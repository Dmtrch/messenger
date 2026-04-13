# Техническая документация проекта Messenger

## 1. Назначение документа

Этот документ описывает фактическое техническое состояние проекта `messenger` на основе исходного кода в репозитории. Он дополняет существующие файлы [`docs/architecture.md`](/Users/dim/vscodeproject/messenger/docs/architecture.md) и [`docs/superpowers/specs/messenger-spec.md`](/Users/dim/vscodeproject/messenger/docs/superpowers/specs/messenger-spec.md), но опирается прежде всего на реальную реализацию.

Документ нужен для:

- быстрого входа нового разработчика в проект;
- понимания текущей архитектуры и границ модулей;
- описания серверного API, клиентской логики и модели данных;
- фиксации расхождений между спецификацией и текущей реализацией;
- подготовки к дальнейшей доработке и рефакторингу.

## 2. Краткое описание системы

`Messenger` это self-hosted мессенджер с Go backend и PWA-клиентом на React. Проект ориентирован на личный или малогрупповой сценарий развёртывания: сервер запускается пользователем локально или на своём хосте, клиент работает в браузере и может устанавливаться как PWA.

Ключевые свойства текущей реализации:

- backend написан на Go 1.22;
- HTTP API построен на `chi`;
- хранилище данных: SQLite в WAL-режиме;
- realtime-коммуникация: WebSocket;
- аутентификация: JWT access token + refresh token в `httpOnly` cookie;
- frontend: React 18 + TypeScript + Vite + Zustand;
- PWA: `vite-plugin-pwa` + Service Worker;
- клиент содержит собственный криптографический слой для X3DH и Double Ratchet на базе `libsodium-wrappers`.

Важно: проект уже содержит E2E-модули на клиенте, но не все аспекты спецификации Signal Protocol и безопасности доведены до production-уровня. Это MVP-реализация с заметным заделом на дальнейшее развитие.

Отдельно зафиксировано направление дальнейшего развития: поверх текущего backend и протокольного слоя проект переходит к native-first семейству клиентов для `Desktop`, `Android` и `iOS`. Desktop MVP реализован в `apps/desktop/` и покрывает macOS/Windows/Linux. Android и iOS — следующие этапы.

## 3. Фактическая структура репозитория

На текущий момент в репозитории реально используются:

```text
messenger/
├── client/                     # React PWA
│   ├── public/
│   │   └── push-handler.js
│   ├── src/
│   │   ├── api/
│   │   ├── config/
│   │   │   └── serverConfig.ts     # multi-server URL management
│   │   ├── components/
│   │   │   └── OfflineIndicator/   # UI-баннер offline-состояния
│   │   ├── crypto/
│   │   ├── hooks/
│   │   ├── pages/
│   │   │   ├── ServerSetupPage.tsx # выбор сервера
│   │   │   └── AdminPage.tsx       # панель администратора
│   │   ├── store/                  # Zustand + IDB модули (authStore: role, chatStore: reset)
│   │   ├── styles/
│   │   └── types/
│   ├── package.json
│   └── vite.config.ts
├── docs/
│   ├── architecture.md
│   ├── SESSION_CONTEXT.md
│   └── superpowers/
│       ├── plans/
│       └── specs/
├── server/
│   ├── cmd/server/
│   │   ├── main.go             # entrypoint, роутинг, static hosting
│   │   └── config.go           # Config struct, YAML + env
│   ├── db/
│   │   ├── schema.go
│   │   ├── migrate.go
│   │   └── queries.go
│   ├── internal/
│   │   ├── auth/               # JWT, bcrypt, role in claims
│   │   ├── admin/              # RequireAdmin, admin handlers
│   │   ├── serverinfo/         # GET /api/server/info
│   │   ├── chat/
│   │   ├── keys/
│   │   ├── media/
│   │   ├── push/
│   │   ├── users/
│   │   └── ws/
│   ├── static/                 # встроенная статика для single-binary режима
│   └── go.mod
└── README.md
```

Примечание:

- в репозитории сейчас нет второго фронтенда `frontend/`, хотя он упоминается в некоторых инструкциях;
- в `server/` лежат локальные файлы SQLite (`messenger.db`, `-wal`, `-shm`) и собранный бинарник `server/bin/server`, то есть репозиторий использовался для локального запуска;
- `shared/` и `apps/` — native track, `apps/desktop/` уже содержит полноценный MVP;
- `shared/protocol/` — formal schemas (REST, WebSocket, message envelope);
- `shared/domain/` — language-neutral contract layer;
- `shared/native-core/` — реализованный runtime-пакет, source-of-truth для web и native клиентов;
- `apps/mobile/android/` и `apps/mobile/ios/` — только `README.md`, реализация не начата.

### Структура `apps/desktop/` (реализовано)

```text
apps/desktop/
├── build.gradle.kts               # Compose Desktop 1.7.x, Ktor 3.x, lazysodium-java 5.1.4, SQLDelight 2.x
├── settings.gradle.kts
├── gradle/libs.versions.toml
└── src/main/kotlin/
    ├── Main.kt
    ├── config/ServerConfig.kt
    ├── crypto/
    │   ├── X3DH.kt                # X3DH initiator + responder (верифицирован через test-vectors)
    │   ├── Ratchet.kt             # Double Ratchet encrypt/decrypt
    │   ├── SenderKey.kt           # Группы: encrypt/decrypt через SenderKey
    │   └── KeyStorage.kt          # PKCS12 (~/.messenger/keystore.p12)
    ├── db/
    │   ├── messenger.sq           # 4 таблицы: chat, message, ratchet_session, outbox
    │   └── DatabaseProvider.kt    # SQLDelight singleton
    ├── service/
    │   ├── ApiClient.kt           # Ktor HTTP + Auth bearer (auto-refresh)
    │   ├── TokenStore.kt          # Хранение JWT в памяти/файле
    │   ├── MessengerWS.kt         # WebSocket + exponential backoff reconnect
    │   └── WSOrchestrator.kt      # Диспетчер WS-фреймов (message/ack/typing/read/deleted/edited)
    ├── store/
    │   ├── AuthStore.kt           # StateFlow<AuthState>
    │   └── ChatStore.kt           # StateFlow<List<ChatItem>> + messages + typing
    ├── viewmodel/
    │   ├── AppViewModel.kt        # login/logout/sendMessage + WS lifecycle
    │   ├── ChatListViewModel.kt
    │   └── ChatWindowViewModel.kt # DB + WS merge, cursor pagination
    └── ui/
        ├── App.kt                 # Навигация: ServerSetup → Auth → ChatList → ChatWindow / Profile
        └── screens/
            ├── ServerSetupScreen.kt
            ├── AuthScreen.kt
            ├── ChatListScreen.kt
            ├── ChatWindowScreen.kt
            └── ProfileScreen.kt
```

Нативные дистрибутивы (собираются на соответствующей ОС):
- macOS: `./gradlew packageDmg`
- Windows: `./gradlew packageMsi`
- Linux: `./gradlew packageDeb`

## 4. Технологический стек

### 4.1 Backend

- Go 1.22
- `github.com/go-chi/chi/v5`
- `github.com/golang-jwt/jwt/v5`
- `github.com/gorilla/websocket`
- `modernc.org/sqlite`
- `github.com/SherClockHolmes/webpush-go`
- `golang.org/x/crypto/bcrypt`
- `gopkg.in/yaml.v3` — парсинг `config.yaml`

### 4.2 Frontend

- React 18
- TypeScript
- Vite 5
- Zustand
- `libsodium-wrappers`
- `idb-keyval`
- `react-router-dom`
- `date-fns`
- `vite-plugin-pwa`
- `vitest` (dev) — тесты
- `libsodium-wrappers-sumo` (dev) — полная сборка libsodium для тестов (содержит `crypto_auth_hmacsha256`)

## 5. Архитектура верхнего уровня

Система состоит из трёх основных слоёв:

1. HTTP API слой на Go.
2. WebSocket Hub для realtime-доставки событий.
3. PWA-клиент, который:
   - управляет аутентификацией;
   - хранит локальное состояние чатов;
   - выполняет шифрование и дешифрование сообщений;
   - подписывается на push-уведомления;
   - взаимодействует с REST и WebSocket API.

Потоки данных:

- регистрация и логин идут через REST;
- список чатов и история сообщений загружаются через REST;
- отправка сообщений выполняется по WebSocket;
- сервер сохраняет отдельную копию сообщения для каждого получателя;
- входящие сообщения приходят по WebSocket в зашифрованном виде;
- клиент расшифровывает их локально и кладёт в Zustand store;
- offline-получатели получают Web Push без текста сообщения.

### 5.1 Native track status

Архитектурные решения зафиксированы:

- `Desktop`: `Kotlin + Compose Multiplatform Desktop` ✅ **MVP реализован** (`apps/desktop/`)
- `Android`: `Kotlin + Compose` ⬜ не начат (`apps/mobile/android/` — только README)
- `iOS`: `SwiftUI` поверх shared core ⬜ не начат (`apps/mobile/ios/` — только README)
- локальная БД: `SQLite` (SQLDelight 2.x на desktop, Room или SQLDelight на Android, GRDB на iOS)
- crypto: `libsodium` family — `lazysodium-java` на JVM, `swift-sodium` на iOS
- cursor-based pagination обязательна для всех клиентов

Дополнительно уже реализован не только контрактный, но и runtime-слой Shared Core:

- `shared/protocol/rest-schema.json`
- `shared/protocol/ws-schema.json`
- `shared/protocol/message-envelope.schema.json`
- `shared/domain/models.md`
- `shared/domain/repositories.md`
- `shared/domain/auth-session.md`
- `shared/domain/websocket-lifecycle.md`
- `shared/domain/sync-engine.md`
- `shared/test-vectors/*`
- `shared/native-core/index.ts`
- `shared/native-core/package.json`
- `shared/native-core/auth/*`
- `shared/native-core/websocket/*`
- `shared/native-core/messages/*`
- `shared/native-core/sync/*`
- `shared/native-core/storage/*`
- `shared/native-core/crypto/*`
- `shared/native-core/calls/call-session.ts`
- `shared/native-core/calls/call-controller.ts`
- `shared/native-core/calls/web/*`
- `shared/native-core/calls/web/browser-webrtc-platform.ts`
- `shared/native-core/websocket/web/ws-frame-types.ts`
- `shared/native-core/websocket/web/ws-model-types.ts`
- `shared/native-core/websocket/web/browser-websocket-platform.ts`
- `shared/native-core/websocket/web/browser-messenger-ws-deps.ts`
- `shared/native-core/calls/web/call-ws-types.ts`

Это уже меняет runtime-код клиента: `api`, `websocket`, `crypto`, `keystore`, `useMessengerWS`, `useCallHandler`, `useWebRTC`, `callStore` и `CallOverlay` используют shared runtime или thin facades над ним.
Для call-стека это уже включает и top-level wiring: `App.tsx` владеет `useCallHandler()`, напрямую пробрасывает `initiateCall` в роутинг/UI и передаёт `handleCallFrame` в `useMessengerWS`, без скрытых callback-полей в Zustand.
Дополнительно realtime-слой уже использует shared-local frame/model contracts, поэтому `shared/native-core/calls/web/*` и `shared/native-core/websocket/web/*` не зависят от `client/src/types` для `WSFrame/WSSendFrame/Chat/Message`. Browser-specific platform wiring тоже частично перенесён в shared: `client/src/api/websocket.ts` и `client/src/hooks/useWebRTC.ts` уже используют shared helpers для `WebSocket`, timers, `RTCPeerConnection` и `getUserMedia`, а `client/src/hooks/useMessengerWS.ts` использует shared helper для browser scheduler и маппинга `ChatSummary -> RealtimeChat`.

### 5.2 Shared Native Core status

На текущий момент `shared/native-core` покрывает следующие runtime-срезы:

- `auth/session-runtime.ts`
  - login/refresh/restore/logout
  - хранение session state
  - device registration
- `websocket/connection-runtime.ts`
  - state machine соединения
  - reconnect/backoff
  - auth-failure handling
- `messages/message-repository.ts`
  - in-memory message repository
  - page merge
  - outbox/state update semantics
- `sync/sync-engine.ts`
  - reconcile после reconnect
  - outbox resend
  - session validation hooks
- `storage/storage-runtime.ts`
  - identity/SPK/OPK
  - ratchet sessions
  - sender keys
  - device/settings/push records
- `crypto/crypto-runtime.ts`
  - session bootstrap
  - encrypt/decrypt orchestration
  - sender keys orchestration
- `crypto/web/*`
  - shared web-реализации `x3dh`, `ratchet`, `senderkey`, `session-web`
- `api/web/browser-api-client.ts`
  - browser HTTP transport
  - refresh rotation
  - authenticated media/ICE flows
- `websocket/web/browser-websocket-client.ts`
  - browser realtime transport
- `websocket/web/browser-websocket-platform.ts`
  - browser `WebSocket` adapter
  - browser timer helpers
- `websocket/web/browser-messenger-ws-deps.ts`
  - browser helper для маппинга `api.getChats()` в shared realtime model
  - browser scheduler helper для realtime orchestrator
- `websocket/web/ws-frame-types.ts`
  - shared-local realtime frame contract
- `websocket/web/ws-model-types.ts`
  - shared-local realtime chat/message model
- `websocket/web/messenger-ws-orchestrator.ts`
  - message-flow orchestration
  - SKDM/prekey/read/typing routing
- `calls/call-session.ts`
  - чистая call state machine
  - `status/callId/chatId/peerId/isVideo/incomingOffer/notification/isMuted/isCameraOff`
  - platform-neutral transitions без browser API
- `calls/call-controller.ts`
  - shared orchestration поверх call session
  - snapshot/subscription model
  - scheduler-driven notification cleanup
- `calls/web/browser-webrtc-runtime.ts`
  - browser WebRTC peer runtime
- `calls/web/browser-webrtc-platform.ts`
  - browser adapter для `RTCPeerConnection`
  - browser helper для `navigator.mediaDevices.getUserMedia`
- `calls/web/call-ws-types.ts`
  - shared-local call signalling contract
- `calls/web/call-handler-orchestrator.ts`
  - signalling orchestration для звонков

Следующие шаги для native track:

- **Stage 11C-2**: реализовать Android-клиент (`apps/mobile/android/`) — Jetpack Compose, Ktor Android engine, lazysodium-android;
- **Stage 11C-3**: реализовать iOS-клиент (`apps/mobile/ios/`) — SwiftUI, URLSession, swift-sodium, GRDB.

## 6. Backend: точка входа и конфигурация

Файлы:
- [`server/cmd/server/main.go`](/Users/dim/vscodeproject/messenger/server/cmd/server/main.go)
- [`server/cmd/server/config.go`](/Users/dim/vscodeproject/messenger/server/cmd/server/config.go)

### 6.1 Конфигурация: файл и переменные окружения

Поддерживается `config.yaml` рядом с бинарником (необязателен). Шаблон: `server/config.yaml.example`. Файл добавлен в `.gitignore` — может содержать `jwt_secret`.

Приоритет: **env-переменная > config.yaml > default**.

Параметры (имена в yaml и соответствующие env):

| yaml | env | default |
|---|---|---|
| `port` | `PORT` | `8080` |
| `db_path` | `DB_PATH` | `./messenger.db` |
| `media_dir` | `MEDIA_DIR` | `./media` |
| `jwt_secret` | `JWT_SECRET` | — (обязателен) |
| `tls_cert` / `tls_key` | `TLS_CERT` / `TLS_KEY` | — |
| `allowed_origin` | `ALLOWED_ORIGIN` | — |
| `behind_proxy` | `BEHIND_PROXY` | `false` |
| `stun_url` | `STUN_URL` | `stun:stun.l.google.com:19302` |
| `turn_url` | `TURN_URL` | — |
| `turn_secret` | `TURN_SECRET` | — |
| `turn_credential_ttl` | `TURN_CREDENTIAL_TTL` | `86400` |
| `vapid_private_key` | `VAPID_PRIVATE_KEY` | авто-генерация |
| `vapid_public_key` | `VAPID_PUBLIC_KEY` | авто-генерация |
| `server_name` | `SERVER_NAME` | `Messenger` |
| `server_description` | `SERVER_DESCRIPTION` | `""` |
| `registration_mode` | `REGISTRATION_MODE` | `open` |
| `admin_username` | `ADMIN_USERNAME` | — |
| `admin_password` | `ADMIN_PASSWORD` | — |

`BEHIND_PROXY=true` при запуске за reverse proxy (Cloudflare Tunnel, nginx): включает HSTS, доверяет X-Real-IP/X-Forwarded-For.

Если VAPID-ключи не заданы, сервер генерирует их на старте и выводит в лог. Это удобно для локальной разработки, но ломает уже выданные push-подписки после рестарта.

### 6.2 Инициализация

На старте сервер:

- открывает SQLite через `db.Open`;
- применяет схему и миграции (#1–13);
- запускает `EnsureAdminUser` — создаёт bootstrap-admin из конфига, если не существует;
- создаёт WebSocket Hub;
- инициализирует хендлеры `auth`, `chat`, `media`, `users`, `keys`, `push`, `serverinfo`, `admin`;
- поднимает `chi.Router`;
- раздаёт встроенную статику из `server/static`.

### 6.3 Middleware

Подключены глобально:

- `middleware.Logger`
- `middleware.Recoverer`
- `middleware.Timeout(30 * time.Second)`
- `secmw.SecurityHeaders(isHTTPS || behindProxy)` — CSP, X-Frame-Options, X-Content-Type-Options, HSTS
- `authLimiter.Middleware()` на `/api/auth/register|login|refresh` — rate limiting 20 req/min per IP

## 7. Backend: HTTP API

### 7.1 Публичные маршруты

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/push/vapid-public-key`
- `GET /api/server/info` — name, description, registrationMode (без JWT)
- `POST /api/auth/request-register` — заявка на регистрацию (режим approval)
- `POST /api/auth/password-reset-request` — запрос сброса пароля
- `GET /ws`

### 7.2 Защищённые маршруты

Под `auth.Middleware`:

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
- `GET /api/media/{mediaId}`
- `PATCH /api/media/{mediaId}`

### 7.3 Маршруты администратора

Под `auth.Middleware` + `admin.RequireAdmin` (role = admin):

- `GET /api/admin/registration-requests`
- `POST /api/admin/registration-requests/{id}/approve`
- `POST /api/admin/registration-requests/{id}/reject`
- `POST /api/admin/invite-codes`
- `GET /api/admin/invite-codes`
- `GET /api/admin/users`
- `POST /api/admin/users/{id}/reset-password`
- `GET /api/admin/password-reset-requests`
- `POST /api/admin/password-reset-requests/{id}/resolve`

## 8. Backend: модуль аутентификации

Файлы:

- [`server/internal/auth/handler.go`](/Users/dim/vscodeproject/messenger/server/internal/auth/handler.go)
- [`server/internal/auth/middleware.go`](/Users/dim/vscodeproject/messenger/server/internal/auth/middleware.go)

### 8.1 Регистрация

`POST /api/auth/register` принимает:

- `username`
- `displayName`
- `password`
- опционально публичные ключи Signal Protocol:
  - `ikPublic`
  - `spkId`
  - `spkPublic`
  - `spkSignature`
  - `opkPublics`

Что делает обработчик:

- валидирует обязательные поля;
- проверяет уникальность `username`;
- хеширует пароль через `bcrypt`;
- создаёт пользователя в `users`;
- если переданы публичные ключи, сохраняет их в `identity_keys` и `pre_keys`;
- сразу выдаёт access token и refresh cookie.

### 8.2 Логин

`POST /api/auth/login`:

- ищет пользователя по `username`;
- сравнивает пароль через `bcrypt.CompareHashAndPassword`;
- возвращает access token и refresh cookie.

### 8.3 Refresh

`POST /api/auth/refresh`:

- читает `refresh_token` из cookie;
- берёт SHA-256 hash от raw token;
- ищет запись в таблице `sessions`;
- проверяет срок действия;
- удаляет старую refresh-сессию;
- выдаёт новую пару access/refresh.

Это rotation-поведение, а не простое переиспользование refresh token.

### 8.4 Logout

`POST /api/auth/logout`:

- удаляет refresh-сессию по hash токена;
- очищает cookie;
- возвращает `204 No Content`.

### 8.5 Смена пароля

`POST /api/auth/change-password` (требует JWT):

- принимает `currentPassword`, `newPassword` (мин. 8 символов);
- верифицирует `currentPassword` через `bcrypt.CompareHashAndPassword`;
- при несовпадении — `403 Forbidden`;
- хеширует новый пароль;
- инвалидирует все refresh-сессии пользователя, кроме текущей (`DeleteUserSessionsExcept`);
- обновляет `password_hash` в `users`;
- возвращает `204 No Content`.

Клиент после успешной смены выполняет logout (принудительный выход).

### 8.6 JWT middleware

`auth.Middleware`:

- требует `Authorization: Bearer <token>`;
- валидирует HMAC JWT;
- извлекает `sub` (userID) и `role`;
- кладёт `userID` и `role` в `request.Context`;
- `auth.RoleFromCtx(r)` — хелпер для получения роли (по умолчанию `"user"`).

JWT claims включают: `sub` (userID), `username`, `displayName`, `role`.

### 8.7 Регистрация (расширенные сценарии)

Поведение `POST /api/auth/register` зависит от `registrationMode`:

- **open** — свободная регистрация, invite code не нужен.
- **invite** — обязателен `inviteCode`; проверяется: существование, не использован, не просрочен; после создания пользователя code помечается как `used_by`.
- **approval** — регистрация прямым POST запрещена (403); нужно сначала подать заявку через `POST /api/auth/request-register`.

### 8.8 Запрос на регистрацию

`POST /api/auth/request-register` (режим approval):

- принимает `username`, `displayName`, `password`;
- хеширует пароль, сохраняет заявку со статусом `pending`;
- возвращает `201 Created`;
- admin одобряет или отклоняет через admin API.

### 8.9 Сброс пароля

`POST /api/auth/password-reset-request`:

- принимает `username`;
- создаёт запись в `password_reset_requests` со статусом `pending`;
- **всегда** возвращает `200 OK` независимо от существования пользователя (no user enumeration);
- admin устанавливает временный пароль через `POST /api/admin/users/{id}/reset-password` и сообщает его пользователю out-of-band.

## 8a. Backend: модуль администрирования

Файлы:
- `server/internal/admin/middleware.go` — `RequireAdmin`
- `server/internal/admin/handler.go` — 9 handler'ов

### Сквозной сценарий: регистрация через заявку (approval mode)

```
Пользователь                  Сервер                     Администратор
     │                           │                              │
     │  POST /auth/request-register                             │
     │  {username, displayName, password}                       │
     │──────────────────────────►│                              │
     │  201 Created              │                              │
     │◄──────────────────────────│                              │
     │  (ключи сохранены в IDB)  │                              │
     │                           │  GET /admin/registration-requests
     │                           │◄─────────────────────────────│
     │                           │  [{id, username, status: "pending"}]
     │                           │──────────────────────────────►│
     │                           │                              │
     │                           │  POST /admin/registration-requests/{id}/approve
     │                           │◄─────────────────────────────│
     │                           │  (создаёт users запись)      │
     │                           │  200 OK                      │
     │                           │──────────────────────────────►│
     │                           │                              │
     │  POST /auth/login         │                              │
     │  {username, password}     │                              │
     │──────────────────────────►│                              │
     │  200 {accessToken, role}  │                              │
     │◄──────────────────────────│                              │
```

### 8a.1 RequireAdmin

Проверяет роль из `auth.RoleFromCtx(r)`. Если не `"admin"` → `403 {"error": "forbidden"}`.

### 8a.2 Управление заявками на регистрацию

- `GET /api/admin/registration-requests` — список всех заявок.
- `POST /api/admin/registration-requests/{id}/approve` — одобрить: проверить уникальность username (409 при конфликте), создать пользователя с `role=user`, обновить статус заявки на `approved`.
- `POST /api/admin/registration-requests/{id}/reject` — обновить статус заявки на `rejected`.

### 8a.3 Инвайт-коды

- `POST /api/admin/invite-codes` — создать код (8-символьный префикс UUID); опциональный `expires_at`.
- `GET /api/admin/invite-codes` — список всех кодов с полями `id`, `createdBy`, `usedBy`, `expiresAt`.

### 8a.4 Управление пользователями

- `GET /api/admin/users` — список пользователей (id, username, displayName, role, createdAt).
- `POST /api/admin/users/{id}/reset-password` — принимает `temp_password`, обновляет хеш; admin сам сообщает пользователю временный пароль out-of-band.

### 8a.5 Запросы сброса пароля

- `GET /api/admin/password-reset-requests` — список запросов со статусом `pending`.
- `POST /api/admin/password-reset-requests/{id}/resolve` — закрыть запрос (установить `status=resolved`).

## 9. Backend: модуль чатов и сообщений

Файл: [`server/internal/chat/handler.go`](/Users/dim/vscodeproject/messenger/server/internal/chat/handler.go)

### 9.1 Получение списка чатов

`GET /api/chats`:

- получает все разговоры пользователя;
- для каждого чата получает участников;
- для direct-чата вычисляет имя второго участника, если имя чата не задано;
- возвращает массив `ChatDTO`.

Ответ содержит:

- `id`
- `type`
- `name`
- `avatarPath`
- `members`
- `unreadCount`
- `updatedAt`
- `lastMessageText`
- `lastMessageTs`

Серверная агрегация выполняется через таблицу `chat_user_state`.

### 9.2 Создание чата

`POST /api/chats`:

- поддерживает `type: direct | group`;
- автоматически добавляет текущего пользователя в состав участников;
- для `direct` проверяет, не существует ли уже чат с тем же собеседником;
- создаёт `conversations` и `conversation_members`.

Для direct-чата при повторном запросе может вернуть существующий чат с `200 OK`.

### 9.3 История сообщений

`GET /api/chats/{chatId}/messages?before=<ts>&limit=<n>`:

- проверяет членство пользователя в разговоре;
- поддерживает курсорную пагинацию через opaque string cursor (base64-encoded timestamp+id);
- возвращает только сообщения, адресованные текущему пользователю;
- не возвращает удалённые сообщения;
- отдаёт `nextCursor` как строку (`MessagesPage.nextCursor: string | undefined`).

### 9.4 Удаление сообщения

`DELETE /api/messages/{clientMsgId}`:

- находит все копии сообщения по `client_msg_id`;
- проверяет, что инициатор удаления является отправителем;
- soft-delete выполняется через `db.DeleteMessages`;
- отправляет в чат WebSocket-событие `message_deleted`.

### 9.5 Редактирование сообщения

`PATCH /api/messages/{clientMsgId}`:

- принимает массив `recipients` с новым ciphertext для каждого пользователя;
- проверяет авторство;
- обновляет шифртекст для каждой получательской копии;
- рассылает `message_edited` точечно каждому получателю.

Сервер не умеет пере-шифровывать сообщение сам и полагается на то, что клиент уже прислал новый шифртекст для каждого участника.

## 10. Backend: WebSocket Hub

Файл: [`server/internal/ws/hub.go`](/Users/dim/vscodeproject/messenger/server/internal/ws/hub.go)

### 10.1 Общая модель

Hub хранит `map[userID]set[*client]`, то есть несколько активных соединений на одного пользователя. Каждый `client` несёт:

- `userID string`
- `deviceID string` — ID из таблицы `devices`; пустая строка для старых клиентов без явного `?deviceId=`
- `conn *websocket.Conn`
- `send chan []byte`

Доступны два метода доставки:

- `Deliver(userID, payload)` — рассылает всем устройствам пользователя (broadcast)
- `DeliverToDevice(userID, deviceID, payload)` — доставляет только указанному устройству; если устройство офлайн — payload игнорируется

### 10.2 Аутентификация и идентификация устройства

`GET /ws?token=<JWT>&deviceId=<id>`:

- JWT читается из query string `token`; upgrade выполняется всегда;
- при невалидном токене соединение закрывается кодом `4001 unauthorized`;
- `deviceId` (опционально) читается из query string; сервер вызывает `GetDeviceByID` и проверяет, что `dev.UserID == userID` из JWT; при несоответствии `deviceID` игнорируется (обратная совместимость), соединение не разрывается.

Браузерский WebSocket API не позволяет передавать произвольные заголовки, поэтому query parameter является фактическим механизмом авторизации.

### 10.3 Поддерживаемые входящие события

Клиент может отправлять:

- `message` — новое сообщение
- `typing` — индикатор набора
- `read` — сообщение прочитано
- `skdm` — Sender Key Distribution Message (для групп)
- `call_offer` — SDP offer от инициатора звонка
- `call_answer` — SDP answer от принявшего звонок
- `ice_candidate` — ICE-кандидат (обе стороны)
- `call_end` — завершение звонка
- `call_reject` — отклонение входящего звонка

### 10.4 Обработка `message`

Входящий фрейм `message` содержит массив `recipients`, где каждый элемент:

```json
{ "userId": "...", "deviceId": "...", "ciphertext": "<base64>" }
```

`deviceId` в `recipient` может быть пустым (адресовать всем устройствам пользователя) или конкретным (адресовать одному устройству).

При получении `message`:

- проверяется членство отправителя в чате;
- для каждого элемента `recipients` создаётся отдельная строка в `messages` с полем `destination_device_id`;
- копия отправителя тоже сохраняется как отдельная запись;
- отправителю приходит `ack` с `clientMsgId`;
- если `recipient.DeviceID` задан — доставка через `DeliverToDevice`, иначе через `Deliver` (broadcast);
- исходящий WS-payload содержит `senderDeviceId` — ID устройства отправителя;
- если получатель online, сервер помечает сообщение как delivered;
- если получатель offline и это не self-copy, отправляется Web Push.

Модель хранения: одна логическая отправка порождает N строк `messages` (по одной на каждый элемент `recipients`), связанных через `client_msg_id`.

### 10.5 Обработка `typing`

Сервер рассылает событие `typing` всем участникам разговора, кроме отправителя.

### 10.6 Обработка `read`

При событии `read`:

- вызывается `db.MarkRead(messageID, now)`;
- событие `read` рассылается остальным участникам чата с полем `userId`;
- клиент обновляет статус сообщения и при совпадении `userId == currentUser` сбрасывает unread badge.

### 10.7 Обработка `skdm`

При событии `skdm`:

- сервер проверяет членство отправителя в указанном чате;
- SKDM-ciphertext доставляется точечно каждому из `recipients` по WebSocket;
- сервер не хранит SKDM — это транзитное событие.

### 10.8 Исходящие события сервера

Клиенту могут приходить:

- `message`
- `ack`
- `typing`
- `read`
- `message_deleted`
- `message_edited`
- `skdm`
- `prekey_low` (count < 10 — клиент должен пополнить OPK)
- `prekey_request` (устарел, заменён `prekey_low`)
- `call_offer`, `call_answer`, `ice_candidate`, `call_end`, `call_reject`, `call_busy` — транзитная сигнализация звонков
- `error`

Поля события `message` (исходящее):

| Поле | Описание |
|---|---|
| `type` | `"message"` |
| `messageId` | серверный UUID (для копии отправителя — `clientMsgId`) |
| `clientMsgId` | UUID, назначенный клиентом-отправителем |
| `chatId` | ID разговора |
| `senderId` | userID отправителя |
| `senderDeviceId` | deviceID устройства отправителя (пустая строка если неизвестен) |
| `ciphertext` | зашифрованный payload (base64 или bytes) |
| `senderKeyId` | ID sender key для групп |
| `timestamp` | unix ms |

## 11. Backend: модуль ключей E2E

Файл: [`server/internal/keys/handler.go`](/Users/dim/vscodeproject/messenger/server/internal/keys/handler.go)

### 11.1 Получение key bundle

`GET /api/keys/{userId}`:

- вызывает `GetIdentityKeysByUserID` — получает все устройства пользователя;
- для каждого устройства атомарно извлекает один OPK через `PopPreKey(userID, deviceID)`;
- возвращает `{ "devices": [ ... ] }` — по одному объекту на активное устройство.

Структура одного элемента `devices`:

```json
{
  "deviceId":     "<uuid>",
  "ikPublic":     "<base64>",
  "spkId":        42,
  "spkPublic":    "<base64>",
  "spkSignature": "<base64>",
  "opkId":        7,        // только если OPK доступен
  "opkPublic":    "<base64>"
}
```

Если у пользователя нет зарегистрированных ключей — `404 Not Found`.

Это соответствует Signal-подходу (Signal-Server `GET /v2/keys/{identifier}/*`): инициатор X3DH получает bundles для всех устройств и создаёт отдельную сессию на каждое.

### 11.2 Регистрация устройства

`POST /api/keys/register`:

- принимает `deviceName`, `ikPublic`, `spkId`, `spkPublic`, `spkSignature`, `opkPublics`;
- идемпотентен: если `ikPublic` уже зарегистрирован для данного пользователя, переиспользует существующий `device_id`;
- создаёт или обновляет запись в `devices` (`last_seen_at` при повторных входах);
- сохраняет `identity_keys` с device_id;
- сохраняет OPK с привязкой к устройству через `InsertPreKeysForDevice`;
- возвращает `{"deviceId": "..."}`.

### 11.3 Загрузка новых prekeys

`POST /api/keys/prekeys`:

- принимает массив новых one-time prekeys;
- сохраняет их в таблицу `pre_keys`.

### 11.4 Низкий запас prekeys

`checkAndNotifyPrekeys(userID)` вызывается:
- при выдаче bundle (после `PopPreKey`);
- при WS-подключении (`ServeWS`).

Если количество свободных OPK < 10, клиенту отправляется `{"type":"prekey_low","count":N}`. Клиент реагирует генерацией 20 новых OPK и загрузкой через `POST /api/keys/prekeys`.

## 12. Backend: модуль пользователей

Файл: [`server/internal/users/handler.go`](/Users/dim/vscodeproject/messenger/server/internal/users/handler.go)

`GET /api/users/search?q=<query>`:

- минимальная длина запроса 2 символа;
- ищет по `username LIKE %query%`;
- исключает самого пользователя;
- возвращает максимум 20 результатов.

Поиск по `display_name` сейчас не реализован, несмотря на placeholder в UI.

## 13. Backend: модуль медиа

Файл: [`server/internal/media/handler.go`](/Users/dim/vscodeproject/messenger/server/internal/media/handler.go)

### 13.1 Upload

`POST /api/media/upload`:

- принимает multipart `file` (клиент загружает зашифрованный blob);
- опционально принимает `chat_id` для привязки к чату;
- ограничивает размер до 10 МБ;
- генерирует UUID `mediaId`;
- сохраняет файл под именем `{uuid}.bin`;
- создаёт запись в `media_objects` с `content_type = "application/octet-stream"` (всегда, независимо от содержимого — реальный MIME-тип хранится только в E2E-payload);
- возвращает `{ mediaId, originalName, contentType: "application/octet-stream" }`.

Клиент шифрует файл через `uploadEncryptedMedia()`: XSalsa20-Poly1305, nonce || ciphertext, случайный media key. Имя файла при загрузке — `'encrypted'`. Ключ встраивается в зашифрованный message payload. Реальный `contentType` (MIME-тип) передаётся в E2E payload и недоступен серверу.

Content sniffing (`http.DetectContentType`) намеренно убран — зашифрованные байты не несут смысловой информации о типе.

### 13.2 Serve

`GET /api/media/{mediaId}`:

- требует валидный JWT (Bearer token);
- проверяет доступ: загрузчик или участник чата, к которому привязан mediaId;
- защищён от path traversal;
- раздаёт zашифрованный blob.

Клиент скачивает ciphertext, расшифровывает локально через `fetchEncryptedMediaBlobUrl()` и создаёт `blob:` URL.

### 13.3 Привязка к чату

`PATCH /api/media/{mediaId}`:

- принимает `chat_id`;
- обновляет `conversation_id` в `media_objects`;
- необходимо если upload происходит до отправки сообщения (без `chat_id`).

## 14. Backend: модуль push-уведомлений

Файл: [`server/internal/push/handler.go`](/Users/dim/vscodeproject/messenger/server/internal/push/handler.go)

### 14.1 Получение публичного VAPID-ключа

`GET /api/push/vapid-public-key` возвращает публичный ключ для подписки в браузере.

### 14.2 Сохранение подписки

`POST /api/push/subscribe`:

- принимает `PushSubscriptionJSON`;
- декодирует `p256dh` и `auth`;
- сохраняет подписку в `push_subscriptions`.

### 14.3 Отправка уведомлений

`SendNotification`:

- получает все подписки пользователя;
- формирует `webpush.Subscription`;
- отправляет payload через `webpush-go`.

Серверный payload не содержит текста сообщения, только тип и `chatId`. Это соответствует приватному сценарию без утечки plaintext в push.

## 15. Backend: база данных

Файлы:

- [`server/db/schema.go`](/Users/dim/vscodeproject/messenger/server/db/schema.go)
- [`server/db/queries.go`](/Users/dim/vscodeproject/messenger/server/db/queries.go)

### 15.1 Особенности подключения

- SQLite открывается в WAL-режиме;
- включены `foreign_keys(ON)`;
- установлен `busy_timeout(5000)`;
- `db.SetMaxOpenConns(1)` из-за модели записи SQLite.

### 15.2 Таблицы

#### `users`

- `id`
- `username`
- `display_name`
- `password_hash`
- `created_at`
- `role` (`user` | `admin`, DEFAULT `user`)

#### `sessions`

Хранит refresh-сессии:

- `id`
- `user_id`
- `token_hash`
- `expires_at`

#### `contacts`

Есть в схеме и query-слое, но в текущем HTTP API не используется.

#### `conversations`

- `id`
- `type` (`direct` или `group`)
- `name`
- `created_at`

#### `conversation_members`

Связь разговоров и участников.

#### `messages`

Основные поля:

- `id`
- `client_msg_id`
- `conversation_id`
- `sender_id`
- `recipient_id`
- `destination_device_id` — пустая строка = доставить всем устройствам (обратная совместимость); непустая = адресована конкретному устройству
- `ciphertext`
- `sender_key_id`
- `is_deleted`
- `edited_at`
- `created_at`
- `delivered_at`
- `read_at`

Смысл модели:

- одна логическая отправка может иметь несколько строк;
- общая связь между копиями строится через `client_msg_id`;
- каждая строка привязана к конкретному `recipient_id` (пользователь) и `destination_device_id` (устройство).

#### `devices`

Зарегистрированные устройства пользователей:

- `id` — UUID устройства
- `user_id`
- `device_name`
- `created_at`
- `last_seen_at`

#### `identity_keys`

Публичные ключи устройства — composite PK `(user_id, device_id)`:

- `user_id`
- `device_id`
- `ik_public`
- `spk_public`
- `spk_signature`
- `spk_id`
- `updated_at`

#### `pre_keys`

One-time prekeys с привязкой к устройству:

- `id`
- `user_id`
- `device_id`
- `key_public`
- `used`

#### `media_objects`

- `id` (mediaId, UUID)
- `uploader_id`
- `conversation_id` (может быть NULL до привязки)
- `storage_path`
- `content_type`
- `size_bytes`
- `created_at`

#### `chat_user_state`

Состояние чата на пользователя:

- `conversation_id`
- `user_id`
- `last_read_message_id`
- `unread_count`

#### `push_subscriptions`

- `id`
- `user_id`
- `endpoint`
- `p256dh`
- `auth`

#### `invite_codes`

- `id` — 8-символьный префикс UUID
- `created_by` — user_id создателя
- `used_by` — user_id потребителя (NULL пока не использован)
- `expires_at` — unix ms, 0 = без срока

#### `registration_requests`

- `id`
- `username`
- `display_name`
- `password_hash`
- `status` (`pending` | `approved` | `rejected`)
- `created_at`

#### `password_reset_requests`

- `id`
- `user_id`
- `temp_password` — устанавливается admin'ом, пустая строка изначально
- `status` (`pending` | `resolved`)
- `created_at`

### 15.3 Индексы и миграции

Схема содержит индекс по истории сообщений:

- `idx_messages_conv_time` на `(conversation_id, created_at DESC)`

Versioned migration runner (`server/db/migrate.go`) применяет все непримененные миграции при старте. Статус отслеживается в таблице `schema_migrations`. Поддерживаются однострочные и многошаговые миграции (`Steps []string` для DDL из нескольких операторов в одной транзакции).

Список миграций:
1. `messages.client_msg_id`
2. `messages.recipient_id`
3. `messages.is_deleted`
4. `messages.edited_at`
5. `identity_keys.device_id`
6. `pre_keys.device_id`
7. пересоздание `identity_keys` с composite PK `(user_id, device_id)`
8. `messages.destination_device_id TEXT NOT NULL DEFAULT ''`
9. `users.role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin'))`
10. создание таблицы `invite_codes`
11. создание таблицы `registration_requests`
12. создание таблицы `password_reset_requests`
13. индексы `idx_registration_requests_status`, `idx_password_reset_requests_status`

## 16. Frontend: архитектура приложения

### 16.1 Bootstrap

Файлы:

- [`client/src/main.tsx`](/Users/dim/vscodeproject/messenger/client/src/main.tsx)
- [`client/src/App.tsx`](/Users/dim/vscodeproject/messenger/client/src/App.tsx)

Приложение:

- монтируется в React root;
- использует `BrowserRouter`;
- при наличии авторизации подключает глобальный `useMessengerWS` и `useOfflineSync`;
- рендерит `<OfflineIndicator />` глобально поверх всех маршрутов.

### 16.2 Роутинг

- `/setup` — выбор и валидация URL сервера (если `serverUrl` не сохранён в localStorage)
- `/auth` — логин / регистрация / request-register / forgot-password
- `/` — список чатов
- `/chat/:chatId` — окно переписки
- `/profile` — профиль пользователя
- `/admin` — панель администратора (только для role === 'admin')

Неавторизованный пользователь всегда редиректится на `/auth`. Если serverUrl не установлен — редирект на `/setup`.

### 16.3 Multi-server client

Файл: `client/src/config/serverConfig.ts`

Клиент поддерживает подключение к произвольному серверу через динамический BASE URL:

- `getServerUrl()` — читает URL из localStorage (или `''` если не установлен)
- `setServerUrl(url)` — сохраняет URL с валидацией через `new URL()` + проверкой `http:/https:` протокола; убирает trailing slash
- `clearServerUrl()` — удаляет из localStorage
- `hasServerUrl()` — проверяет наличие
- `initServerUrl()` — при отсутствии пробует установить `window.location.origin` (только при `http/https` схеме, игнорирует `null`/`file://`)

Все запросы в `client.ts` и URL WS-соединения используют `getServerUrl()` как база. При смене сервера (кнопка в Profile) выполняется: `api.logout()` → `clearServerUrl()` → `chatStore.reset()` → `wsStore.setSend(null)` → navigate(`/setup`).

## 16a. Frontend: страница выбора сервера (ServerSetupPage)

Файл: `client/src/pages/ServerSetupPage.tsx`

Отображается при первом запуске или после команды «Сменить сервер». Пользователь вводит URL сервера и подключается к нему.

**Шаги:**

1. Пользователь вводит URL (например `https://my-server.example.com`).
2. Нажимает «Подключиться» — клиент вызывает `GET /api/server/info` без JWT.
3. Если запрос успешен, отображается карточка сервера: название, описание, режим регистрации.
4. Пользователь нажимает «Продолжить» — URL сохраняется через `setServerUrl()`, редирект на `/auth`.
5. При ошибке соединения показывается сообщение об ошибке; URL не сохраняется.

**Сброс сервера** (из Profile): `api.logout()` → `clearServerUrl()` → `chatStore.reset()` → `wsStore.setSend(null)` → navigate(`/setup`). Чаты предыдущего сервера очищаются из памяти до входа на новый.

## 16b. Frontend: страница авторизации (AuthPage) — расширенные сценарии

Файл: `client/src/pages/AuthPage.tsx`

AuthPage поддерживает три вкладки: **Войти**, **Регистрация**, **Забыл пароль**.

При открытии страница загружает `GET /api/server/info` для определения `registrationMode` и соответствующей адаптации UI.

### Регистрация с инвайт-кодом (`registrationMode === 'invite'`)

1. Показывается дополнительное поле «Инвайт-код».
2. Код может быть предзаполнен из URL query param `?invite=<code>`.
3. При отправке форма передаёт `inviteCode` в `POST /api/auth/register`.
4. Если код отсутствует, неверен или просрочен — сервер возвращает `403`.

### Запрос на регистрацию (`registrationMode === 'approval'`)

1. Вкладка «Регистрация» показывает форму заявки: username, displayName, password.
2. При отправке выполняется `POST /api/auth/request-register`.
3. Клиент генерирует крипто-ключи (Identity Key, Signed PreKey, One-Time PreKeys), но **сохраняет их в IndexedDB только после** `201 Created` от сервера. Это предотвращает mismatch: если сервер откажет, ключей в IndexedDB не будет.
4. Пользователю показывается сообщение «Заявка отправлена. Ожидайте подтверждения администратора».
5. После одобрения администратором пользователь может войти обычным способом.

### Восстановление пароля

1. Пользователь переходит на вкладку «Забыл пароль» (ссылка на форме логина).
2. Вводит username, нажимает «Отправить запрос».
3. Клиент вызывает `POST /api/auth/password-reset-request`.
4. **Всегда** отображается сообщение «Запрос отправлен. Обратитесь к администратору» — вне зависимости от наличия пользователя в системе (no user enumeration, даже в catch).
5. Администратор видит запрос в панели, устанавливает временный пароль и сообщает его пользователю лично.

## 16c. Frontend: панель администратора (AdminPage)

Файл: `client/src/pages/AdminPage.tsx`

Доступна по маршруту `/admin` только для пользователей с `role === 'admin'`. Содержит 4 вкладки.

### Вкладка «Заявки»

Отображает список заявок на регистрацию со статусом `pending`.

Для каждой заявки:
- username, displayName, дата создания;
- кнопки **Одобрить** / **Отклонить**.

**Одобрить:** `POST /api/admin/registration-requests/{id}/approve`
- сервер проверяет уникальность username (409 при конфликте → показывается inline-ошибка);
- создаёт пользователя с `role=user`;
- помечает заявку как `approved`.

**Отклонить:** `POST /api/admin/registration-requests/{id}/reject` — помечает заявку как `rejected`.

После каждого действия список заявок обновляется автоматически.

### Вкладка «Пользователи»

Отображает всех пользователей: id, username, displayName, role, дата регистрации.

Кнопка **Сбросить пароль** — открывает inline-форму для ввода временного пароля.

`POST /api/admin/users/{id}/reset-password` с телом `{ "temp_password": "..." }`:
- обновляет `password_hash` в БД;
- admin сообщает временный пароль пользователю out-of-band (по телефону, email и т.п.);
- пользователь входит с временным паролем и должен сменить его.

### Вкладка «Инвайты»

Отображает список инвайт-кодов с полями: код, создан кем, использован кем, срок действия.

Кнопка **Создать** — `POST /api/admin/invite-codes` (опционально: `expires_at` в ms).

Созданный код администратор передаёт пользователю. Пользователь вводит его при регистрации.

### Вкладка «Сброс паролей»

Отображает список запросов сброса пароля со статусом `pending`: username (ищется по user_id), дата создания.

Кнопка **Закрыть** — `POST /api/admin/password-reset-requests/{id}/resolve`:
- помечает запрос как `resolved`;
- означает, что администратор уже передал временный пароль пользователю.

### Общие принципы AdminPage UI

- Переключение вкладки автоматически очищает `error` и `successMsg`.
- Все ошибки API показываются inline (без `alert()`).
- Успешные действия показывают inline-сообщение об успехе.
- Данные загружаются при монтировании и перезагружаются после каждой мутации.

## 17. Frontend: REST API клиент

Файл: [`client/src/api/client.ts`](/Users/dim/vscodeproject/messenger/client/src/api/client.ts)

### 17.1 Общая модель

Клиент использует единый helper `req<T>()`, который:

- строит URL как `${getServerUrl()}${path}` — BASE динамически читается из localStorage;
- автоматически подставляет `Authorization: Bearer <accessToken>`;
- отправляет `credentials: include` для refresh cookie;
- при `401` один раз выполняет silent refresh;
- повторяет исходный запрос после успешного refresh.

### 17.2 Поддерживаемые методы

API-клиент реализует методы:

- `register`
- `login`
- `refresh`
- `logout`
- `getKeyBundle`
- `uploadPreKeys`
- `getChats`
- `createChat`
- `getMessages`
- `uploadMedia` (нешифрованный, устарел)
- `uploadEncryptedMedia(file, chatId?)` — шифрует XSalsa20-Poly1305, загружает ciphertext, возвращает `{mediaId, mediaKey, originalName, contentType}`
- `fetchMediaBlobUrl(mediaId)` — загружает с JWT, возвращает кешированный object URL
- `fetchEncryptedMediaBlobUrl(mediaId, mediaKey, mimeType)` — скачивает, расшифровывает, кеширует blob URL
- `deleteMessage`
- `editMessage`
- `subscribePush`
- `searchUsers`
- `getServerInfo` — GET `/api/server/info`, без токена
- `requestRegister` — POST `/api/auth/request-register`
- `passwordResetRequest` — POST `/api/auth/password-reset-request`

## 18. Frontend: WebSocket клиент

Файл: [`client/src/api/websocket.ts`](/Users/dim/vscodeproject/messenger/client/src/api/websocket.ts)

`MessengerWS` поддерживает:

- подключение к `/ws?token=<JWT>`;
- автоматический reconnect с exponential backoff;
- распознавание auth failure через код `4001`;
- попытку refresh токена и повторное подключение;
- callbacks `onConnect`, `onDisconnect`, `onAuthFail`.

## 19. Frontend: Zustand stores

### 19.1 `authStore`

Файл: [`client/src/store/authStore.ts`](/Users/dim/vscodeproject/messenger/client/src/store/authStore.ts)

Хранит:

- `currentUser`
- `accessToken`
- `isAuthenticated`
- `role` (`'admin' | 'user' | null`) — устанавливается из ответа login; включён в `partialize` (persist)

Также реализует:

- `setSession` / `login` — устанавливает `accessToken`, `currentUser`, `role`
- `logout` — сбрасывает все поля включая `role`

### 19.2 `chatStore`

Файл: [`client/src/store/chatStore.ts`](/Users/dim/vscodeproject/messenger/client/src/store/chatStore.ts)

Хранит:

- `chats`
- `messages` как словарь `chatId -> Message[]`
- `typingUsers`

Операции:

- `setChats` — при вызове автоматически сохраняет список в IndexedDB через `saveChats()`
- `upsertChat` — при изменении `members` группового чата fire-and-forget вызывает `invalidateGroupSenderKey(chatId)`, чтобы следующая отправка создала новый SenderKey
- `addMessage`
- `prependMessages`
- `updateMessageStatus`
- `deleteMessage`
- `editMessage`
- `setTyping`
- `markRead`
- `reset()` — сбрасывает `chats: [], messages: {}` при смене сервера

Есть локальная дедупликация сообщений и optimistic update.

### 19.3 Offline-хранилище: `messageDb` и `outboxDb`

Файлы:

- [`client/src/store/messageDb.ts`](/Users/dim/vscodeproject/messenger/client/src/store/messageDb.ts)
- [`client/src/store/outboxDb.ts`](/Users/dim/vscodeproject/messenger/client/src/store/outboxDb.ts)

**`messageDb`** использует `idb-keyval` (IndexedDB `messenger-data/data`) для персистентности:

- `saveMessages(chatId, msgs)` / `loadMessages(chatId)` — полный массив сообщений на чат (до 200 последних);
- `appendMessages(chatId, newMsgs)` — дедуплицирующее добавление без перезаписи;
- `updateMessageStatusInDb(chatId, msgId, status)` — обновление статуса одного сообщения;
- `saveChats(chats)` / `loadChats()` — список чатов.

**`outboxDb`** хранит исходящие сообщения, которые не удалось отправить из-за offline:

- `OutboxItem` содержит `frame` (уже зашифрованный WSSendFrame), `optimisticMsg` и `enqueuedAt`;
- `enqueueOutbox` / `loadOutbox` / `removeFromOutbox` / `clearOutbox`.

### 19.3 `wsStore`

Файл: [`client/src/store/wsStore.ts`](/Users/dim/vscodeproject/messenger/client/src/store/wsStore.ts)

Назначение:

- хранить функцию отправки в текущий WebSocket transport;
- дать UI-компонентам доступ к `send` без прямой зависимости от экземпляра `MessengerWS`.

## 20. Frontend: страницы и UI-компоненты

### 20.1 `AuthPage`

Файл: [`client/src/pages/AuthPage.tsx`](/Users/dim/vscodeproject/messenger/client/src/pages/AuthPage.tsx)

Функции:

- логин и регистрация;
- генерация локальных identity keys;
- создание signed prekey и пачки one-time prekeys;
- отправка публичных ключей при регистрации;
- сохранение локальных приватных ключей в IndexedDB.

### 20.2 `ChatListPage` и `ChatList`

Файлы:

- [`client/src/pages/ChatListPage.tsx`](/Users/dim/vscodeproject/messenger/client/src/pages/ChatListPage.tsx)
- [`client/src/components/ChatList/ChatList.tsx`](/Users/dim/vscodeproject/messenger/client/src/components/ChatList/ChatList.tsx)

Функции:

- загрузка списка чатов;
- переход в чат;
- отображение времени последней активности;
- модалка создания нового чата.

### 20.3 `NewChatModal`

Файл: [`client/src/components/NewChatModal/NewChatModal.tsx`](/Users/dim/vscodeproject/messenger/client/src/components/NewChatModal/NewChatModal.tsx)

Поддерживает:

- прямой чат с одним пользователем;
- групповой чат;
- поиск пользователей с debounce;
- выбор нескольких участников;
- локальный `upsertChat` после создания.

### 20.4 `ChatWindowPage` и `ChatWindow`

Файлы:

- [`client/src/pages/ChatWindowPage.tsx`](/Users/dim/vscodeproject/messenger/client/src/pages/ChatWindowPage.tsx)
- [`client/src/components/ChatWindow/ChatWindow.tsx`](/Users/dim/vscodeproject/messenger/client/src/components/ChatWindow/ChatWindow.tsx)

Это центральный UI-модуль проекта. Он реализует:

- загрузку истории сообщений по курсору;
- optimistic sending;
- очередь отправки при отсутствии активного WS;
- вложения и предварительное превью изображений;
- редактирование собственных сообщений;
- удаление собственных сообщений;
- context menu;
- long press на мобильных устройствах;
- typing indicator;
- статус `sending/sent/delivered/read/failed`.

Особенности:

- сообщение шифруется отдельно для каждого получателя;
- для вложения формируется JSON payload с `mediaId`, `originalName`, `mediaType`, `text`;
- есть fallback на plain base64, если E2E-шифрование не удалось.

### 20.5 `ProfilePage` и `Profile`

Файлы:

- [`client/src/pages/ProfilePage.tsx`](/Users/dim/vscodeproject/messenger/client/src/pages/ProfilePage.tsx)
- [`client/src/components/Profile/Profile.tsx`](/Users/dim/vscodeproject/messenger/client/src/components/Profile/Profile.tsx)

Показывают:

- `displayName`
- `username`
- укороченный публичный identity key
- кнопку logout

## 21. Frontend: WebSocket orchestration

Файл: [`client/src/hooks/useMessengerWS.ts`](/Users/dim/vscodeproject/messenger/client/src/hooks/useMessengerWS.ts)

Хук:

- создаёт и жизненно циклично обслуживает `MessengerWS`;
- при входящих `message` определяет тип (direct/group) и вызывает `decryptMessage` или `decryptGroupMessage`;
- при `message_edited` расшифровывает новый ciphertext;
- при `message_deleted` удаляет сообщение из стора;
- при `typing` ставит typing state;
- при `ack` обновляет статус оптимистичного сообщения;
- при `read` обновляет статус сообщения; при `userId == currentUser` сбрасывает unread badge;
- при `skdm` вызывает `handleIncomingSKDM` — сохраняет SenderKey участника;
- при `prekey_low` вызывает `replenishPreKeys()` — генерирует 20 новых OPK и загружает на сервер.

Также хук:

- при необходимости дозагружает список чатов, если сообщение пришло в неизвестный чат;
- выполняет logout при безуспешном refresh WebSocket-токена;
- при расшифровке входящего сообщения вызывает `appendMessages(chatId, [msg])` — сохраняет в IndexedDB для offline-доступа.

## 21.2 `useOfflineSync`

Файл: [`client/src/hooks/useOfflineSync.ts`](/Users/dim/vscodeproject/messenger/client/src/hooks/useOfflineSync.ts)

Хук отслеживает смену `wsSend` с `null` на функцию (WS только что подключился). При восстановлении соединения:

- загружает очередь из `outboxDb`;
- отправляет каждый кешированный фрейм через `wsSend`;
- при успешной отправке удаляет элемент из очереди и обновляет статус сообщения.

## 21.3 `useNetworkStatus`

Файл: [`client/src/hooks/useNetworkStatus.ts`](/Users/dim/vscodeproject/messenger/client/src/hooks/useNetworkStatus.ts)

Возвращает `{ isOnline: boolean }`. Слушает `window` события `online`/`offline` и инициализируется из `navigator.onLine`.

## 22. Frontend: push-уведомления

### 22.1 Hook

Файл: [`client/src/hooks/usePushNotifications.ts`](/Users/dim/vscodeproject/messenger/client/src/hooks/usePushNotifications.ts)

Логика:

- проверка `serviceWorker` и `PushManager`;
- запрос разрешения у пользователя;
- получение публичного VAPID-ключа;
- подписка через `registration.pushManager.subscribe`;
- отправка подписки на сервер через `api.subscribePush`.

### 22.2 Service Worker

Файл: [`client/public/push-handler.js`](/Users/dim/vscodeproject/messenger/client/public/push-handler.js)

Поддерживает:

- показ системных уведомлений;
- переход в приложение по клику;
- обработку `pushsubscriptionchange`.

Важно: в `pushsubscriptionchange` fetch на `/api/push/subscribe` не добавляет `Authorization` header. Так как этот маршрут защищён JWT middleware, автоматическое переподключение подписки может не сработать в текущем виде без дополнительной серверной или клиентской логики.

## 23. Frontend: криптография и локальное хранилище

### 23.1 `keystore.ts`

Файл: [`client/src/crypto/keystore.ts`](/Users/dim/vscodeproject/messenger/client/src/crypto/keystore.ts)

Через `idb-keyval` в IndexedDB сохраняются:

- identity key pair (`identity_key`);
- signed prekey (`signed_prekey`);
- one-time prekeys (`one_time_prekeys` — массив, `appendOneTimePreKeys` добавляет без перезаписи);
- ratchet session state (`ratchet:{chatId}`);
- my SenderKey для группы (`my_sender_key:{chatId}`);
- peer SenderKey от участника (`peer_sender_key:{chatId}:{senderId}`);
- device ID (`device_id`);
- push subscription;
- время последнего replenish prekeys (`prekey_replenish_ts`) — cooldown 5 минут.

Дополнительные функции:
- `deleteMySenderKey(chatId)` — удаляет `my_sender_key:{chatId}` (вызывается при смене состава группы);
- `isPreKeyReplenishOnCooldown()` / `savePreKeyReplenishTime()` — защита от слишком частого пополнения OPK при `prekey_low`.

### 23.2 `x3dh.ts`

Файл: [`client/src/crypto/x3dh.ts`](/Users/dim/vscodeproject/messenger/client/src/crypto/x3dh.ts)

Реализует:

- инициализацию `libsodium`;
- генерацию DH key pairs;
- derivation shared secret для initiator/responder;
- base64 helpers;
- X3DH handshake primitives.

### 23.3 `ratchet.ts`

Файл: [`client/src/crypto/ratchet.ts`](/Users/dim/vscodeproject/messenger/client/src/crypto/ratchet.ts)

Реализует полный Double Ratchet по спецификации Signal:

- symmetric ratchet (chain key → message key derivation через HMAC-SHA256);
- DH ratchet при смене ключей (два шага: recv chain + send chain);
- `initRatchet` следует Signal spec: Alice (initiator) выполняет `DH(aliceKey, bobKey) + KDF` для `sendChainKey`; Bob (responder) стартует с `dhRemotePublic=null` — первое сообщение Alice триггернёт DH ratchet, который даёт Bob и recv, и sendChainKey;
- кэш skipped message keys: `SkippedKeyEntry { key: string, storedAt: number }`, лимит `MAX_SKIP=100`, TTL 7 дней (`purgeExpiredSkippedKeys` вызывается при decrypt и сериализации);
- `prevSendCount` (pn) в заголовке для out-of-order доставки;
- `ratchetEncrypt` / `ratchetDecrypt` (при расшифровке сначала ищет skipped cache);
- сериализацию/десериализацию состояния для IndexedDB, backward-compat со старым форматом (строка → `{ key, storedAt }`).

### 23.4 `session.ts`

Файл: [`client/src/crypto/session.ts`](/Users/dim/vscodeproject/messenger/client/src/crypto/session.ts)

Orchestration-слой над X3DH, Double Ratchet и Sender Keys:

- `encryptMessage(chatId, recipientId, plaintext)` — direct E2E через X3DH+Ratchet;
- `decryptMessage(chatId, senderId, ciphertext)` — direct E2E decrypt;
- `encryptGroupMessage(chatId, myUserId, members, plaintext)` — lazy SKDM при первом сообщении, затем SenderKey encrypt;
- `decryptGroupMessage(chatId, senderId, ciphertext)` — SenderKey decrypt;
- `handleIncomingSKDM(chatId, senderId, ciphertext)` — расшифровывает SKDM через E2E сессию, сохраняет peer SenderKey;
- `tryDecryptPreview(chatId, senderId, ciphertext)` — безопасный декрипт для превью (`lastMessage`): перехватывает ошибки, возвращает `'Зашифрованное сообщение'` при неудаче, `'📎 Вложение'` для медиа;
- `invalidateGroupSenderKey(chatId)` — удаляет собственный SenderKey из IndexedDB; вызывается из `chatStore.upsertChat` при изменении состава группы, чтобы следующая отправка создала новый SenderKey и разослала SKDM.

Wire payload для direct-сообщений кодируется как `base64(JSON)` и содержит:

- `v` (версия)
- `ek` (ephemeral key, для первого сообщения)
- `opkId` (использованный OPK)
- `ikPub` (public identity key)
- `msg` (Double Ratchet ciphertext)

Wire payload для групп — `base64(JSON)` с полем `type: "group"`.

### 23.5 `senderkey.ts`

Файл: [`client/src/crypto/senderkey.ts`](/Users/dim/vscodeproject/messenger/client/src/crypto/senderkey.ts)

Реализует Sender Key Protocol для групп:

- `generateSenderKey()` — chain key + Ed25519 signing keypair;
- `senderKeyEncrypt(state, plaintext)` — AES-CBC + HMAC, продвигает chain;
- `senderKeyDecrypt(state, payload)` — с поддержкой skipped iteration cache;
- `createSKDistribution(state)` — создаёт SKDM для передачи участникам;
- `importSKDistribution(encoded)` — импортирует SKDM от другого участника;
- сериализация/десериализация для IndexedDB.

## 24. PWA и сборка клиента

Файл: [`client/vite.config.ts`](/Users/dim/vscodeproject/messenger/client/vite.config.ts)

### 24.1 Особенности конфигурации

- alias `@ -> src`
- кастомный resolver для `libsodium-wrappers`, который принудительно ведёт на CJS-сборку
- `VitePWA` с `generateSW`
- `registerType: autoUpdate`

### 24.2 Runtime caching

Настроено кэширование:

- `/api/*` через `NetworkFirst` с `networkTimeoutSeconds: 5` — при плохой сети быстро переходит на кэш
- `/media/*` через `CacheFirst`

### 24.3 Dev proxy

В dev-режиме клиент проксирует:

- `/api` -> `http://localhost:8080`
- `/ws` -> `ws://localhost:8080`
- `/media` -> `http://localhost:8080`

Фактический dev-порт в конфиге: `3000`.

Это расходится с частью документации, где ещё указан `5173`.

## 25. Типы обмена данными

Файл: [`client/src/types/index.ts`](/Users/dim/vscodeproject/messenger/client/src/types/index.ts)

Ключевые типы:

- `User`
- `Chat`
- `Message`
- `PublicKeyBundle`
- `WSFrame`
- `WSSendFrame`

Сервер и клиент используют разные DTO-слои:

- на сервере Go-структуры;
- на клиенте TypeScript-модели;
- при этом часть полей клиент поддерживает локально, даже если сервер пока их не заполняет.

## 26. Запуск и режимы эксплуатации

### 26.1 Backend

```bash
cd server
go build -o ./bin/messenger ./cmd/server
JWT_SECRET=your-secret ./bin/messenger
```

### 26.2 Frontend dev

```bash
cd client
npm install
npm run dev
```

### 26.3 Single-binary режим

Судя по `README.md`, предполагается:

1. собрать клиент;
2. положить `client/dist` в `server/static`;
3. пересобрать backend;
4. раздавать UI и API одним Go-бинарником.

## 27. Что реализовано хорошо уже сейчас

- простая и рабочая self-hosted модель;
- единая кодовая база для API, WS и встроенной раздачи клиента;
- ротация refresh token;
- отдельный криптографический слой на клиенте;
- offline push без plaintext-содержимого;
- локальное IndexedDB-хранилище ключей, ratchet state, истории сообщений и списка чатов;
- персистентная outbox-очередь исходящих с автоматической повторной отправкой;
- UI-индикация offline-состояния через `OfflineIndicator`;
- MVP-поддержка direct и group chat;
- UI поддерживает редактирование, удаление, вложения и optimistic sending.

## 28. Расхождения со спецификацией и ограничения текущей реализации

Ниже перечислены актуальные расхождения между кодом и ожидаемой целевой архитектурой. Закрытые пункты из этапов 1–5 убраны.

### 28.1 Device model (частично закрыт, архитектурный долг остаётся)

Заложен фундамент multi-device (этапы 3, 7):

- `devices` таблица существует;
- `identity_keys` получила composite PK `(user_id, device_id)` через migration #7;
- `UpsertIdentityKey` использует `ON CONFLICT(user_id, device_id)`;
- `PopPreKey(userID, deviceID)` фильтрует OPK по конкретному устройству;
- `POST /api/keys/register` идемпотентен: повторный вызов с тем же `ikPublic` возвращает существующий `device_id`.

Остаётся:

- `GET /api/keys/:userId` возвращает только первое устройство пользователя (нет GET bundle всех устройств);
- на клиенте нет per-device ratchet state (один ratchet на `chatId`);
- WS Hub не различает соединения по `device_id`.

### 28.2 ~~Sender Key ротация при смене состава группы~~ ✅ Закрыто (этап 8)

`chatStore.upsertChat` сравнивает отсортированные списки `members`. При изменении — fire-and-forget вызов `invalidateGroupSenderKey(chatId)`, который удаляет SenderKey из IndexedDB. Следующая отправка создаст новый ключ и разошлёт SKDM актуальным участникам. Обратный сценарий (новый участник не получает старый SenderKey) обеспечивается самим фактом удаления ключа до следующей отправки.

### 28.3 Offline history ✅ Реализовано (этап 6)

IndexedDB persistence добавлен через `messageDb.ts` и `outboxDb.ts`. `ChatListPage` и `ChatWindow` применяют IDB-first стратегию: данные рендерятся из кэша до получения ответа сервера. `OfflineIndicator` отображает баннер при отрыве сети. Исходящие сообщения в offline сохраняются в outbox и автоматически отправляются при восстановлении соединения.

### 28.4 Поиск пользователей

UI пишет "Поиск по имени или username", но backend ищет только по `username`.

### 28.5 Push subscription refresh

Сценарий `pushsubscriptionchange` в Service Worker не сможет обновить подписку без JWT-контекста: маршрут `/api/push/subscribe` защищён middleware.

### 28.6 Контакты

Таблица `contacts` и query-функции существуют, но HTTP API для работы с контактами не реализован.

## 28.7 Аудио/видео звонки ✅ Реализованы (этап 9)

Реализованы звонки 1-на-1:

- WS-события сигнализации: `call_offer`, `call_answer`, `ice_candidate`, `call_end`, `call_reject`, `call_busy` — транзитная пересылка в Hub
- in-memory map активных звонков в Hub
- `RTCPeerConnection` на клиенте с STUN-конфигурацией (`STUN_URL` из env, по умолчанию Google STUN)
- UI входящего звонка (ringtone, принять/отклонить), UI активного звонка (камера, микрофон, завершить)
- TURN: временные credentials через `GET /api/calls/ice-servers` (JWT required); настраивается через `TURN_URL`, `TURN_SECRET`, `TURN_CREDENTIAL_TTL`
- `CallOverlay` вынесен вне auth-guard — overlay виден поверх всех маршрутов
- call domain state machine и notification lifecycle вынесены в `shared/native-core/calls/*`
- `callStore` теперь является adapter-store над shared snapshot, а не источником call business logic
- legacy bridge callbacks `_callFrameHandler` и `_initiateCall` удалены из `callStore`
- top-level ownership `call-controller` теперь сосредоточен в `App.tsx`, который напрямую связывает `useCallHandler`, `useMessengerWS` и `CallOverlay`
- `shared/native-core/calls/web/*` и `shared/native-core/websocket/web/*` используют собственные shared contracts для сигналинга и realtime моделей вместо `client/src/types`

Остаётся: групповые звонки требуют SFU (LiveKit) — отдельный тяжёлый сервис, не входит в текущий монолит.

## 29. Рекомендации по дальнейшему развитию

### 29.1 Приоритет 1 — Device model (частично закрыт)

Фундамент заложен: composite PK в `identity_keys`, `PopPreKey` по device, идемпотентный `POST /api/keys/register`. Остаётся: GET bundle всех устройств, per-device ratchet на клиенте.

### 29.2 ~~Приоритет 2 — Offline history~~ ✅ Закрыто в этапе 6

IndexedDB persistence реализован: `messageDb.ts` сохраняет историю и список чатов, `outboxDb.ts` хранит очередь исходящих, `useOfflineSync` сбрасывает очередь при reconnect, `OfflineIndicator` сигнализирует об offline-состоянии.

### 29.3 ~~Приоритет 3 — Sender Key ротация~~ ✅ Закрыто (этап 8)

Реализовано через `invalidateGroupSenderKey` в `session.ts` + триггер в `chatStore.upsertChat` при сравнении `members`. Следующая отправка автоматически создаёт новый SenderKey и рассылает SKDM.

### 29.4 ~~Тесты~~ ✅ Закрыто (этап 8)

Backend (Go): `auth` (register, login, refresh rotation, change-password, JWT middleware), `keys` (register idempotency, PopPreKey, bundle 404), `chat` (non-member 403, delete/edit authz), `db` (migrations idempotent, migration #7 composite PK), `ws` (invalid token → 4001, valid connect, broadcast delivery).

Frontend (Vitest): `ratchet.test.ts` (11 тестов: round-trip, out-of-order, MAX_SKIP, TTL, serialization), `x3dh.test.ts` (6: handshake с/без OPK, wrong keys), `api/client.test.ts` (9: auto-refresh, dedup parallel 401, skipAuth, 204, ApiError).

### 29.6 Аудио/видео звонки ✅ Закрыто (этап 9)

Звонки 1-на-1, STUN, TURN реализованы. Остаётся: групповые звонки (LiveKit SFU) как отдельный Docker-сервис.

### 29.5 ~~Эксплуатация~~ ✅ Закрыто

- ~~versioned migrations~~ ✅ — `server/db/migrate.go`, migration runner с `schema_migrations`;
- ~~deployment guide для Cloudflare Tunnel~~ ✅ — `docs/deployment.md`;
- ~~конфигурационный файл сервера~~ ✅ — `server/cmd/server/config.go` + `config.yaml.example`; приоритет env > yaml > defaults.

## 30. Итог

Проект уже представляет собой рабочий MVP self-hosted мессенджера с:

- JWT-аутентификацией;
- SQLite persistence;
- real-time доставкой через WebSocket;
- PWA-клиентом;
- локальным клиентским E2E-слоем;
- поддержкой медиа, редактирования и удаления сообщений;
- Web Push уведомлениями.

Этапы 1–8 плана `v1-gap-remediation.md` закрыты. Реализованы:

- security headers, rate limiting, bcrypt=12, SameSite=Strict, WS origin allowlist;
- mediaId, JWT-защищённый медиадоступ, client-side encrypted media at rest (MIME скрыт, всегда `application/octet-stream`);
- device entity, POST /api/keys/register (идемпотентный по IK pubkey);
- server-driven unreadCount/updatedAt, opaque cursor pagination, read receipt broadcast;
- skipped message keys (TTL 7 дней), prekey_low lifecycle (backoff 5 мин), Sender Keys для групп;
- IndexedDB persistence истории и чатов, offline outbox с auto-resend, OfflineIndicator;
- Sender Key ротация при изменении состава группы (`invalidateGroupSenderKey`);
- backend тесты (5 пакетов, Go), frontend тесты (26 тестов, Vitest);
- конфигурационный файл сервера (`config.yaml` + env-overrides, `gopkg.in/yaml.v3`);
- смена пароля с инвалидацией всех сессий (`POST /api/auth/change-password`);
- `initRatchet` следует Signal spec: Alice делает DH+KDF для sendChainKey, Bob ждёт первого входящего сообщения.

Незакрытые зоны:

- полноценный multi-device (GET bundle всех устройств, per-device ratchet на клиенте, WS hub по device_id).

С точки зрения разработки проект уже имеет хорошую основу: структура понятна, модули отделены, а ключевые пользовательские сценарии покрыты кодом.
