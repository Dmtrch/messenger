# Messenger

Self-hosted E2E encrypted messenger. PWA installs on iOS and Android.
Server runs on your machine — all data stays local.

## Requirements

| Tool | Version | Purpose |
|------|---------|---------|
| Go | 1.22+ | build server |
| Node.js | 20+ | build client |
| Docker + Docker Compose | any | containerized run (optional) |

---

## Quick start via Docker

```bash
cd /path/to/messenger

# Copy and configure environment
cp .env.example .env
# Edit .env: set JWT_SECRET (required)
# Optionally set VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY to persist push subscriptions

docker compose build && docker compose up -d
```

After startup:
- **App (PWA + API):** http://localhost:8080

---

## Run without Docker

### 1. Build and run the server

```bash
cd server
go mod tidy
go build -o ./bin/messenger ./cmd/server
JWT_SECRET=your-secret ./bin/messenger
```

Server starts on `http://localhost:8080`. SQLite database is created automatically.

#### Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_SECRET` | JWT signing secret (required) | — |
| `DB_PATH` | SQLite file path | `./messenger.db` |
| `MEDIA_DIR` | Directory for uploaded files | `./media` |
| `PORT` | Server port | `8080` |
| `VAPID_PRIVATE_KEY` | Web Push VAPID private key | auto-generated |
| `VAPID_PUBLIC_KEY` | Web Push VAPID public key | auto-generated |
| `TLS_CERT` / `TLS_KEY` | TLS certificate paths | empty (HTTP) |

> **Note:** VAPID keys are auto-generated on each start if not set. Set them in `.env` to persist push subscriptions across restarts.

### 2. Dev client (hot reload)

```bash
cd client
npm install
npm run dev   # → http://localhost:5173 (proxies API to :8080)
```

### 3. Build embedded PWA (single binary)

```bash
cd client && npm run build
cp -r dist ../server/cmd/server/static/
cd ../server && go build -o ./bin/messenger ./cmd/server
JWT_SECRET=your-secret ./bin/messenger   # serves PWA + API on :8080
```

---

## Features

- **E2E encryption** — Signal Protocol (X3DH + Double Ratchet, XSalsa20-Poly1305)
- **Direct and group chats** — multi-select participants when creating
- **File attachments** — photos and files up to 10 MB per message
- **Message actions** — copy, edit, delete via long-press (mobile) or right-click (desktop)
- **Push notifications** — Web Push VAPID for offline recipients
- **PWA** — installable on iOS 16.4+ and Android, works offline for history
- **Self-hosted** — your server, your data, no third parties

---

## PWA Installation

### iOS (Safari)
1. Open the app address in Safari
2. Tap the Share button (square with arrow)
3. Select "Add to Home Screen"
4. Tap "Add"

> Push notifications require iOS 16.4+.

### Android (Chrome)
1. Open the app address in Chrome
2. Tap menu (three dots) → "Add to Home screen"
3. Confirm installation

---

## Encryption architecture

- **X3DH** — session establishment (Identity Keys, Signed PreKeys, One-Time PreKeys)
- **Double Ratchet** — per-message encryption (XSalsa20-Poly1305 via libsodium)
- Private keys live only in **IndexedDB** on the user's device
- Server stores only ciphertext — it cannot decrypt messages
- Media metadata (file ID, name, type) is encrypted inside message ciphertext; file content is stored unencrypted (MVP)

---

## API overview

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | — | Register + upload X3DH keys |
| POST | `/api/auth/login` | — | Login, get JWT + refresh cookie |
| POST | `/api/auth/refresh` | cookie | Silent token refresh |
| GET | `/api/chats` | JWT | List user's chats |
| POST | `/api/chats` | JWT | Create direct or group chat |
| GET | `/api/chats/:id/messages` | JWT | Message history (recipient-filtered) |
| DELETE | `/api/messages/:clientMsgId` | JWT | Soft-delete all copies (sender only) |
| PATCH | `/api/messages/:clientMsgId` | JWT | Edit message (sender only, re-encrypted) |
| GET | `/api/keys/:userId` | JWT | Get X3DH PreKey Bundle |
| POST | `/api/keys/prekeys` | JWT | Upload one-time prekeys |
| POST | `/api/media/upload` | JWT | Upload file (max 10 MB) |
| GET | `/api/media/:filename` | — | Serve uploaded file |
| GET | `/api/push/vapid-public-key` | — | VAPID public key |
| POST | `/api/push/subscribe` | JWT | Register push subscription |
| GET | `/ws` | JWT (query) | WebSocket connection |

---

## Project structure

```
messenger/
├── server/
│   ├── cmd/server/main.go       # entry point, routes, env
│   ├── internal/
│   │   ├── auth/                # JWT auth middleware + handlers
│   │   ├── chat/                # chat CRUD, delete/edit handlers
│   │   ├── keys/                # X3DH key bundle handlers
│   │   ├── media/               # file upload + serve
│   │   ├── push/                # VAPID Web Push
│   │   └── ws/                  # WebSocket Hub
│   └── db/
│       ├── schema.go            # SQLite schema + auto-migration
│       └── queries.go           # typed SQL queries
└── client/
    └── src/
        ├── api/                 # REST + WebSocket clients
        ├── crypto/              # X3DH, Double Ratchet, keystore
        ├── components/
        │   └── ChatWindow/      # main chat UI, context menu, attachments
        ├── hooks/               # useMessengerWS, usePushNotifications
        ├── store/               # Zustand stores
        └── types/               # shared TypeScript types
```

---

## Development

```bash
# Backend hot-reload (requires air)
go install github.com/air-verse/air@latest
cd server && air

# Frontend hot-reload
cd client && npm run dev

# Type check + lint
cd client && npm run type-check && npm run lint

# Go build check
cd server && go build ./...
```

---

## Internet access (optional)

Use Cloudflare Tunnel for public HTTPS without a static IP or port forwarding:

```bash
brew install cloudflare/cloudflare/cloudflared  # macOS
cloudflared tunnel login
cloudflared tunnel create messenger
cloudflared tunnel run --url http://localhost:8080 <TUNNEL_ID>
```

---

## Local HTTPS (TLS)

Required for push notifications on some platforms. Use [mkcert](https://github.com/FiloSottile/mkcert) for a local certificate:

```bash
brew install mkcert && mkcert -install
mkcert localhost 127.0.0.1
TLS_CERT=localhost+1.pem TLS_KEY=localhost+1-key.pem JWT_SECRET=secret ./bin/messenger
```
