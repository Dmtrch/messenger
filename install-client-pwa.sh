#!/usr/bin/env bash
# =============================================================================
# Messenger — сборка PWA-клиента (macOS / Linux)
# =============================================================================
# Использование:
#   chmod +x install-client-pwa.sh
#   ./install-client-pwa.sh
#
# Результат:
#   • React-клиент собран в client/dist/
#   • Файлы готовы для встраивания в сервер (server/static/)
#   • Или сервер запущен для локального тестирования
#
# Примечание:
#   PWA не требует отдельной установки — это веб-приложение.
#   Откройте URL сервера в браузере и нажмите "Установить" / "Добавить на главный экран".
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
CLIENT_DIR="$SCRIPT_DIR/client"
STATIC_DIR="$SCRIPT_DIR/server/static"

echo ""
echo -e "${BOLD}════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  Messenger — PWA Client Builder${NC}"
echo -e "${BOLD}════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  PWA (Progressive Web App) — браузерное приложение."
echo -e "  После сборки откройте URL сервера в Chrome / Safari / Edge"
echo -e "  и нажмите \"Установить\" для добавления на рабочий стол."
echo ""

# ── Выбор режима ─────────────────────────────────────────────────────────────
step "Выбор режима"
echo ""
echo "  1) Сборка для продакшн (dist → server/static/) — рекомендуется"
echo "  2) Запуск dev-сервера (Vite hot-reload, localhost:5173)"
echo ""
read -r -p "Режим [1]: " MODE
MODE="${MODE:-1}"

# ── Проверка зависимостей ────────────────────────────────────────────────────
step "Проверка зависимостей"

if ! command -v node &>/dev/null; then
    echo ""
    OS_TYPE="$(uname)"
    warn "Node.js не найден. Установите Node.js 18+:"
    if [[ "$OS_TYPE" == "Darwin" ]]; then
        warn "  brew install node"
        warn "  или https://nodejs.org/"
    else
        warn "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
        warn "  sudo apt install -y nodejs"
        warn "  или https://nodejs.org/"
    fi
    error "Установите Node.js и повторите запуск."
fi

NODE_VER=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
[[ "$NODE_VER" -ge 18 ]] || error "Требуется Node.js 18+. Найдена версия: $(node --version)"
success "Node.js $(node --version)"

command -v npm &>/dev/null || error "npm не найден. Переустановите Node.js с https://nodejs.org/"
success "npm $(npm --version)"

[[ -d "$CLIENT_DIR" ]] || error "Директория клиента не найдена: $CLIENT_DIR"
[[ -f "$CLIENT_DIR/package.json" ]] || error "package.json не найден в $CLIENT_DIR"
success "package.json найден"

# ── Установка зависимостей ───────────────────────────────────────────────────
step "Установка npm-зависимостей"

cd "$CLIENT_DIR"
info "npm install..."
npm install 2>&1 | tail -5
success "Зависимости установлены"

# ── Режим 2: dev-сервер ──────────────────────────────────────────────────────
if [[ "$MODE" == "2" ]]; then
    step "Запуск Vite dev-сервера"
    echo ""
    echo -e "  ${YELLOW}Нажмите Ctrl+C для остановки.${NC}"
    echo ""
    read -r -p "URL серверного API (по умолчанию http://localhost:8080): " API_URL
    API_URL="${API_URL:-http://localhost:8080}"

    export VITE_API_URL="$API_URL"
    info "Запуск: npm run dev"
    echo ""
    npm run dev
    exit 0
fi

# ── Режим 1: продакшн-сборка ─────────────────────────────────────────────────
step "Продакшн-сборка React-клиента"

info "npm run build..."
npm run build 2>&1 | tail -15

DIST_DIR="$CLIENT_DIR/dist"
[[ -d "$DIST_DIR" ]] || error "dist/ не создан после сборки. Проверьте вывод выше."

INDEX_FILE="$DIST_DIR/index.html"
[[ -f "$INDEX_FILE" ]] || error "index.html не найден в dist/"

DIST_SIZE=$(du -sh "$DIST_DIR" 2>/dev/null | cut -f1)
success "Сборка завершена (размер: $DIST_SIZE)"
success "Путь: $DIST_DIR"

# ── Копирование в server/static/ ─────────────────────────────────────────────
step "Интеграция с сервером"

echo ""
echo "  Выберите действие:"
echo "  1) Скопировать dist/ в server/static/ (требует пересборки Go-сервера)"
echo "  2) Только показать путь к dist/ (для ручного развёртывания)"
echo ""
read -r -p "Действие [1]: " DEPLOY_MODE
DEPLOY_MODE="${DEPLOY_MODE:-1}"

if [[ "$DEPLOY_MODE" == "1" ]]; then
    if [[ -d "$STATIC_DIR" ]]; then
        BACKUP_DIR="${STATIC_DIR}.backup.$(date +%Y%m%d-%H%M%S)"
        warn "Резервная копия server/static/ → $BACKUP_DIR"
        cp -R "$STATIC_DIR" "$BACKUP_DIR"
    fi

    mkdir -p "$STATIC_DIR"
    cp -R "$DIST_DIR/." "$STATIC_DIR/"
    success "Файлы скопированы в $STATIC_DIR"
    echo ""
    info "Для применения изменений пересоберите Go-сервер:"
    info "  cd server && go build -o bin/server ./cmd/server"
    info "  или запустите: docker compose build"
else
    info "Путь к готовым файлам:"
    info "  $DIST_DIR"
    info ""
    info "Для размещения на веб-сервере (nginx, apache):"
    info "  Скопируйте содержимое dist/ в корень сайта."
    info "  Настройте реверс-прокси на API-сервер."
fi

# ── Итог ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  PWA клиент собран!${NC}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  dist:    ${CYAN}$DIST_DIR${NC}"
echo ""
echo -e "  Как использовать PWA:"
echo -e "    1. Откройте URL вашего сервера в браузере"
echo -e "    2. Chrome/Edge: значок установки в адресной строке"
echo -e "    3. Safari/iOS: Поделиться → Добавить на экран «Домой»"
echo ""
