#!/usr/bin/env bash
# =============================================================================
# Messenger Server — автоматическая установка (macOS / Linux)
# =============================================================================
# Использование:
#   chmod +x install-server.sh
#   ./install-server.sh
#
# Результат:
#   • Сервер запущен в Docker
#   • Файл server-main.txt — все данные для администратора
# =============================================================================
set -euo pipefail

# ── Цвета вывода ──────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERR]${NC}  $*"; exit 1; }
step()    { echo -e "\n${BOLD}==> $*${NC}"; }

# ── Проверка зависимостей ────────────────────────────────────────────────────
step "Проверка зависимостей"

check_cmd() {
    if ! command -v "$1" &>/dev/null; then
        error "Не найден '$1'. Установите его и повторите запуск."
    fi
    success "$1 найден"
}

check_cmd docker
check_cmd openssl
check_cmd curl

# Docker Compose v2 (встроен в Docker Desktop) или v1
if docker compose version &>/dev/null 2>&1; then
    COMPOSE="docker compose"
elif docker-compose version &>/dev/null 2>&1; then
    COMPOSE="docker-compose"
else
    error "Docker Compose не найден. Установите Docker Desktop или docker-compose."
fi
success "Docker Compose: $COMPOSE"

# Проверяем, что Docker запущен
if ! docker info &>/dev/null 2>&1; then
    error "Docker не запущен. Запустите Docker Desktop и повторите."
fi
success "Docker работает"

# ── Интерактивная конфигурация ───────────────────────────────────────────────
step "Настройка сервера"

echo ""
echo "Оставьте поле пустым для использования значения по умолчанию (в скобках)."
echo ""

prompt() {
    local var_name="$1"
    local prompt_text="$2"
    local default="$3"
    local secret="${4:-no}"

    if [[ "$secret" == "yes" ]]; then
        read -r -s -p "$prompt_text [$default]: " value
        echo ""
    else
        read -r -p "$prompt_text [$default]: " value
    fi

    value="${value:-$default}"
    eval "$var_name='$value'"
}

prompt SERVER_NAME      "Имя сервера" "Messenger"
prompt SERVER_DESC      "Описание сервера" "Self-hosted messenger"
prompt PORT             "Порт сервера" "8080"
prompt ALLOWED_ORIGIN   "URL сервера (напр. https://chat.example.com; пусто = localhost)" ""
prompt REG_MODE         "Режим регистрации [open/invite/approval]" "open"

# Проверка режима регистрации
case "$REG_MODE" in
    open|invite|approval) ;;
    *) error "Неверный режим: '$REG_MODE'. Допустимо: open, invite, approval" ;;
esac

echo ""
echo -e "${BOLD}Учётная запись администратора:${NC}"
prompt ADMIN_USER "  Логин администратора" "admin"
while true; do
    read -r -s -p "  Пароль администратора: " ADMIN_PASS; echo ""
    read -r -s -p "  Повторите пароль:       " ADMIN_PASS2; echo ""
    [[ "$ADMIN_PASS" == "$ADMIN_PASS2" ]] && break
    warn "Пароли не совпадают, попробуйте ещё раз."
done
[[ ${#ADMIN_PASS} -lt 8 ]] && warn "Пароль короткий (менее 8 символов)"

# TURN (опционально)
echo ""
echo -e "${BOLD}WebRTC TURN-сервер (опционально, Enter — пропустить):${NC}"
prompt TURN_URL    "  TURN URL (напр. turn:turn.example.com:3478)" ""
TURN_SECRET_VAL=""
if [[ -n "$TURN_URL" ]]; then
    prompt TURN_SECRET_VAL "  TURN Secret" ""
fi

# ── Генерация секретов ───────────────────────────────────────────────────────
step "Генерация секретов"

JWT_SECRET=$(openssl rand -hex 32)
success "JWT_SECRET сгенерирован"

# ── Запись .env ──────────────────────────────────────────────────────────────
step "Создание файла .env"

ENV_FILE=".env"
if [[ -f "$ENV_FILE" ]]; then
    BACKUP=".env.backup.$(date +%Y%m%d-%H%M%S)"
    warn "Существующий .env сохранён как $BACKUP"
    cp "$ENV_FILE" "$BACKUP"
fi

cat > "$ENV_FILE" <<EOF
# Сгенерировано install-server.sh $(date '+%Y-%m-%d %H:%M:%S')

# ── Обязательные ──────────────────────────────────────────────────────────────
JWT_SECRET=${JWT_SECRET}

# ── База данных и хранилище ────────────────────────────────────────────────────
DB_PATH=/data/messenger.db
MEDIA_DIR=/data/media
DOWNLOADS_DIR=/data/downloads
PORT=${PORT}

# ── Сервер ────────────────────────────────────────────────────────────────────
SERVER_NAME=${SERVER_NAME}
SERVER_DESCRIPTION=${SERVER_DESC}
REGISTRATION_MODE=${REG_MODE}

# ── Администратор ─────────────────────────────────────────────────────────────
ADMIN_USERNAME=${ADMIN_USER}
ADMIN_PASSWORD=${ADMIN_PASS}

# ── Безопасность ──────────────────────────────────────────────────────────────
ALLOWED_ORIGIN=${ALLOWED_ORIGIN}
BEHIND_PROXY=false

# ── Web Push VAPID (заполнится после первого запуска) ─────────────────────────
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=

# ── TLS (оставьте пустым при использовании Cloudflare Tunnel) ─────────────────
TLS_CERT=
TLS_KEY=

# ── WebRTC ────────────────────────────────────────────────────────────────────
STUN_URL=stun:stun.l.google.com:19302
TURN_URL=${TURN_URL}
TURN_SECRET=${TURN_SECRET_VAL}
TURN_CREDENTIAL_TTL=86400

# ── Push-уведомления для мобильных (опционально) ─────────────────────────────
# Android FCM: укажите Server Key из Firebase Console
#FCM_LEGACY_KEY=
# iOS APNs: загрузите .p8 ключ из Apple Developer Portal
#APNS_KEY_PATH=/data/apns.p8
#APNS_KEY_ID=
#APNS_TEAM_ID=
#APNS_BUNDLE_ID=com.messenger
#APNS_SANDBOX=true

# ── Политики групп и загрузок (опционально, используются значения по умолчанию)
#MAX_GROUP_MEMBERS=50
#ALLOW_USERS_CREATE_GROUPS=true
#MAX_UPLOAD_BYTES=104857600

# ── Метаданные приложения (для /api/version, опционально) ─────────────────────
#APP_VERSION=1.0.0
#MIN_CLIENT_VERSION=0.0.0
#APP_CHANGELOG=

# ── Cloudflare Tunnel (только при запуске с профилем cloudflare) ──────────────
#TUNNEL_TOKEN=
EOF

success ".env создан"

# ── Сборка образа ────────────────────────────────────────────────────────────
step "Сборка Docker-образа (может занять несколько минут)"

$COMPOSE build 2>&1 | tail -5
success "Образ собран"

# ── Первый запуск для получения VAPID ────────────────────────────────────────
step "Первый запуск сервера (получение VAPID-ключей)"

$COMPOSE up -d
info "Ожидание генерации VAPID-ключей (15 секунд)..."
sleep 15

VAPID_LOG=$($COMPOSE logs messenger 2>/dev/null || $COMPOSE logs 2>/dev/null)

VAPID_PRIV=$(echo "$VAPID_LOG" | grep -o 'VAPID_PRIVATE_KEY=[^[:space:]]*' | head -1 | cut -d= -f2)
VAPID_PUB=$(echo  "$VAPID_LOG" | grep -o 'VAPID_PUBLIC_KEY=[^[:space:]]*'  | head -1 | cut -d= -f2)

if [[ -z "$VAPID_PRIV" || -z "$VAPID_PUB" ]]; then
    warn "VAPID-ключи не найдены в логах (возможно, уже были сохранены или логи буферизированы)."
    warn "Проверьте вручную: $COMPOSE logs messenger | grep VAPID"
else
    success "VAPID-ключи получены"

    # Обновляем .env
    if [[ "$(uname)" == "Darwin" ]]; then
        sed -i '' "s|^VAPID_PUBLIC_KEY=.*|VAPID_PUBLIC_KEY=${VAPID_PUB}|"   "$ENV_FILE"
        sed -i '' "s|^VAPID_PRIVATE_KEY=.*|VAPID_PRIVATE_KEY=${VAPID_PRIV}|" "$ENV_FILE"
    else
        sed -i    "s|^VAPID_PUBLIC_KEY=.*|VAPID_PUBLIC_KEY=${VAPID_PUB}|"   "$ENV_FILE"
        sed -i    "s|^VAPID_PRIVATE_KEY=.*|VAPID_PRIVATE_KEY=${VAPID_PRIV}|" "$ENV_FILE"
    fi
    success ".env обновлён с VAPID-ключами"

    # Перезапуск для применения ключей
    step "Перезапуск сервера с сохранёнными VAPID-ключами"
    $COMPOSE restart
    sleep 5
    success "Сервер перезапущен"
fi

# ── Проверка работоспособности ───────────────────────────────────────────────
step "Проверка доступности сервера"

CHECK_URL="http://localhost:${PORT}/api/server/info"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$CHECK_URL" 2>/dev/null || echo "000")

if [[ "$HTTP_CODE" == "200" ]]; then
    success "Сервер отвечает на $CHECK_URL (HTTP $HTTP_CODE)"
    SERVER_STATUS="РАБОТАЕТ"
else
    warn "Сервер не ответил ожидаемым кодом (получено: HTTP $HTTP_CODE)"
    warn "Проверьте логи: $COMPOSE logs"
    SERVER_STATUS="ТРЕБУЕТ ПРОВЕРКИ (HTTP $HTTP_CODE)"
fi

# ── Запись server-main.txt ───────────────────────────────────────────────────
step "Запись данных администратора в server-main.txt"

INSTALL_DATE=$(date '+%Y-%m-%d %H:%M:%S')
SERVER_URL_DISPLAY="${ALLOWED_ORIGIN:-http://localhost:${PORT}}"

cat > server-main.txt <<EOF
=============================================================================
  MESSENGER SERVER — ДАННЫЕ АДМИНИСТРАТОРА
  Установлено: ${INSTALL_DATE}
=============================================================================

СТАТУС СЕРВЕРА: ${SERVER_STATUS}

── Доступ ────────────────────────────────────────────────────────────────────

  URL сервера:    ${SERVER_URL_DISPLAY}
  Локальный URL:  http://localhost:${PORT}
  Порт:           ${PORT}

── Учётная запись администратора ────────────────────────────────────────────

  Логин:    ${ADMIN_USER}
  Пароль:   ${ADMIN_PASS}

  ВНИМАНИЕ: Сохраните этот файл в надёжном месте и удалите с сервера
  после сохранения пароля в менеджере паролей.

── Конфигурация сервера ──────────────────────────────────────────────────────

  Имя:              ${SERVER_NAME}
  Описание:         ${SERVER_DESC}
  Режим регистрации: ${REG_MODE}

── Секреты (СТРОГО КОНФИДЕНЦИАЛЬНО) ─────────────────────────────────────────

  JWT_SECRET:         ${JWT_SECRET}
  VAPID_PUBLIC_KEY:   ${VAPID_PUB:-<будет в .env после перезапуска>}
  VAPID_PRIVATE_KEY:  ${VAPID_PRIV:-<будет в .env после перезапуска>}

── WebRTC ────────────────────────────────────────────────────────────────────

  STUN: stun:stun.l.google.com:19302
  TURN URL:    ${TURN_URL:-не настроен}
  TURN Secret: ${TURN_SECRET_VAL:-не настроен}

── Пути данных (внутри Docker volume) ───────────────────────────────────────

  База данных: /data/messenger.db  (volume: messenger_data)
  Медиафайлы:  /data/media         (volume: messenger_data)

── Управление сервером ───────────────────────────────────────────────────────

  Запуск:      docker compose up -d
  Остановка:   docker compose stop
  Перезапуск:  docker compose restart
  Логи:        docker compose logs -f
  Статус:      docker compose ps

── Резервное копирование ─────────────────────────────────────────────────────

  docker compose stop
  docker cp messenger:/data/messenger.db ./backup-\$(date +%Y%m%d).db
  docker compose start

── Обновление ────────────────────────────────────────────────────────────────

  git pull
  docker compose build
  docker compose up -d

── Файлы конфигурации ────────────────────────────────────────────────────────

  .env          — переменные окружения (ХРАНИТЕ В БЕЗОПАСНОСТИ)
  docker-compose.yml — конфигурация Docker

=============================================================================
  Сохраните этот файл в безопасном месте!
  Никогда не публикуйте содержимое секций "Секреты" публично.
=============================================================================
EOF

success "server-main.txt создан"

# ── Итог ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Установка завершена успешно!${NC}"
echo -e "${GREEN}${BOLD}════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Сервер:      ${CYAN}${SERVER_URL_DISPLAY}${NC}"
echo -e "  Локально:    ${CYAN}http://localhost:${PORT}${NC}"
echo -e "  Администратор: ${BOLD}${ADMIN_USER}${NC}"
echo -e "  Статус:      ${GREEN}${SERVER_STATUS}${NC}"
echo ""
echo -e "  Данные администратора сохранены в: ${BOLD}server-main.txt${NC}"
echo -e "  ${YELLOW}Сохраните этот файл в безопасном месте!${NC}"
echo ""
echo -e "  Логи: ${CYAN}$COMPOSE logs -f${NC}"
echo ""
