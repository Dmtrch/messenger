#!/usr/bin/env bash
# Использование: chmod +x server-ctl.sh && ./server-ctl.sh {start|stop|restart|status|logs|build}

# ╔══════════════════════════════════════════════════════════════╗
# ║           MESSENGER SERVER CONTROL SCRIPT v1.0              ║
# ╚══════════════════════════════════════════════════════════════╝

set -euo pipefail

# ── Цвета ────────────────────────────────────────────────────────
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Пути ─────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="${SCRIPT_DIR}/server"
BIN="${SERVER_DIR}/bin/server"
PID_FILE="${SERVER_DIR}/messenger.pid"
LOG_FILE="${SERVER_DIR}/messenger.log"
CONFIG_FILE="${SERVER_DIR}/config.yaml"

# ── Вспомогательные функции ───────────────────────────────────────

get_port() {
  if [[ -f "${CONFIG_FILE}" ]]; then
    grep -E '^port:' "${CONFIG_FILE}" | awk '{print $2}' | tr -d '"' | head -1
  fi
}

get_uptime() {
  local pid="$1"
  if command -v ps &>/dev/null; then
    local start
    start=$(ps -o lstart= -p "${pid}" 2>/dev/null | xargs -I{} date -j -f "%a %b %d %T %Y" "{}" "+%s" 2>/dev/null \
      || ps -o etimes= -p "${pid}" 2>/dev/null | xargs)
    # Попробуем через etimes (Linux и macOS)
    local etimes
    etimes=$(ps -o etimes= -p "${pid}" 2>/dev/null | tr -d ' ') || etimes=""
    if [[ -n "${etimes}" && "${etimes}" =~ ^[0-9]+$ ]]; then
      local h=$(( etimes / 3600 ))
      local m=$(( (etimes % 3600) / 60 ))
      local s=$(( etimes % 60 ))
      printf "%dч %dм %dс" "${h}" "${m}" "${s}"
      return
    fi
  fi
  echo "неизвестно"
}

is_running() {
  local pid="$1"
  kill -0 "${pid}" 2>/dev/null
}

read_pid() {
  if [[ -f "${PID_FILE}" ]]; then
    cat "${PID_FILE}"
  fi
}

usage() {
  echo -e "${BOLD}Использование:${NC} $(basename "$0") {start|stop|restart|status|logs|build}"
  echo ""
  echo -e "  ${CYAN}start${NC}    — Запустить сервер"
  echo -e "  ${CYAN}stop${NC}     — Остановить сервер"
  echo -e "  ${CYAN}restart${NC}  — Перезапустить сервер"
  echo -e "  ${CYAN}status${NC}   — Показать статус сервера"
  echo -e "  ${CYAN}logs${NC}     — Следить за логами (tail -f)"
  echo -e "  ${CYAN}build${NC}    — Собрать бинарник из исходников"
  exit 1
}

# ── Команды ───────────────────────────────────────────────────────

cmd_start() {
  echo -e "${BOLD}${CYAN}▶ Запуск сервера Messenger...${NC}"

  # Проверить: уже запущен?
  local existing_pid
  existing_pid=$(read_pid)
  if [[ -n "${existing_pid}" ]] && is_running "${existing_pid}"; then
    echo -e "${YELLOW}Сервер уже запущен (PID: ${existing_pid})${NC}"
    exit 0
  fi

  # Проверить: бинарник существует?
  if [[ ! -f "${BIN}" ]]; then
    echo -e "${RED}Бинарник не найден: ${BIN}${NC}"
    echo -e "Запустите сборку: ${CYAN}./server-ctl.sh build${NC}"
    exit 1
  fi

  # Запустить процесс
  cd "${SERVER_DIR}"
  nohup ./bin/server >> messenger.log 2>&1 &
  local new_pid=$!
  echo "${new_pid}" > "${PID_FILE}"

  # Подождать 1 секунду и проверить живость
  sleep 1
  if ! is_running "${new_pid}"; then
    echo -e "${RED}Сервер не смог запуститься. Проверьте лог: ${LOG_FILE}${NC}"
    rm -f "${PID_FILE}"
    exit 1
  fi

  local port
  port=$(get_port)
  echo -e "${GREEN}${BOLD}✓ Сервер запущен (PID: ${new_pid})${NC}"
  if [[ -n "${port}" ]]; then
    echo -e "  ${CYAN}URL:${NC}   http://localhost:${port}/"
    echo -e "  ${CYAN}Admin:${NC} http://localhost:${port}/admin/"
  fi
}

cmd_stop() {
  echo -e "${BOLD}${CYAN}■ Остановка сервера Messenger...${NC}"

  local pid
  pid=$(read_pid)
  if [[ -z "${pid}" ]] || ! is_running "${pid}" 2>/dev/null; then
    echo -e "${YELLOW}Сервер не запущен${NC}"
    [[ -f "${PID_FILE}" ]] && rm -f "${PID_FILE}"
    exit 0
  fi

  # Отправить SIGTERM
  kill -TERM "${pid}" 2>/dev/null || true

  # Ждать до 10 секунд
  local waited=0
  while is_running "${pid}" 2>/dev/null && (( waited < 10 )); do
    sleep 1
    (( waited++ )) || true
  done

  # SIGKILL если не умер
  if is_running "${pid}" 2>/dev/null; then
    echo -e "${YELLOW}Процесс не ответил на SIGTERM, отправляю SIGKILL...${NC}"
    kill -KILL "${pid}" 2>/dev/null || true
    sleep 1
  fi

  rm -f "${PID_FILE}"
  echo -e "${GREEN}${BOLD}✓ Сервер остановлен${NC}"
}

cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

cmd_status() {
  local pid
  pid=$(read_pid)
  local port
  port=$(get_port)

  echo -e "${BOLD}${CYAN}══ Статус сервера Messenger ══${NC}"

  if [[ -n "${pid}" ]] && is_running "${pid}" 2>/dev/null; then
    local uptime
    uptime=$(get_uptime "${pid}")
    echo -e "  ${GREEN}${BOLD}● Запущен${NC} (PID: ${pid}, аптайм: ${uptime})"
  else
    echo -e "  ${RED}${BOLD}○ Остановлен${NC}"
    [[ -f "${PID_FILE}" ]] && rm -f "${PID_FILE}"
  fi

  if [[ -n "${port}" ]]; then
    echo -e "  ${CYAN}Порт:${NC}  ${port}"
    echo -e "  ${CYAN}URL:${NC}   http://localhost:${port}/"
    echo -e "  ${CYAN}Admin:${NC} http://localhost:${port}/admin/"
  fi
}

cmd_logs() {
  if [[ ! -f "${LOG_FILE}" ]]; then
    echo -e "${RED}Лог-файл не найден: ${LOG_FILE}${NC}"
    exit 1
  fi
  echo -e "${CYAN}Слежение за логами (Ctrl+C для выхода):${NC}"
  tail -f "${LOG_FILE}"
}

cmd_build() {
  echo -e "${BOLD}${CYAN}⚙ Сборка сервера Messenger...${NC}"

  if ! command -v go &>/dev/null; then
    echo -e "${RED}Команда 'go' не найдена.${NC}"
    echo -e "Установите Go: ${CYAN}https://go.dev/dl/${NC}"
    echo -e "  macOS:  ${CYAN}brew install go${NC}"
    echo -e "  Linux:  ${CYAN}https://go.dev/doc/install${NC}"
    exit 1
  fi

  mkdir -p "${SERVER_DIR}/bin"
  echo -e "  Версия Go: $(go version)"
  (
    cd "${SERVER_DIR}"
    go build -o bin/server ./cmd/server
  )
  echo -e "${GREEN}${BOLD}✓ Сборка завершена: ${BIN}${NC}"
}

# ── Точка входа ───────────────────────────────────────────────────

if [[ $# -eq 0 ]]; then
  usage
fi

case "$1" in
  start)   cmd_start   ;;
  stop)    cmd_stop    ;;
  restart) cmd_restart ;;
  status)  cmd_status  ;;
  logs)    cmd_logs    ;;
  build)   cmd_build   ;;
  *)       usage       ;;
esac
