# Stage 7: Migration Framework & Deployment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ad-hoc `ALTER TABLE` calls with a versioned migration runner, and add a full deployment guide with Cloudflare Tunnel support.

**Architecture:** Built-in mini migration runner (`server/db/migrate.go`) tracks applied migrations in a `schema_migrations` SQLite table. Runner is called from `db.Open()` on every startup. Docker Compose gains an optional `cloudflared` service via profiles.

**Tech Stack:** Go 1.21+, SQLite (modernc.org/sqlite), Docker Compose v2, Cloudflare Tunnel

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `server/db/migrate.go` | Create | Migration runner + migration list |
| `server/db/migrate_test.go` | Create | Tests for runner (fresh DB, idempotency, legacy DB) |
| `server/db/schema.go` | Modify | Remove ad-hoc loop, add `RunMigrations` call |
| `docker-compose.yml` | Modify | Add cloudflared service (profile), full env vars |
| `.env.example` | Create | Documented env vars template |
| `docs/deployment.md` | Create | Full deployment guide |

---

## Task 1: Create migration runner

**Files:**
- Create: `server/db/migrate.go`

- [ ] **Step 1: Create `server/db/migrate.go`**

```go
package db

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// Migration описывает одну версионированную миграцию схемы БД.
type Migration struct {
	ID  int
	SQL string
}

// migrations — список всех миграций в порядке применения.
// Для добавления новой: append с следующим ID.
var migrations = []Migration{
	{1, `ALTER TABLE messages ADD COLUMN client_msg_id TEXT`},
	{2, `ALTER TABLE messages ADD COLUMN recipient_id TEXT NOT NULL DEFAULT ''`},
	{3, `ALTER TABLE messages ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0`},
	{4, `ALTER TABLE messages ADD COLUMN edited_at INTEGER`},
	{5, `ALTER TABLE identity_keys ADD COLUMN device_id TEXT`},
	{6, `ALTER TABLE pre_keys ADD COLUMN device_id TEXT`},
}

// RunMigrations создаёт таблицу schema_migrations и применяет все
// непримененные миграции. Идемпотентен: безопасно вызывать при каждом старте.
func RunMigrations(db *sql.DB) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		id         INTEGER PRIMARY KEY,
		applied_at INTEGER NOT NULL
	)`)
	if err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	rows, err := db.Query(`SELECT id FROM schema_migrations`)
	if err != nil {
		return fmt.Errorf("query applied migrations: %w", err)
	}
	defer rows.Close()

	applied := make(map[int]bool)
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("scan migration id: %w", err)
		}
		applied[id] = true
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate migrations: %w", err)
	}

	for _, m := range migrations {
		if applied[m.ID] {
			continue
		}

		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("begin migration %d: %w", m.ID, err)
		}

		if _, err := tx.Exec(m.SQL); err != nil {
			_ = tx.Rollback()
			// Идемпотентность: свежие установки уже содержат колонки в schema
			if strings.Contains(err.Error(), "duplicate column name") {
				if _, err2 := db.Exec(
					`INSERT INTO schema_migrations(id, applied_at) VALUES(?, ?)`,
					m.ID, time.Now().Unix(),
				); err2 != nil {
					return fmt.Errorf("record idempotent migration %d: %w", m.ID, err2)
				}
				continue
			}
			return fmt.Errorf("migration %d: %w", m.ID, err)
		}

		if _, err := tx.Exec(
			`INSERT INTO schema_migrations(id, applied_at) VALUES(?, ?)`,
			m.ID, time.Now().Unix(),
		); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("record migration %d: %w", m.ID, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %d: %w", m.ID, err)
		}
	}

	return nil
}
```

- [ ] **Step 2: Verify it compiles**

```sh
cd server && go build ./db/...
```

Expected: no output (clean build).

- [ ] **Step 3: Commit**

```sh
git add server/db/migrate.go
git commit -m "feat(db): versioned migration runner"
```

---

## Task 2: Write tests for migration runner

**Files:**
- Create: `server/db/migrate_test.go`

- [ ] **Step 1: Create `server/db/migrate_test.go`**

```go
package db

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:?_pragma=foreign_keys(ON)&_pragma=journal_mode(WAL)")
	if err != nil {
		t.Fatal("open test db:", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// TestRunMigrations_FreshDB: свежая БД с полной схемой.
// Колонки уже есть → duplicate column name → все миграции всё равно записаны.
func TestRunMigrations_FreshDB(t *testing.T) {
	db := openTestDB(t)

	if _, err := db.Exec(schema); err != nil {
		t.Fatal("apply schema:", err)
	}

	if err := RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations on fresh DB: %v", err)
	}

	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&count); err != nil {
		t.Fatal("count migrations:", err)
	}
	if count != len(migrations) {
		t.Errorf("expected %d migrations recorded, got %d", len(migrations), count)
	}
}

// TestRunMigrations_Idempotent: повторный вызов не возвращает ошибку.
func TestRunMigrations_Idempotent(t *testing.T) {
	db := openTestDB(t)

	if _, err := db.Exec(schema); err != nil {
		t.Fatal("apply schema:", err)
	}

	if err := RunMigrations(db); err != nil {
		t.Fatal("first run:", err)
	}
	if err := RunMigrations(db); err != nil {
		t.Fatalf("second run (idempotency): %v", err)
	}
}

// TestRunMigrations_LegacyDB: старая БД без новых колонок получает их через миграции.
func TestRunMigrations_LegacyDB(t *testing.T) {
	db := openTestDB(t)

	// Создаём минимальные таблицы без новых колонок (как было до этапа 3–4)
	mustExec(t, db, `CREATE TABLE messages (
		id              TEXT PRIMARY KEY,
		conversation_id TEXT NOT NULL,
		sender_id       TEXT NOT NULL,
		ciphertext      BLOB NOT NULL,
		created_at      INTEGER NOT NULL
	)`)
	mustExec(t, db, `CREATE TABLE identity_keys (
		user_id       TEXT PRIMARY KEY,
		ik_public     BLOB NOT NULL,
		spk_public    BLOB NOT NULL,
		spk_signature BLOB NOT NULL,
		spk_id        INTEGER NOT NULL,
		updated_at    INTEGER NOT NULL
	)`)
	mustExec(t, db, `CREATE TABLE pre_keys (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id    TEXT NOT NULL,
		key_public BLOB NOT NULL,
		used       INTEGER NOT NULL DEFAULT 0
	)`)

	if err := RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations on legacy DB: %v", err)
	}

	// Колонки должны появиться — проверяем INSERT с ними
	_, err := db.Exec(`INSERT INTO messages
		(id, conversation_id, sender_id, ciphertext, created_at, client_msg_id, recipient_id, is_deleted)
		VALUES('1','c1','u1',x'00',1,'cmid','r1',0)`)
	if err != nil {
		t.Fatalf("new columns not added to messages: %v", err)
	}

	_, err = db.Exec(`INSERT INTO identity_keys
		(user_id, ik_public, spk_public, spk_signature, spk_id, updated_at, device_id)
		VALUES('u1',x'00',x'00',x'00',1,1,'dev1')`)
	if err != nil {
		t.Fatalf("device_id not added to identity_keys: %v", err)
	}
}

func mustExec(t *testing.T, db *sql.DB, q string) {
	t.Helper()
	if _, err := db.Exec(q); err != nil {
		t.Fatalf("mustExec: %v\nSQL: %s", err, q)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail (runner not wired yet)**

```sh
cd server && go test ./db/... -v -run TestRunMigrations
```

Expected: `PASS` for all three tests (runner exists, schema also exists in same package).

- [ ] **Step 3: Commit**

```sh
git add server/db/migrate_test.go
git commit -m "test(db): migration runner tests"
```

---

## Task 3: Wire runner into schema.go

**Files:**
- Modify: `server/db/schema.go`

- [ ] **Step 1: Remove ad-hoc migration loop and add RunMigrations call**

In `server/db/schema.go`, replace this block:

```go
	// Миграция для существующих БД — ошибки игнорируются (колонка уже есть)
	for _, m := range []string{
		`ALTER TABLE messages ADD COLUMN client_msg_id TEXT`,
		`ALTER TABLE messages ADD COLUMN recipient_id TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE messages ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE messages ADD COLUMN edited_at INTEGER`,
		// Этап 3: device model — device_id nullable для backward compat
		`ALTER TABLE identity_keys ADD COLUMN device_id TEXT`,
		`ALTER TABLE pre_keys ADD COLUMN device_id TEXT`,
	} {
		db.Exec(m) //nolint:errcheck
	}
```

With:

```go
	if err := RunMigrations(db); err != nil {
		return nil, fmt.Errorf("run migrations: %w", err)
	}
```

- [ ] **Step 2: Build to verify**

```sh
cd server && go build ./...
```

Expected: no output.

- [ ] **Step 3: Run all tests**

```sh
cd server && go test ./db/... -v
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```sh
git add server/db/schema.go
git commit -m "refactor(db): replace ad-hoc ALTER TABLE with versioned migration runner"
```

---

## Task 4: Update docker-compose.yml

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Replace `docker-compose.yml` content**

```yaml
version: '3.8'

services:
  messenger:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: messenger
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      PORT: "8080"
      DB_PATH: /data/messenger.db
      MEDIA_DIR: /data/media
      JWT_SECRET: ${JWT_SECRET:?JWT_SECRET is required}
      ALLOWED_ORIGIN: ${ALLOWED_ORIGIN:-}
      VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY:-}
      VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY:-}
      # Прямой TLS (оставьте пустым при использовании Cloudflare Tunnel)
      TLS_CERT: ${TLS_CERT:-}
      TLS_KEY: ${TLS_KEY:-}
      # WebRTC
      STUN_URL: ${STUN_URL:-stun:stun.l.google.com:19302}
      TURN_URL: ${TURN_URL:-}
      TURN_SECRET: ${TURN_SECRET:-}
      TURN_CREDENTIAL_TTL: ${TURN_CREDENTIAL_TTL:-86400}
    volumes:
      - messenger_data:/data
    networks:
      - messenger_net

  # Cloudflare Tunnel (опционально)
  # Запуск: docker compose --profile cloudflare up -d
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN:?TUNNEL_TOKEN is required for cloudflare profile}
    depends_on:
      - messenger
    networks:
      - messenger_net
    profiles:
      - cloudflare

networks:
  messenger_net:
    driver: bridge

volumes:
  messenger_data:
```

- [ ] **Step 2: Verify compose syntax**

```sh
docker compose config --quiet
```

Expected: no errors.

- [ ] **Step 3: Commit**

```sh
git add docker-compose.yml
git commit -m "feat(docker): add cloudflared service (profile) and full env vars"
```

---

## Task 5: Create .env.example

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Create `.env.example`**

```sh
cat > .env.example << 'EOF'
# ── Обязательные ────────────────────────────────────────────────────────────
# Секрет подписи JWT. Минимум 32 символа. Сгенерировать: openssl rand -hex 32
JWT_SECRET=

# ── База данных и хранилище ──────────────────────────────────────────────────
DB_PATH=/data/messenger.db
MEDIA_DIR=/data/media
PORT=8080

# ── Безопасность ────────────────────────────────────────────────────────────
# Разрешённый origin клиента (используется для CORS и WebSocket CheckOrigin)
# Пример: https://chat.example.com
ALLOWED_ORIGIN=

# ── Web Push (VAPID) ─────────────────────────────────────────────────────────
# Если оставить пустым — ключи генерируются автоматически при первом запуске.
# ВАЖНО: сохраните сгенерированные ключи из логов, иначе push-подписки сломаются
# после перезапуска контейнера.
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=

# ── Прямой TLS ───────────────────────────────────────────────────────────────
# Заполните только при использовании прямого TLS (без Cloudflare Tunnel).
# Пути к файлам сертификата внутри контейнера (монтируйте через volumes:).
TLS_CERT=
TLS_KEY=

# ── Cloudflare Tunnel ────────────────────────────────────────────────────────
# Токен туннеля из https://one.dash.cloudflare.com → Zero Trust → Networks → Tunnels
# Нужен только при запуске с: docker compose --profile cloudflare up -d
TUNNEL_TOKEN=

# ── WebRTC (STUN / TURN) ─────────────────────────────────────────────────────
STUN_URL=stun:stun.l.google.com:19302
# TURN сервер (опционально, для пользователей за симметричным NAT)
TURN_URL=
TURN_SECRET=
TURN_CREDENTIAL_TTL=86400
EOF
```

- [ ] **Step 2: Verify .env.example is not gitignored**

```sh
git check-ignore -v .env.example
```

Expected: no output (файл не игнорируется).

- [ ] **Step 3: Commit**

```sh
git add .env.example
git commit -m "docs: add .env.example with all server variables documented"
```

---

## Task 6: Write deployment guide

**Files:**
- Create: `docs/deployment.md`

- [ ] **Step 1: Create `docs/deployment.md`**

```markdown
# Deployment Guide

Self-hosted deployment guide for the messenger server.

## Prerequisites

- Docker and Docker Compose v2 (`docker compose version`)
- A domain name pointing to your server (or Cloudflare Tunnel token)
- Outbound internet access for STUN (WebRTC)

---

## Quick Start

```sh
git clone <repo-url> messenger
cd messenger
cp .env.example .env
# Edit .env — set JWT_SECRET (required)
docker compose up -d
```

The server listens on port 8080. First run auto-generates VAPID keys — save them:

```sh
docker logs messenger 2>&1 | grep VAPID
# Copy the two lines into .env, then restart:
docker compose restart messenger
```

---

## Option A: Cloudflare Tunnel (recommended)

No open inbound ports required. Cloudflare handles TLS termination.

### Setup

1. Go to [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com) → Networks → Tunnels → Create tunnel
2. Choose **Cloudflared** connector → copy the tunnel token
3. Add to `.env`:

```env
TUNNEL_TOKEN=<your-token>
ALLOWED_ORIGIN=https://your-domain.com
```

4. In the Cloudflare dashboard, add a Public Hostname route:
   - Subdomain: `chat` (or your choice)
   - Domain: `example.com`
   - Service: `http://messenger:8080`

5. Start with the cloudflare profile:

```sh
docker compose --profile cloudflare up -d
```

### Notes

- Leave `TLS_CERT` and `TLS_KEY` empty — Cloudflare handles TLS
- WebSocket (`/ws`) works automatically through the tunnel
- HSTS is not set by the app when running behind Cloudflare (Cloudflare sets it)

---

## Option B: Direct TLS

Use when you prefer not to route traffic through Cloudflare.

### Let's Encrypt with Certbot

```sh
# Obtain certificate (adjust domain and email)
certbot certonly --standalone -d chat.example.com --email admin@example.com --agree-tos

# Certificates are saved to /etc/letsencrypt/live/chat.example.com/
```

### docker-compose.yml — add volume mounts

Add to the `messenger` service in `docker-compose.yml`:

```yaml
volumes:
  - messenger_data:/data
  - /etc/letsencrypt/live/chat.example.com/fullchain.pem:/certs/fullchain.pem:ro
  - /etc/letsencrypt/live/chat.example.com/privkey.pem:/certs/privkey.pem:ro
```

### .env

```env
TLS_CERT=/certs/fullchain.pem
TLS_KEY=/certs/privkey.pem
ALLOWED_ORIGIN=https://chat.example.com
```

### Restart

```sh
docker compose up -d
```

---

## Backup

```sh
# Stop server to avoid partial writes
docker compose stop messenger

# Copy database from volume to host
docker cp messenger:/data/messenger.db ./backup-$(date +%Y%m%d-%H%M).db

# Copy media (optional, large)
docker cp messenger:/data/media ./backup-media-$(date +%Y%m%d)

# Restart
docker compose start messenger
```

---

## Restore

```sh
docker compose stop messenger
docker cp ./backup-20260101-1200.db messenger:/data/messenger.db
docker compose start messenger
```

---

## Update

Database migrations run automatically on startup. No manual steps needed.

```sh
git pull
docker compose build
docker compose up -d
```

To verify migrations applied:

```sh
docker exec messenger sqlite3 /data/messenger.db \
  "SELECT id, datetime(applied_at, 'unixepoch') FROM schema_migrations ORDER BY id;"
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `JWT_SECRET is required` on startup | Set `JWT_SECRET` in `.env` |
| Push notifications stop after restart | VAPID keys changed — save them from first-run logs to `.env` |
| WebSocket connects then immediately closes | Check `ALLOWED_ORIGIN` matches the browser URL exactly |
| Video calls fail for some users | Configure a TURN server (`TURN_URL`, `TURN_SECRET`) |
| `duplicate column name` in logs | Safe to ignore — migration runner handles this automatically |
```

- [ ] **Step 2: Commit**

```sh
git add docs/deployment.md
git commit -m "docs: add deployment guide (Cloudflare Tunnel, TLS, backup, update path)"
```

---

## Task 7: Update spec-gap-checklist.md

**Files:**
- Modify: `docs/spec-gap-checklist.md`

- [ ] **Step 1: Mark Stage 7 items as complete**

In `docs/spec-gap-checklist.md`, update:

```markdown
- [x] Перейти на versioned migrations и целевую схему БД
```

And in `docs/v1-gap-remediation.md`, mark Stage 7 as closed:

```markdown
## Этап 7. Migration framework и эксплуатация ✅ Закрыт
```

- [ ] **Step 2: Commit**

```sh
git add docs/spec-gap-checklist.md docs/v1-gap-remediation.md
git commit -m "docs: отметить этап 7 (migrations + deployment) как закрытый"
```

---

## Self-Review Checklist

- [x] **Migration runner** — `migrate.go` covers all 6 legacy ALTER TABLE operations
- [x] **Idempotency** — duplicate column name handled, fresh installs work
- [x] **Tests** — three cases: fresh DB, idempotent, legacy DB
- [x] **schema.go** — ad-hoc loop removed, `RunMigrations` wired
- [x] **docker-compose** — cloudflared via profile, all env vars documented
- [x] **.env.example** — all variables with comments
- [x] **docs/deployment.md** — Cloudflare Tunnel, direct TLS, backup, restore, update path
- [x] **Checklist** — spec-gap-checklist.md updated
