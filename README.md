# Messenger

Self-hosted messenger with E2E encryption, installable PWA client, Go backend, and a shared foundation for future native apps.

The repository currently contains:

- `server/` — Go API + WebSocket server with SQLite, media storage, push notifications, admin flows, and ICE configuration for calls
- `client/` — React/Vite PWA with Signal-style crypto, offline queues, push notifications, server setup flow, admin UI, and browser WebRTC call handling
- `shared/` — protocol contracts, domain docs, test vectors, and `shared/native-core` for future desktop/mobile clients
- `apps/` — native app foundation directories for desktop and mobile tracks

## Tech Stack

| Layer | Stack |
|------|-------|
| Backend | Go 1.22, Chi, Gorilla WebSocket, SQLite (`modernc.org/sqlite`), JWT |
| Web client | React 18, Vite 5, TypeScript, Zustand, libsodium, Vite PWA |
| Push | Web Push VAPID |
| Calls | Browser WebRTC + server ICE config endpoint |
| Shared contracts | TypeScript package + JSON schemas + test vectors |

## Repository Layout

```text
messenger/
├── client/                 # PWA клиент
├── server/                 # Go сервер
├── shared/                 # общие контракты, схемы и test vectors
├── apps/                   # foundation для desktop/mobile native клиентов
├── docs/                   # архитектура, спецификации, планы
├── docker-compose.yml      # контейнерный запуск сервера
└── .env.example            # пример переменных окружения
```

More specifically:

- `server/cmd/server/` — entrypoint, config loading, route registration, call ICE helpers
- `server/internal/auth` — login, refresh, logout, password change, registration request flow
- `server/internal/admin` — approval of registration requests, invite codes, user management, password reset requests
- `server/internal/chat` — chats, messages, read markers, edit/delete
- `server/internal/keys` — device key registration and prekey bundle delivery
- `server/internal/push` — VAPID public key and push subscription handling
- `server/internal/ws` — realtime transport and call signaling
- `client/src/pages` — auth, server setup, chats, profile, admin pages
- `client/src/crypto` — X3DH, ratchet, sender key, keystore
- `client/src/store` — auth/chat/call/ws/offline persistence
- `shared/native-core` — shared runtime API boundary for future native clients

## Current Product Scope

What is already reflected in code:

- self-hosted Go server serving API, WebSocket, and embedded static client assets
- PWA client with installable shell and server selection screen
- JWT auth with refresh flow and `httpOnly` cookie refresh endpoint
- registration modes from server config: `open`, `invite`, `request`
- admin panel for approving registrations, creating invite codes, resetting passwords, and resolving password reset requests
- direct and group chats, message history, edit/delete, read markers
- device key registration and prekey upload for E2E bootstrap
- browser push notifications using VAPID
- browser call flow using WebRTC helpers and `/api/calls/ice-servers`
- shared protocol/contracts and test vectors prepared for native tracks

Important limitation: media files are uploaded and served by the backend, but the current README should not imply that media binaries are already end-to-end encrypted at rest unless you verify and implement that behavior explicitly.

## Configuration

Server config is loaded in this priority order:

`environment variables` > `server/cmd/server/config.yaml` (if present as `config.yaml` near the binary working dir) > built-in defaults

### Main environment variables

| Variable | Purpose | Default |
|---------|---------|---------|
| `JWT_SECRET` | JWT signing secret, required | none |
| `PORT` | HTTP/TLS listen port | `8080` |
| `DB_PATH` | SQLite database path | `./messenger.db` |
| `MEDIA_DIR` | uploaded media directory | `./media` |
| `ALLOWED_ORIGIN` | CORS and WebSocket origin check | empty |
| `TLS_CERT` / `TLS_KEY` | direct TLS certificate paths | empty |
| `BEHIND_PROXY` | trust reverse proxy deployment mode | `false` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | push keys | auto-generated if empty |
| `STUN_URL` | default STUN server | `stun:stun.l.google.com:19302` |
| `TURN_URL` | optional TURN server URL | empty |
| `TURN_SECRET` | shared secret for TURN credentials | empty |
| `TURN_CREDENTIAL_TTL` | TTL for TURN credentials | `86400` |
| `SERVER_NAME` | public server name for setup screen | `Messenger` |
| `SERVER_DESCRIPTION` | public server description | empty |
| `REGISTRATION_MODE` | `open`, `invite`, or `request` | `open` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | bootstrap admin on first run | empty |

For Docker-based setup, start from the root `.env.example`.

## Quick Start

### Option 1: Local development

1. Start the backend:

```bash
cd server
go run ./cmd/server
```

2. In a second terminal start the PWA:

```bash
cd client
npm install
npm run dev
```

3. Open `http://localhost:5173`.
   The client will use `window.location.origin` by default, but it also has a dedicated `/setup` flow where you can point it to another Messenger server via `/api/server/info`.

### Option 2: Docker

```bash
cp .env.example .env
# заполните JWT_SECRET и при необходимости остальные параметры

docker compose up --build
```

Default exposed address:

- `http://localhost:8080`

Optional Cloudflare Tunnel profile:

```bash
docker compose --profile cloudflare up -d
```

## Build and Validation

### Client

```bash
cd client
npm install
npm run dev
npm run build
npm run lint
npm run type-check
npm run test
```

### Server

```bash
cd server
go test ./...
go build ./...
```

### Embedded static build

If you want the Go server to serve the built PWA from `server/cmd/server/static`:

```bash
cd client
npm run build
rm -rf ../server/cmd/server/static/*
cp -R dist/. ../server/cmd/server/static/

cd ../server
go build -o ./bin/messenger ./cmd/server
JWT_SECRET=change-me ./bin/messenger
```

## API Surface

The main routes currently registered in `server/cmd/server/main.go` include:

### Public

- `GET /api/server/info`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `POST /api/auth/request-register`
- `POST /api/auth/password-reset-request`
- `GET /api/push/vapid-public-key`
- `GET /ws`

### Authenticated

- `POST /api/auth/change-password`
- `GET /api/users/search`
- `GET /api/chats`
- `POST /api/chats`
- `GET /api/chats/{chatId}/messages`
- `POST /api/chats/{chatId}/read`
- `DELETE /api/messages/{clientMsgId}`
- `PATCH /api/messages/{clientMsgId}`
- `GET /api/keys/{userId}`
- `POST /api/keys/prekeys`
- `POST /api/keys/register`
- `POST /api/push/subscribe`
- `POST /api/media/upload`
- `GET /api/media/{id}`
- `GET /api/calls/ice-servers`

### Admin-only

- `GET /api/admin/registration-requests`
- `POST /api/admin/registration-requests/{id}/approve`
- `POST /api/admin/registration-requests/{id}/reject`
- `POST /api/admin/invite-codes`
- `GET /api/admin/invite-codes`
- `GET /api/admin/users`
- `POST /api/admin/users/{id}/reset-password`
- `GET /api/admin/password-reset-requests`
- `POST /api/admin/password-reset-requests/{id}/resolve`

## Frontend Routes

The current React app exposes these main screens:

- `/setup` — server connection and server info discovery
- `/auth` — login/register flow
- `/` — chat list
- `/chat/:chatId` — chat window
- `/profile` — profile/settings
- `/admin` — admin panel, only for users with `role === 'admin'`

## Native App Foundation

`apps/` is not a full product yet. It defines the direction for future native clients:

- `apps/desktop` — Kotlin Multiplatform + Compose Multiplatform Desktop
- `apps/mobile` — Android on Kotlin + Compose, iOS on SwiftUI
- `shared/native-core` — platform-neutral runtime boundary that both native tracks can reuse

## Documentation

- [docs/architecture.md](docs/architecture.md) — architecture overview and system decisions
- `docs/superpowers/specs/` — feature/spec documents
- `shared/protocol/` — REST/WS contracts and schemas
- `shared/test-vectors/` — crypto and protocol vectors

## Notes

- Push subscriptions will break after restart if you rely on auto-generated VAPID keys and do not persist them.
- If you deploy behind a reverse proxy or Cloudflare Tunnel, set `BEHIND_PROXY=true`.
- The semantic repository shape already assumes the web client is the current production UI and native apps are an in-progress foundation, not a finished deliverable.
