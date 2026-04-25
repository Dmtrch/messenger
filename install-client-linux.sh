#!/usr/bin/env bash
# =============================================================================
# Messenger — установка Desktop-клиента (Linux)
# =============================================================================
# Использование:
#   chmod +x install-client-linux.sh
#   ./install-client-linux.sh
#
# Результат:
#   • Compose Multiplatform Desktop приложение собрано
#   • DEB / RPM / AppImage / JAR готов к установке
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
echo -e "${BOLD}  Messenger — Linux Desktop Client Installer${NC}"
echo -e "${BOLD}════════════════════════════════════════════════════${NC}"
echo ""

# ── Проверка ОС ──────────────────────────────────────────────────────────────
step "Проверка ОС"
[[ "$(uname)" == "Linux" ]] || error "Этот скрипт предназначен для Linux.\nДля macOS используйте: install-client-macos.sh"

# Определить дистрибутив
DISTRO="unknown"
if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    DISTRO="${ID:-unknown}"
fi
success "Linux ($DISTRO)"

# ── Проверка зависимостей ────────────────────────────────────────────────────
step "Проверка зависимостей"

if ! command -v java &>/dev/null; then
    echo ""
    warn "JDK не найден. Установите JDK 17+:"
    case "$DISTRO" in
        ubuntu|debian|linuxmint|pop)
            warn "  sudo apt update && sudo apt install -y openjdk-17-jdk"
            ;;
        fedora|rhel|centos|rocky|alma)
            warn "  sudo dnf install -y java-17-openjdk-devel"
            ;;
        arch|manjaro|endeavouros)
            warn "  sudo pacman -S jdk17-openjdk"
            ;;
        opensuse*)
            warn "  sudo zypper install java-17-openjdk-devel"
            ;;
        *)
            warn "  https://adoptium.net/"
            ;;
    esac
    error "Установите JDK и повторите запуск."
fi

JAVA_VER=$(java -version 2>&1 | awk -F '"' '/version/ {print $2}' | cut -d. -f1)
[[ -n "$JAVA_VER" && "$JAVA_VER" -ge 17 ]] 2>/dev/null || \
    error "Требуется JDK 17+. Найдена версия: $(java -version 2>&1 | head -1)"
success "Java $JAVA_VER найдена"

[[ -d "$DESKTOP_DIR" ]] || error "Директория Desktop-проекта не найдена: $DESKTOP_DIR"
[[ -f "$DESKTOP_DIR/gradlew" ]] || error "gradlew не найден в $DESKTOP_DIR"
chmod +x "$DESKTOP_DIR/gradlew"
success "Gradle wrapper найден"

# Проверить наличие dpkg/rpm для соответствующего пакета
HAS_DPKG=false
HAS_RPM=false
command -v dpkg &>/dev/null && HAS_DPKG=true
command -v rpm &>/dev/null && HAS_RPM=true

# ── Определение задачи Gradle ────────────────────────────────────────────────
step "Определение задачи сборки"

cd "$DESKTOP_DIR"
TASKS=$(./gradlew tasks --quiet 2>/dev/null || true)

if $HAS_DPKG && echo "$TASKS" | grep -q "packageDeb"; then
    GRADLE_TASK="packageDeb"
    info "Выбрана задача: packageDeb (Debian/Ubuntu)"
elif $HAS_RPM && echo "$TASKS" | grep -q "packageRpm"; then
    GRADLE_TASK="packageRpm"
    info "Выбрана задача: packageRpm (Fedora/RHEL)"
elif echo "$TASKS" | grep -q "packageAppImage"; then
    GRADLE_TASK="packageAppImage"
    info "Выбрана задача: packageAppImage (универсальный)"
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
step "Сборка Linux Desktop приложения ($GRADLE_TASK)"

info "Рабочая директория: $DESKTOP_DIR"
info "Первый запуск может занять несколько минут (загрузка зависимостей)..."
echo ""

./gradlew "$GRADLE_TASK" 2>&1 | tail -20

success "Сборка завершена"

# ── Поиск и установка результатов ────────────────────────────────────────────
step "Поиск результатов сборки"

BUILD_OUT="$DESKTOP_DIR/build"
FOUND_PATH=""
FOUND_EXT=""

for EXT in deb rpm AppImage jar; do
    CANDIDATE=$(find "$BUILD_OUT" -iname "*.$EXT" -not -name "*sources*" 2>/dev/null | head -1 || true)
    if [[ -n "$CANDIDATE" ]]; then
        FOUND_PATH="$CANDIDATE"
        FOUND_EXT="${EXT,,}"
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
        deb)
            info "Установка DEB-пакета (требуются права sudo)..."
            read -r -p "Установить через dpkg? [Y/n]: " DO_INSTALL
            DO_INSTALL="${DO_INSTALL:-y}"
            if [[ "${DO_INSTALL,,}" != "n" ]]; then
                sudo dpkg -i "$FOUND_PATH" && success "Пакет установлен" || \
                    warn "Ошибка установки. Попробуйте: sudo dpkg -i \"$FOUND_PATH\""
            fi
            ;;
        rpm)
            info "Установка RPM-пакета (требуются права sudo)..."
            read -r -p "Установить через rpm? [Y/n]: " DO_INSTALL
            DO_INSTALL="${DO_INSTALL:-y}"
            if [[ "${DO_INSTALL,,}" != "n" ]]; then
                sudo rpm -i "$FOUND_PATH" && success "Пакет установлен" || \
                    warn "Ошибка установки. Попробуйте: sudo rpm -i \"$FOUND_PATH\""
            fi
            ;;
        appimage)
            chmod +x "$FOUND_PATH"
            info "AppImage готов к запуску."
            read -r -p "Скопировать в ~/Applications/? [Y/n]: " DO_COPY
            DO_COPY="${DO_COPY:-y}"
            if [[ "${DO_COPY,,}" != "n" ]]; then
                mkdir -p "$HOME/Applications"
                cp "$FOUND_PATH" "$HOME/Applications/"
                success "Скопировано в $HOME/Applications/"
            fi
            read -r -p "Запустить сейчас? [Y/n]: " RUN_NOW
            RUN_NOW="${RUN_NOW:-y}"
            if [[ "${RUN_NOW,,}" != "n" ]]; then
                "$FOUND_PATH" &
                disown
                success "Приложение запущено"
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
echo -e "${GREEN}${BOLD}  Linux Desktop клиент готов!${NC}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════${NC}"
echo ""
[[ -n "$FOUND_PATH" ]] && echo -e "  Файл:  ${CYAN}$FOUND_PATH${NC}"
echo ""
echo -e "  При первом запуске приложения введите URL вашего сервера."
echo ""
