# Установка сервера Messenger

> **Как использовать этот файл.**
> Положи его в папку с репозиторием Messenger на сервере.
> Открой Claude Code (`claude`) и скажи:
> `прочитай install-server.md и выполни все инструкции`

---

## Задача для Claude Code

Ты устанавливаешь и настраиваешь backend-сервер мессенджера Messenger.
Рабочая папка — текущий каталог, в котором находится этот файл.
В папке `server/` лежит Go-исходник сервера.

**Первым делом определи ОС:**
- Если Windows — выполняй только раздел [Windows](#windows-установка).
- Если Linux или macOS — выполняй основные шаги 1–13.

Выполни все шаги по порядку. После каждого шага убедись, что он завершился успешно, прежде чем переходить к следующему.
Не спрашивай подтверждения между шагами — выполни весь процесс автономно от начала до конца.
В конце выведи итоговую сводку с URL сервера и учётными данными администратора.

---

## Шаг 1. Определить окружение

Выясни:
- Операционную систему и дистрибутив (`uname -a`, `lsb_release -a` или `/etc/os-release`)
- Архитектуру процессора (`uname -m`)
- Имя текущего пользователя и домашнюю папку
- Путь к текущей рабочей папке (`pwd`)

Запомни эти значения — они понадобятся в следующих шагах.

---

## Шаг 2. Проверить и установить Go 1.22+

Проверь: `go version`

Если Go не установлен или версия ниже 1.22, установи актуальную версию:

**Linux (x86_64):**
```bash
GO_VERSION=1.22.5
curl -OL https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz
sudo rm -rf /usr/local/go
sudo tar -C /usr/local -xzf go${GO_VERSION}.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
export PATH=$PATH:/usr/local/go/bin
```

**Linux (arm64):**
```bash
GO_VERSION=1.22.5
curl -OL https://go.dev/dl/go${GO_VERSION}.linux-arm64.tar.gz
sudo rm -rf /usr/local/go
sudo tar -C /usr/local -xzf go${GO_VERSION}.linux-arm64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
export PATH=$PATH:/usr/local/go/bin
```

**macOS:**
```bash
brew install go
```

После установки убедись: `go version` показывает 1.22+.

---

## Шаг 3. Определить публичный IP-адрес

Выполни по очереди — используй первый успешный результат:
```bash
curl -s https://ifconfig.me
curl -s https://api.ipify.org
curl -s https://icanhazip.com
```

Также определи локальный IP (нужен для systemd):
```bash
hostname -I | awk '{print $1}'
```

Запомни публичный IP — он войдёт в `allowed_origin` и итоговый URL.

---

## Шаг 4. Выбрать порт

По умолчанию используй порт **8080**.

Проверь, свободен ли он:
```bash
ss -tlnp | grep ':8080' || echo "порт свободен"
```

Если порт занят, попробуй 8443, 3000, 9000 — первый свободный.

---

## Шаг 5. Открыть порт в firewall

**Ubuntu/Debian (ufw):**
```bash
sudo ufw allow <ПОРТ>/tcp
sudo ufw status
```

**CentOS/RHEL (firewalld):**
```bash
sudo firewall-cmd --permanent --add-port=<ПОРТ>/tcp
sudo firewall-cmd --reload
```

**iptables (если нет ufw/firewalld):**
```bash
sudo iptables -A INPUT -p tcp --dport <ПОРТ> -j ACCEPT
```

---

## Шаг 6. Сгенерировать секреты

**JWT_SECRET** (минимум 32 символа):
```bash
openssl rand -hex 32
```

**VAPID-ключи** для Web Push уведомлений.
Сервер может сгенерировать их сам при первом запуске, если они не указаны в config.
Оставь поля `vapid_public_key` и `vapid_private_key` пустыми — сервер сам создаст их и выведет в лог.

**Пароль администратора** — придумай надёжный пароль (минимум 12 символов).
Запомни его — он потребуется для входа в панель администратора.

---

## Шаг 7. Создать config.yaml

Создай файл `server/config.yaml` со следующим содержимым.
Подставь реальные значения вместо плейсхолдеров:

```yaml
port: "<ПОРТ>"
db_path: "./messenger.db"
media_dir: "./media"
downloads_dir: "./downloads"
jwt_secret: "<JWT_SECRET из шага 6>"
allowed_origin: "http://<ПУБЛИЧНЫЙ_IP>:<ПОРТ>"
behind_proxy: false
stun_url: "stun:stun.l.google.com:19302"
turn_url: ""
turn_secret: ""
server_name: "Messenger"
server_description: "Самохостируемый мессенджер"
registration_mode: "open"
admin_username: "admin"
admin_password: "<ПАРОЛЬ_АДМИНИСТРАТОРА>"
vapid_public_key: ""
vapid_private_key: ""

# Push-уведомления для мобильных (опционально):
# fcm_legacy_key: ""
# apns_key_path: ""
# apns_key_id: ""
# apns_team_id: ""
# apns_bundle_id: "com.messenger"
# apns_sandbox: true

# Политики групп и загрузок (опционально):
# max_group_members: 50
# allow_users_create_groups: true
# max_upload_bytes: 104857600

# Метаданные приложения (опционально):
# app_version: "1.0.0"
# min_client_version: "0.0.0"
```

Примечания:
- `registration_mode`: `open` — регистрация открыта; `invite` — только по инвайт-коду; `approval` — с одобрения администратора.
- `behind_proxy`: установи `true`, если сервер работает за Cloudflare или nginx.
- `downloads_dir`: папка для хранения загруженных файлов (отдельно от медиа).
- Поля FCM/APNs раскомментируй при подключении мобильных push-уведомлений.

---

## Шаг 8. Создать директории

```bash
mkdir -p server/media
```

---

## Шаг 9. Собрать бинарник

```bash
cd server
go mod download
go build -o bin/server ./cmd/server
cd ..
```

Убедись, что файл `server/bin/server` создан и имеет права на выполнение.

---

## Шаг 10. Настроить автозапуск

### Linux — systemd (рекомендуется)

Создай файл `/etc/systemd/system/messenger.service`:

```ini
[Unit]
Description=Messenger Server
After=network.target

[Service]
Type=simple
User=<ТЕКУЩИЙ_ПОЛЬЗОВАТЕЛЬ>
WorkingDirectory=<ПОЛНЫЙ_ПУТЬ_К_ПАПКЕ>/server
ExecStart=<ПОЛНЫЙ_ПУТЬ_К_ПАПКЕ>/server/bin/server
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=HOME=<ДОМАШНЯЯ_ПАПКА>

[Install]
WantedBy=multi-user.target
```

Подставь реальные пути из шага 1. Затем:
```bash
sudo systemctl daemon-reload
sudo systemctl enable messenger
sudo systemctl start messenger
```

### macOS — launchd

Создай файл `~/Library/LaunchAgents/com.messenger.server.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.messenger.server</string>
  <key>ProgramArguments</key>
  <array>
    <string><ПОЛНЫЙ_ПУТЬ>/server/bin/server</string>
  </array>
  <key>WorkingDirectory</key>
  <string><ПОЛНЫЙ_ПУТЬ>/server</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/messenger.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/messenger-error.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.messenger.server.plist
```

---

## Шаг 11. Проверить запуск

**Linux:**
```bash
sudo systemctl status messenger
journalctl -u messenger -n 50
```

**macOS:**
```bash
cat /tmp/messenger.log
```

Убедись, что в логе нет `FATAL` и есть строка вида:
```
listening on :8080
```

---

## Шаг 12. Проверить доступность сервера

Проверь изнутри:
```bash
curl -s http://localhost:<ПОРТ>/api/server/info | head -c 200
```

Ожидаемый ответ — JSON с `server_name`, `registration_mode`.

Проверь снаружи:
```bash
curl -s http://<ПУБЛИЧНЫЙ_IP>:<ПОРТ>/api/server/info | head -c 200
```

Если внешний запрос не проходит — проверь firewall (шаг 5) и убедись, что хостинг-провайдер не блокирует порт.

---

## Шаг 13. Вывести итоговую сводку

После успешной проверки выведи пользователю сводку в следующем формате:

```
╔══════════════════════════════════════════════════╗
║           СЕРВЕР MESSENGER ЗАПУЩЕН               ║
╠══════════════════════════════════════════════════╣
║ URL сервера:  http://<IP>:<ПОРТ>                 ║
║ Панель admin: http://<IP>:<ПОРТ>  (роль admin)   ║
╠══════════════════════════════════════════════════╣
║ Логин администратора:  admin                     ║
║ Пароль администратора: <ПАРОЛЬ>                  ║
╠══════════════════════════════════════════════════╣
║ Режим регистрации:  open                         ║
║ Путь к БД:          server/messenger.db          ║
║ Медиафайлы:         server/media/                ║
║ Конфигурация:       server/config.yaml           ║
╠══════════════════════════════════════════════════╣
║ Для просмотра логов:                             ║
║   sudo journalctl -u messenger -f                ║
║ Для перезапуска:                                 ║
║   sudo systemctl restart messenger               ║
╚══════════════════════════════════════════════════╝

Как подключиться из приложения:
  1. Открой Messenger (web, desktop или mobile)
  2. На экране настройки сервера введи: http://<IP>:<ПОРТ>
  3. Зарегистрируйся или войди под учётными данными admin
```

---

## Устранение типичных проблем

**`JWT_SECRET is required`** — config.yaml не найден или поле пустое. Проверь путь и содержимое файла.

**`address already in use`** — порт занят. Смени `port` в config.yaml и повтори шаги 5, 10.

**`permission denied` при bind на порт < 1024** — используй порт >= 1024 или добавь capability:
```bash
sudo setcap cap_net_bind_service=+ep server/bin/server
```

**Внешний запрос не проходит, внутренний работает** — проверь firewall (шаг 5) и правила безопасности у хостинг-провайдера (Security Groups, Network ACL).

**Сервер не стартует после перезагрузки** — убедись, что `systemctl enable messenger` выполнен.

---

## Windows — установка

> Этот раздел выполняется **вместо** шагов 1–13, если ОС — Windows.
> Все команды выполняются в **PowerShell от имени администратора**.
> Открой: Пуск → PowerShell → правая кнопка → «Запуск от имени администратора».

---

### W-1. Определить окружение

```powershell
$env:OS
[System.Environment]::OSVersion.VersionString
[System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture
$env:USERNAME
$PWD.Path
```

Запомни полный путь к текущей папке — он понадобится в шаге W-6.

---

### W-2. Проверить и установить Go 1.22+

```powershell
go version
```

Если Go не установлен или версия ниже 1.22:

```powershell
# Скачать MSI-установщик Go 1.22 для Windows amd64
$goVersion = "1.22.5"
$goArch = if ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -eq "Arm64") { "arm64" } else { "amd64" }
$url = "https://go.dev/dl/go$goVersion.windows-$goArch.msi"
Invoke-WebRequest -Uri $url -OutFile "$env:TEMP\go-installer.msi"
Start-Process msiexec.exe -Wait -ArgumentList "/i $env:TEMP\go-installer.msi /quiet"
$env:PATH = "C:\Program Files\Go\bin;" + $env:PATH
```

Проверь: `go version` должен показать 1.22+.

---

### W-3. Определить публичный IP-адрес

```powershell
$publicIP = (Invoke-WebRequest -Uri "https://ifconfig.me" -UseBasicParsing).Content.Trim()
Write-Host "Публичный IP: $publicIP"
```

Если первый запрос не прошёл, попробуй:
```powershell
$publicIP = (Invoke-WebRequest -Uri "https://api.ipify.org" -UseBasicParsing).Content.Trim()
```

---

### W-4. Выбрать порт

По умолчанию — порт **8080**. Проверь, свободен ли он:

```powershell
$port = 8080
$occupied = netstat -ano | Select-String ":$port "
if ($occupied) {
    Write-Host "Порт $port занят, пробую 8443..."
    $port = 8443
}
Write-Host "Выбран порт: $port"
```

---

### W-5. Открыть порт в Windows Firewall

```powershell
New-NetFirewallRule `
  -DisplayName "Messenger Server" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort $port `
  -Action Allow `
  -Profile Any
Write-Host "Правило firewall создано для порта $port"
```

Проверь, что правило добавлено:
```powershell
Get-NetFirewallRule -DisplayName "Messenger Server"
```

---

### W-6. Создать config.yaml и директории

Сгенерируй JWT_SECRET:
```powershell
$jwtSecret = [System.Web.Security.Membership]::GeneratePassword(32, 4)
# Если нет System.Web, используй альтернативу:
$jwtSecret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
Write-Host "JWT_SECRET: $jwtSecret"
```

Придумай пароль администратора и подставь его ниже.

Создай директорию для медиафайлов:
```powershell
New-Item -ItemType Directory -Force -Path "server\media"
```

Создай файл `server\config.yaml`:
```powershell
$adminPassword = "ЗАМЕНИ_НА_СВОЙ_ПАРОЛЬ"   # <-- вставь реальный пароль

$config = @"
port: "$port"
db_path: "./messenger.db"
media_dir: "./media"
downloads_dir: "./downloads"
jwt_secret: "$jwtSecret"
allowed_origin: "http://${publicIP}:${port}"
behind_proxy: false
stun_url: "stun:stun.l.google.com:19302"
turn_url: ""
turn_secret: ""
server_name: "Messenger"
server_description: "Самохостируемый мессенджер"
registration_mode: "open"
admin_username: "admin"
admin_password: "$adminPassword"
vapid_public_key: ""
vapid_private_key: ""

# Push-уведомления для мобильных (опционально):
# fcm_legacy_key: ""
# apns_key_path: ""
# apns_key_id: ""
# apns_team_id: ""
# apns_bundle_id: "com.messenger"
# apns_sandbox: true

# Политики групп и загрузок (опционально):
# max_group_members: 50
# allow_users_create_groups: true
# max_upload_bytes: 104857600

# Метаданные приложения (опционально):
# app_version: "1.0.0"
# min_client_version: "0.0.0"
"@

Set-Content -Path "server\config.yaml" -Value $config -Encoding UTF8
Write-Host "config.yaml создан"
```

---

### W-7. Собрать бинарник

```powershell
Push-Location server
go mod download
New-Item -ItemType Directory -Force -Path "bin"
go build -o bin\server.exe .\cmd\server
Pop-Location
```

Убедись, что файл создан:
```powershell
Test-Path "server\bin\server.exe"
```

---

### W-8. Настроить автозапуск — Windows Service через NSSM

NSSM ("Non-Sucking Service Manager") — простейший способ запустить любой исполняемый файл как Windows Service.

**Установить NSSM:**
```powershell
# Скачать NSSM
Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile "$env:TEMP\nssm.zip"
Expand-Archive -Path "$env:TEMP\nssm.zip" -DestinationPath "$env:TEMP\nssm" -Force

# Определить архитектуру и скопировать нужный бинарник
$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -eq "Arm64") { "arm64" } else { "win64" }
Copy-Item "$env:TEMP\nssm\nssm-2.24\$arch\nssm.exe" "C:\Windows\System32\nssm.exe"
Write-Host "NSSM установлен"
```

**Зарегистрировать сервис:**
```powershell
$repoPath = $PWD.Path   # путь к корню репозитория

nssm install MessengerServer "$repoPath\server\bin\server.exe"
nssm set MessengerServer AppDirectory "$repoPath\server"
nssm set MessengerServer DisplayName "Messenger Server"
nssm set MessengerServer Description "Self-hosted E2E encrypted messenger"
nssm set MessengerServer Start SERVICE_AUTO_START
nssm set MessengerServer AppStdout "$repoPath\server\messenger.log"
nssm set MessengerServer AppStderr "$repoPath\server\messenger-error.log"
nssm set MessengerServer AppRotateFiles 1
nssm set MessengerServer AppRotateBytes 10485760

nssm start MessengerServer
Write-Host "Сервис MessengerServer запущен"
```

---

### W-9. Проверить запуск

```powershell
# Статус сервиса
Get-Service -Name MessengerServer

# Последние строки лога
Start-Sleep -Seconds 3
Get-Content "server\messenger.log" -Tail 20
```

Убедись, что в логе есть строка `listening on :<ПОРТ>` и нет `FATAL`.

---

### W-10. Проверить доступность

Изнутри:
```powershell
Invoke-WebRequest -Uri "http://localhost:$port/api/server/info" -UseBasicParsing | Select-Object -ExpandProperty Content
```

Снаружи:
```powershell
Invoke-WebRequest -Uri "http://${publicIP}:${port}/api/server/info" -UseBasicParsing | Select-Object -ExpandProperty Content
```

Ожидаемый ответ — JSON с `server_name` и `registration_mode`.

Если внешний запрос не проходит:
1. Убедись, что правило firewall создано (шаг W-5).
2. Проверь, не блокирует ли роутер порт (нужен port forwarding, если сервер за NAT).
3. Если используется хостинг-провайдер — проверь Security Groups / Network ACL.

---

### W-11. Итоговая сводка (Windows)

После успешной проверки выведи пользователю:

```
╔══════════════════════════════════════════════════╗
║        СЕРВЕР MESSENGER ЗАПУЩЕН (Windows)        ║
╠══════════════════════════════════════════════════╣
║ URL сервера:  http://<IP>:<ПОРТ>                 ║
║ Панель admin: http://<IP>:<ПОРТ>  (роль admin)   ║
╠══════════════════════════════════════════════════╣
║ Логин администратора:  admin                     ║
║ Пароль администратора: <ПАРОЛЬ>                  ║
╠══════════════════════════════════════════════════╣
║ Режим регистрации:  open                         ║
║ Конфигурация:  server\config.yaml                ║
║ Лог сервера:   server\messenger.log              ║
╠══════════════════════════════════════════════════╣
║ Управление сервисом (PowerShell admin):          ║
║   Start-Service MessengerServer                  ║
║   Stop-Service  MessengerServer                  ║
║   Restart-Service MessengerServer                ║
║   Get-Content server\messenger.log -Tail 50 -Wait║
╚══════════════════════════════════════════════════╝

Как подключиться из приложения:
  1. Открой Messenger (web, desktop или mobile)
  2. На экране настройки сервера введи: http://<IP>:<ПОРТ>
  3. Зарегистрируйся или войди под учётными данными admin
```

---

### Устранение проблем на Windows

**`go : The term 'go' is not recognized`** — Go не в PATH. Закрой и снова открой PowerShell как администратор, или выполни:
```powershell
$env:PATH = "C:\Program Files\Go\bin;" + $env:PATH
```

**`нет доступа` при создании сервиса** — PowerShell запущен не от администратора. Перезапусти.

**Сервис падает сразу** — проверь лог:
```powershell
Get-Content "server\messenger-error.log" -Tail 30
```
Чаще всего причина: не найден `config.yaml` или пустой `jwt_secret`.

**Внешний IP недоступен, локальный работает** — сервер за роутером с NAT. Нужно настроить **проброс порта (port forwarding)** на роутере: внешний порт `<ПОРТ>` → локальный IP машины → порт `<ПОРТ>`. Локальный IP получи командой: `(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" })[0].IPAddress`

**Удалить сервис** (если нужно переустановить):
```powershell
nssm stop MessengerServer
nssm remove MessengerServer confirm
```
