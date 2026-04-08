# Repository Guidelines

## Project Structure & Module Organization
This repository contains a self-hosted messenger with a Go backend and React PWA frontends. `client/` is a Vite React PWA named `messenger-client`; `frontend/` is a second Vite React PWA named `messenger-pwa`. Both keep source in `src/` with domain folders such as `api/` or `services/`, `crypto/`, `hooks/`, `pages/`, `store/`, `styles/`, and `types/`. Prefer adding new frontend code to the app that is already being changed rather than duplicating work across both apps without a reason.

`server/` is a Go 1.22 module (`github.com/messenger/server`). Current backend code is organized around `server/db/` for schema/query logic and `server/internal/` for feature packages, including `auth` and `ws`. The product specification in `docs/superpowers/specs/messenger-spec.md` describes a target layout with `api/`, `ws/`, `crypto/`, and `storage/`; treat that file as the source of truth for behavior, but verify the actual repository layout before moving packages.

Documentation lives in `docs/`. Use `docs/architecture.md` for existing architectural notes and `docs/superpowers/specs/messenger-spec.md` for the detailed product contract.

## Build, Test, and Development Commands
Run frontend commands from the app directory you are changing:

```sh
cd client
npm install
npm run dev
npm run build
npm run lint
npm run type-check
```

Use the same commands in `frontend/`. `npm run dev` starts Vite, `npm run build` runs TypeScript and creates the production bundle, `npm run lint` runs ESLint on `src`, and `npm run type-check` runs `tsc --noEmit`.

For backend work:

```sh
cd server
go test ./...
go test ./... -run TestName
gofmt -w path/to/file.go
```

`docker-compose.yml` defines intended `server` and `client` services, with ports `8080` and `5173`. Dockerfiles were not present in this checkout during guide creation; add or verify them before running `docker compose up --build`.

## Coding Style & Naming Conventions
Use TypeScript and React functional components in the PWA apps. Keep component files in PascalCase (`ChatWindowPage.tsx`), hooks in camelCase prefixed with `use`, stores as `*Store.ts`, and CSS Modules as `*.module.css`. Keep shared TypeScript shapes in `src/types/` and avoid `any` for API payloads, crypto state, and WebSocket messages.

Go code must be formatted with `gofmt`. Use short, lowercase package names. Keep implementation details under `internal/<feature>` unless they must be imported by other modules. Prefer explicit error handling and small request/response structs for API handlers.

When adding comments in source code, use Russian comments as required by the local agent instructions. Keep comments brief and explain non-obvious decisions, especially around cryptography and persistence.

## Spec-Driven Requirements
Before changing behavior, check `docs/superpowers/specs/messenger-spec.md`. Must-have requirements include:

- Authentication with username/password, JWT access tokens with 15-minute TTL, refresh tokens with 7-day TTL, and refresh tokens stored in httpOnly cookies.
- Multi-device registration, with each device publishing identity keys, signed prekeys, and one-time prekeys.
- End-to-end encryption based on X3DH session setup and Double Ratchet message encryption. The server must not be able to decrypt message content.
- Sender Keys for group chats, with groups up to 50 members for MVP.
- Offline message buffering, delivery/read statuses, typing indicators where implemented, and cursor-based message pagination.
- Encrypted media at rest on the server. Images up to 10 MB are MVP; larger videos/files are lower priority.
- Web Push VAPID notifications with no plaintext message content in the notification payload.
- PWA installation on iOS/Android, offline history viewing, and service worker caching for the UI shell.

Expected API surfaces include `/api/auth/register`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `/api/keys/register`, `/api/keys/:userId`, `/api/keys/prekeys`, `/api/chats`, `/api/chats/:id/messages`, `/api/media/upload`, `/api/media/:id`, `/api/push/subscribe`, and `WSS /ws?token=<JWT>`.

## Testing Guidelines
No test files or frontend test framework were present when this guide was written. Add frontend tests beside the code as `*.test.ts` or `*.test.tsx` when a runner is introduced. Add Go tests as `*_test.go` files next to the package under test.

At minimum, run `npm run type-check` and `npm run lint` for the affected frontend app, and `go test ./...` for backend changes. For crypto or auth work, include tests for malformed inputs, replay/duplicate key handling, expired tokens, and empty or missing payloads. For WebSocket work, test reconnect and offline delivery behavior where practical.

## Commit & Pull Request Guidelines
Git history is not available from this checkout, so no repository-specific convention can be inferred. Use concise imperative commits such as `Add chat store persistence` or Conventional Commit style like `fix(client): handle websocket reconnect`. Keep commits scoped to one logical change.

Pull requests should include a short summary, linked issue or spec section when relevant, validation commands run, and screenshots or recordings for visible UI changes. If a change intentionally diverges from `messenger-spec.md`, call out the reason and the follow-up needed.

## Security & Configuration Tips
Use `.env.example` files in `client/` and `frontend/` as templates. Do not commit secrets, private keys, generated VAPID private keys, TLS keys, local databases, or media files. For server deployments, set `JWT_SECRET`, `DB_PATH`, `MEDIA_DIR`, and TLS settings explicitly instead of relying on development defaults.

Preserve the E2E security boundary: plaintext message content and private key material must remain client-side. Server logs should never include decrypted content, passwords, refresh tokens, access tokens, or push subscription secrets.

## Agent-Specific Instructions
When answering contributors in this repository, use Russian for prose unless writing code or project documentation in English. For code comments, use Russian. Use semantic code search before broad `rg` searches when investigating where logic is implemented. If the same error repeats more than three times during debugging, stop and present three concrete remediation options before continuing.
