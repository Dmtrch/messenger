@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

:: =============================================================================
:: Messenger — установка Desktop-клиента (Windows)
:: =============================================================================
:: Использование:
::   Запустите install-client-windows.bat
::
:: Результат:
::   • Compose Multiplatform Desktop приложение собрано
::   • MSI/EXE установщик или запускаемый JAR готов к использованию
:: =============================================================================

title Messenger Desktop Installer (Windows)

echo.
echo  ===================================================================
echo    Messenger — Desktop Client Installer (Windows)
echo  ===================================================================
echo.

:: ── Проверка зависимостей ─────────────────────────────────────────────────────
echo  =^> Проверка зависимостей
echo.

where java >nul 2>&1
if %errorLevel% neq 0 (
    echo  [ERR] JDK не найден.
    echo        Скачайте JDK 17+: https://adoptium.net/
    echo        При установке выберите "Add to PATH".
    pause
    exit /b 1
)

for /f "tokens=* usebackq" %%v in (`java -version 2^>^&1`) do (
    set JAVA_VER_LINE=%%v
    goto :got_java_ver
)
:got_java_ver
echo  [OK]   Java: !JAVA_VER_LINE!

if not exist "apps\desktop\gradlew.bat" (
    echo  [ERR] gradlew.bat не найден в apps\desktop\
    echo        Убедитесь, что запускаете скрипт из корневой папки репозитория.
    pause
    exit /b 1
)
echo  [OK]   Gradle wrapper найден

:: ── Определение доступных задач Gradle ───────────────────────────────────────
echo.
echo  =^> Определение доступных задач сборки
echo.

set HAS_MSI=0
set HAS_PACKAGE=0

cd apps\desktop
call gradlew.bat tasks --quiet 2>nul | findstr /i "packageMsi" >nul 2>&1 && set HAS_MSI=1
call gradlew.bat tasks --quiet 2>nul | findstr /i "packageDistributionForCurrentOS" >nul 2>&1 && set HAS_PACKAGE=1
cd ..\..

if "!HAS_MSI!"=="1" (
    set GRADLE_TASK=packageMsi
    echo  [INFO] Выбрана задача: packageMsi (создаёт MSI-установщик)
) else if "!HAS_PACKAGE!"=="1" (
    set GRADLE_TASK=packageDistributionForCurrentOS
    echo  [INFO] Выбрана задача: packageDistributionForCurrentOS
) else (
    set GRADLE_TASK=packageUberJarForCurrentOS
    echo  [INFO] Выбрана задача: packageUberJarForCurrentOS (создаёт запускаемый JAR)
)

:: ── Сборка ────────────────────────────────────────────────────────────────────
echo.
echo  =^> Сборка Desktop приложения (!GRADLE_TASK!)
echo.
echo  [INFO] Рабочая директория: apps\desktop
echo  [INFO] Это может занять несколько минут при первом запуске...
echo.

cd apps\desktop
call gradlew.bat !GRADLE_TASK!
set BUILD_ERR=%errorLevel%
cd ..\..

if %BUILD_ERR% neq 0 (
    echo.
    echo  [ERR] Ошибка сборки. Проверьте вывод выше.
    echo.
    echo  Частые причины:
    echo    - Версия JDK ниже 17: скачайте JDK 17+ с https://adoptium.net/
    echo    - Нет доступа в интернет для загрузки зависимостей Gradle
    echo    - Недостаточно оперативной памяти (требуется минимум 4 ГБ)
    pause
    exit /b 1
)

:: ── Поиск результатов сборки ──────────────────────────────────────────────────
echo.
echo  =^> Поиск результатов сборки
echo.

set BUILD_OUT=apps\desktop\build\compose\binaries\main
set FOUND_FILE=

if exist "!BUILD_OUT!" (
    for /r "!BUILD_OUT!" %%f in (*.msi) do (
        set "FOUND_FILE=%%f"
        set "FOUND_EXT=msi"
    )
    if "!FOUND_FILE!"=="" (
        for /r "!BUILD_OUT!" %%f in (*.exe) do (
            set "FOUND_FILE=%%f"
            set "FOUND_EXT=exe"
        )
    )
)

if "!FOUND_FILE!"=="" (
    for /r "apps\desktop\build" %%f in (*.jar) do (
        echo %%f | findstr /v "sources" >nul && (
            set "FOUND_FILE=%%f"
            set "FOUND_EXT=jar"
        )
    )
)

if "!FOUND_FILE!" neq "" (
    echo  [OK]   Найден файл: !FOUND_FILE!
    echo.

    if "!FOUND_EXT!"=="msi" (
        echo  [INFO] Запустите MSI-установщик для установки Messenger на Windows.
        echo.
        set /p "INSTALL_NOW=  Запустить установщик сейчас? [Y/n]: "
        if /i "!INSTALL_NOW!" neq "n" (
            start "" "!FOUND_FILE!"
        )
    ) else if "!FOUND_EXT!"=="exe" (
        echo  [INFO] Запустите EXE-файл для установки или запуска Messenger.
        echo.
        set /p "RUN_NOW=  Запустить сейчас? [Y/n]: "
        if /i "!RUN_NOW!" neq "n" (
            start "" "!FOUND_FILE!"
        )
    ) else if "!FOUND_EXT!"=="jar" (
        echo  [INFO] JAR-файл запускается командой:
        echo         java -jar "!FOUND_FILE!"
        echo.
        set /p "RUN_NOW=  Запустить сейчас? [Y/n]: "
        if /i "!RUN_NOW!" neq "n" (
            start javaw -jar "!FOUND_FILE!"
        )
    )
) else (
    echo  [WARN] Готовый файл не найден автоматически.
    echo         Проверьте папку: apps\desktop\build\
    if exist "apps\desktop\build" (
        dir /B "apps\desktop\build\"
    )
)

:: ── Итог ─────────────────────────────────────────────────────────────────────
echo.
echo  ===================================================================
echo    Сборка Desktop завершена!
echo  ===================================================================
echo.
if "!FOUND_FILE!" neq "" (
    echo    Файл:  !FOUND_FILE!
    echo.
)
echo    При первом запуске приложения введите URL вашего сервера.
echo.
pause
