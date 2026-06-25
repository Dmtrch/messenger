; ============================================================================
; Messenger Server — Windows Installer
; Требуется: Inno Setup 6+
; Сборка:    ISCC.exe scripts\messenger-setup.iss  (из корня проекта)
;            или запустите scripts\build-windows-installer.ps1
; ============================================================================

#define AppName        "Messenger Server"
#define AppVersion     "1.0"
#define ServiceName    "Messenger"
#define ServiceDisplay "Messenger Server"
#define ExeName        "messenger.exe"

[Setup]
AppId={{F3A2B1C4-D5E6-7890-ABCD-EF0123456789}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Messenger
DefaultDirName={autopf}\Messenger
DefaultGroupName={#AppName}
OutputDir=dist
OutputBaseFilename=messenger-server-setup
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Files]
Source: "dist\{#ExeName}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Открыть Admin-панель"; Filename: "{app}\open-admin.bat"
Name: "{group}\Управление сервисом"; Filename: "{app}\server-ctl.bat"
Name: "{group}\Удалить {#AppName}"; Filename: "{uninstallexe}"

[UninstallRun]
Filename: "sc.exe"; Parameters: "stop {#ServiceName}"; Flags: runhidden waituntilterminated; RunOnceId: "StopService"
Filename: "sc.exe"; Parameters: "delete {#ServiceName}"; Flags: runhidden waituntilterminated; RunOnceId: "DeleteService"
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""{#AppName}"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveFirewall"

[Code]
var
  ServerPage:  TInputQueryWizardPage;
  AdminPage:   TInputQueryWizardPage;
  RegModePage: TInputOptionWizardPage;

{ SetEnvironmentVariableW — для передачи Unicode-контента дочернему процессу }
function SetEnvironmentVariable(lpName: String; lpValue: String): BOOL;
  external 'SetEnvironmentVariableW@kernel32.dll stdcall';

{ Запись файла в кодировке UTF-8 без BOM.
  Контент передаётся через переменную окружения (Unicode), поэтому никакой
  ANSI-перекодировки не происходит — работает корректно на PS5 и PS7. }
procedure WriteUtf8File(const FileName, Content: String);
var
  TempPS: String;
  ResultCode: Integer;
begin
  TempPS := ExpandConstant('{tmp}\messenger_write_utf8.ps1');
  SetEnvironmentVariable('_MSG_CONTENT', Content);
  SaveStringToFile(TempPS,
    '[System.IO.File]::WriteAllText(' +
    '"' + FileName + '", ' +
    '$env:_MSG_CONTENT, ' +
    '[System.Text.UTF8Encoding]::new($false))' + #13#10,
    False);
  Exec('powershell.exe',
    '-NoProfile -ExecutionPolicy Bypass -File "' + TempPS + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  SetEnvironmentVariable('_MSG_CONTENT', '');
end;

{ Экранирование специальных символов для YAML double-quoted строки }
function EscapeYaml(const S: String): String;
var
  I: Integer;
  R: String;
begin
  R := '';
  for I := 1 to Length(S) do begin
    if S[I] = '\' then R := R + '\\'
    else if S[I] = '"' then R := R + '\"'
    else R := R + S[I];
  end;
  Result := R;
end;

{ Замена обратных слешей на прямые (для путей в YAML) }
function ToSlash(const S: String): String;
var
  I: Integer;
  R: String;
begin
  R := S;
  for I := 1 to Length(R) do
    if R[I] = '\' then R[I] := '/';
  Result := R;
end;

{ Извлечение значения после "KEY=" в многострочном тексте }
function ParseAfterKey(const Content, Key: String): String;
var
  SearchStr: String;
  P, Q: Integer;
begin
  Result := '';
  SearchStr := Key + '=';
  P := Pos(SearchStr, Content);
  if P = 0 then Exit;
  P := P + Length(SearchStr);
  Q := P;
  while (Q <= Length(Content)) and
        (Content[Q] <> #13) and (Content[Q] <> #10) and (Content[Q] <> ' ') do
    Inc(Q);
  Result := Trim(Copy(Content, P, Q - P));
end;

procedure InitializeWizard;
begin
  ServerPage := CreateInputQueryPage(wpWelcome,
    'Настройка сервера', 'Укажите основные параметры сервера', '');
  ServerPage.Add('Имя сервера:', False);
  ServerPage.Add('Описание:', False);
  ServerPage.Add('Порт (по умолчанию 8080):', False);
  ServerPage.Add('Публичный URL (напр. https://chat.example.com; пусто = localhost):', False);
  ServerPage.Values[0] := 'Messenger';
  ServerPage.Values[1] := 'Self-hosted messenger';
  ServerPage.Values[2] := '8080';
  ServerPage.Values[3] := '';

  AdminPage := CreateInputQueryPage(ServerPage.ID,
    'Учётная запись администратора', 'Укажите данные для входа в Admin-панель', '');
  AdminPage.Add('Логин:', False);
  AdminPage.Add('Пароль:', True);
  AdminPage.Add('Подтвердите пароль:', True);
  AdminPage.Values[0] := 'admin';

  RegModePage := CreateInputOptionPage(AdminPage.ID,
    'Режим регистрации', 'Кто может регистрироваться на сервере?',
    'Можно изменить позже в Admin-панели.', True, False);
  RegModePage.Add('Открытый — любой может создать аккаунт');
  RegModePage.Add('По приглашению — только с инвайт-кодом администратора');
  RegModePage.Add('С одобрения — администратор одобряет каждую заявку');
  RegModePage.SelectedValueIndex := 0;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;

  if CurPageID = ServerPage.ID then begin
    if Trim(ServerPage.Values[0]) = '' then begin
      MsgBox('Укажите имя сервера.', mbError, MB_OK);
      Result := False; Exit;
    end;
    if Trim(ServerPage.Values[2]) = '' then begin
      MsgBox('Укажите порт.', mbError, MB_OK);
      Result := False; Exit;
    end;
  end;

  if CurPageID = AdminPage.ID then begin
    if Trim(AdminPage.Values[0]) = '' then begin
      MsgBox('Укажите логин администратора.', mbError, MB_OK);
      Result := False; Exit;
    end;
    if AdminPage.Values[1] = '' then begin
      MsgBox('Укажите пароль.', mbError, MB_OK);
      Result := False; Exit;
    end;
    if AdminPage.Values[1] <> AdminPage.Values[2] then begin
      MsgBox('Пароли не совпадают. Повторите ввод.', mbError, MB_OK);
      AdminPage.Values[1] := '';
      AdminPage.Values[2] := '';
      Result := False; Exit;
    end;
    if Length(AdminPage.Values[1]) < 8 then begin
      if MsgBox('Пароль короткий (менее 8 символов). Продолжить?',
          mbConfirmation, MB_YESNO) = IDNO then begin
        Result := False; Exit;
      end;
    end;
  end;
end;

function RegModeStr: String;
begin
  case RegModePage.SelectedValueIndex of
    0: Result := 'open';
    1: Result := 'invite';
  else
    Result := 'approval';
  end;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo,
  MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result :=
    'Параметры сервера:' + NewLine +
    Space + 'Имя:        ' + Trim(ServerPage.Values[0]) + NewLine +
    Space + 'Порт:       ' + Trim(ServerPage.Values[2]) + NewLine +
    Space + 'Регистрация: ' + RegModeStr() + NewLine +
    Space + 'Администратор: ' + Trim(AdminPage.Values[0]) + NewLine +
    NewLine +
    MemoDirInfo + NewLine;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  AppDir, DataDir, ConfigFile: String;
  TempPS, TempJWT, TempStdout, TempStderr, TempResult: String;
  JWTSecret, VapidAll, VapidPriv, VapidPub: String;
  ServerName, ServerDesc, Port, AllowedOrigin: String;
  AdminUser, AdminPass, RegMode: String;
  ResultCode: Integer;
  Cfg, AdminInfo: String;
  FileContent: AnsiString;
begin
  if CurStep <> ssPostInstall then Exit;

  AppDir     := ExpandConstant('{app}');
  DataDir    := ExpandConstant('{commonappdata}\Messenger');
  ConfigFile := DataDir + '\config.yaml';

  { Значения мастера }
  ServerName    := Trim(ServerPage.Values[0]);
  ServerDesc    := Trim(ServerPage.Values[1]);
  Port          := Trim(ServerPage.Values[2]);
  AllowedOrigin := Trim(ServerPage.Values[3]);
  AdminUser     := Trim(AdminPage.Values[0]);
  AdminPass     := AdminPage.Values[1];
  RegMode       := RegModeStr();

  { Создать директории данных }
  ForceDirectories(DataDir + '\data\media');
  ForceDirectories(DataDir + '\data\downloads');
  ForceDirectories(DataDir + '\logs');

  { ── Генерация JWT_SECRET ──────────────────────────────────────────────── }
  TempJWT := ExpandConstant('{tmp}\messenger_jwt.txt');
  TempPS  := ExpandConstant('{tmp}\gen_jwt.ps1');
  SaveStringToFile(TempPS,
    '$b = New-Object byte[] 32; ' +
    '[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ' +
    '[System.BitConverter]::ToString($b).Replace("-","").ToLower() | ' +
    'Out-File -FilePath "' + TempJWT + '" -Encoding ascii -NoNewline' + #13#10,
    False);
  Exec('powershell.exe',
    '-NoProfile -ExecutionPolicy Bypass -File "' + TempPS + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if LoadStringFromFile(TempJWT, FileContent) then
    JWTSecret := Trim(String(FileContent));

  { ── Запись начального config.yaml (без VAPID) ────────────────────────── }
  Cfg :=
    '# Сгенерировано установщиком Messenger Server' + #13#10 +
    'port: "' + EscapeYaml(Port) + '"' + #13#10 +
    'jwt_secret: "' + EscapeYaml(JWTSecret) + '"' + #13#10 +
    'db_path: "' + EscapeYaml(ToSlash(DataDir)) + '/data/messenger.db"' + #13#10 +
    'media_dir: "' + EscapeYaml(ToSlash(DataDir)) + '/data/media"' + #13#10 +
    'downloads_dir: "' + EscapeYaml(ToSlash(DataDir)) + '/data/downloads"' + #13#10 +
    'server_name: "' + EscapeYaml(ServerName) + '"' + #13#10 +
    'server_description: "' + EscapeYaml(ServerDesc) + '"' + #13#10 +
    'registration_mode: "' + RegMode + '"' + #13#10 +
    'admin_username: "' + EscapeYaml(AdminUser) + '"' + #13#10 +
    'admin_password: "' + EscapeYaml(AdminPass) + '"' + #13#10 +
    'stun_url: "stun:stun.l.google.com:19302"' + #13#10 +
    'vapid_private_key: ""' + #13#10 +
    'vapid_public_key: ""' + #13#10;
  WriteUtf8File(ConfigFile, Cfg);

  { ── Кратковременный запуск сервера для генерации VAPID-ключей ─────────── }
  TempStdout := ExpandConstant('{tmp}\messenger_stdout.txt');
  TempStderr := ExpandConstant('{tmp}\messenger_stderr.txt');
  TempResult := ExpandConstant('{tmp}\messenger_vapid.txt');
  TempPS     := ExpandConstant('{tmp}\get_vapid.ps1');

  SaveStringToFile(TempPS,
    '$p = Start-Process -FilePath "' + AppDir + '\' + '{#ExeName}" ' +
    '-ArgumentList "--config", "' + ConfigFile + '" ' +
    '-PassThru -WindowStyle Hidden ' +
    '-RedirectStandardOutput "' + TempStdout + '" ' +
    '-RedirectStandardError "' + TempStderr + '"' + #13#10 +
    'Start-Sleep -Seconds 12' + #13#10 +
    'Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue' + #13#10 +
    '$out = (Get-Content "' + TempStdout + '" -Raw -ErrorAction SilentlyContinue)' + #13#10 +
    '$err = (Get-Content "' + TempStderr + '" -Raw -ErrorAction SilentlyContinue)' + #13#10 +
    '($out + $err) | Out-File -FilePath "' + TempResult + '" -Encoding utf8 -NoNewline' + #13#10,
    False);

  Exec('powershell.exe',
    '-NoProfile -ExecutionPolicy Bypass -File "' + TempPS + '"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  { Парсинг VAPID-ключей из вывода }
  if LoadStringFromFile(TempResult, FileContent) then begin
    VapidAll  := String(FileContent);
    VapidPriv := ParseAfterKey(VapidAll, 'VAPID_PRIVATE_KEY');
    VapidPub  := ParseAfterKey(VapidAll, 'VAPID_PUBLIC_KEY');
  end;

  { ── Обновление config.yaml с VAPID-ключами ───────────────────────────── }
  if (VapidPriv <> '') and (VapidPub <> '') then begin
    Cfg :=
      '# Сгенерировано установщиком Messenger Server' + #13#10 +
      'port: "' + EscapeYaml(Port) + '"' + #13#10 +
      'jwt_secret: "' + EscapeYaml(JWTSecret) + '"' + #13#10 +
      'db_path: "' + EscapeYaml(ToSlash(DataDir)) + '/data/messenger.db"' + #13#10 +
      'media_dir: "' + EscapeYaml(ToSlash(DataDir)) + '/data/media"' + #13#10 +
      'downloads_dir: "' + EscapeYaml(ToSlash(DataDir)) + '/data/downloads"' + #13#10 +
      'server_name: "' + EscapeYaml(ServerName) + '"' + #13#10 +
      'server_description: "' + EscapeYaml(ServerDesc) + '"' + #13#10 +
      'registration_mode: "' + RegMode + '"' + #13#10 +
      'admin_username: "' + EscapeYaml(AdminUser) + '"' + #13#10 +
      'admin_password: "' + EscapeYaml(AdminPass) + '"' + #13#10 +
      'stun_url: "stun:stun.l.google.com:19302"' + #13#10 +
      'vapid_private_key: "' + EscapeYaml(VapidPriv) + '"' + #13#10 +
      'vapid_public_key: "' + EscapeYaml(VapidPub) + '"' + #13#10;
    WriteUtf8File(ConfigFile, Cfg);
  end;

  { ── Вспомогательные .bat файлы ───────────────────────────────────────── }
  SaveStringToFile(AppDir + '\open-admin.bat',
    '@echo off' + #13#10 +
    'start http://localhost:' + Port + '/admin/' + #13#10,
    False);

  { server-ctl.bat пишем через WriteUtf8File (UTF-8 без BOM) + chcp 65001,
    иначе кириллица в консоли выводится кракозябрами (ANSI/cp1251 vs OEM cp866). }
  WriteUtf8File(AppDir + '\server-ctl.bat',
    '@echo off' + #13#10 +
    'chcp 65001 >nul' + #13#10 +
    'setlocal' + #13#10 +
    'echo  Управление Messenger Server' + #13#10 +
    'echo  ==============================' + #13#10 +
    'echo  1. Запустить сервис' + #13#10 +
    'echo  2. Остановить сервис' + #13#10 +
    'echo  3. Перезапустить сервис' + #13#10 +
    'echo  4. Статус сервиса' + #13#10 +
    'echo  5. Просмотр логов' + #13#10 +
    'echo  ==============================' + #13#10 +
    'set /p choice=  Ваш выбор: ' + #13#10 +
    'if "%choice%"=="1" sc start {#ServiceName}' + #13#10 +
    'if "%choice%"=="2" sc stop {#ServiceName}' + #13#10 +
    'if "%choice%"=="3" (sc stop {#ServiceName} && timeout /t 3 >nul && sc start {#ServiceName})' + #13#10 +
    'if "%choice%"=="4" sc query {#ServiceName}' + #13#10 +
    'if "%choice%"=="5" explorer "' + DataDir + '\logs"' + #13#10 +
    'pause' + #13#10);

  { ── Остановить и удалить старый сервис (при переустановке) ───────────── }
  Exec('sc.exe', 'stop {#ServiceName}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Exec('sc.exe', 'delete {#ServiceName}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(2000);

  { ── Регистрация Windows-сервиса ──────────────────────────────────────── }
  Exec('sc.exe',
    'create {#ServiceName}' +
    ' binPath= "\"' + AppDir + '\{#ExeName}\" --config \"' + ConfigFile + '\""' +
    ' start= auto' +
    ' DisplayName= "{#ServiceDisplay}"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  Exec('sc.exe',
    'description {#ServiceName} "Messenger — Self-hosted E2E encrypted messenger"',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  { Автоперезапуск при сбое: 5с → 10с → 30с, сброс через 60с }
  Exec('sc.exe',
    'failure {#ServiceName} reset= 60 actions= restart/5000/restart/10000/restart/30000',
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  { ── Правило брандмауэра ──────────────────────────────────────────────── }
  Exec('netsh.exe',
    'advfirewall firewall add rule name="{#AppName}" dir=in action=allow protocol=TCP localport=' + Port,
    '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  { ── Запуск сервиса ───────────────────────────────────────────────────── }
  Exec('sc.exe', 'start {#ServiceName}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

  { ── Файл с данными администратора ────────────────────────────────────── }
  AdminInfo :=
    '=============================================================' + #13#10 +
    '  MESSENGER SERVER — ДАННЫЕ АДМИНИСТРАТОРА' + #13#10 +
    '=============================================================' + #13#10 +
    '' + #13#10 +
    '  Локальный URL:   http://localhost:' + Port + #13#10 +
    '  Admin-панель:    http://localhost:' + Port + '/admin/' + #13#10;

  if AllowedOrigin <> '' then
    AdminInfo := AdminInfo +
      '  Публичный URL:   ' + AllowedOrigin + #13#10 +
      '  Admin-панель:    ' + AllowedOrigin + '/admin/' + #13#10;

  AdminInfo := AdminInfo +
    '' + #13#10 +
    '  Логин:    ' + AdminUser + #13#10 +
    '  Пароль:   ' + AdminPass + #13#10 +
    '' + #13#10 +
    '  Конфигурация:  ' + ConfigFile + #13#10 +
    '  Данные:        ' + DataDir + '\data' + #13#10 +
    '  Логи:          ' + DataDir + '\logs' + #13#10 +
    '  Бинарник:      ' + AppDir + '\{#ExeName}' + #13#10 +
    '' + #13#10 +
    '  Управление сервисом:' + #13#10 +
    '    sc start {#ServiceName}    — запуск' + #13#10 +
    '    sc stop {#ServiceName}     — остановка' + #13#10 +
    '    sc query {#ServiceName}    — статус' + #13#10 +
    '' + #13#10 +
    '  VAPID_PUBLIC_KEY:  ' + VapidPub + #13#10 +
    '  VAPID_PRIVATE_KEY: ' + VapidPriv + #13#10 +
    '' + #13#10 +
    '  СОХРАНИТЕ ЭТОТ ФАЙЛ В НАДЁЖНОМ МЕСТЕ!' + #13#10 +
    '  НИКОГДА не публикуйте JWT_SECRET и VAPID_PRIVATE_KEY.' + #13#10 +
    '=============================================================' + #13#10;

  WriteUtf8File(AppDir + '\server-main.txt', AdminInfo);

  { Показать файл с данными }
  Exec('notepad.exe', AppDir + '\server-main.txt', '', SW_SHOWNORMAL, ewNoWait, ResultCode);
end;
