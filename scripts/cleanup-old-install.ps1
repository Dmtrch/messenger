# Удаление остатков предыдущей установки Messenger
# Запускать от имени администратора

$ErrorActionPreference = "SilentlyContinue"

Write-Host "Очистка предыдущей установки Messenger..." -ForegroundColor Cyan

# Папка данных сервера
$dataDir = "C:\ProgramData\Messenger"
if (Test-Path $dataDir) {
    takeown /f $dataDir /r /d y | Out-Null
    icacls $dataDir /grant "Administrators:(OI)(CI)F" /t /q | Out-Null
    Remove-Item $dataDir -Recurse -Force
    if (Test-Path $dataDir) { Write-Host "  [ОШИБКА] $dataDir не удалён" -ForegroundColor Red }
    else                     { Write-Host "  [OK] $dataDir удалён"        -ForegroundColor Green }
} else {
    Write-Host "  [ПРОПУСК] $dataDir не найден" -ForegroundColor Yellow
}

# Папка логов пользователя
$appData = "C:\Users\dmtrc\AppData\Roaming\Messenger"
if (Test-Path $appData) {
    Remove-Item $appData -Recurse -Force
    if (Test-Path $appData) { Write-Host "  [ОШИБКА] $appData не удалён" -ForegroundColor Red }
    else                     { Write-Host "  [OK] $appData удалён"        -ForegroundColor Green }
} else {
    Write-Host "  [ПРОПУСК] $appData уже удалён" -ForegroundColor Yellow
}

# Запись реестра
$regKey = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{DE091103-B235-3793-80D6-2BF5F370E603}"
if (Test-Path $regKey) {
    Remove-Item $regKey -Recurse -Force
    if (Test-Path $regKey) { Write-Host "  [ОШИБКА] Запись реестра не удалена" -ForegroundColor Red }
    else                    { Write-Host "  [OK] Запись реестра удалена"         -ForegroundColor Green }
} else {
    Write-Host "  [ПРОПУСК] Запись реестра не найдена" -ForegroundColor Yellow
}

Write-Host "`nГотово." -ForegroundColor Cyan
pause
