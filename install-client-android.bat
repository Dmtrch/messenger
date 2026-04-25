@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

:: =============================================================================
:: Messenger — установка Android-клиента (Windows)
:: =============================================================================
:: Использование:
::   Запустите install-client-android.bat (от обычного пользователя достаточно)
::
:: Результат:
::   • APK собран в apps\mobile\android\app\build\outputs\apk\debug\
::   • APK установлен на подключённое Android-устройство (если доступен adb)
:: =============================================================================

title Messenger Android Installer

echo.
echo  ===================================================================
echo    Messenger — Android Client Installer (Windows)
echo  ===================================================================
echo.

:: ── Проверка зависимостей ─────────────────────────────────────────────────────
echo  =^> Проверка зависимостей
echo.

where java >nul 2>&1
if %errorLevel% neq 0 (
    echo  [ERR] JDK не найден.
    echo        Скачайте JDK 17+: https://adoptium.net/
    pause
    exit /b 1
)
echo  [OK]   Java найдена

where adb >nul 2>&1
if %errorLevel% equ 0 (
    set ADB_AVAILABLE=1
    echo  [OK]   adb найден
) else (
    set ADB_AVAILABLE=0
    echo  [WARN] adb не найден — APK будет собран без автоустановки.
    echo         Установите Android Studio: https://developer.android.com/studio
    echo         и добавьте platform-tools в PATH.
)

if not exist "apps\mobile\android\gradlew.bat" (
    echo  [ERR] gradlew.bat не найден в apps\mobile\android\
    pause
    exit /b 1
)
echo  [OK]   Gradle wrapper найден

:: ── ANDROID_HOME ──────────────────────────────────────────────────────────────
if "%ANDROID_HOME%"=="" (
    if exist "%LOCALAPPDATA%\Android\Sdk" (
        set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
        echo  [INFO] ANDROID_HOME определён: !ANDROID_HOME!
    ) else (
        echo  [WARN] ANDROID_HOME не задан. При ошибке сборки установите:
        echo         set ANDROID_HOME=C:\Users\%USERNAME%\AppData\Local\Android\Sdk
    )
)

:: ── Выбор варианта сборки ─────────────────────────────────────────────────────
echo.
echo  =^> Выбор варианта сборки
echo.
echo     1) Debug   — быстрая сборка, не требует подписи (рекомендуется)
echo     2) Release — требует keystore для подписи
echo.
set "BUILD_CHOICE=1"
set /p "BUILD_CHOICE=  Вариант [1]: "
if "!BUILD_CHOICE!"=="" set "BUILD_CHOICE=1"

if "!BUILD_CHOICE!"=="2" (
    set "GRADLE_TASK=assembleRelease"
    set "APK_PATH=apps\mobile\android\app\build\outputs\apk\release\app-release-unsigned.apk"
    echo  [WARN] Release-сборка не подписана. Потребуется ручная подпись.
) else (
    set "GRADLE_TASK=assembleDebug"
    set "APK_PATH=apps\mobile\android\app\build\outputs\apk\debug\app-debug.apk"
)

:: ── Сборка APK ────────────────────────────────────────────────────────────────
echo.
echo  =^> Сборка Android APK (!GRADLE_TASK!)
echo.
echo  [INFO] Рабочая директория: apps\mobile\android

cd apps\mobile\android
call gradlew.bat !GRADLE_TASK!
set BUILD_ERR=%errorLevel%
cd ..\..\..

if %BUILD_ERR% neq 0 (
    echo.
    echo  [ERR] Ошибка сборки APK. Проверьте вывод выше.
    pause
    exit /b 1
)

if not exist "!APK_PATH!" (
    echo  [ERR] APK не найден: !APK_PATH!
    pause
    exit /b 1
)
echo  [OK]   APK собран: !APK_PATH!

:: ── Установка APK ─────────────────────────────────────────────────────────────
echo.
echo  =^> Установка APK
echo.

if "!ADB_AVAILABLE!"=="1" (
    set DEVICE_COUNT=0
    for /f "skip=1 tokens=1" %%d in ('adb devices 2^>nul ^| findstr /v "List"') do (
        echo %%d | findstr "device" >nul && set /a DEVICE_COUNT+=1
    )

    if "!DEVICE_COUNT!"=="0" (
        echo  [WARN] Подключённые Android-устройства не найдены.
        echo         Подключите устройство с включённой отладкой USB,
        echo         или запустите Android Emulator, затем выполните:
        echo           adb install -r "!APK_PATH!"
    ) else (
        echo  [INFO] Установка APK на устройство...
        adb install -r "!APK_PATH!"
        if !errorLevel! equ 0 (
            echo  [OK]   APK установлен
        ) else (
            echo  [WARN] Ошибка установки. Попробуйте вручную:
            echo           adb install -r "!APK_PATH!"
        )
    )
) else (
    echo  [INFO] Для установки вручную:
    echo           adb install -r "!APK_PATH!"
    echo         Или скопируйте APK на устройство и откройте через файловый менеджер.
)

:: ── Итог ─────────────────────────────────────────────────────────────────────
echo.
echo  ===================================================================
echo    Установка Android завершена!
echo  ===================================================================
echo.
echo    APK: !APK_PATH!
echo.
echo    При первом запуске приложения введите URL вашего сервера.
echo.
pause
