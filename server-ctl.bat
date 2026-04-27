@echo off
setlocal enabledelayedexpansion

:: ============================================================
:: Messenger Server — управление сервером
:: ============================================================

set "SCRIPT_DIR=%~dp0"
set "SERVER_DIR=%SCRIPT_DIR%server"
set "BIN=%SERVER_DIR%\bin\server.exe"
set "PID_FILE=%SERVER_DIR%\messenger.pid"
set "LOG_FILE=%SERVER_DIR%\messenger.log"
set "CONFIG_FILE=%SERVER_DIR%\config.yaml"
set "SERVICE_NAME=MessengerServer"

:: --- Определить режим (service vs process) ---
set "SERVICE_MODE=0"
nssm status %SERVICE_NAME% >nul 2>&1
if %ERRORLEVEL% EQU 0 set "SERVICE_MODE=1"

:: --- Маршрутизация команд ---
if "%~1"==""        goto :usage
if /i "%~1"=="start"   goto :cmd_start
if /i "%~1"=="stop"    goto :cmd_stop
if /i "%~1"=="restart" goto :cmd_restart
if /i "%~1"=="status"  goto :cmd_status
if /i "%~1"=="logs"    goto :cmd_logs
if /i "%~1"=="build"   goto :cmd_build
goto :usage

:: ============================================================
:cmd_start
:: ============================================================
if "%SERVICE_MODE%"=="1" (
    echo [INFO] Режим: NSSM-сервис
    nssm start %SERVICE_NAME%
    if !ERRORLEVEL! EQU 0 (
        echo [OK] Сервис %SERVICE_NAME% запущен.
    ) else (
        echo [ERR] Не удалось запустить сервис %SERVICE_NAME%.
        exit /b 1
    )
    goto :eof
)

:: --- Process mode ---
echo [INFO] Режим: прямой запуск процесса

:: Проверить бинарник
if not exist "%BIN%" (
    echo [ERR] Бинарник не найден: %BIN%
    echo [INFO] Выполните: server-ctl.bat build
    exit /b 1
)

:: Проверить — уже запущен?
if exist "%PID_FILE%" (
    set /p EXISTING_PID=<"%PID_FILE%"
    tasklist /FI "PID eq !EXISTING_PID!" 2>nul | find /i "server.exe" >nul 2>&1
    if !ERRORLEVEL! EQU 0 (
        echo [WARN] Сервер уже запущен (PID: !EXISTING_PID!)
        exit /b 0
    ) else (
        echo [INFO] Устаревший PID-файл удалён.
        del "%PID_FILE%" >nul 2>&1
    )
)

:: Запуск
echo [INFO] Запуск сервера...
pushd "%SERVER_DIR%"
start /B "" bin\server.exe >> messenger.log 2>&1
popd

:: Ждём 2 секунды
ping -n 3 127.0.0.1 >nul 2>&1

:: Получить PID через WMIC
set "NEW_PID="
for /f "tokens=2 delims=," %%A in ('wmic process where "name='server.exe'" get ProcessId /format:csv 2^>nul ^| findstr /r "[0-9]"') do (
    if not defined NEW_PID set "NEW_PID=%%A"
)

:: Запасной вариант — tasklist
if not defined NEW_PID (
    for /f "tokens=2" %%A in ('tasklist /FI "IMAGENAME eq server.exe" /FO TABLE /NH 2^>nul ^| findstr /i "server.exe"') do (
        if not defined NEW_PID set "NEW_PID=%%A"
    )
)

if defined NEW_PID (
    echo !NEW_PID!>"%PID_FILE%"
    echo [OK] Сервер запущен (PID: !NEW_PID!)
) else (
    echo [WARN] Сервер запущен, но PID определить не удалось. Проверьте лог.
)

:: Определить порт из config.yaml
set "PORT="
if exist "%CONFIG_FILE%" (
    for /f "tokens=2 delims=: " %%A in ('findstr /i "port" "%CONFIG_FILE%" 2^>nul') do (
        if not defined PORT set "PORT=%%A"
    )
)
if defined PORT (
    echo [INFO] Адрес: http://localhost:!PORT!/
    echo [INFO] Админка: http://localhost:!PORT!/admin/
) else (
    echo [INFO] Адрес: http://localhost:8080/
    echo [INFO] Админка: http://localhost:8080/admin/
)
goto :eof

:: ============================================================
:cmd_stop
:: ============================================================
if "%SERVICE_MODE%"=="1" (
    echo [INFO] Режим: NSSM-сервис
    nssm stop %SERVICE_NAME%
    if !ERRORLEVEL! EQU 0 (
        echo [OK] Сервис %SERVICE_NAME% остановлен.
    ) else (
        echo [ERR] Не удалось остановить сервис %SERVICE_NAME%.
        exit /b 1
    )
    goto :eof
)

:: --- Process mode ---
if not exist "%PID_FILE%" (
    echo [WARN] PID-файл не найден. Сервер не запущен или был остановлен вручную.
    exit /b 0
)

set /p STOP_PID=<"%PID_FILE%"
echo [INFO] Остановка процесса PID: %STOP_PID% ...
taskkill /PID %STOP_PID% /F >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    del "%PID_FILE%" >nul 2>&1
    echo [OK] Сервер остановлен.
) else (
    echo [WARN] Процесс PID %STOP_PID% не найден. Возможно, уже остановлен.
    del "%PID_FILE%" >nul 2>&1
)
goto :eof

:: ============================================================
:cmd_restart
:: ============================================================
echo [INFO] Перезапуск сервера...
call :cmd_stop
call :cmd_start
goto :eof

:: ============================================================
:cmd_status
:: ============================================================
if "%SERVICE_MODE%"=="1" (
    echo [INFO] Режим: NSSM-сервис
    nssm status %SERVICE_NAME%
    goto :eof
)

:: --- Process mode ---
if not exist "%PID_FILE%" (
    echo [INFO] Статус: Остановлен (PID-файл отсутствует)
    goto :eof
)

set /p STATUS_PID=<"%PID_FILE%"
tasklist /FI "PID eq %STATUS_PID%" 2>nul | find /i "server.exe" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] Статус: Запущен (PID: %STATUS_PID%)
) else (
    echo [INFO] Статус: Остановлен (устаревший PID: %STATUS_PID%)
    del "%PID_FILE%" >nul 2>&1
)
goto :eof

:: ============================================================
:cmd_logs
:: ============================================================
if not exist "%LOG_FILE%" (
    echo [WARN] Лог-файл не найден: %LOG_FILE%
    exit /b 1
)

echo [INFO] Показ лога (Ctrl+C для выхода)...
powershell -Command "Get-Content '%LOG_FILE%' -Wait -Tail 50" 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [WARN] PowerShell недоступен, показ статичного лога:
    type "%LOG_FILE%"
)
goto :eof

:: ============================================================
:cmd_build
:: ============================================================
echo [INFO] Сборка сервера...
where go >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERR] Go не найден в PATH.
    echo [INFO] Установите Go: https://go.dev/dl/
    echo [INFO] После установки перезапустите командную строку.
    exit /b 1
)

if not exist "%SERVER_DIR%\bin" mkdir "%SERVER_DIR%\bin"

pushd "%SERVER_DIR%"
go build -o bin\server.exe .\cmd\server
if !ERRORLEVEL! EQU 0 (
    echo [OK] Сборка завершена: %BIN%
) else (
    echo [ERR] Ошибка сборки. Проверьте вывод выше.
    popd
    exit /b 1
)
popd
goto :eof

:: ============================================================
:usage
:: ============================================================
echo.
echo   ╔══════════════════════════════════════════════════╗
echo   ║     Messenger Server — управление сервером       ║
echo   ╚══════════════════════════════════════════════════╝
echo.
echo   Использование:
echo     server-ctl.bat ^<команда^>
echo.
echo   Команды:
echo     start    — Запустить сервер
echo     stop     — Остановить сервер
echo     restart  — Перезапустить сервер
echo     status   — Показать статус сервера
echo     logs     — Показать лог в реальном времени
echo     build    — Собрать бинарник из исходников
echo.
echo   Режимы:
echo     NSSM     — если MessengerServer зарегистрирован как сервис Windows
echo     Process  — прямой запуск процесса (по умолчанию)
echo.
echo   Пути:
echo     Бинарник : server\bin\server.exe
echo     Лог      : server\messenger.log
echo     Конфиг   : server\config.yaml
echo.
exit /b 1

endlocal
