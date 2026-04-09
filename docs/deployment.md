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
