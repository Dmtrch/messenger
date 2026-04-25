#!/usr/bin/env bash
# =============================================================================
# Messenger — установка Desktop-клиента (macOS)
# =============================================================================
# Использование:
#   chmod +x install-client-macos.sh
#   ./install-client-macos.sh
#
# Результат:
#   • Compose Multiplatform Desktop приложение собрано
#   • DMG или .app готов к установке / запуску
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
DESKTOP_DIR="$SCRIPT_DIR/apps/desktop"

echo ""
echo -e "${BOLD}════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Messenger — macOS Desktop Client Installer${NC}"
echo -e "${BOLD}════════════════════════════════════════════════════${NC}"
echo ""

# ── Проверка ОС ──────────────────────────────────────────────────────────────
step "Проверка ОС"
[[ "$(uname)" == "Darwin" ]] || error "Этот скрипт предназначен для macOS.\nДля Linux используйте: install-client-linux.sh"
success "macOS $(sw_vers -productVersion)"

# ── Проверка зависимостей ────────────────────────────────────────────────────
step "Проверка зависимостей"

if ! command -v java &>/dev/null; then
    error "JDK не найден.\n  Установите JDK 17+:\n    brew install --cask temurin\n  или https://adoptium.net/"
fi
JAVA_VER=$(java -version 2>&1 | awk -F '"' '/version/ {print $2}' | cut -d. -f1)
[[ -n "$JAVA_VER" && "$JAVA_VER" -ge 17 ]] 2>/dev/null || \
    error "Требуется JDK 17+. Найдена версия: $(java -version 2>&1 | head -1)"
success "Java $JAVA_VER найдена"

[[ -d "$DESKTOP_DIR" ]] || error "Директория Desktop-проекта не найдена: $DESKTOP_DIR"
[[ -f "$DESKTOP_DIR/gradlew" ]] || error "gradlew не найден в $DESKTOP_DIR"
chmod +x "$DESKTOP_DIR/gradlew"
success "Gradle wrapper найден"

# ── Определение доступных задач ──────────────────────────────────────────────
step "Определение задач Gradle"

cd "$DESKTOP_DIR"
TASKS=$(./gradlew tasks --quiet 2>/dev/null || true)

if echo "$TASKS" | grep -q "packageDmg"; then
    GRADLE_TASK="packageDmg"
    info "Выбрана задача: packageDmg (создаёт DMG-образ)"
elif echo "$TASKS" | grep -q "packageDistributionForCurrentOS"; then
    GRADLE_TASK="packageDistributionForCurrentOS"
    info "Выбрана задача: packageDistributionForCurrentOS"
elif echo "$TASKS" | grep -q "packageUberJarForCurrentOS"; then
    GRADLE_TASK="packageUberJarForCurrentOS"
    info "Выбрана задача: packageUberJarForCurrentOS (JAR)"
else
    GRADLE_TASK="build"
    info "Выбрана задача: build"
fi

# ── Сборка ───────────────────────────────────────────────────────────────────
step "Сборка macOS Desktop приложения ($GRADLE_TASK)"

info "Рабочая директория: $DESKTOP_DIR"
info "Первый запуск может занять несколько минут (загрузка зависимостей Gradle)..."
echo ""

./gradlew "$GRADLE_TASK" 2>&1 | tail -20

success "Сборка завершена"

# ── Поиск результатов ────────────────────────────────────────────────────────
step "Поиск результатов сборки"

BUILD_OUT="$DESKTOP_DIR/build"
FOUND_PATH=""

# Приоритет: DMG → .app → JAR
for EXT in dmg app jar; do
    CANDIDATE=$(find "$BUILD_OUT" -name "*.$EXT" -not -name "*sources*" -not -path "*/PlugIns/*" 2>/dev/null | head -1 || true)
    if [[ -n "$CANDIDATE" ]]; then
        FOUND_PATH="$CANDIDATE"
        FOUND_EXT="$EXT"
        break
    fi
done

if [[ -z "$FOUND_PATH" ]]; then
    warn "Готовый файл не найден. Проверьте содержимое $BUILD_OUT:"
    ls -la "$BUILD_OUT" 2>/dev/null || true
else
    success "Найден: $FOUND_PATH"
    echo ""

    case "$FOUND_EXT" in
        dmg)
            info "Открываю DMG-образ..."
            open "$FOUND_PATH"
            info "Перетащите Messenger.app в папку Applications."
            ;;
        app)
            echo "  Скопировать .app в /Applications? [Y/n]: "
            read -r COPY_APP
            COPY_APP="${COPY_APP:-y}"
            if [[ "${COPY_APP,,}" != "n" ]]; then
                cp -R "$FOUND_PATH" /Applications/
                success "Установлено в /Applications/$(basename "$FOUND_PATH")"
                open "/Applications/$(basename "$FOUND_PATH")"
            else
                info "Запуск напрямую из папки сборки..."
                open "$FOUND_PATH"
            fi
            ;;
        jar)
            info "Запуск JAR: java -jar \"$FOUND_PATH\""
            read -r -p "Запустить сейчас? [Y/n]: " RUN_NOW
            RUN_NOW="${RUN_NOW:-y}"
            if [[ "${RUN_NOW,,}" != "n" ]]; then
                java -jar "$FOUND_PATH" &
                disown
                success "Приложение запущено"
            fi
            ;;
    esac
fi

# ── Итог ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  macOS Desktop клиент готов!${NC}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════${NC}"
echo ""
[[ -n "$FOUND_PATH" ]] && echo -e "  Файл:  ${CYAN}$FOUND_PATH${NC}"
echo ""
echo -e "  При первом запуске приложения введите URL вашего сервера."
echo ""
