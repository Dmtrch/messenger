@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

:: =============================================================================
:: Messenger Server — автоматическая установка (Windows)
:: =============================================================================
:: Использование:
::   Запустите от имени администратора: install-server.bat
::
:: Результат:
::   • Сервер запущен в Docker
::   • Файл server-main.txt — все данные для администратора
:: =============================================================================

title Messenger Server Installer

echo.
echo  ===================================================================
echo    MESSENGER SERVER — УСТАНОВКА (Windows)
echo  ===================================================================
echo.

:: ── Проверка прав администратора ─────────────────────────────────────────────
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo  [ERR] Запустите этот файл от имени администратора!
    echo        Правая кнопка мыши -> "Запуск от имени администратора"
    pause
    exit /b 1
)

:: ── Проверка зависимостей ─────────────────────────────────────────────────────
echo  [INFO] Проверка зависимостей...

where docker >nul 2>&1
if %errorLevel% neq 0 (
    echo  [ERR] Docker не найден.
    echo        Скачайте Docker Desktop: https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
)
echo  [OK]   Docker найден

docker info >nul 2>&1
if %errorLevel% neq 0 (
    echo  [ERR] Docker не запущен. Запустите Docker Desktop и повторите.
    pause
    exit /b 1
)
echo  [OK]   Docker работает

docker compose version >nul 2>&1
if %errorLevel% neq 0 (
    echo  [ERR] Docker Compose не найден. Обновите Docker Desktop.
    pause
    exit /b 1
)
echo  [OK]   Docker Compose найден

where powershell >nul 2>&1
if %errorLevel% neq 0 (
    echo  [ERR] PowerShell не найден (необходим для генерации секретов).
    pause
    exit /b 1
)
echo  [OK]   PowerShell найден

where curl >nul 2>&1
if %errorLevel% neq 0 (
    echo  [WARN] curl не найден, проверка доступности сервера будет пропущена.
    set CURL_AVAILABLE=0
) else (
    set CURL_AVAILABLE=1
)

:: ── Интерактивная конфигурация ────────────────────────────────────────────────
echo.
echo  ===================================================================
echo    Настройка сервера
echo  ===================================================================
echo.
echo  Оставьте поле пустым для значения по умолчанию (в скобках).
echo.

set "SERVER_NAME=Messenger"
set /p "SERVER_NAME=  Имя сервера [Messenger]: "
if "!SERVER_NAME!"=="" set "SERVER_NAME=Messenger"

set "SERVER_DESC=Self-hosted messenger"
set /p "SERVER_DESC=  Описание сервера [Self-hosted messenger]: "
if "!SERVER_DESC!"=="" set "SERVER_DESC=Self-hosted messenger"

set "PORT=8080"
set /p "PORT=  Порт сервера [8080]: "
if "!PORT!"=="" set "PORT=8080"

set "ALLOWED_ORIGIN="
set /p "ALLOWED_ORIGIN=  URL сервера (напр. https://chat.example.com; Enter = localhost): "

set "REG_MODE=open"
set /p "REG_MODE=  Режим регистрации [open/invite/approval] [open]: "
if "!REG_MODE!"=="" set "REG_MODE=open"

if "!REG_MODE!" neq "open" if "!REG_MODE!" neq "invite" if "!REG_MODE!" neq "approval" (
    echo  [ERR] Неверный режим: '!REG_MODE!'. Допустимо: open, invite, approval
    pause
    exit /b 1
)

echo.
echo  Учётная запись администратора:
set "ADMIN_USER=admin"
set /p "ADMIN_USER=    Логин администратора [admin]: "
if "!ADMIN_USER!"=="" set "ADMIN_USER=admin"

:ask_password
echo    Пароль администратора (ввод скрыт не поддерживается в cmd,
echo    используйте достаточно сложный пароль):
set "ADMIN_PASS="
set /p "ADMIN_PASS=    Пароль: "
if "!ADMIN_PASS!"=="" (
    echo  [ERR] Пароль не может быть пустым.
    goto ask_password
)

:: ── TURN (опционально) ───────────────────────────────────────────────────────
echo.
echo  WebRTC TURN-сервер (опционально, Enter — пропустить):
set "TURN_URL="
set /p "TURN_URL=    TURN URL (напр. turn:turn.example.com:3478): "
set "TURN_SECRET_VAL="
if "!TURN_URL!" neq "" (
    set /p "TURN_SECRET_VAL=    TURN Secret: "
)

:: ── Генерация JWT_SECRET через PowerShell ─────────────────────────────────────
echo.
echo  [INFO] Генерация секретов...

for /f "delims=" %%i in ('powershell -NoProfile -Command "[System.BitConverter]::ToString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).Replace('-','').ToLower()"') do (
    set "JWT_SECRET=%%i"
)
echo  [OK]   JWT_SECRET сгенерирован

:: ── Резервная копия .env ─────────────────────────────────────────────────────
if exist ".env" (
    for /f "tokens=*" %%d in ('powershell -NoProfile -Command "Get-Date -Format 'yyyyMMdd-HHmmss'"') do set "TS=%%d"
    copy ".env" ".env.backup.!TS!" >nul
    echo  [WARN] Существующий .env сохранён как .env.backup.!TS!
)

:: ── Запись .env ──────────────────────────────────────────────────────────────
echo  [INFO] Создание .env...

for /f "tokens=*" %%d in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "NOW=%%d"

(
echo # Сгенерировано install-server.bat !NOW!
echo.
echo # -- Обязательные ----------------------------------------------------------
echo JWT_SECRET=!JWT_SECRET!
echo.
echo # -- База данных и хранилище -----------------------------------------------
echo DB_PATH=/data/messenger.db
echo MEDIA_DIR=/data/media
echo DOWNLOADS_DIR=/data/downloads
echo PORT=!PORT!
echo.
echo # -- Сервер ----------------------------------------------------------------
echo SERVER_NAME=!SERVER_NAME!
echo SERVER_DESCRIPTION=!SERVER_DESC!
echo REGISTRATION_MODE=!REG_MODE!
echo.
echo # -- Администратор ---------------------------------------------------------
echo ADMIN_USERNAME=!ADMIN_USER!
echo ADMIN_PASSWORD=!ADMIN_PASS!
echo.
echo # -- Безопасность ----------------------------------------------------------
echo ALLOWED_ORIGIN=!ALLOWED_ORIGIN!
echo BEHIND_PROXY=false
echo.
echo # -- Web Push VAPID (заполнится после первого запуска) ---------------------
echo VAPID_PUBLIC_KEY=
echo VAPID_PRIVATE_KEY=
echo.
echo # -- TLS (оставьте пустым при использовании Cloudflare Tunnel) ------------
echo TLS_CERT=
echo TLS_KEY=
echo.
echo # -- WebRTC ----------------------------------------------------------------
echo STUN_URL=stun:stun.l.google.com:19302
echo TURN_URL=!TURN_URL!
echo TURN_SECRET=!TURN_SECRET_VAL!
echo TURN_CREDENTIAL_TTL=86400
echo.
echo # -- Push-уведомления для мобильных (опционально) -------------------------
echo #FCM_LEGACY_KEY=
echo #APNS_KEY_PATH=/data/apns.p8
echo #APNS_KEY_ID=
echo #APNS_TEAM_ID=
echo #APNS_BUNDLE_ID=com.messenger
echo #APNS_SANDBOX=true
echo.
echo # -- Политики групп и загрузок (опционально) ------------------------------
echo #MAX_GROUP_MEMBERS=50
echo #ALLOW_USERS_CREATE_GROUPS=true
echo #MAX_UPLOAD_BYTES=104857600
echo.
echo # -- Метаданные приложения (опционально) ----------------------------------
echo #APP_VERSION=1.0.0
echo #MIN_CLIENT_VERSION=0.0.0
echo #APP_CHANGELOG=
echo.
echo # -- Cloudflare Tunnel (только при запуске с профилем cloudflare) ---------
echo #TUNNEL_TOKEN=
) > ".env"

echo  [OK]   .env создан

:: ── Сборка Docker-образа ─────────────────────────────────────────────────────
echo.
echo  [INFO] Сборка Docker-образа (может занять несколько минут)...
docker compose build
if %errorLevel% neq 0 (
    echo  [ERR] Ошибка сборки. Проверьте вывод выше.
    pause
    exit /b 1
)
echo  [OK]   Образ собран

:: ── Первый запуск для получения VAPID ────────────────────────────────────────
echo.
echo  [INFO] Первый запуск сервера (получение VAPID-ключей)...
docker compose up -d
if %errorLevel% neq 0 (
    echo  [ERR] Ошибка запуска контейнера.
    pause
    exit /b 1
)

echo  [INFO] Ожидание генерации VAPID-ключей (15 секунд)...
powershell -NoProfile -Command "Start-Sleep -Seconds 15"

:: Извлекаем VAPID из логов через PowerShell
for /f "delims=" %%v in ('powershell -NoProfile -Command "$logs = docker compose logs messenger 2>&1; if (!$logs) { $logs = docker compose logs 2>&1 }; $priv = ($logs | Select-String 'VAPID_PRIVATE_KEY=(\S+)').Matches.Groups[1].Value; Write-Output $priv"') do (
    set "VAPID_PRIV=%%v"
)

for /f "delims=" %%v in ('powershell -NoProfile -Command "$logs = docker compose logs messenger 2>&1; if (!$logs) { $logs = docker compose logs 2>&1 }; $pub = ($logs | Select-String 'VAPID_PUBLIC_KEY=(\S+)').Matches.Groups[1].Value; Write-Output $pub"') do (
    set "VAPID_PUB=%%v"
)

set "VAPID_STATUS=не обнаружены в логах"

if "!VAPID_PRIV!" neq "" if "!VAPID_PUB!" neq "" (
    echo  [OK]   VAPID-ключи получены
    set "VAPID_STATUS=сохранены"

    :: Обновляем .env через PowerShell (sed-аналог)
    powershell -NoProfile -Command ^
        "(Get-Content '.env') -replace '^VAPID_PUBLIC_KEY=.*','VAPID_PUBLIC_KEY=!VAPID_PUB!' | Set-Content '.env'"
    powershell -NoProfile -Command ^
        "(Get-Content '.env') -replace '^VAPID_PRIVATE_KEY=.*','VAPID_PRIVATE_KEY=!VAPID_PRIV!' | Set-Content '.env'"

    echo  [OK]   .env обновлён с VAPID-ключами

    echo  [INFO] Перезапуск сервера с сохранёнными VAPID-ключами...
    docker compose restart
    powershell -NoProfile -Command "Start-Sleep -Seconds 5"
    echo  [OK]   Сервер перезапущен
) else (
    echo  [WARN] VAPID-ключи не найдены в логах.
    echo  [WARN] Проверьте вручную: docker compose logs messenger
    echo  [WARN] и добавьте ключи в .env вручную.
)

:: ── Проверка работоспособности ───────────────────────────────────────────────
echo.
echo  [INFO] Проверка доступности сервера...
set "SERVER_STATUS=НЕ ПРОВЕРЯЛСЯ"

if "!CURL_AVAILABLE!"=="1" (
    for /f %%h in ('curl -s -o NUL -w "%%{http_code}" --connect-timeout 5 "http://localhost:!PORT!/api/server/info" 2^>NUL') do (
        set "HTTP_CODE=%%h"
    )
    if "!HTTP_CODE!"=="200" (
        echo  [OK]   Сервер отвечает на http://localhost:!PORT! (HTTP 200)
        set "SERVER_STATUS=РАБОТАЕТ"
    ) else (
        echo  [WARN] Неожиданный код ответа: HTTP !HTTP_CODE!
        echo  [WARN] Проверьте логи: docker compose logs
        set "SERVER_STATUS=ТРЕБУЕТ ПРОВЕРКИ (HTTP !HTTP_CODE!)"
    )
) else (
    echo  [WARN] curl не найден, проверка пропущена.
    set "SERVER_STATUS=НЕ ПРОВЕРЯЛСЯ (curl отсутствует)"
)

:: ── Запись server-main.txt ───────────────────────────────────────────────────
echo.
echo  [INFO] Запись данных администратора в server-main.txt...

set "SERVER_URL_DISPLAY=!ALLOWED_ORIGIN!"
if "!SERVER_URL_DISPLAY!"=="" set "SERVER_URL_DISPLAY=http://localhost:!PORT!"

for /f "tokens=*" %%d in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"') do set "INSTALL_DATE=%%d"

(
echo =============================================================================
echo   MESSENGER SERVER — ДАННЫЕ АДМИНИСТРАТОРА
echo   Установлено: !INSTALL_DATE!
echo =============================================================================
echo.
echo СТАТУС СЕРВЕРА: !SERVER_STATUS!
echo.
echo -- Доступ -------------------------------------------------------------------
echo.
echo   URL сервера:   !SERVER_URL_DISPLAY!
echo   Локальный URL: http://localhost:!PORT!
echo   Порт:          !PORT!
echo.
echo -- Учётная запись администратора -------------------------------------------
echo.
echo   Логин:    !ADMIN_USER!
echo   Пароль:   !ADMIN_PASS!
echo.
echo   ВНИМАНИЕ: Сохраните этот файл в надёжном месте и удалите с сервера
echo   после сохранения пароля в менеджере паролей.
echo.
echo -- Конфигурация сервера ----------------------------------------------------
echo.
echo   Имя:               !SERVER_NAME!
echo   Описание:          !SERVER_DESC!
echo   Режим регистрации: !REG_MODE!
echo.
echo -- Секреты (СТРОГО КОНФИДЕНЦИАЛЬНО) ----------------------------------------
echo.
echo   JWT_SECRET:         !JWT_SECRET!
echo   VAPID_PUBLIC_KEY:   !VAPID_PUB!
echo   VAPID_PRIVATE_KEY:  !VAPID_PRIV!
echo.
echo -- WebRTC ------------------------------------------------------------------
echo.
echo   STUN: stun:stun.l.google.com:19302
echo   TURN URL:    !TURN_URL!
echo   TURN Secret: !TURN_SECRET_VAL!
echo.
echo -- Пути данных (внутри Docker volume) --------------------------------------
echo.
echo   База данных: /data/messenger.db  (volume: messenger_data)
echo   Медиафайлы:  /data/media         (volume: messenger_data)
echo.
echo -- Управление сервером -----------------------------------------------------
echo.
echo   Запуск:      docker compose up -d
echo   Остановка:   docker compose stop
echo   Перезапуск:  docker compose restart
echo   Логи:        docker compose logs -f
echo   Статус:      docker compose ps
echo.
echo -- Резервное копирование ---------------------------------------------------
echo.
echo   docker compose stop
echo   docker cp messenger:/data/messenger.db ./backup-%%DATE%%.db
echo   docker compose start
echo.
echo -- Обновление --------------------------------------------------------------
echo.
echo   git pull
echo   docker compose build
echo   docker compose up -d
echo.
echo -- Файлы конфигурации -------------------------------------------------------
echo.
echo   .env               — переменные окружения (ХРАНИТЕ В БЕЗОПАСНОСТИ)
echo   docker-compose.yml — конфигурация Docker
echo.
echo =============================================================================
echo   Сохраните этот файл в безопасном месте!
echo   Никогда не публикуйте содержимое секции "Секреты" публично.
echo =============================================================================
) > "server-main.txt"

echo  [OK]   server-main.txt создан

:: ── Итог ─────────────────────────────────────────────────────────────────────
echo.
echo  ===================================================================
echo    Установка завершена успешно!
echo  ===================================================================
echo.
echo    Сервер:       !SERVER_URL_DISPLAY!
echo    Локально:     http://localhost:!PORT!
echo    Администратор: !ADMIN_USER!
echo    Статус:       !SERVER_STATUS!
echo.
echo    Данные администратора: server-main.txt
echo    СОХРАНИТЕ ЭТОТ ФАЙЛ В БЕЗОПАСНОМ МЕСТЕ!
echo.
echo    Логи: docker compose logs -f
echo.
pause
