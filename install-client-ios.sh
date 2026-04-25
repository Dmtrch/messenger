#!/usr/bin/env bash
# =============================================================================
# Messenger — установка iOS-клиента (только macOS)
# =============================================================================
# Использование:
#   chmod +x install-client-ios.sh
#   ./install-client-ios.sh
#
# Результат:
#   • Зависимости проекта разрешены через Swift Package Manager
#   • Приложение открыто в Xcode для сборки и запуска
#   • Или (для CI/автоматизации): сборка для симулятора через xcodebuild
#
# Примечание:
#   iOS-приложение использует Swift Package Manager (Package.swift).
#   Полный UI (SwiftUI) собирается только через Xcode.
#   Для устройства требуется Apple Developer аккаунт с подписанным профилем.
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
IOS_DIR="$SCRIPT_DIR/apps/mobile/ios"

echo ""
echo -e "${BOLD}════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Messenger — iOS Client Installer${NC}"
echo -e "${BOLD}════════════════════════════════════════════════════${NC}"
echo ""

# ── Проверка ОС ──────────────────────────────────────────────────────────────
step "Проверка ОС"
[[ "$(uname)" == "Darwin" ]] || error "iOS-клиент можно собрать только на macOS.\nДля других платформ используйте:\n  • PWA:     install-client-pwa.sh\n  • Android: install-client-android.sh"
success "macOS $(sw_vers -productVersion)"

# ── Проверка зависимостей ────────────────────────────────────────────────────
step "Проверка зависимостей"

if ! command -v xcodebuild &>/dev/null; then
    error "Xcode не найден.\n  Установите Xcode из App Store: https://apps.apple.com/app/xcode/id497799835\n  Затем: sudo xcode-select --install"
fi
XCODE_VER=$(xcodebuild -version 2>/dev/null | head -1)
success "$XCODE_VER"

if ! command -v swift &>/dev/null; then
    error "Swift не найден. Установите Xcode Command Line Tools:\n  xcode-select --install"
fi
SWIFT_VER=$(swift --version 2>/dev/null | head -1)
success "$SWIFT_VER"

[[ -f "$IOS_DIR/Package.swift" ]] || error "Package.swift не найден в $IOS_DIR"
success "Package.swift найден"

# ── Разрешение зависимостей SPM ──────────────────────────────────────────────
step "Разрешение зависимостей Swift Package Manager"

cd "$IOS_DIR"
info "swift package resolve..."
swift package resolve 2>&1 | tail -10
success "Зависимости разрешены"

# ── Сборка библиотеки MessengerCrypto ────────────────────────────────────────
step "Сборка MessengerCrypto (проверка окружения)"

info "swift build --target MessengerCrypto..."
swift build --target MessengerCrypto 2>&1 | tail -10
success "MessengerCrypto собран"

# ── Открытие проекта в Xcode ─────────────────────────────────────────────────
step "Открытие iOS-проекта в Xcode"

echo ""
echo -e "  Полный iOS-клиент (SwiftUI) собирается из Xcode."
echo -e "  Окружение проверено, зависимости разрешены."
echo ""
echo "  Следующие шаги в Xcode:"
echo "    1. Выберите схему 'Messenger' (или 'MessengerApp')"
echo "    2. Выберите симулятор или реальное устройство"
echo "    3. Нажмите Cmd+R для запуска"
echo "    4. При первом запуске введите URL вашего сервера"
echo ""
read -r -p "Открыть Package.swift в Xcode сейчас? [Y/n]: " OPEN_XCODE
OPEN_XCODE="${OPEN_XCODE:-y}"

if [[ "${OPEN_XCODE,,}" != "n" ]]; then
    info "Открываю Package.swift в Xcode..."
    open -a Xcode "$IOS_DIR/Package.swift" 2>/dev/null || \
        open "$IOS_DIR/Package.swift" 2>/dev/null || \
        warn "Не удалось открыть Xcode автоматически. Откройте вручную:\n  open \"$IOS_DIR/Package.swift\""
    success "Xcode открыт"
fi

# ── (Опционально) сборка для симулятора через xcodebuild ─────────────────────
step "Сборка для симулятора (опционально)"

echo ""
echo "  Автоматическая сборка .app через xcodebuild (только для CI/автоматизации)."
read -r -p "Запустить xcodebuild для симулятора? [y/N]: " RUN_BUILD
RUN_BUILD="${RUN_BUILD:-n}"

if [[ "${RUN_BUILD,,}" == "y" ]]; then
    # Получить доступные схемы
    SCHEMES=$(xcodebuild -list -package 2>/dev/null | awk '/Schemes:/,0' | grep -v "Schemes:" | xargs || true)
    info "Доступные схемы: $SCHEMES"

    # Найти подходящий симулятор
    SIM_ID=$(xcrun simctl list devices available --json 2>/dev/null | \
        python3 -c "
import sys, json
data = json.load(sys.stdin)
for runtime, devices in sorted(data.get('devices', {}).items(), reverse=True):
    if 'iOS' not in runtime:
        continue
    for d in devices:
        if 'iPhone' in d.get('name', '') and d.get('isAvailable', True):
            print(d['udid'])
            sys.exit(0)
" 2>/dev/null || true)

    if [[ -z "$SIM_ID" ]]; then
        warn "Симулятор iPhone не найден. Создайте его в Xcode → Window → Devices and Simulators."
    else
        SIM_NAME=$(xcrun simctl list devices --json 2>/dev/null | \
            python3 -c "
import sys, json
data = json.load(sys.stdin)
for runtime, devices in data.get('devices', {}).items():
    for d in devices:
        if d.get('udid') == '$SIM_ID':
            print(d.get('name', '$SIM_ID'))
            sys.exit(0)
" 2>/dev/null || echo "$SIM_ID")
        info "Используется симулятор: $SIM_NAME ($SIM_ID)"

        BUILD_DIR="$IOS_DIR/build/simulator"
        mkdir -p "$BUILD_DIR"

        # Пробуем собрать схему Messenger, если доступна
        TARGET_SCHEME="MessengerCrypto"
        for s in Messenger MessengerApp; do
            if echo "$SCHEMES" | grep -qw "$s"; then
                TARGET_SCHEME="$s"
                break
            fi
        done

        info "Схема: $TARGET_SCHEME"
        xcodebuild \
            -scheme "$TARGET_SCHEME" \
            -destination "platform=iOS Simulator,id=$SIM_ID" \
            -derivedDataPath "$BUILD_DIR" \
            build 2>&1 | tail -20 || warn "xcodebuild завершился с ошибкой. Откройте Xcode для диагностики."

        APP_PATH=$(find "$BUILD_DIR" -name "*.app" -not -path "*/PlugIns/*" 2>/dev/null | head -1 || true)
        if [[ -n "$APP_PATH" ]]; then
            success "Собрано: $APP_PATH"
            info "Установка на симулятор..."
            xcrun simctl boot "$SIM_ID" 2>/dev/null || true
            xcrun simctl install "$SIM_ID" "$APP_PATH"
            BUNDLE_ID=$(defaults read "$APP_PATH/Info.plist" CFBundleIdentifier 2>/dev/null || true)
            [[ -n "$BUNDLE_ID" ]] && xcrun simctl launch "$SIM_ID" "$BUNDLE_ID" && success "Приложение запущено"
            open -a Simulator 2>/dev/null || true
        fi
    fi
fi

# ── Итог ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  iOS клиент готов!${NC}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Проект:  ${CYAN}$IOS_DIR/Package.swift${NC}"
echo ""
echo -e "  В Xcode выберите схему и нажмите Cmd+R."
echo -e "  При первом запуске введите URL вашего сервера."
echo ""
