@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

:: =============================================================================
:: Messenger — сборка PWA-клиента (Windows)
:: =============================================================================
:: Использование:
::   Запустите install-client-pwa.bat
::
:: Результат:
::   • React-клиент собран в client\dist\
::   • Файлы готовы для встраивания в сервер (server\static\)
::
:: Примечание:
::   PWA не требует отдельной установки — это веб-приложение.
::   Откройте URL сервера в браузере и нажмите "Установить".
:: =============================================================================

title Messenger PWA Builder

echo.
echo  ===================================================================
echo    Messenger — PWA Client Builder (Windows)
echo  ===================================================================
echo.
echo    PWA (Progressive Web App) — браузерное приложение.
echo    После сборки откройте URL сервера в Chrome / Edge
echo    и нажмите "Установить" для добавления на рабочий стол.
echo.

:: ── Выбор режима ──────────────────────────────────────────────────────────────
echo  =^> Выбор режима
echo.
echo     1) Сборка для продакшн (dist -^> server\static\)  [рекомендуется]
echo     2) Запуск dev-сервера (Vite hot-reload, localhost:5173)
echo.
set "MODE=1"
set /p "MODE=  Режим [1]: "
if "!MODE!"=="" set "MODE=1"

:: ── Проверка зависимостей ─────────────────────────────────────────────────────
echo.
echo  =^> Проверка зависимостей
echo.

where node >nul 2>&1
if %errorLevel% neq 0 (
    echo  [ERR] Node.js не найден.
    echo        Скачайте Node.js 18+: https://nodejs.org/
    echo        При установке выберите "Add to PATH".
    pause
    exit /b 1
)

for /f %%v in ('node --version 2^>nul') do set NODE_VER=%%v
echo  [OK]   Node.js !NODE_VER!

where npm >nul 2>&1
if %errorLevel% neq 0 (
    echo  [ERR] npm не найден. Переустановите Node.js: https://nodejs.org/
    pause
    exit /b 1
)

for /f %%v in ('npm --version 2^>nul') do set NPM_VER=%%v
echo  [OK]   npm !NPM_VER!

if not exist "client\package.json" (
    echo  [ERR] client\package.json не найден.
    echo        Убедитесь, что запускаете скрипт из корневой папки репозитория.
    pause
    exit /b 1
)
echo  [OK]   package.json найден

:: ── Установка зависимостей ────────────────────────────────────────────────────
echo.
echo  =^> Установка npm-зависимостей
echo.

cd client
call npm install
if %errorLevel% neq 0 (
    echo  [ERR] Ошибка npm install. Проверьте вывод выше.
    cd ..
    pause
    exit /b 1
)
echo  [OK]   Зависимости установлены

:: ── Режим 2: dev-сервер ───────────────────────────────────────────────────────
if "!MODE!"=="2" (
    echo.
    echo  =^> Запуск Vite dev-сервера
    echo.
    echo  [INFO] Нажмите Ctrl+C для остановки.
    echo.
    set "API_URL=http://localhost:8080"
    set /p "API_URL=  URL серверного API [http://localhost:8080]: "
    if "!API_URL!"=="" set "API_URL=http://localhost:8080"

    set "VITE_API_URL=!API_URL!"
    call npm run dev
    cd ..
    goto :eof
)

:: ── Продакшн-сборка ───────────────────────────────────────────────────────────
echo.
echo  =^> Продакшн-сборка React-клиента
echo.
echo  [INFO] npm run build...
echo.

call npm run build
if %errorLevel% neq 0 (
    echo  [ERR] Ошибка сборки. Проверьте вывод выше.
    cd ..
    pause
    exit /b 1
)

if not exist "dist\index.html" (
    echo  [ERR] dist\index.html не найден после сборки.
    cd ..
    pause
    exit /b 1
)
echo  [OK]   Сборка завершена: client\dist\

cd ..

:: ── Интеграция с сервером ─────────────────────────────────────────────────────
echo.
echo  =^> Интеграция с сервером
echo.
echo     1) Скопировать dist\ в server\static\ (требует пересборки сервера)
echo     2) Только показать путь к dist\ (для ручного развёртывания)
echo.
set "DEPLOY=1"
set /p "DEPLOY=  Действие [1]: "
if "!DEPLOY!"=="" set "DEPLOY=1"

if "!DEPLOY!"=="1" (
    if exist "server\static" (
        for /f "tokens=*" %%d in ('powershell -NoProfile -Command "Get-Date -Format ''yyyyMMdd-HHmmss''"') do set "TS=%%d"
        echo  [WARN] Резервная копия server\static\ -^> server\static.backup.!TS!\
        xcopy "server\static" "server\static.backup.!TS!\" /E /Q >nul 2>&1
        rmdir /s /q "server\static"
    )

    mkdir "server\static" >nul 2>&1
    xcopy "client\dist" "server\static\" /E /Q
    echo  [OK]   Файлы скопированы в server\static\
    echo.
    echo  [INFO] Для применения пересоберите сервер:
    echo           cd server ^&^& go build -o bin\server.exe .\cmd\server
    echo           или: docker compose build
) else (
    echo  [INFO] Путь к готовым файлам: client\dist\
    echo  [INFO] Для размещения на веб-сервере (nginx, IIS):
    echo           Скопируйте содержимое dist\ в корень сайта.
)

:: ── Итог ─────────────────────────────────────────────────────────────────────
echo.
echo  ===================================================================
echo    PWA клиент собран!
echo  ===================================================================
echo.
echo    dist: client\dist\
echo.
echo    Как использовать PWA:
echo      1. Откройте URL вашего сервера в браузере
echo      2. Chrome/Edge: значок установки в адресной строке
echo      3. Safari/iOS: Поделиться -^> Добавить на экран Домой
echo.
pause
