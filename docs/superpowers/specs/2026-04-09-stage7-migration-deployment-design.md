# Stage 7 Design: Migration Framework & Deployment

**Date:** 2026-04-09  
**Status:** ✅ Implemented  
**Scope:** Versioned database migrations + deployment guide (Cloudflare Tunnel, TLS, backup/restore, update path)

---

## 1. Problem Statement

Current state has two issues:

1. **Ad-hoc migrations** — `schema.go` runs a list of `ALTER TABLE` statements on every startup, ignoring all errors with `//nolint:errcheck`. No journal of what was applied, no way to add future migrations safely.
2. **No deployment guide** — no documented process for TLS setup, Cloudflare Tunnel, backup/restore, or updating the server without data loss.

---

## 2. Migration Framework

### 2.1 Approach: Built-in mini-runner (no external dependencies)

A `schema_migrations` table tracks applied migrations by integer ID. On startup, the runner applies only pending migrations in order.

### 2.2 New file: `server/db/migrate.go`

```go
type Migration struct {
    ID  int
    SQL string
}

var migrations = []Migration{
    {1, `ALTER TABLE messages ADD COLUMN client_msg_id TEXT`},
    {2, `ALTER TABLE messages ADD COLUMN recipient_id TEXT NOT NULL DEFAULT ''`},
    {3, `ALTER TABLE messages ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0`},
    {4, `ALTER TABLE messages ADD COLUMN edited_at INTEGER`},
    {5, `ALTER TABLE identity_keys ADD COLUMN device_id TEXT`},
    {6, `ALTER TABLE pre_keys ADD COLUMN device_id TEXT`},
}
```

### 2.3 Runner logic

```
RunMigrations(db *sql.DB) error:
  1. CREATE TABLE IF NOT EXISTS schema_migrations (
         id INTEGER PRIMARY KEY,
         applied_at INTEGER NOT NULL
     )
  2. SELECT id FROM schema_migrations → applied set
  3. For each migration not in applied set:
       a. BEGIN TRANSACTION
       b. db.Exec(migration.SQL)
       c. If error contains "duplicate column name" → treat as already applied (idempotent)
       d. If other error → ROLLBACK, return fmt.Errorf("migration %d: %w", id, err)
       e. INSERT INTO schema_migrations(id, applied_at) VALUES(?, unixtime)
       f. COMMIT
  4. Return nil
```

**Idempotency rationale:** Fresh installs get full schema via `CREATE TABLE IF NOT EXISTS` (columns already present). ALTER TABLE would return "duplicate column name" — this is treated as success. Existing installs missing the columns get them applied. Either way the result is correct.

### 2.4 Changes to `schema.go`

- Remove the ad-hoc migration loop (`for _, m := range []string{...}`)
- After `db.Exec(schema)`, call `RunMigrations(db)` — fatal on error
- The `schema` const stays unchanged (defines baseline for new installs)

### 2.5 Adding future migrations

To add a new migration: append one entry to the `migrations` slice in `migrate.go` with the next sequential ID. No other changes needed.

---

## 3. Docker & Environment

### 3.1 `docker-compose.yml` changes

- Add `cloudflared` service consuming `TUNNEL_TOKEN` from `.env`
- Add `ALLOWED_ORIGIN`, `TLS_CERT`, `TLS_KEY` env vars (TLS commented out by default)
- Add `messenger_net` bridge network shared between `messenger` and `cloudflared`
- `cloudflared` depends on `messenger`

### 3.2 `.env.example`

Document all server env vars with comments:

```
# Required
JWT_SECRET=                          # min 32 chars, keep secret

# Database & storage
DB_PATH=/data/messenger.db
MEDIA_DIR=/data/media
PORT=8080

# Security
ALLOWED_ORIGIN=https://your-domain.com

# Web Push (auto-generated if empty, but save these after first run)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=

# TLS (direct — leave empty if using Cloudflare Tunnel)
TLS_CERT=
TLS_KEY=

# Cloudflare Tunnel (leave empty if using direct TLS)
TUNNEL_TOKEN=

# WebRTC
STUN_URL=stun:stun.l.google.com:19302
TURN_URL=
TURN_SECRET=
TURN_CREDENTIAL_TTL=86400
```

---

## 4. Deployment Guide (`docs/deployment.md`)

### Sections

1. **Prerequisites** — Docker, docker compose, domain name
2. **Quick start** — clone → copy `.env.example` → set `JWT_SECRET` → `docker compose up -d`
3. **Cloudflare Tunnel setup** (recommended)
   - Create tunnel in Cloudflare dashboard → get token
   - Set `TUNNEL_TOKEN` in `.env`
   - Set `ALLOWED_ORIGIN=https://your-domain.com`
   - DNS: CNAME your domain → tunnel UUID.cfargotunnel.com
4. **Direct TLS** (alternative — no Cloudflare)
   - Obtain cert (Let's Encrypt / own CA)
   - Mount cert files into container via `volumes:`
   - Set `TLS_CERT=/certs/fullchain.pem`, `TLS_KEY=/certs/privkey.pem`
5. **VAPID keys** — save auto-generated keys from first-run logs to `.env`
6. **Backup**
   ```sh
   docker compose stop
   cp /path/to/volume/messenger.db messenger.db.backup
   docker compose start
   # or with docker cp:
   docker cp messenger:/data/messenger.db ./backup-$(date +%Y%m%d).db
   ```
7. **Restore**
   ```sh
   docker compose stop
   docker cp ./backup.db messenger:/data/messenger.db
   docker compose start
   ```
8. **Update path**
   ```sh
   git pull
   docker compose build
   docker compose up -d
   # Migrations run automatically on startup
   ```
9. **Troubleshooting** — common issues (JWT_SECRET missing, VAPID not set, origin mismatch)

---

## 5. Files Changed / Created

| File | Action |
|------|--------|
| `server/db/migrate.go` | Create — migration runner + migration list |
| `server/db/schema.go` | Modify — remove ad-hoc loop, add RunMigrations call |
| `docker-compose.yml` | Modify — cloudflared service, env vars |
| `.env.example` | Create — documented env vars |
| `docs/deployment.md` | Create — full deployment guide |

---

## 6. Non-Goals

- External migration tools (goose, golang-migrate) — not needed for this scale
- Rollback support — SQLite ALTER TABLE is irreversible; backups are the rollback strategy
- Migration CLI — startup runner is sufficient for self-hosted single-node
