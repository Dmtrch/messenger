# Messenger — Production Deployment Guide

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Go | 1.22+ | Build server binary |
| Node.js | 20+ | Build web client assets |
| Docker + Compose | 24+ | Optional containerised deployment |

---

## Quick Deploy (Docker)

The fastest path to production. Copy `.env.example` to `.env`, fill in the required values, then run:

```bash
cp .env.example .env
# Edit .env — at minimum set JWT_SECRET and ALLOWED_ORIGIN
docker compose up -d
```

**Minimal `docker-compose.yml`** (place at repo root):

```yaml
services:
  messenger:
    image: messenger:latest          # build locally or push to a registry
    build: .
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ./data:/data                 # DB + media persistence
    env_file:
      - .env
    environment:
      DB_PATH: /data/messenger.db
      MEDIA_DIR: /data/media
      DOWNLOADS_DIR: /data/downloads

  # Optional: Cloudflare Tunnel (zero-config TLS)
  cloudflared:
    image: cloudflare/cloudflared:latest
    profiles: ["cloudflare"]
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN}
    restart: unless-stopped
```

Generate a JWT secret before first run:

```bash
openssl rand -hex 32
# paste result into JWT_SECRET in .env
```

---

## Manual Deploy

### 1. Build the web client

```bash
cd client
npm install
npm run build          # outputs to client/dist/
```

### 2. Embed assets into server binary

The server embeds the client via Go's `//go:embed static`. Copy the built assets first:

```bash
cp -r client/dist/* server/cmd/server/static/
```

### 3. Build server binary

```bash
cd server
go build -o messenger-server ./cmd/server
```

### 4. Run

```bash
export JWT_SECRET=$(openssl rand -hex 32)
export ALLOWED_ORIGIN=https://chat.example.com
./messenger-server
```

The server listens on `PORT` (default `8080`). Database and media directories are created automatically on first run.

---

## Environment Variables

Priority order: **env vars > config.yaml > built-in defaults**

The server also reads an optional `config.yaml` (same field names, snake_case). Environment variables always win.

### Core

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `JWT_SECRET` | — | **Yes** | JWT signing secret. Minimum 32 characters. Use `openssl rand -hex 32` |
| `PORT` | `8080` | No | HTTP/HTTPS listen port |
| `ALLOWED_ORIGIN` | — | **Yes (prod)** | Client origin for CORS and WebSocket `CheckOrigin` (e.g. `https://chat.example.com`) |
| `BEHIND_PROXY` | `false` | Conditional | Set `true` when behind Nginx, Cloudflare Tunnel, or any reverse proxy |

### Storage

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DB_PATH` | `./messenger.db` | No | SQLite database file path |
| `MEDIA_DIR` | `./media` | No | Directory for uploaded files |
| `DOWNLOADS_DIR` | `./downloads` | No | Directory for prepared downloads |

### TLS

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `TLS_CERT` | — | No | Path to TLS certificate file (PEM) |
| `TLS_KEY` | — | No | Path to TLS private key file (PEM) |

### Web Push (VAPID)

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `VAPID_PUBLIC_KEY` | auto-generated | **Persist in prod** | VAPID public key for Web Push |
| `VAPID_PRIVATE_KEY` | auto-generated | **Persist in prod** | VAPID private key for Web Push |

### WebRTC

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `STUN_URL` | `stun:stun.l.google.com:19302` | No | STUN server for WebRTC ICE |
| `TURN_URL` | — | No | TURN server URI (needed for symmetric NAT users) |
| `TURN_SECRET` | — | Conditional | TURN shared secret (HMAC credential generation) |
| `TURN_CREDENTIAL_TTL` | `86400` | No | TURN credential validity in seconds |

### Server Identity

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `SERVER_NAME` | `Messenger` | No | Display name shown in the client |
| `SERVER_DESCRIPTION` | — | No | Optional server description |

### Registration

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `REGISTRATION_MODE` | `open` | No | `open` / `invite` / `approval` |
| `ADMIN_USERNAME` | — | No | Bootstrap admin username (created on first run if DB is empty) |
| `ADMIN_PASSWORD` | — | No | Bootstrap admin password |

### Groups & Uploads

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `MAX_GROUP_MEMBERS` | `50` | No | Maximum members per group |
| `ALLOW_USERS_CREATE_GROUPS` | `true` | No | Whether regular users can create groups |
| `MAX_UPLOAD_BYTES` | `104857600` (100 MB) | No | Maximum file upload size in bytes |

### App Version

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `APP_VERSION` | `dev` | No | Current server/app version string |
| `MIN_CLIENT_VERSION` | `0.0.0` | No | Minimum client version required to connect |
| `APP_CHANGELOG` | — | No | Changelog text surfaced to clients |

### Native Push Notifications

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `FCM_LEGACY_KEY` | — | No | Firebase Server Key for FCM push (Android) |
| `APNS_KEY_PATH` | — | No | Path to APNs `.p8` key file (iOS) |
| `APNS_KEY_ID` | — | No | APNs Key ID |
| `APNS_TEAM_ID` | — | No | Apple Developer Team ID |
| `APNS_BUNDLE_ID` | — | No | iOS app Bundle ID |
| `APNS_SANDBOX` | `false` | No | `true` to use APNs sandbox endpoint |

---

## TLS Configuration

### Option A — Direct TLS (self-managed certificates)

```bash
TLS_CERT=/etc/certs/fullchain.pem
TLS_KEY=/etc/certs/privkey.pem
```

The server listens on `PORT` with TLS. Use [Certbot](https://certbot.eff.org/) or [acme.sh](https://acme.sh) to obtain Let's Encrypt certificates. Set `BEHIND_PROXY=false`.

### Option B — Reverse proxy (Nginx)

Let Nginx handle TLS termination, proxy to the backend over plain HTTP:

```nginx
server {
    listen 443 ssl http2;
    server_name chat.example.com;

    ssl_certificate     /etc/letsencrypt/live/chat.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    location / {
        proxy_pass         http://localhost:8080;
        proxy_http_version 1.1;

        # WebSocket support
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Real IP forwarding
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 3600s;   # keep WebSocket connections alive
    }
}
```

Set `BEHIND_PROXY=true` in your environment so the server trusts forwarded headers and sends HSTS without local TLS certificates.

### Option C — Caddy (automatic TLS)

```caddyfile
chat.example.com {
    reverse_proxy localhost:8080 {
        header_up Upgrade {>Upgrade}
        header_up Connection {>Connection}
    }
}
```

Set `BEHIND_PROXY=true`.

### Option D — Cloudflare Tunnel (zero-config TLS)

```bash
docker compose --profile cloudflare up -d
```

Set `BEHIND_PROXY=true` and `TUNNEL_TOKEN` from the Cloudflare Zero Trust dashboard. No local certificates required.

---

## Database

### Location

SQLite database is stored at `DB_PATH` (default `./messenger.db`). In Docker deployments mount a persistent volume:

```yaml
volumes:
  - ./data:/data
```

### Migrations

Migrations run **automatically on every server start**. No manual migration step is needed. The migration logic lives in `server/db/migrate.go`.

### Backup Strategy

SQLite's `VACUUM INTO` is the safest online backup method — it produces a consistent snapshot without stopping the server:

```bash
# Recommended: daily cron job
sqlite3 /data/messenger.db "VACUUM INTO '/backups/messenger-$(date +%Y%m%d).db'"
```

Alternative using the SQLite CLI online backup:

```bash
sqlite3 /data/messenger.db ".backup /backups/messenger-$(date +%Y%m%d).db"
```

Keep at least 7 daily backups. Test restoration periodically:

```bash
sqlite3 /backups/messenger-20260101.db "PRAGMA integrity_check;"
```

---

## VAPID Keys (Web Push)

VAPID keys authenticate your server with browser push services (FCM, Mozilla Push, etc.).

### Generating keys

```bash
# Option 1: built into the server — check logs on first run
./messenger-server
# Look for lines like:
# VAPID keys generated (add to env or config.yaml to persist):
#   VAPID_PRIVATE_KEY=...
#   VAPID_PUBLIC_KEY=...

# Option 2: via web-push CLI
npx web-push generate-vapid-keys
```

### Why you must persist them

If VAPID keys change between restarts, **all existing push subscriptions become invalid**. Users stop receiving notifications until they reopen the app and re-subscribe. Always set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` explicitly before deploying to production. Never rely on auto-generated ephemeral keys.

Store the generated values in your `.env` file, `config.yaml`, or a secrets manager (Vault, AWS Secrets Manager, etc.).

---

## Security Hardening Checklist

- [ ] **`JWT_SECRET`** — minimum 32 characters, randomly generated (`openssl rand -hex 32`). Never reuse across environments.
- [ ] **`ALLOWED_ORIGIN`** — always set in production to your exact client origin (e.g. `https://chat.example.com`). Leaving it empty disables origin checks.
- [ ] **TLS** — use TLS 1.2+ (TLS 1.3 preferred). Direct TLS or proxy termination, never plain HTTP in production.
- [ ] **`BEHIND_PROXY`** — set `true` only if actually behind a trusted proxy. Setting it incorrectly allows IP spoofing via `X-Forwarded-For`.
- [ ] **`REGISTRATION_MODE`** — use `invite` or `approval` for private deployments. `open` allows anyone to register.
- [ ] **`ADMIN_USERNAME` / `ADMIN_PASSWORD`** — set a strong password. After first run, update the admin password via the admin panel and remove these env vars from the environment if possible.
- [ ] **Rate limiting** — built into the server (Chi middleware). No additional config required.
- [ ] **`MAX_UPLOAD_BYTES`** — consider reducing from 100 MB if storage is constrained.
- [ ] **VAPID keys** — persist explicitly (see section above).
- [ ] **Firewall** — expose only `PORT` (8080 or 443). Restrict direct SQLite file access.
- [ ] **`DB_PATH` and `MEDIA_DIR`** — store on a volume separate from the application binary for easier backup and recovery.

---

## Monitoring

### Real-time event stream

The server exposes an SSE (Server-Sent Events) monitoring endpoint for admins:

```
GET /api/admin/monitoring/stream
Authorization: Bearer <admin-jwt>
```

Connect with `curl` to stream live events:

```bash
curl -N -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://chat.example.com/api/admin/monitoring/stream
```

### What to monitor

| Signal | How to check |
|--------|-------------|
| Server uptime / process | systemd / Docker health check |
| Disk usage (`DB_PATH`, `MEDIA_DIR`) | `df -h` / cron alert at 80% |
| SQLite integrity | Weekly `PRAGMA integrity_check` |
| Application logs | `logs/` directory (rotated automatically) |
| Push delivery failures | Server logs (`push` package) |
| WebRTC ICE failures | Browser console + TURN server logs |
| Memory / CPU | Docker stats or host metrics (Prometheus node exporter) |

### Health check endpoint

```
GET /api/server/info
```

Returns server name, version, registration mode, and VAPID public key. No authentication required. Use this for uptime monitoring (e.g. Uptime Kuma, Healthchecks.io).

---

## Backup & Recovery

### Full backup procedure

```bash
#!/bin/bash
BACKUP_DIR=/backups/$(date +%Y%m%d)
mkdir -p "$BACKUP_DIR"

# Database
sqlite3 /data/messenger.db "VACUUM INTO '$BACKUP_DIR/messenger.db'"

# Media files (incremental with rsync)
rsync -av --delete /data/media/ "$BACKUP_DIR/media/"
rsync -av --delete /data/downloads/ "$BACKUP_DIR/downloads/"

echo "Backup complete: $BACKUP_DIR"
```

Schedule via cron (daily at 03:00):

```cron
0 3 * * * /opt/messenger/backup.sh >> /var/log/messenger-backup.log 2>&1
```

### Rollback procedure

1. Stop the server: `docker compose down` or `systemctl stop messenger`
2. Restore the database:
   ```bash
   cp /backups/20260101/messenger.db /data/messenger.db
   ```
3. Restore media if needed:
   ```bash
   rsync -av /backups/20260101/media/ /data/media/
   ```
4. Start the server: `docker compose up -d` or `systemctl start messenger`
5. Verify with `GET /api/server/info` and check logs.

### Binary rollback

Keep the previous server binary alongside the new one:

```bash
cp messenger-server messenger-server.prev
# deploy new binary
# if issues:
mv messenger-server.prev messenger-server
systemctl restart messenger
```
