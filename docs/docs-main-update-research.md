# Research snapshot для `docs/main/*`

> Структурированный справочник по коду. Источник истины для переработки документов в `docs/main/`.
> Содержимое собрано автоматически из репозитория; при расхождении приоритет у кода.

## Шапка актуальности

- **baseline_sha**: `60d7c9326f00b915271386e386d2d68ca409c85a` (`60d7c93` — feat: фаза 1 — биометрика, vault, новые UI-компоненты, серверные модули)
- **Дата снимка**: 2026-04-21
- **Автор снимка**: автоматическая сессия (Claude Code)
- **Язык**: русский

### Watched paths (изменение инвалидирует снимок)

```
server/
client/src/
shared/native-core/
apps/
Dockerfile
docker-compose.yml
scripts/db-migrate.sh
server/Makefile
.github/workflows/build-native.yml
docs/api-reference.md
docs/crypto-rationale.md
docs/prd-alignment-progress.md
docs/prd-vs-impl.md
docs/security-audit.md
docs/test-plan.md
docs/release-checklist.md
```

### Процедура проверки актуальности

```sh
git diff --name-only 60d7c932..HEAD -- \
  server/ client/src/ shared/native-core/ apps/ \
  Dockerfile docker-compose.yml scripts/db-migrate.sh server/Makefile \
  .github/workflows/build-native.yml \
  docs/api-reference.md docs/crypto-rationale.md docs/prd-alignment-progress.md \
  docs/prd-vs-impl.md docs/security-audit.md docs/test-plan.md docs/release-checklist.md
```

Если вывод пустой — снимок актуален. Иначе обновить задетые секции и сдвинуть `baseline_sha`.

---

## 1. Серверные модули (`server/internal/*`)

Язык: Go 1.23. Маршрутизатор: `github.com/go-chi/chi/v5`. WebSocket: `github.com/gorilla/websocket`. WebRTC SFU: `github.com/pion/webrtc/v3`.

| Пакет | Назначение | Ключевые файлы |
|---|---|---|
| `admin` | Админ-панель: инвайты, заявки, пользователи, квоты, retention, broadcast, remote-wipe | `handler.go`, `middleware.go` (+ `handler_test.go`, `invite_test.go`) |
| `auth` | Регистрация/логин/логаут, JWT + refresh в httpOnly, смена пароля, device-link, account status middleware | `handler.go`, `middleware.go`, `lazy_rehash_test.go` |
| `bots` | Bots API: создание, webhook delivery (HMAC-SHA256, retry 1s/2s/4s) | `handler.go`, `middleware.go`, `webhook.go` |
| `calls` | 1:1 и групповые звонки: signalling + REST `/calls/room/*` + ICE servers | `handler.go` (+ `handler_test.go`) |
| `chat` | Чаты 1:1 и групповые, сообщения, TTL, read markers, edit/delete | `handler.go` |
| `clienterrors` | Приём логов ошибок с клиента (`POST /api/client-errors`) | `handler.go` |
| `devices` | Список устройств пользователя, отвязка | `handler.go` |
| `downloads` | Manifest версий native-приложений, отдача `.dmg/.deb/.msi/.apk`, `GET /api/version` | `handler.go` |
| `integration` | Интеграционные тесты (auth/chat/invite flows) — **нет продакшн-кода** | `*_flow_test.go` |
| `keys` | X3DH bundles, загрузка prekeys, регистрация устройства | `handler.go` |
| `logger` | Инициализация файлового логгера (lumberjack rotation) | `logger.go` |
| `media` | Загрузка, выдача, листинг чат-медиа; orphan и retention cleaners | `handler.go`, `cleaner.go` |
| `middleware` | SecurityHeaders, RequestLogger, Recoverer, RateLimiter, CORS (здесь же) | `security.go`, `logging.go`, `ratelimit_test.go` |
| `monitoring` | CPU/RAM/Disk (gopsutil), GET-snapshot и SSE-стрим для админа | `handler.go` |
| `password` | bcrypt + lazy rehash цена работы | `password.go`, `password_test.go` |
| `push` | Web Push (VAPID) + native push: FCM legacy + APNs JWT | `handler.go` |
| `serverinfo` | `GET /api/server/info`: имя, описание, режим регистрации, лимиты | `handler.go` |
| `sfu` | Группоые звонки: комнаты `Room`, участники, webrtc-PeerConnection forwarding | `manager.go` (+ `sfu_test.go`) |
| `storage` | **Пустой каталог** (без `.go` файлов на 60d7c93) — оставлен для будущего; в main.go не импортируется | — |
| `users` | Поиск пользователей | `handler.go` |
| `ws` | WebSocket Hub: клиенты, комнаты, fan-out, call signalling, presence | `hub.go` (+ `hub_test.go`, `hub_calls_test.go`) |

### Точка входа

- `server/cmd/server/main.go` — создаёт БД, Hub, handlers; устанавливает middleware (`RequestLogger`, `Recoverer`, `Timeout 30s`, `SecurityHeaders`, `CORS`); монтирует роуты под `/api`, `/ws`, отдаёт embedded static.
- `server/cmd/server/config.go` — `Config` struct, дефолты, YAML + env.
- `server/cmd/server/calls.go` — `iceServersHandler` (TURN credential с HMAC).
- `server/cmd/server/tls_test.go` — проверка TLS config (TLS 1.3 only).
- Сборка: `//go:embed static` → клиентские ассеты встраиваются в бинарник.

### Rate limiters (сконфигурированы в main.go)

- `authLimiter`: 20 req/min per IP.
- `botLimiter`: 60 req/min per IP.

### Registration modes

Валидатор `config.go` допускает **`open` | `invite` | `approval`**. (Внимание: в устаревших доках и `CLAUDE.md` встречается термин `request` — это исходное название до переименования, сейчас корректное значение — `approval`.)

---

## 2. Схема БД (`server/db/`)

Файлы: `schema.go` (const `schema` + `Open()`), `queries.go` (CRUD), `migrate.go` (`RunMigrations`), `migrate_test.go`.

Движок: SQLite (`modernc.org/sqlite`), WAL + foreign keys ON + busy_timeout 5s, `SetMaxOpenConns(1)`.

### Таблицы (по `schema.go` + миграции)

| Таблица | Назначение |
|---|---|
| `users` | id, username, display_name, password_hash, role (user/moderator/admin), status (active/suspended/banned), session_epoch, created_at |
| `sessions` | refresh-токены (token_hash, expires_at) с FK на users |
| `contacts` | (user_id, contact_id) пары |
| `conversations` | id, type (direct/group), name, created_at, default_ttl, max_members |
| `conversation_members` | (conversation_id, user_id) |
| `messages` | id, client_msg_id, conversation_id, sender_id, recipient_id, ciphertext BLOB, sender_key_id, is_deleted, edited_at, created_at, delivered_at, read_at, expires_at |
| `push_subscriptions` | Web Push endpoint + p256dh + auth |
| `devices` | id, user_id, device_name, created_at, last_seen_at |
| `chat_user_state` | last_read_msg_id, last_read_at |
| `media_objects` | id, uploader_id, conversation_id, filename, original_name, content_type, size, created_at |
| `invite_codes` | code, created_by, used_by, expires_at, revoked_at |
| `invite_activations` | журнал IP/UA/activated_at |
| `registration_requests` | status (pending/approved/rejected), reviewed_at/by |
| `password_reset_requests` | status (pending/completed/rejected), temp_password |
| `device_link_tokens` | QR-pairing token, TTL 120s |
| `user_quotas` | quota_bytes, used_bytes |
| `settings` | key-value (retention, max_group_members, и т. д.) |
| `bots` | id, name, owner_id, token_hash, webhook_url, active |
| `schema_migrations` | id, applied_at (версия схемы) |

Дополнительно (добавлено миграциями): `identity_keys` (Ed25519), `opk_publics` (one-time prekeys), колонки и индексы через `ALTER TABLE`. Точный список миграций — в `migrate.go` (массив `migrations`) и в `scripts/db-migrate.sh` (на текущий момент `TOTAL_MIGRATIONS=28`).

### Миграционный процесс

- `RunMigrations(db)` создаёт `schema_migrations`, применяет недоставленные миграции в транзакции, поддерживает `Steps` (multi-statement DDL).
- Идемпотентно обрабатывает ошибки `duplicate column name`, `no such table`, `already exists` — записывает миграцию как применённую.
- CLI-утилита `scripts/db-migrate.sh`: `--dry-run`, `--version`, `--rollback N`.

---

## 3. REST API (маршруты в `server/cmd/server/main.go`)

Базовый префикс `/api`.

### Публичные

- `GET /api/server/info` — имя/описание/режим регистрации/лимиты.
- `GET /api/version` — текущая и минимальная версии клиента.
- `POST /api/client-errors` — приём error-логов с клиента.
- `GET /api/push/vapid-public-key` — публичный VAPID-ключ.

### Auth (rate-limited, 20/min)

- `POST /api/auth/register` — открытая регистрация (mode=open) или по инвайту (mode=invite).
- `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/refresh`.
- `POST /api/auth/request-register` — заявка на регистрацию (mode=approval).
- `POST /api/auth/password-reset-request` — обращение к админу.
- `POST /api/auth/device-link-activate` — активация QR-токена при привязке нового устройства.

### Authenticated (JWT + AccountStatusMiddleware)

- `POST /api/auth/change-password`, `POST /api/auth/device-link-request`.
- `GET/DELETE /api/devices`, `GET/DELETE /api/devices/{deviceId}`.
- `GET /api/users/search`.
- `GET/POST /api/chats`, `GET /api/chats/{id}/messages`, `POST /api/chats/{id}/ttl`, `POST /api/chats/{id}/members`, `POST /api/chats/{id}/read`.
- `DELETE /api/messages/{clientMsgId}`, `PATCH /api/messages/{clientMsgId}`.
- `GET /api/keys/{userId}`, `POST /api/keys/prekeys`, `POST /api/keys/register`.
- `POST /api/push/subscribe`, `POST /api/push/native/register`.
- `POST /api/media/upload`, `GET /api/media/{id}`, `GET /api/chats/{id}/media`.
- `GET /api/calls/ice-servers`; `POST /api/calls/room`, `DELETE /api/calls/room/{roomId}`, `GET /api/calls/room/{roomId}/participants`, `POST /api/calls/room/{roomId}/join`, `POST /api/calls/room/{roomId}/leave`.
- `GET /api/downloads/manifest`, `GET /api/downloads/{filename}`.

### Admin (JWT + RequireAdmin)

- `GET/POST /api/admin/registration-requests`, `/approve`, `/reject`.
- `GET/POST /api/admin/invite-codes`, `DELETE /{code}`, `GET /{code}/activations`.
- `GET /api/admin/users`, `POST /{id}/reset-password`, `/suspend`, `/unsuspend`, `/ban`, `/revoke-sessions`, `/remote-wipe`.
- `GET/PUT /api/admin/users/{id}/quota`, `PUT /api/admin/users/{id}/role`.
- `GET/PUT /api/admin/settings/retention`, `GET/PUT /api/admin/settings/max-group-members`.
- `GET /api/admin/password-reset-requests`, `POST /{id}/resolve`.
- `GET /api/admin/system/stats`, `GET /api/admin/system/stream` (SSE).

### WebSocket

- `GET /ws` (JWT-аутентифицирован) — реальное время: сообщения, presence, call signalling, groups SFU signalling.

### Static

- `GET /assets/*` — embedded (`//go:embed static`).
- `GET /*` — SPA-fallback на `index.html`.

---

## 4. WebSocket Hub (`server/internal/ws/hub.go`)

- Структура `Hub`: клиенты, комнаты (chat rooms), call-состояния.
- Клиент = 1 WebSocket-соединение + userID + deviceID.
- Потоки:
  - Входящий фрейм от клиента → диспетчер по типу: `message`, `typing`, `read`, `call.*`, `group-call.*`.
  - Fan-out по участникам conversation.
- Call signalling: offer/answer/ice, group-call.join/leave/offer (для SFU — через `sfu.Manager`).
- Presence: последний `last_seen_at` обновляется через WS + REST.

**Точный список WS-фреймов**: в `server/internal/ws/hub.go` + тестах `hub_test.go`, `hub_calls_test.go`. Рекомендуется сверять при переработке `technical-documentation.md` §10.

---

## 5. SFU и WebRTC (`server/internal/sfu/manager.go`)

- `Manager` — реестр комнат.
- `Room{ID, ChatID, CreatorID, Participants, peers, api}` — webrtc.API на комнату.
- `participant{localTracks}` — forwards remote track ко всем остальным (SFU-mesh).
- Сигналы: `Join`, `Leave`, `SetRemoteDescription`, `AddTrack`.
- ICE: STUN по дефолту, TURN — через `iceServersHandler` (HMAC-подписанные creds с TTL).

`govulncheck` отмечал vuln в `pion/dtls@2.2.12` (random-nonce/AES-GCM). Упомянуть в security-audit/release-checklist.

---

## 6. Bots + Webhooks (`server/internal/bots/`)

- `POST /api/bots`, `DELETE /api/bots/{id}`, `PATCH /api/bots/{id}` — CRUD (через admin).
- `POST /api/bots/{id}/webhook` (или через bot token middleware) — отправка сообщений в чат.
- Webhook delivery (`webhook.go`): **allowlist только localhost/RFC-1918**, HMAC-SHA256 (`X-Messenger-Signature`), retry 1s→2s→4s, `Timeout 5s`. Это защита от SSRF.

---

## 7. Клиент (`client/`)

### Стек

- React 18 + TypeScript 5.5 + Vite 5 → фактически в package.json `vite@^8.0.9` (**сверить с CLAUDE.md: там Vite 5, в package.json 8.x — расхождение**).
- Zustand 4, React Router v6, libsodium-wrappers (+ `-sumo` для vitest), idb-keyval, qrcode.react, recharts, date-fns, clsx.
- PWA через `vite-plugin-pwa` (generateSW, autoUpdate, 4 МБ лимит кэша, custom `importScripts: ['/push-sw.js']`).
- Тесты: Vitest (+ coverage v8), Playwright (`test:e2e`).
- Dev-proxy: `/api`, `/ws`, `/media` → `http://localhost:8080`.

### `client/src/` — структура

- `api/`: `client.ts` (REST), `websocket.ts`.
- `components/`: CallOverlay, ChatList, ChatWindow, GalleryModal, GroupCallView, LinkDevice, NewChatModal, OfflineIndicator, PassphraseGate, Profile, SafetyNumber, VoiceMessage, VoiceRecorder.
- `config/`: `serverConfig.ts`, `version.ts`.
- `crypto/`: `x3dh.ts`, `session.ts`, `ratchet.ts`, `senderkey.ts`, `keystore.ts` (IndexedDB-хранилище ключей под vault).
- `hooks/`: `useBrowserWSBindings`, `useCallHandler`, `useMessengerWS`, `useNetworkStatus`, `useOfflineSync`, `usePushNotifications`, `useWebRTC`.
- `lib/logger.ts`.
- `pages/`: AdminPage, AuthPage, ChatListPage, ChatWindowPage, DownloadsPage, LinkDevicePage, ProfilePage, ServerSetupPage.
- `store/` (Zustand + IndexedDB): authStore, callStore, chatStore, messageDb, outboxDb, serverInfoStore, vaultStore, wsStore.
- `styles/globals.css`, `types/index.ts`, `utils/ringtone.ts`.

### Особенности

- `passphrase gate` — блокирует UI до ввода passphrase для разблокировки vault (AES-GCM ключи).
- Offline queue: `outboxDb.ts` + `useOfflineSync.ts`.
- Push: Service Worker + `usePushNotifications.ts`.
- Coverage thresholds: 60% lines/functions (vitest.config).
- Lint: `max-warnings 0`.

---

## 8. Shared / native-core (`shared/native-core/`)

TypeScript-рантайм, переиспользуемый в web и (через мост) в native apps.

### Дерево

- `index.ts` — публичные экспорты.
- `auth/session-runtime.ts` — AuthSessionRuntime (login/logout/refresh, token state).
- `api/web/browser-api-client.ts` — REST-клиент на fetch.
- `websocket/connection-runtime.ts` — коннект/реконнект/ping.
- `websocket/web/` — `browser-messenger-ws-deps`, `browser-websocket-client`, `browser-websocket-platform`, `browser-ws-wiring`, `messenger-ws-orchestrator`.
- `messages/message-repository.ts` — персистенция сообщений/outbox.
- `crypto/` — `aesGcm`, `cryptoVault`, `crypto-runtime`, `seed-vectors`, `test-vector-runner`, `web-crypto-adapter`; web-адаптеры: `ratchet-web`, `senderkey-web`, `session-web`, `x3dh-web`, `web-helpers`.
- `storage/` — `storage-runtime`, `web/browser-keystore`, `web/encryptedStore`, `web/vaultMigration`.
- `calls/` — `call-controller`, `call-session`, web: `browser-webrtc-platform`, `browser-webrtc-runtime`, `call-handler-orchestrator`, `call-ws-types`.
- `sync/sync-engine.ts` — фоновая синхронизация.
- `module.json`, `package.json`, `README.md`, tsconfig(.build).json.

### Домен (доки)

- `shared/domain/` — `auth-session.md`, `events.md`, `interfaces.md`, `models.md`, `repositories.md`, `sync-engine.md`, `websocket-lifecycle.md`, `README.md`.
- `shared/crypto-contracts/` — `aes-gcm-spec.md`, `interfaces.md`, `README.md`.
- `shared/test-vectors/` — файлы с тестовыми векторами (упомянуты в планах PRD).

---

## 9. Native apps (`apps/`)

### Desktop — Kotlin Compose Multiplatform (`apps/desktop/`)

- `build.gradle.kts`, `settings.gradle.kts`.
- `src/main/kotlin/Main.kt` — минимальный `application { Window { App() } }` (UI из `ui.App`).
- CI: Gradle-tasks `packageDmg`, `packageDeb`, `packageMsi` (matrix: macOS arm64, macOS x86_64, Linux, Windows).
- Подпись артефактов: опциональная через secrets (macOS signing identity, Windows .pfx).

### Android — Kotlin + Jetpack Compose + SQLDelight (`apps/mobile/android/`)

- `build.gradle.kts`: plugins — android-application, kotlin-android, kotlin-compose, kotlin-serialization, sqldelight. `compileSdk=35`, `minSdk=26`, `targetSdk=35`, `versionCode=1`, `versionName=1.0`, `jvmTarget=17`, `applicationId=com.messenger`.
- Зависимости: compose-bom, compose-material3, ktor-client (+ okhttp, content-negotiation, auth, websockets), serialization-json, lazysodium-android, sqldelight-android-driver, coroutines, coil-compose.
- CI: `assembleRelease` (если задан keystore через secrets) или `assembleDebug`.
- Точный исходный tree на snapshot: в `apps/mobile/android/` присутствуют `build.gradle.kts`, `settings.gradle.kts`, `README.md`. Фактические Kotlin-исходники (ChatWindowScreen, MessageBubble, EncryptedMediaFetcher, AppState, ApiClient, ChatWindowViewModel, MessengerApp.kt) подтверждаются в планах `docs/superpowers/plans/2026-04-13-android-client.md` и `2026-04-14-android-file-transfer.md` — но `find` под watched path вернул только top-level файлы. **Надо ли явно сверить исходники — сверяется в сессии #3 (technical-documentation)**.

### iOS — SwiftUI + Swift Package (`apps/mobile/ios/`)

- `Package.swift` — SPM манифест.
- `Sources/Messenger/`: `App.swift` (SwiftUI entry + AppDelegate для APNs; подключает WebRTC через `#if canImport(WebRTC)`), `BuildConfig.swift`, `UpdateCheckerService.swift`.
- `Sources/MessengerCrypto/`: `Ratchet.swift`, `SenderKey.swift`, `X3DH.swift`.
- `Tests/MessengerTests/CryptoTests.swift`.
- CI: job `build-ios-crypto` — только `swift build --product MessengerCrypto -c release`. Полный IPA требует Xcode-проект + Apple signing (вне SPM).

### Auxiliary

- `apps/README.md`, `apps/desktop/README.md`, `apps/mobile/README.md`, `apps/mobile/android/README.md`, `apps/mobile/ios/README.md`.

---

## 10. Конфигурация и ENV (`server/cmd/server/config.go`)

Порядок приоритета: **env > config.yaml > defaults**. Имя файла-конфига: `config.yaml` (по умолчанию, задан в `main.go`).

| ENV | YAML key | Дефолт | Назначение |
|---|---|---|---|
| `PORT` | `port` | `8080` | Порт |
| `DB_PATH` | `db_path` | `./messenger.db` | Путь к SQLite |
| `MEDIA_DIR` | `media_dir` | `./media` | Каталог медиа |
| `DOWNLOADS_DIR` | `downloads_dir` | `./downloads` | Каталог артефактов native-клиентов |
| `JWT_SECRET` | `jwt_secret` | — | **Обязателен** |
| `TLS_CERT` | `tls_cert` | пусто | Прямой TLS (cert) |
| `TLS_KEY` | `tls_key` | пусто | Прямой TLS (key) |
| `ALLOWED_ORIGIN` | `allowed_origin` | пусто | CORS / WS origin |
| `BEHIND_PROXY` | `behind_proxy` | `false` | HSTS+trust XFF при reverse proxy |
| `STUN_URL` | `stun_url` | `stun:stun.l.google.com:19302` | STUN |
| `TURN_URL` | `turn_url` | пусто | TURN |
| `TURN_SECRET` | `turn_secret` | пусто | HMAC для TURN creds |
| `TURN_CREDENTIAL_TTL` | `turn_credential_ttl` | `86400` | TTL TURN-creds |
| `VAPID_PRIVATE_KEY` | `vapid_private_key` | auto | Web Push |
| `VAPID_PUBLIC_KEY` | `vapid_public_key` | auto | Web Push |
| `SERVER_NAME` | `server_name` | `Messenger` | Публичное имя |
| `SERVER_DESCRIPTION` | `server_description` | пусто | Описание |
| `REGISTRATION_MODE` | `registration_mode` | `open` | `open` / `invite` / `approval` |
| `ADMIN_USERNAME` | `admin_username` | пусто | Bootstrap админа |
| `ADMIN_PASSWORD` | `admin_password` | пусто | Bootstrap админа |
| `MAX_GROUP_MEMBERS` | `max_group_members` | `50` | Лимит группы (0=дефолт) |
| `ALLOW_USERS_CREATE_GROUPS` | `allow_users_create_groups` | `true` | Флаг |
| `MAX_UPLOAD_BYTES` | `max_upload_bytes` | `100<<20` (100 МБ) | Лимит media-upload |
| `APP_VERSION` | `app_version` | `dev` | Версия server build |
| `MIN_CLIENT_VERSION` | `min_client_version` | `0.0.0` | Минимальная версия клиента |
| `APP_CHANGELOG` | `app_changelog` | пусто | Changelog для version endpoint |
| `FCM_LEGACY_KEY` | `fcm_legacy_key` | пусто | FCM (Firebase Server Key) |
| `APNS_KEY_PATH` | `apns_key_path` | пусто | Путь к APNs .p8 |
| `APNS_KEY_ID` | `apns_key_id` | пусто | APNs |
| `APNS_TEAM_ID` | `apns_team_id` | пусто | APNs |
| `APNS_BUNDLE_ID` | `apns_bundle_id` | пусто | APNs |
| `APNS_SANDBOX` | `apns_sandbox` | `false` | APNs sandbox flag |

Дополнительно в `docker-compose.yml` — `TUNNEL_TOKEN` (для профиля `cloudflare`).

### Предупреждения/валидация

- `JWT_SECRET == ""` → `log.Fatal`.
- `REGISTRATION_MODE` ∉ {open, invite, approval} → `log.Fatal`.
- Отсутствие TLS → warning при `ALLOWED_ORIGIN` без TLS и без `BEHIND_PROXY`.
- Если `VAPID_*` пусто — генерируются и логируются одноразово (⚠ push-подписки сломаются после перезапуска если не сохранить).

---

## 11. Docker / Compose / CI

### Dockerfile (multi-stage)

1. `client-builder` (node:20-alpine) → `npm install` + `npm run build` → `dist/`.
2. `server-builder` (golang) → копирует `client/dist` в `server/cmd/server/static` для `go:embed`, затем `go build -o /bin/messenger ./cmd/server` с `CGO_ENABLED=0`.
3. Final image — статический бинарь + runtime.

### docker-compose.yml

- Сервис `messenger`: build из Dockerfile, порт `8080`, volume `messenger_data:/data`, healthcheck `wget /api/server/info` каждые 30s.
- Проброс ENV: `JWT_SECRET` (обязателен), `ALLOWED_ORIGIN`, `VAPID_*`, `TLS_*`, `STUN_URL`, `TURN_*`, `TURN_CREDENTIAL_TTL`.
- Профиль `cloudflare` → сервис `cloudflared` (`cloudflare/cloudflared:latest`) с `TUNNEL_TOKEN`.

### CI (`.github/workflows/build-native.yml`)

Триггеры: push tags `v*`, `workflow_dispatch`.

Jobs:

- `resolve-inputs` — version + server_url (baked через `scripts/set-server-url.sh`).
- `build-desktop-macos-arm64`, `build-desktop-macos-x86_64` — `./gradlew packageDmg`, опциональная подпись по `MACOS_CERTIFICATE_BASE64/PASSWORD` + `MACOS_SIGNING_IDENTITY`.
- `build-desktop-linux` — `./gradlew packageDeb`.
- `build-desktop-windows` — `./gradlew packageMsi`, опциональная подпись через `WINDOWS_PFX_BASE64/PASSWORD` + `signtool`.
- `build-android` — `assembleRelease` (если задан keystore) иначе `assembleDebug`.
- `build-ios-crypto` — `swift build --product MessengerCrypto -c release` (без IPA).
- `test-server` — Go tests.
- `publish-release` — `softprops/action-gh-release` draft-релиз с артефактами, только при push tag `v*`.

Java version в CI: `17` (temurin).

### Scripts

- `scripts/db-migrate.sh` — CLI над schema_migrations. Флаги `--db`, `--dry-run`, `--version`, `--rollback N`. `TOTAL_MIGRATIONS=28`.
- `scripts/set-server-url.sh` — upgrade baked server URL для native-сборок (упомянут в CI).

### Makefile (`server/Makefile`)

- `make test` → `go test ./... -race`.
- `make coverage` → coverage.out + HTML отчёт.
- `make test-integration` → `go test ./internal/integration/... -v -race`.

---

## 12. Существующие документы (`docs/`)

| Файл | Роль для `docs/main/*` |
|---|---|
| `docs/api-reference.md` | Источник REST/WS контрактов для §10 tech-doc и architecture |
| `docs/crypto-rationale.md` | Обоснование X3DH/Double Ratchet/AES-GCM vault — для E2E-раздела architecture |
| `docs/deployment.md` | База для `docs/main/deployment.md` (но `docs/main/deployment.md` короче) |
| `docs/prd-alignment-baseline.md` | Исходный baseline PRD alignment |
| `docs/prd-alignment-plan.md` | План устранения PRD-разрывов (фазы 0/1/...) |
| `docs/prd-alignment-progress.md` | Статус фаз — основа для `v1-gap-remediation.md` |
| `docs/prd-vs-impl.md`, `docs/prd-vs-implementation.md` | Сверка PRD ↔ код |
| `docs/security-audit.md` | Источник для §Безопасность платформы |
| `docs/test-plan.md` | Источник для §Запуск и тесты |
| `docs/release-checklist.md`, `docs/release-tag-instructions.md` | Для deployment/release |
| `docs/ios-update-policy.md` | Для usersguid/deployment (iOS обновления) |
| `docs/privacy-screen-contract.md`, `docs/privacy-screen-desktop-limitations.md`, `docs/privacy-screen-smoke-tests.md` | Native security — для architecture/usersguid |
| `docs/audit/native-platform-audit.md`, `docs/audit/system-audit-2026-04-16.md` | Для architecture/security |
| `docs/superpowers/plans/*.md` | История решений (chats, WebRTC, multi-device, android, desktop, iOS, multi-server admin, offline PWA, migration deployment, file transfer, WebRTC android…) |

### Файлы в `docs/main/` (целевые)

| Файл | Объём | Статус |
|---|---|---|
| `architecture.md` | 695 строк / 12 секций | TODO (#2) |
| `technical-documentation.md` | 1829 строк / 37 секций | TODO (#3) |
| `v1-gap-remediation.md` | 497 строк / 17 секций | TODO (#4) |
| `next-session.md` | 46 строк / 3 секции | TODO (#5) |
| `usersguid.md` | 313 строк / 8 секций | TODO (#6) |
| `deployment.md` | 162 строки / 8 секций | TODO (#7) |

---

## 13. Известные расхождения и риски

Эти пункты важно учесть при переработке; не повторять ошибки старых доков.

1. **Registration mode**: `CLAUDE.md` использует термин `request`, но фактический валидатор принимает `approval`. В доках `docs/main/*` нужно использовать `approval` и упомянуть, что `request` — устаревший синоним.
2. **Vite версия**: `CLAUDE.md` заявляет Vite 5, `client/package.json` содержит `vite@^8.0.9`. Для tech-doc/architecture — опираться на package.json.
3. **Пакет `server/internal/storage`**: каталог пустой, в `main.go` не импортируется. В чеклисте упомянут — в новой доке отметить как «зарезервирован» или не упоминать.
4. **`shared/native-core`**: в чеклисте перечислен подраздел `sync`, но фактически также есть `messages` и `api`. Учесть полный список: `auth`, `api`, `crypto`, `storage`, `websocket`, `messages`, `calls`, `sync`.
5. **SFU vuln**: `pion/dtls@2.2.12` имеет GO-2026-4479. Упомянуть в security-audit/release-checklist, а в architecture — просто факт использования Pion.
6. **Android исходники**: `find apps/mobile/android -type f` на baseline возвращает только top-level gradle/README; актуальная структура Kotlin-кода подтверждается планами `docs/superpowers/plans/2026-04-13-android-client.md` и `2026-04-14-android-file-transfer.md`. При переработке tech-doc и architecture — **сверять через git log**, не копировать из планов слепо.
7. **iOS полный IPA**: не собирается в CI, только `MessengerCrypto` через SPM. В доках явно отразить.

---

## 14. Что этот снимок НЕ содержит

- Пополусимвольные сигнатуры всех REST-хендлеров (JSON-схемы запросов/ответов) — это **источник** для `technical-documentation.md` §REST API, берётся из `docs/api-reference.md` + чтения хендлеров.
- Полный список миграций с описанием DDL — уточнять из `server/db/migrate.go` при переработке tech-doc.
- Сводную диаграмму компонентов — создавать при переработке `architecture.md` (#2), опираясь на разделы 1, 4, 5, 7, 8, 9 этого снимка.

---

## 15. Журнал изменений снимка

- **2026-04-21** — первичное заполнение на baseline `60d7c93`. Все секции заполнены по собранным данным; помечены места с возможными расхождениями (раздел 13).
