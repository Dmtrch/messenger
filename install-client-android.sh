#!/usr/bin/env bash
# =============================================================================
# Messenger — установка Android-клиента (macOS / Linux)
# =============================================================================
# Использование:
#   chmod +x install-client-android.sh
#   ./install-client-android.sh
#
# Результат:
#   • APK собран в apps/mobile/android/app/build/outputs/apk/debug/
#   • APK установлен на подключённое Android-устройство (если доступен adb)
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERR]${NC}  $*"; exit 1; }
step()    { echo -e "\n${BOLD}==> $*${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$SCRIPT_DIR/apps/mobile/android"
APK_PATH="$ANDROID_DIR/app/build/outputs/apk/debug/app-debug.apk"

echo ""
echo -e "${BOLD}════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Messenger — Android Client Installer${NC}"
echo -e "${BOLD}════════════════════════════════════════════════════${NC}"
echo ""

# ── Проверка зависимостей ────────────────────────────────────────────────────
step "Проверка зависимостей"

if ! command -v java &>/dev/null; then
    error "JDK не найден.\n  Установите JDK 17+: https://adoptium.net/\n  macOS: brew install --cask temurin"
fi
JAVA_VER=$(java -version 2>&1 | awk -F '"' '/version/ {print $2}' | cut -d. -f1)
[[ -n "$JAVA_VER" && "$JAVA_VER" -ge 17 ]] 2>/dev/null || \
    error "Требуется JDK 17+. Найдена версия: $(java -version 2>&1 | head -1)"
success "Java $JAVA_VER найдена"

ADB_AVAILABLE=false
if command -v adb &>/dev/null; then
    ADB_AVAILABLE=true
    success "adb найден ($(adb version 2>/dev/null | head -1))"
else
    warn "adb не найден — APK будет собран, но не установлен автоматически."
    warn "  Установите Android Studio: https://developer.android.com/studio"
    warn "  или Android SDK командной строки и добавьте platform-tools в PATH."
fi

[[ -d "$ANDROID_DIR" ]] || error "Директория Android-проекта не найдена: $ANDROID_DIR"
[[ -f "$ANDROID_DIR/gradlew" ]] || error "gradlew не найден в $ANDROID_DIR"
chmod +x "$ANDROID_DIR/gradlew"
success "Gradle wrapper найден"

# ── Проверка ANDROID_HOME ────────────────────────────────────────────────────
if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" ]]; then
    # Попробуем стандартные пути
    for candidate in \
        "$HOME/Library/Android/sdk" \
        "$HOME/Android/Sdk" \
        "/opt/android-sdk" \
        "/usr/lib/android-sdk"; do
        if [[ -d "$candidate" ]]; then
            export ANDROID_HOME="$candidate"
            export ANDROID_SDK_ROOT="$candidate"
            info "ANDROID_HOME определён автоматически: $ANDROID_HOME"
            break
        fi
    done
fi

if [[ -z "${ANDROID_HOME:-}" ]]; then
    warn "ANDROID_HOME не задан. Если сборка завершится ошибкой, выполните:"
    warn "  export ANDROID_HOME=<путь к Android SDK>"
fi

# ── Выбор варианта сборки ────────────────────────────────────────────────────
step "Выбор варианта сборки"
echo ""
echo "  1) Debug  — быстрая сборка, не требует ключей подписи (рекомендуется)"
echo "  2) Release — требует keystore для подписи"
echo ""
read -r -p "Вариант [1]: " BUILD_VARIANT
BUILD_VARIANT="${BUILD_VARIANT:-1}"

case "$BUILD_VARIANT" in
    2)
        GRADLE_TASK="assembleRelease"
        APK_PATH="$ANDROID_DIR/app/build/outputs/apk/release/app-release-unsigned.apk"
        warn "Release-сборка не подписана. Для установки потребуется ручная подпись."
        ;;
    *)
        GRADLE_TASK="assembleDebug"
        ;;
esac

# ── Сборка APK ───────────────────────────────────────────────────────────────
step "Сборка Android APK ($GRADLE_TASK)"

info "Рабочая директория: $ANDROID_DIR"
cd "$ANDROID_DIR"

./gradlew "$GRADLE_TASK" 2>&1 | tail -20

[[ -f "$APK_PATH" ]] || error "APK не создан. Ожидаемый путь:\n  $APK_PATH\nПроверьте вывод сборки выше."
success "APK собран: $APK_PATH"

# ── Установка APK ────────────────────────────────────────────────────────────
step "Установка APK"

if $ADB_AVAILABLE; then
    DEVICES=$(adb devices 2>/dev/null | grep -v "List of devices" | grep -c "device$" || true)

    if [[ "$DEVICES" -eq 0 ]]; then
        warn "Подключённые Android-устройства не найдены."
        warn "Подключите устройство (включите режим разработчика + отладка USB),"
        warn "  или запустите Android Emulator, затем выполните:"
        info "  adb install -r \"$APK_PATH\""
    elif [[ "$DEVICES" -eq 1 ]]; then
        info "Установка на устройство..."
        adb install -r "$APK_PATH"
        success "APK установлен"
    else
        warn "Найдено $DEVICES устройств. Выберите одно командой:"
        adb devices
        info "  adb -s <DEVICE_ID> install -r \"$APK_PATH\""
    fi
else
    info "Для установки вручную:"
    info "  adb install -r \"$APK_PATH\""
    info "  Или скопируйте APK на устройство и откройте через файловый менеджер."
fi

# ── Итог ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Установка Android завершена!${NC}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  APK:  ${CYAN}$APK_PATH${NC}"
echo ""
echo -e "  При первом запуске приложения:"
echo -e "  введите URL вашего сервера Messenger."
echo ""
