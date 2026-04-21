#!/usr/bin/env bash
set -euo pipefail

TOTAL_MIGRATIONS=28

DB_PATH="${DB_PATH:-./messenger.db}"
MODE=""
ROLLBACK_N=""

usage() {
  echo "Usage: $(basename "$0") [--db PATH] [--dry-run] [--version] [--rollback N]"
  echo ""
  echo "Options:"
  echo "  --db PATH       Path to SQLite DB (default: \$DB_PATH or ./messenger.db)"
  echo "  --dry-run       Show pending migration IDs without applying"
  echo "  --version       Show current applied migration version"
  echo "  --rollback N    Remove schema_migrations entries with id > N"
  exit 1
}

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --db)
      DB_PATH="$2"; shift 2 ;;
    --dry-run)
      MODE="dry-run"; shift ;;
    --version)
      MODE="version"; shift ;;
    --rollback)
      MODE="rollback"; ROLLBACK_N="$2"; shift 2 ;;
    --help|-h)
      usage ;;
    *)
      echo "Unknown option: $1" >&2; usage ;;
  esac
done

[[ -z "$MODE" ]] && usage

# Check sqlite3 is available
if ! command -v sqlite3 &>/dev/null; then
  echo "Error: sqlite3 is not installed. Install it (e.g. brew install sqlite3 or apt install sqlite3)." >&2
  exit 1
fi

# Run a query against the DB; returns empty string if table doesn't exist
run_query() {
  sqlite3 "$DB_PATH" "$1" 2>/dev/null || true
}

# Get max applied migration ID (0 if none)
get_current_version() {
  local result
  result=$(run_query "SELECT COALESCE(MAX(id), 0) FROM schema_migrations;" 2>/dev/null) || result="0"
  echo "${result:-0}"
}

# --version
if [[ "$MODE" == "version" ]]; then
  if [[ ! -f "$DB_PATH" ]]; then
    echo "Error: database file not found: $DB_PATH" >&2
    exit 1
  fi
  ver=$(get_current_version)
  if [[ "$ver" == "0" ]]; then
    echo "0 (no migrations applied)"
  else
    echo "$ver"
  fi
  exit 0
fi

# --dry-run
if [[ "$MODE" == "dry-run" ]]; then
  if [[ ! -f "$DB_PATH" ]]; then
    echo "No database found, all migrations pending: $(seq -s ' ' 1 $TOTAL_MIGRATIONS)"
    exit 0
  fi

  # Get all applied IDs as space-separated list
  applied=$(run_query "SELECT id FROM schema_migrations ORDER BY id;" | tr '\n' ' ')

  pending=()
  for i in $(seq 1 $TOTAL_MIGRATIONS); do
    if ! echo " $applied " | grep -qw "$i"; then
      pending+=("$i")
    fi
  done

  if [[ ${#pending[@]} -eq 0 ]]; then
    echo "All $TOTAL_MIGRATIONS migrations applied."
  else
    echo "Pending migrations: ${pending[*]}"
  fi
  exit 0
fi

# --rollback N
if [[ "$MODE" == "rollback" ]]; then
  if [[ ! "$ROLLBACK_N" =~ ^[0-9]+$ ]]; then
    echo "Error: --rollback requires a non-negative integer argument." >&2
    exit 1
  fi

  if [[ ! -f "$DB_PATH" ]]; then
    echo "Error: database file not found: $DB_PATH" >&2
    exit 1
  fi

  current=$(get_current_version)

  if [[ "$ROLLBACK_N" -ge "$current" ]]; then
    echo "Nothing to rollback. Current version: $current, requested rollback to: $ROLLBACK_N"
    exit 0
  fi

  echo "WARNING: This will mark migrations $((ROLLBACK_N + 1))..$current as not applied."
  echo "Data changes are NOT reversed. Only schema_migrations table entries will be deleted."
  echo ""
  printf "Type 'yes' to confirm: "
  read -r confirm
  if [[ "$confirm" != "yes" ]]; then
    echo "Aborted."
    exit 1
  fi

  deleted=$(sqlite3 "$DB_PATH" "DELETE FROM schema_migrations WHERE id > $ROLLBACK_N; SELECT changes();")
  echo "Rolled back: $deleted migration record(s) removed. New version: $ROLLBACK_N"
  exit 0
fi
