# Messenger

Self-hosted end-to-end encrypted chat with a PWA client, Go backend, and native app foundation for desktop and mobile.

![Go](https://img.shields.io/badge/Go-1.22-00ADD8?logo=go) ![React](https://img.shields.io/badge/React-18-61DAFB?logo=react) ![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript) ![SQLite](https://img.shields.io/badge/SQLite-embedded-003B57?logo=sqlite) ![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

- **E2E Encryption** — Signal-style X3DH key exchange + double ratchet; PWA passphrase vault (AES-256-GCM, PBKDF2 600k iterations)
- **Encrypted Media** — media blobs encrypted at rest, auto-revoke URLs after 60 seconds
- **Registration Modes** — open / invite-only (QR codes + TTL) / admin-approval; roles: admin / moderator / user
- **Strong Auth** — JWT + Argon2id passwords; lazy bcrypt → Argon2id migration; TLS 1.3 enforced
- **Account Safety** — Kill Switch, Suspend, Ban + Remote Wipe via WebSocket
- **Disappearing Messages** — per-chat TTL (5 min / 1 h / 1 d / 1 week) with real-time countdown
- **Multi-Device Pairing** — QR-code device pairing + per-device management
- **Group & Video Calls** — WebRTC SFU (pion), grid UI, voice activity detection
- **Voice Notes** — in-chat audio recording (audio/webm+opus) with waveform preview
- **Media Gallery** — built-in lightbox gallery per chat
- **Bot API** — webhooks, HMAC-SHA256 signatures, rate-limiting, token rotation
- **Biometrics / Screen Lock** — Android BiometricPrompt, iOS LAContext, Desktop PIN; screenshot block (FLAG_SECURE / blur overlay)
- **Admin Controls** — disk quotas, media retention policy, group member limits, `AllowUsersCreateGroups` flag
- **Monitoring** — CPU / RAM / disk dashboard (gopsutil + SSE + recharts)
- **Native Apps + Auto-Update** — desktop (DMG / DEB / MSI) and mobile (APK / IPA) with auto-update and CI builds

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Clients                             │
│  PWA (React/Vite)  │  Desktop (Compose)  │  Mobile     │
│                    │                     │ (Android /  │
│  libsodium crypto  │                     │   iOS)      │
└────────┬───────────┴──────────┬──────────┴──────┬───────┘
         │  REST + WebSocket    │  shared/         │
         │  (HTTPS / WSS)       │  native-core     │
┌────────▼──────────────────────▼──────────────────▼───────┐
│                    Go Backend (server/)                   │
│  Chi router · Gorilla WebSocket · JWT auth               │
│  X3DH key exchange · WebRTC SFU (pion)                   │
│  Web Push VAPID · Bot API · Admin API                    │
│  Media storage · Monitoring SSE                          │
│  SQLite (modernc.org/sqlite)                             │
└──────────────────────────────────────────────────────────┘
```

### Repository layout

```
messenger/
├── server/          # Go API + WebSocket server
│   ├── cmd/server/  # Entry point, config, route registration
│   └── internal/    # auth, chat, ws, media, admin, bot, push, calls…
├── client/          # React/Vite PWA
│   └── src/         # pages, components, crypto, store, hooks
├── shared/
│   ├── native-core/ # Platform-neutral TS runtime for native clients
│   ├── protocol/    # REST/WS API contracts & JSON schemas
│   ├── crypto-contracts/ # E2E encryption specs
│   └── test-vectors/    # Crypto validation data
├── apps/
│   ├── desktop/     # Kotlin Multiplatform + Compose Desktop
│   └── mobile/      # Android (Kotlin/Compose) + iOS (SwiftUI)
└── docs/            # Architecture, specs, plans
```

---

## Quick Start

### Option 1: Docker (recommended)

```bash
cp .env.example .env
# Set at minimum: JWT_SECRET=<your-secret>
docker compose up --build
```

Open `http://localhost:8080`.

Optional — Cloudflare Tunnel sidecar:

```bash
docker compose --profile cloudflare up -d
```

### Option 2: Local development

```bash
# Terminal 1 — backend
cd server
go run ./cmd/server

# Terminal 2 — web client
cd client
npm install
npm run dev
```

Open `http://localhost:5173`. Use the `/setup` screen to point the client at any running Messenger server.

### Embedded build (single binary)

```bash
cd client && npm run build
rm -rf ../server/cmd/server/static/*
cp -R dist/. ../server/cmd/server/static/

cd ../server
go build -o ./bin/messenger ./cmd/server
JWT_SECRET=change-me ./bin/messenger
```

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET` | **required** | JWT signing key |
| `PORT` | `8080` | HTTP/TLS listen port |
| `DB_PATH` | `./messenger.db` | SQLite database path |
| `MEDIA_DIR` | `./media` | Uploaded media directory |
| `ALLOWED_ORIGIN` | — | CORS and WebSocket origin check |
| `TLS_CERT` / `TLS_KEY` | — | Direct TLS certificate paths |
| `BEHIND_PROXY` | `false` | Trust reverse proxy headers |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | auto-generated | Web Push keys (persist for production) |
| `STUN_URL` | `stun:stun.l.google.com:19302` | STUN server |
| `TURN_URL` / `TURN_SECRET` | — | TURN server (optional) |
| `REGISTRATION_MODE` | `open` | `open` / `invite` / `request` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | — | Bootstrap admin on first run |
| `SERVER_NAME` | `Messenger` | Displayed on the setup screen |

Full list and descriptions in `.env.example`.

---

## Build & Validation

```bash
# Client
cd client
npm run lint        # ESLint (zero warnings)
npm run type-check  # TypeScript validation
npm run test        # Vitest unit tests
npm run build       # Production build

# Server
cd server
go test ./...
go build ./...
```

CI produces release artifacts for all platforms (DMG, DEB, MSI, APK, IPA) via `.github/workflows/build-native.yml`.

---

## Native Apps

`apps/` provides the foundation for native clients — not yet production-ready, but under active development:

- **Desktop** (`apps/desktop/`) — Kotlin Multiplatform + Compose Desktop; CI builds DMG / DEB / MSI
- **Android** (`apps/mobile/android/`) — Kotlin + Jetpack Compose; CI builds APK
- **iOS** (`apps/mobile/ios/`) — SwiftUI; CI builds IPA
- **Shared core** (`shared/native-core/`) — platform-neutral TypeScript runtime reused by all native tracks

The `/downloads` page auto-detects the visitor's OS and serves the appropriate installer.

---

## Documentation

- [`docs/`](docs/) — architecture overviews, feature specs, plans
- [`shared/protocol/`](shared/protocol/) — REST/WS API contracts and JSON schemas
- [`shared/crypto-contracts/`](shared/crypto-contracts/) — E2E encryption specification
- [`shared/test-vectors/`](shared/test-vectors/) — crypto and protocol test vectors

---

## Contributing

Pull requests are welcome. Please open an issue first for significant changes.

## License

MIT
