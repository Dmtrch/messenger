# =============================================================================
# build-windows-installer.ps1
# Сборка Windows-установщика для Messenger Server
# =============================================================================
# Использование (из корня проекта):
#   .\scripts\build-windows-installer.ps1
#
# Параметры:
#   -SkipClient  — пропустить сборку клиента (использовать уже собранные файлы)
#   -SkipInno    — только собрать бинарник, не создавать .exe установщик
# =============================================================================
param(
    [switch]$SkipClient,
    [switch]$SkipInno
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root    = Split-Path $PSScriptRoot -Parent
$Scripts = $PSScriptRoot
$Dist    = Join-Path $Scripts "dist"

function Write-Step { param($Msg) Write-Host "`n==> $Msg" -ForegroundColor Cyan }
function Write-OK   { param($Msg) Write-Host "  [OK]  $Msg" -ForegroundColor Green }
function Write-Err  { param($Msg) Write-Host "  [ERR] $Msg" -ForegroundColor Red; exit 1 }

# ── Проверка зависимостей ─────────────────────────────────────────────────────
Write-Step "Проверка зависимостей"

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    Write-Err "Go не найден. Установите с https://go.dev/dl/"
}
Write-OK "Go $(go version)"

if (-not $SkipClient) {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Err "Node.js не найден. Установите с https://nodejs.org/"
    }
    Write-OK "Node $(node --version)"

    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Err "npm не найден."
    }
    Write-OK "npm $(npm --version)"
}

if (-not $SkipInno) {
    $InnoPath = @(
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe",
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1

    if (-not $InnoPath) {
        Write-Err "Inno Setup 6 не найден.`n  Скачайте с https://jrsoftware.org/isdl.php"
    }
    Write-OK "Inno Setup: $InnoPath"
}

# ── Создать папку dist ────────────────────────────────────────────────────────
Write-Step "Подготовка директории сборки"
New-Item -ItemType Directory -Force -Path $Dist | Out-Null
Write-OK "dist: $Dist"

# ── Сборка клиента ────────────────────────────────────────────────────────────
if (-not $SkipClient) {
    Write-Step "Сборка клиента (npm run build)"

    Push-Location (Join-Path $Root "client")
    try {
        npm install --legacy-peer-deps
        npm run build
    } finally {
        Pop-Location
    }

    $ClientDist = Join-Path $Root "client\dist"
    $StaticDest = Join-Path $Root "server\cmd\server\static"

    if (-not (Test-Path $ClientDist)) {
        Write-Err "Сборка клиента не создала $ClientDist"
    }

    Write-Step "Копирование статических файлов в go:embed директорию"
    if (Test-Path $StaticDest) {
        Get-ChildItem $StaticDest -Exclude ".gitkeep" | Remove-Item -Recurse -Force
    }
    Copy-Item "$ClientDist\*" $StaticDest -Recurse -Force
    Write-OK "Статические файлы скопированы"
} else {
    Write-Host "  [SKIP] Сборка клиента пропущена (-SkipClient)" -ForegroundColor Yellow
}

# ── Сборка Go-бинарника для Windows ──────────────────────────────────────────
Write-Step "Сборка Go-бинарника (Windows amd64)"

$OutExe = Join-Path $Dist "messenger.exe"

Push-Location (Join-Path $Root "server")
try {
    $env:GOOS        = "windows"
    $env:GOARCH      = "amd64"
    $env:CGO_ENABLED = "0"

    go build -ldflags="-s -w" -o $OutExe "./cmd/server"
} finally {
    Remove-Item Env:\GOOS        -ErrorAction SilentlyContinue
    Remove-Item Env:\GOARCH      -ErrorAction SilentlyContinue
    Remove-Item Env:\CGO_ENABLED -ErrorAction SilentlyContinue
    Pop-Location
}

if (-not (Test-Path $OutExe)) {
    Write-Err "Бинарник не создан: $OutExe"
}

$Size = [math]::Round((Get-Item $OutExe).Length / 1MB, 1)
Write-OK "Бинарник собран: $OutExe ($Size МБ)"

# ── Сборка Inno Setup установщика ────────────────────────────────────────────
if (-not $SkipInno) {
    Write-Step "Сборка Windows-установщика (Inno Setup)"

    $IssFile = Join-Path $Scripts "messenger-setup.iss"

    & $InnoPath $IssFile
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Inno Setup завершился с кодом $LASTEXITCODE"
    }

    $Installer = Join-Path $Dist "messenger-server-setup.exe"
    if (-not (Test-Path $Installer)) {
        Write-Err "Установщик не создан: $Installer"
    }

    $ISize = [math]::Round((Get-Item $Installer).Length / 1MB, 1)
    Write-OK "Установщик создан: $Installer ($ISize МБ)"
} else {
    Write-Host "  [SKIP] Inno Setup пропущен (-SkipInno)" -ForegroundColor Yellow
}

# ── Итог ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  Готово!" -ForegroundColor Green
Write-Host ""
Write-Host "  Бинарник:    $OutExe" -ForegroundColor White

if (-not $SkipInno) {
    $Installer = Join-Path $Dist "messenger-server-setup.exe"
    Write-Host "  Установщик:  $Installer" -ForegroundColor White
    Write-Host ""
    Write-Host "  Запустите установщик на целевой машине от имени администратора." -ForegroundColor Yellow
}
Write-Host ""
