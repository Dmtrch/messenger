# Техническая документация Messenger

> Актуально на коммит `3c9b58d` (2026-04-27). Источник истины — код и `docs/docs-main-update-research.md`. При расхождениях приоритет у кода. Документ парный с `docs/main/architecture.md` (высокоуровневый обзор) и `docs/api-reference.md` (контракты).

---

## 1. Назначение документа и область применения

Справочник по реализации сервера, web-клиента, общего shared-слоя и native-приложений. Предназначен для:

- быстрого входа в репозиторий (что где лежит, как вызывается);
- ориентации по публичным API модулей, REST/WS-эндпоинтов, схеме БД;
- фиксации конфигурационных контрактов (ENV, YAML);
- фиксации известных ограничений и рисков.

Что **не** входит в документ:
- пошаговые user-сценарии (см. `docs/main/usersguid.md`);
- инструкции по деплою и подготовке окружения (см. `docs/main/deployment.md`);
- обоснование крипто-решений (см. `docs/crypto-rationale.md`);
- полные JSON-схемы запросов/ответов (см. `docs/api-reference.md` и `shared/protocol/`).

---

## 2. Сервер

### 2.1 Входная точка

- `server/cmd/server/main.go` — читает конфиг, открывает БД, запускает миграции, инициализирует `ws.Hub`, `sfu.Manager`, хендлеры, монтирует маршруты, поднимает HTTP(S). Маршрутная группа `/admin` монтирует server-side rendered панель администратора (`admin.UIHandler`) с сессионной аутентификацией (отдельно от JWT API).
- `server/cmd/server/config.go` — `Config` struct, загрузка YAML + env overrides, валидация обязательных параметров.
- `server/cmd/server/calls.go` — `iceServersHandler` (HMAC-подписанные TURN-креды).
- `server/cmd/server/tls_test.go` — проверка, что TLS конфигурируется только на TLS 1.3.
- Статика встраивается директивой `//go:embed static`.

Middleware-цепочка запроса: `RequestLogger → Recoverer → Timeout(30s) → SecurityHeaders → CORS`. Rate limiters:

- `authLimiter` — 20 req/min per IP на `/api/auth/*`;
- `botLimiter` — 60 req/min per IP на `/api/bots/*`.

### 2.2 Модули `server/internal/*`

| Пакет | Зона ответственности | Ключевые файлы |
|---|---|---|
| `admin` | Инвайты, заявки на регистрацию, пользователи (suspend/ban/role), квоты, retention, broadcast, remote-wipe; server-side rendered admin web UI | `handler.go`, `middleware.go`, `handler_test.go`, `invite_test.go`, `ui_handler.go`, `session.go` |
| `auth` | Регистрация/login/logout, JWT + refresh rotation, смена пароля, device-link, `AccountStatusMiddleware` | `handler.go`, `middleware.go`, `lazy_rehash_test.go` |
| `bots` | Bots API: создание, webhook delivery (HMAC-SHA256, retry 1s/2s/4s), allowlist localhost/RFC-1918 | `handler.go`, `middleware.go`, `webhook.go` |
| `calls` | 1:1 и групповые звонки: REST `/calls/room/*`, `iceServersHandler` | `handler.go`, `handler_test.go` |
| `chat` | Чаты direct/group, сообщения, TTL, read markers, edit/delete (soft-delete) | `handler.go` |
| `clienterrors` | Приём client-side логов ошибок (`POST /api/client-errors`) | `handler.go` |
| `devices` | Список устройств, отвязка | `handler.go` |
| `downloads` | Manifest версий, отдача `.dmg/.deb/.msi/.apk`, `GET /api/version` | `handler.go` |
| `integration` | Интеграционные тесты auth/chat/invite — **без продакшн-кода** | `*_flow_test.go` |
| `keys` | X3DH bundles, загрузка OPK, регистрация устройства | `handler.go` |
| `logger` | Инициализация файлового логгера (lumberjack rotation) | `logger.go` |
| `media` | Upload/download/listing; orphan & retention cleaners | `handler.go`, `cleaner.go` |
| `middleware` | SecurityHeaders, RequestLogger, Recoverer, RateLimiter, CORS | `security.go`, `logging.go`, `ratelimit_test.go` |
| `monitoring` | CPU/RAM/Disk через `gopsutil`; snapshot + SSE-стрим для админа. `CollectStats()` экспортирована и используется в admin web UI | `handler.go` |
| `password` | bcrypt cost 12 + lazy rehash | `password.go`, `password_test.go` |
| `push` | Web Push (VAPID) + FCM legacy + APNs JWT | `handler.go` |
| `serverinfo` | Публичный `GET /api/server/info` (name, description, registration_mode, limits) | `handler.go` |
| `sfu` | Групповые звонки: `Room`, `participant`, track forwarding через `pion/webrtc` | `manager.go`, `sfu_test.go` |
| `storage` | Пустой пакет (зарезервирован), в `main.go` не импортируется | — |
| `users` | Поиск пользователей | `handler.go` |
| `ws` | WebSocket Hub, комнаты чатов, fan-out, signalling 1:1/SFU, presence | `hub.go`, `hub_test.go`, `hub_calls_test.go` |

---

## 3. Схема БД

### 3.1 Движок

- `modernc.org/sqlite` (pure-Go, без CGO).
- Pragmas: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, `SetMaxOpenConns(1)`.
- Точки входа: `server/db/schema.go` (`Open()`, constant `schema`), `queries.go` (CRUD), `migrate.go` (`RunMigrations`).

### 3.2 Таблицы (базовые, создаются в `schema.go`)

| Таблица | Назначение / ключевые поля |
|---|---|
| `users` | `id, username UNIQUE, display_name, password_hash, role ∈ {user,moderator,admin}, status ∈ {active,suspended,banned}, session_epoch, created_at` |
| `sessions` | `id, user_id → users, token_hash, expires_at` (refresh tokens) |
| `contacts` | `(user_id, contact_id)` |
| `conversations` | `id, type ∈ {direct,group}, name, created_at, default_ttl, max_members` |
| `conversation_members` | `(conversation_id, user_id)` |
| `messages` | `id, client_msg_id, conversation_id, sender_id, recipient_id, destination_device_id, ciphertext BLOB, sender_key_id, reply_to_id, is_deleted, edited_at, created_at, delivered_at, read_at, expires_at` |
| `push_subscriptions` | `id, user_id, endpoint, p256dh BLOB, auth BLOB` (Web Push) |
| `native_push_tokens` | FCM + APNs токены на устройство |
| `devices` | `id, user_id, device_name, created_at, last_seen_at` |
| `device_link_tokens` | QR-pairing, TTL 120s |
| `identity_keys` | `(user_id, device_id)` PK, `ik_public, spk_public, spk_signature, spk_id, updated_at` |
| `pre_keys` (OPK) | `id, user_id, device_id, key_public, used` |
| `chat_user_state` | `(conversation_id, user_id)` → `last_read_message_id, unread_count` |
| `media_objects` | `id, uploader_id, conversation_id, filename, original_name, content_type, size, client_msg_id, created_at` |
| `invite_codes` | `code, created_by, used_by, expires_at, revoked_at` |
| `invite_activations` | IP/UA/activated_at (журнал активаций) |
| `registration_requests` | `status ∈ {pending,approved,rejected}, reviewed_at, reviewed_by` |
| `password_reset_requests` | `status ∈ {pending,completed,rejected}, temp_password` |
| `user_quotas` | `user_id, quota_bytes, used_bytes` |
| `settings` | `key, value` (retention, max_group_members и т. п.) |
| `bots` | `id, name, owner_id, token_hash UNIQUE, webhook_url, active, created_at` |
| `schema_migrations` | `id, applied_at` (трекер версий) |

### 3.3 Миграции (`server/db/migrate.go`)

28 миграций под id 1…28. Применение — `RunMigrations(db)`: создаёт `schema_migrations`, применяет в транзакциях недоставленные записи, поддерживает `Steps []string` для multi-statement DDL; идемпотентно игнорирует `duplicate column name / no such table / already exists` и помечает миграцию как применённую.

Краткий реестр:

| id | Что делает |
|---:|---|
| 1 | `messages.client_msg_id` |
| 2 | `messages.recipient_id NOT NULL DEFAULT ''` |
| 3 | `messages.is_deleted` |
| 4 | `messages.edited_at` |
| 5 | `identity_keys.device_id` |
| 6 | `pre_keys.device_id` |
| 7 | Multi-step: пересборка PK identity_keys/pre_keys под `(user_id, device_id)` |
| 8 | `messages.destination_device_id` |
| 9 | `users.role` |
| 10 | `invite_codes` |
| 11 | `registration_requests` |
| 12 | `password_reset_requests` |
| 13 | Multi-step |
| 14 | `media_objects.client_msg_id` |
| 15 | `messages.reply_to_id` |
| 16 | `native_push_tokens` |
| 17 | `invite_codes.revoked_at` |
| 18 | Multi-step |
| 19 | `users.status CHECK(active/suspended/banned)` |
| 20 | `users.session_epoch` |
| 21 | `messages.expires_at` |
| 22 | `conversations.default_ttl` |
| 23 | `device_link_tokens` |
| 24 | `user_quotas` |
| 25 | `settings` |
| 26 | No-op (`SELECT 1`) |
| 27 | `conversations.max_members` |
| 28 | `bots` |

CLI-обёртка: `scripts/db-migrate.sh` (`--db`, `--dry-run`, `--version`, `--rollback N`; `TOTAL_MIGRATIONS=28`).

Вспомогательные функции `server/db/queries.go` (добавлены):

| Функция | Назначение |
|---|---|
| `HasAdminUser(db)` | Проверяет, есть ли хотя бы один пользователь с `role='admin'` (используется admin web UI для роутинга на `/admin/setup`) |
| `CountMessages(db)` | Возвращает общее количество строк в `messages` (дашборд admin UI) |
| `CountConversations(db)` | Возвращает общее количество чатов/групп в `conversations` (дашборд admin UI) |

---

## 4. REST API справочник

Префикс `/api`. Ниже — сгруппированный список. Контракт тел запроса/ответа — `docs/api-reference.md` + `shared/protocol/`.

### 4.1 Публичные (без JWT)

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/server/info` | Имя/описание/режим регистрации/лимиты |
| GET | `/api/version` | Текущая и минимальная версии клиента, changelog |
| POST | `/api/client-errors` | Приём логов ошибок |
| GET | `/api/push/vapid-public-key` | Публичный VAPID-ключ |

### 4.2 Auth (rate-limited, 20/min per IP)

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/api/auth/register` | Открытая регистрация или по инвайту |
| POST | `/api/auth/login` | Логин → JWT + refresh cookie |
| POST | `/api/auth/logout` | Инвалидация refresh |
| POST | `/api/auth/refresh` | Обновление access token |
| POST | `/api/auth/request-register` | Заявка на регистрацию (mode=approval) |
| POST | `/api/auth/password-reset-request` | Заявка админу на сброс пароля (no user enumeration) |
| POST | `/api/auth/device-link-activate` | Активация QR-токена нового устройства |

### 4.3 Authenticated (JWT + `AccountStatusMiddleware`)

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/api/auth/change-password` | Смена пароля |
| POST | `/api/auth/device-link-request` | Выдать QR-токен для нового устройства |
| GET / DELETE | `/api/devices`, `/api/devices/{deviceId}` | Список/отвязка устройств |
| GET | `/api/users/search` | Поиск пользователей по username |
| GET / POST | `/api/chats` | Список/создание чатов |
| GET | `/api/chats/{id}/messages` | История (opaque cursor) |
| POST | `/api/chats/{id}/read` | Отметить прочитанным |
| POST | `/api/chats/{id}/ttl` | TTL чата |
| POST | `/api/chats/{id}/members` | Добавить участников |
| GET | `/api/chats/{id}/media` | Список медиа чата |
| DELETE | `/api/messages/{clientMsgId}` | Удалить сообщение (soft) |
| PATCH | `/api/messages/{clientMsgId}` | Редактировать |
| GET | `/api/keys/{userId}` | X3DH bundle |
| POST | `/api/keys/prekeys` | Пополнить OPK |
| POST | `/api/keys/register` | Регистрация/обновление device key bundle |
| POST | `/api/push/subscribe` | Web Push подписка |
| POST | `/api/push/native/register` | FCM/APNs токен |
| POST | `/api/media/upload` | Upload ciphertext blob |
| GET | `/api/media/{id}` | Download ciphertext blob |
| GET | `/api/calls/ice-servers` | STUN/TURN креды |
| POST | `/api/calls/room` | Создать SFU-комнату |
| DELETE | `/api/calls/room/{roomId}` | Закрыть |
| GET | `/api/calls/room/{roomId}/participants` | Список участников |
| POST | `/api/calls/room/{roomId}/join` | Присоединиться |
| POST | `/api/calls/room/{roomId}/leave` | Покинуть |
| GET | `/api/downloads/manifest` | Манифест native-артефактов |
| GET | `/api/downloads/{filename}` | Скачать native-артефакт |

### 4.4 Admin Web UI (`/admin/*`)

Server-side rendered панель на основе `admin.UIHandler`. Аутентификация — cookie-сессии (`admin.Store`), не JWT. Маршруты:

| Метод | Путь | Назначение |
|---|---|---|
| GET / POST | `/admin/setup` | Создание первого администратора (доступно только при отсутствии admin-пользователей в БД) |
| GET / POST | `/admin/login` | Вход в панель |
| GET | `/admin/logout` | Выход |
| GET | `/admin/` | Дашборд (метрики CPU/RAM/Disk, счётчики пользователей/сообщений/чатов) |
| POST | `/admin/ui/invites/create` | Создать инвайт-код |
| POST | `/admin/ui/invites/{code}/revoke` | Отозвать инвайт-код |
| POST | `/admin/ui/users/{id}/reset-password` | Сбросить пароль пользователя |
| POST | `/admin/ui/users/{id}/delete` | Удалить пользователя |
| POST | `/admin/ui/users/{id}/ban` | Заблокировать |
| POST | `/admin/ui/users/{id}/unban` | Разблокировать |
| POST | `/admin/ui/requests/{id}/approve` | Одобрить заявку на регистрацию |
| POST | `/admin/ui/requests/{id}/reject` | Отклонить заявку |
| GET / POST | `/admin/ui/settings` | Настройки сервера |

Все маршруты кроме `/setup` и `/login` требуют сессии (`admin.RequireUIAuth`).

### 4.5 Admin REST (JWT + `RequireAdmin`)

| Метод | Путь |
|---|---|
| GET / POST | `/api/admin/registration-requests`, `/{id}/approve`, `/{id}/reject` |
| GET / POST | `/api/admin/invite-codes`, DELETE `/{code}`, GET `/{code}/activations` |
| GET | `/api/admin/users` |
| POST | `/api/admin/users/{id}/reset-password`, `/suspend`, `/unsuspend`, `/ban`, `/revoke-sessions`, `/remote-wipe` |
| GET / PUT | `/api/admin/users/{id}/quota` |
| PUT | `/api/admin/users/{id}/role` |
| GET / PUT | `/api/admin/settings/retention`, `/api/admin/settings/max-group-members` |
| GET | `/api/admin/password-reset-requests` |
| POST | `/api/admin/password-reset-requests/{id}/resolve` |
| GET | `/api/admin/system/stats`, `/api/admin/system/stream` (SSE) |

### 4.6 Bots

Создание/редактирование — через admin-эндпоинты; отправка сообщений ботом — bot-token middleware. Webhook-доставка идёт от сервера к URL бота, `X-Messenger-Signature: HMAC-SHA256(body, bot_secret)`, timeout 5s, retry 1s→2s→4s, URL-allowlist localhost/RFC-1918.

### 4.7 Static

- `GET /assets/*` — embedded (`//go:embed static`).
- `GET /*` — SPA fallback на `index.html`.

---

## 5. WebSocket

Соединение: `GET /ws?token=<JWT>` (или `Authorization: Bearer ...`). Реализация: `server/internal/ws/hub.go`.

### 5.1 Клиент → сервер (типы фреймов)

| Тип | Назначение |
|---|---|
| `message` | Отправка сообщения в чат. Тело включает `chatId` и список `recipients:[{userId, deviceId, ciphertext}]` |
| `skdm` | Sender Key Distribution Message (рассылка SenderKey внутри группы) |
| `typing` | Индикатор набора |
| `read` | Read marker (`chatId, messageId`) |
| `call_offer` | SDP offer 1:1 |
| `call_answer` | SDP answer 1:1 |
| `call_end` / `call_reject` / `call_busy` | Завершение/отказ/занято |
| `ice_candidate` | ICE-кандидат |
| `group-call.*` | Сигнализация для SFU (`join`, `leave`, `offer`, `answer`, `ice`) |

Маршрутизация в `hub.go`: `switch msg.Type`. Полный свод входящих веток — `server/internal/ws/hub.go:372…`.

### 5.2 Сервер → клиент

| Тип | Когда |
|---|---|
| `message` | Входящее сообщение, `{chatId, messageId, clientMsgId, senderId, ciphertext, senderKeyId, timestamp}` |
| `ack` | Подтверждение, что сервер принял отправленное сообщение |
| `message_deleted` | `{chatId, clientMsgId}` |
| `message_edited` | `{chatId, clientMsgId, ciphertext, editedAt}` |
| `typing` | `{chatId, userId}` |
| `read` | `{chatId, messageId, userId}` |
| `skdm` | Входящий SKDM от участника группы |
| `prekey_low` | `{count}` — OPK < 10, пополнить через REST |
| `prekey_request` | Устаревший, оставлен для обратной совместимости |
| `call_*` | Транзитные signalling-события |
| `group-call.*` | SFU-сигналы |

### 5.3 Потоки

- Входящий message → хаб кладёт в БД (`messages`), fan-out участникам чата онлайн.
- 1:1 звонок: хаб транзитно пересылает `call_offer/answer/ice/end/reject/busy` между двумя клиентами, хранит минимальное in-memory состояние звонка.
- Групповой звонок: `group-call.*` проходит через `sfu.Manager` (см. §7).
- Presence: `devices.last_seen_at` обновляется в WS и части REST-эндпоинтов.

Тесты: `hub_test.go`, `hub_calls_test.go`.

---

## 6. Web-клиент (`client/`)

### 6.1 Стек

- React 18, TypeScript 5.5, Vite 8 (`vite@^8.0.9` в `package.json`).
- Zustand 4, React Router v6, `libsodium-wrappers` (+ `-sumo` для тестов).
- IndexedDB через `idb-keyval`.
- `vite-plugin-pwa` (generateSW, autoUpdate, 4 МБ лимит кэша, `importScripts: ['/push-sw.js']`).
- Тесты: Vitest + coverage v8 (threshold 60% lines/functions), Playwright (`npm run test:e2e`).
- Lint: ESLint, `--max-warnings 0`.
- Dev-proxy Vite: `/api`, `/ws`, `/media` → `http://localhost:8080`.
- Прочее: `qrcode.react`, `recharts`, `date-fns`, `clsx`.

### 6.2 Структура `client/src/`

- `api/` — `client.ts` (REST + encrypted media helpers), `websocket.ts`.
- `config/` — `serverConfig.ts` (multi-server URL), `version.ts`.
- `crypto/` — `x3dh.ts`, `session.ts`, `ratchet.ts`, `senderkey.ts`, `keystore.ts` (IndexedDB под vault).
- `store/` (Zustand + IndexedDB):
  - `authStore` — access token, role, current user.
  - `callStore` — состояние звонка, participants, peers.
  - `chatStore` — чаты, их метаданные; `reset()` при смене сервера.
  - `messageDb`, `outboxDb` — персистенция сообщений и отправленной очереди.
  - `serverInfoStore` — `/api/server/info` снапшот.
  - `vaultStore` — passphrase-gate, состояние vault.
  - `wsStore` — состояние WebSocket (через shared runtime).
- `hooks/`:
  - `useMessengerWS` — главный WS-жизненный цикл (использует `shared/native-core/websocket`).
  - `useCallHandler`, `useWebRTC` — обработка звонков через shared `call-controller`.
  - `useBrowserWSBindings` — привязка WS-платформы (timers, WebSocket fabric).
  - `useNetworkStatus`, `useOfflineSync` — offline-очередь.
  - `usePushNotifications` — подписка на Web Push.
- `components/` — `CallOverlay`, `ChatList`, `ChatWindow`, `GalleryModal`, `GroupCallView`, `LinkDevice`, `NewChatModal`, `OfflineIndicator`, `PassphraseGate`, `Profile`, `SafetyNumber`, `VoiceMessage`, `VoiceRecorder`.
- `pages/` — `AdminPage`, `AuthPage`, `ChatListPage`, `ChatWindowPage`, `DownloadsPage`, `LinkDevicePage`, `ProfilePage`, `ServerSetupPage`.
- `lib/logger.ts`, `styles/globals.css`, `types/index.ts`, `utils/ringtone.ts`.
- `public/push-handler.js` + `push-sw.js` — Service Worker.

### 6.3 Потоки web-клиента

- Старт: `initServerUrl` → `ServerSetupPage` (если URL не задан) → `AuthPage`.
- Разблокировка: `PassphraseGate` — до разблокировки vault UI чатов скрыт.
- WS: `useMessengerWS` подписывается через shared orchestrator; reconnect/backoff внутри `shared/native-core/websocket`.
- Offline: `outboxDb` буферизует исходящие, `useOfflineSync` переигрывает при возврате сети.
- Push: Service Worker реагирует на push-payload, показывает уведомление, открывает нужный чат.

---

## 7. Shared / native-core (`shared/native-core/`)

TypeScript-рантайм; source of truth для web и контрактная база для native.

### 7.1 Публичные подсистемы

| Подсистема | Ключевые модули | API (коротко) |
|---|---|---|
| `auth` | `session-runtime.ts` | `AuthSessionRuntime`: login, logout, refresh, token state, listeners |
| `api` | `web/browser-api-client.ts` | `BrowserApiClient`: fetch-обёртка для REST, авто-подстановка JWT, refresh on 401 |
| `websocket` | `connection-runtime.ts`, `web/*` | `ConnectionRuntime` + orchestrator: коннект, reconnect, ping, маршрутизация фреймов |
| `messages` | `message-repository.ts` | Персистенция сообщений и outbox |
| `crypto` | `aesGcm`, `cryptoVault`, `crypto-runtime`, `web-crypto-adapter`, `web/{ratchet-web, senderkey-web, session-web, x3dh-web, web-helpers}`, `seed-vectors`, `test-vector-runner` | X3DH/Double Ratchet/Sender Keys + AES-GCM vault + test-vectors runner |
| `storage` | `storage-runtime`, `web/{browser-keystore, encryptedStore, vaultMigration}` | Платформонезависимое key-value + шифрованное хранилище |
| `calls` | `call-controller`, `call-session`, `web/{browser-webrtc-platform, browser-webrtc-runtime, call-handler-orchestrator, call-ws-types}` | Управление звонками 1:1/групповыми, браузерный WebRTC-адаптер |
| `sync` | `sync-engine.ts` | Фоновая синхронизация сообщений |

Прочее: `index.ts` (публичные экспорты), `module.json`, `package.json`, `README.md`, `tsconfig(.build).json`.

### 7.2 Остальные пакеты `shared/`

- `shared/protocol/` — JSON-схемы REST, WS envelope, message payload.
- `shared/crypto-contracts/` — `aes-gcm-spec.md`, `interfaces.md`, `README.md`.
- `shared/domain/` — `auth-session.md`, `events.md`, `interfaces.md`, `models.md`, `repositories.md`, `sync-engine.md`, `websocket-lifecycle.md`.
- `shared/test-vectors/` — cross-platform векторы (Go/TS/Kotlin/Swift сверяются одним набором).

---

## 8. Native apps

### 8.1 Desktop (`apps/desktop/`)

- Kotlin + Compose Multiplatform Desktop.
- `build.gradle.kts`, `settings.gradle.kts`.
- `src/main/kotlin/Main.kt` — `application { Window { App() } }`.
- CI taskи: `packageDmg`, `packageDeb`, `packageMsi` (matrix: macOS arm64, macOS x86_64, Linux, Windows).
- Подпись опциональная: macOS (`MACOS_CERTIFICATE_BASE64/PASSWORD` + `MACOS_SIGNING_IDENTITY`), Windows (`WINDOWS_PFX_BASE64/PASSWORD` + `signtool`).

### 8.2 Android (`apps/mobile/android/`)

- Kotlin + Jetpack Compose + SQLDelight.
- Gradle: plugins — `android-application`, `kotlin-android`, `kotlin-compose`, `kotlin-serialization`, `sqldelight`.
- `compileSdk=35`, `minSdk=26`, `targetSdk=35`, `versionCode=1`, `versionName=1.0`, `jvmTarget=17`, `applicationId=com.messenger`.
- Ключевые зависимости: `compose-bom`, `compose-material3`, `ktor-client` (+ `okhttp`, `content-negotiation`, `auth`, `websockets`), `kotlinx-serialization-json`, `lazysodium-android`, `sqldelight-android-driver`, `kotlinx-coroutines`, `coil-compose`.
- CI job: `assembleRelease` при наличии keystore-secrets, иначе `assembleDebug`.
- Kotlin-исходники (ChatWindowScreen, MessageBubble, EncryptedMediaFetcher, AppState, ApiClient, ChatWindowViewModel, MessengerApp и др.) добавлялись планами `docs/superpowers/plans/2026-04-13-android-client.md` и `2026-04-14-android-file-transfer.md`. На baseline `60d7c93` точное дерево исходников **сверять через `git ls-tree`** — в отчёте снимка это отмечено как риск.

### 8.3 iOS (`apps/mobile/ios/`)

- SwiftUI + Swift Package Manager.
- `Package.swift` — манифест SPM.
- `Sources/Messenger/`: `App.swift` (SwiftUI entry + `AppDelegate` для APNs, WebRTC через `#if canImport(WebRTC)`), `BuildConfig.swift`, `UpdateCheckerService.swift`.
- `Sources/MessengerCrypto/`: `Ratchet.swift`, `SenderKey.swift`, `X3DH.swift`.
- Тесты: `Tests/MessengerTests/CryptoTests.swift` (`swift test`).
- CI job `build-ios-crypto`: только `swift build --product MessengerCrypto -c release`. Полноценный IPA требует Xcode-проекта и Apple signing — **в CI не собирается**.

---

## 9. Crypto-слой

### 9.1 X3DH

- `IK` (Ed25519, долговременная), `SPK` (X25519, подписан IK), `OPK` (X25519, одноразовые).
- Загрузка на сервер: `POST /api/keys/register` (ik, spk + signature) и `POST /api/keys/prekeys` (список OPK).
- Получение связки: `GET /api/keys/{userId}` — возвращает IK, SPK + signature, одиночный OPK (если есть). WS `prekey_low` сигнализирует клиенту пополнить OPK, когда запас падает.
- DH-комбинация: `DH1=DH(IK_A,SPK_B); DH2=DH(EK_A,IK_B); DH3=DH(EK_A,SPK_B); DH4=DH(EK_A,OPK_B)` → `SK=KDF(DH1||DH2||DH3||DH4)`.
- Реализации: `client/src/crypto/x3dh.ts` через `shared/native-core/crypto/web/x3dh-web.ts`; iOS — `Sources/MessengerCrypto/X3DH.swift`; Android — lazysodium-хелперы.

### 9.2 Double Ratchet

- Symmetric chain: fresh key per message (forward secrecy).
- DH-ratchet: ротация публичных ключей при получении нового raw-сообщения с другой стороны.
- Шифр сообщения: XSalsa20-Poly1305 (`crypto_secretbox`).
- Skipped message keys: `MAX_SKIP=100`, кэш пропущенных ключей для out-of-order.
- Реализации: `crypto/ratchet.ts` ↔ `shared/native-core/crypto/web/ratchet-web.ts`; iOS — `Ratchet.swift`.

### 9.3 Sender Keys (группы)

- Каждый участник держит собственный `SenderKey` (chain_key + signing pair).
- `SKDM` рассылается через X3DH/Double Ratchet 1:1 каждому участнику.
- Групповое сообщение: AES-CBC + HMAC под `SenderKey`; получатели расшифровывают одним ключом.
- Ротация при изменении состава группы — частично реализована (см. `docs/prd-alignment-progress.md`).
- Реализации: `crypto/senderkey.ts` ↔ `shared/native-core/crypto/web/senderkey-web.ts`; iOS — `SenderKey.swift`.

### 9.4 AES-GCM vault

- Локальный слой шифрования на устройстве: IK private, ratchet state, sender keys, кэш сообщений.
- Master-key выводится из passphrase (см. `shared/crypto-contracts/aes-gcm-spec.md`).
- Рантайм: `shared/native-core/crypto/cryptoVault.ts` + `storage/web/encryptedStore.ts`.
- Миграция со старых форматов хранения: `storage/web/vaultMigration.ts`.

### 9.5 Key storage

- Web: IndexedDB через `crypto/keystore.ts` поверх `encryptedStore` → AES-GCM vault.
- Native: lazysodium (Android) / swift-sodium (iOS) + локальная FS / GRDB.
- Cross-platform consistency проверяется через `shared/test-vectors/`.

---

## 10. Конфигурация ENV

Приоритет: `env > config.yaml > defaults`. Имя файла по умолчанию — `config.yaml` (задано в `main.go`).

### 10.1 Обязательные

| ENV | YAML key | Назначение |
|---|---|---|
| `JWT_SECRET` | `jwt_secret` | Подпись JWT. Пустое значение → `log.Fatal` |

### 10.2 Базовые

| ENV | YAML key | Дефолт | Назначение |
|---|---|---|---|
| `PORT` | `port` | `8080` | HTTP порт |
| `DB_PATH` | `db_path` | `./messenger.db` | SQLite файл |
| `MEDIA_DIR` | `media_dir` | `./media` | Каталог медиа |
| `DOWNLOADS_DIR` | `downloads_dir` | `./downloads` | Каталог native-артефактов |
| `SERVER_NAME` | `server_name` | `Messenger` | Публичное имя |
| `SERVER_DESCRIPTION` | `server_description` | — | Описание |
| `APP_VERSION` | `app_version` | `dev` | Версия сборки сервера |
| `MIN_CLIENT_VERSION` | `min_client_version` | `0.0.0` | Минимальная версия клиента |
| `APP_CHANGELOG` | `app_changelog` | — | Changelog для `/api/version` |

### 10.3 TLS / origins / proxy

| ENV | Дефолт | Назначение |
|---|---|---|
| `TLS_CERT`, `TLS_KEY` | — | Прямой TLS (только TLS 1.3) |
| `ALLOWED_ORIGIN` | — | CORS / WS `CheckOrigin` (список через запятую) |
| `BEHIND_PROXY` | `false` | Доверие `X-Forwarded-*`, HSTS, расчёт proto/ip |

### 10.4 Регистрация / админ

| ENV | Дефолт | Назначение |
|---|---|---|
| `REGISTRATION_MODE` | `open` | `open` / `invite` / `approval`. Невалидное → `log.Fatal` |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | — | Bootstrap админа при пустой БД |

### 10.5 Push

| ENV | Дефолт | Назначение |
|---|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | auto-gen | Web Push (⚠ при пустых генерируются разовые; подписки сломаются после рестарта) |
| `FCM_LEGACY_KEY` | — | FCM Server Key |
| `APNS_KEY_PATH`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` | — | APNs .p8 и метаданные |
| `APNS_SANDBOX` | `false` | Использовать APNs sandbox |

### 10.6 Звонки (STUN/TURN)

| ENV | Дефолт | Назначение |
|---|---|---|
| `STUN_URL` | `stun:stun.l.google.com:19302` | STUN |
| `TURN_URL` | — | TURN |
| `TURN_SECRET` | — | HMAC для временных TURN-creds |
| `TURN_CREDENTIAL_TTL` | `86400` | TTL выдаваемых TURN-creds, сек |

### 10.7 Группы / квоты

| ENV | Дефолт | Назначение |
|---|---|---|
| `MAX_GROUP_MEMBERS` | `50` | Максимум в группе (0 → дефолт) |
| `ALLOW_USERS_CREATE_GROUPS` | `true` | Разрешение создавать группы обычным пользователям |
| `MAX_UPLOAD_BYTES` | `100<<20` | Лимит одного upload (байт) |

Дополнительно `docker-compose.yml` пробрасывает `TUNNEL_TOKEN` для профиля `cloudflare`.

---

## 11. Запуск и тесты

### 11.1 Сервер

```bash
cd server
go run ./cmd/server                 # dev-запуск
make test                           # go test ./... -race
make coverage                       # coverage.out + HTML
make test-integration               # go test ./internal/integration/... -v -race
```

Миграции применяются автоматически при старте; ручной прогон — `scripts/db-migrate.sh`.

### 11.2 Web-клиент

```bash
cd client
npm install
npm run dev                         # Vite dev server (http://localhost:5173)
npm run build                       # tsc + Vite production build
npm run preview                     # локальный preview production-сборки
npm run type-check
npm run lint                        # --max-warnings 0
npm run test                        # Vitest (single run), 60% coverage
npm run test:watch
npm run test:e2e                    # Playwright
```

Dev-proxy Vite пробрасывает `/api`, `/ws`, `/media` на `http://localhost:8080`.

### 11.3 Native

```bash
# Desktop
cd apps/desktop && ./gradlew packageDmg   # или packageDeb / packageMsi / run

# Android
cd apps/mobile/android && ./gradlew assembleDebug

# iOS (только криптопакет в CI)
cd apps/mobile/ios && swift build --product MessengerCrypto -c release && swift test
```

Полный iOS-IPA собирается вне CI через Xcode (см. `docs/ios-update-policy.md`).

### 11.4 Docker

```bash
docker-compose up                   # messenger на :8080
docker-compose --profile cloudflare up  # + cloudflared (TUNNEL_TOKEN)
```

### 11.5 CI (`.github/workflows/build-native.yml`)

Триггеры: push tags `v*`, `workflow_dispatch`.

- `resolve-inputs` — вычисление version + server_url (через `scripts/set-server-url.sh`).
- `build-desktop-macos-arm64`, `-macos-x86_64`, `-linux`, `-windows` — Gradle packageDmg/Deb/Msi + опциональная подпись.
- `build-android` — assembleRelease/assembleDebug.
- `build-ios-crypto` — `swift build --product MessengerCrypto`.
- `test-server` — `go test ./...`.
- `publish-release` — `softprops/action-gh-release`, только для тегов `v*`.

Java в CI — 17 (temurin).

---

## 12. Известные ограничения

1. **SQLite writer concurrency**: `SetMaxOpenConns(1)` и SQLite WAL дают ориентировочно до 50–100 одновременных пользователей. Горизонтальное масштабирование невозможно без миграции на PostgreSQL.
2. **`server/internal/storage`**: пустой каталог, зарезервирован; в `main.go` не импортируется.
3. **`pion/dtls@2.2.12`** — vuln GO-2026-4479 (random-nonce AES-GCM). Статус/митигация — `docs/security-audit.md`.
4. **VAPID-ключи**: при пустых значениях сервер генерирует пару на старте, ключ в лог не сохраняется между рестартами — push-подписки клиентов сломаются. Для продакшена обязательно задать персистентно.
5. **iOS IPA**: CI собирает только `MessengerCrypto` через SPM; полная сборка IPA вне репозитория (Xcode + Apple signing).
6. **Desktop WebRTC**: в текущем baseline — stub SDP (ровно как зафиксировано планами фазы). Актуальный статус см. `docs/prd-alignment-progress.md`.
7. **Android Kotlin-исходники**: на baseline `60d7c93` в watched-path видны только `build.gradle.kts`, `settings.gradle.kts`, `README.md`. Дерево фактических Kotlin-файлов сверять через git history, не копировать слепо из планов.
8. **Vite версия**: в `CLAUDE.md` указано «Vite 5», в `client/package.json` — `vite@^8.0.9`. Источник истины — `package.json`.
9. **`REGISTRATION_MODE`**: валидные значения — `open` / `invite` / `approval`. Термин `request` (встречается в устаревших доках и `CLAUDE.md`) — устаревший синоним `approval`.
10. **SFU масштаб**: SFU встроен в основной бинарник (`server/internal/sfu`), без транскодинга. Практический потолок — ≤ 10–15 активных участников на комнату; для большего требуется выделенный SFU (LiveKit и т. п.).
11. **Bots webhook allowlist**: URL бота должен быть localhost или RFC-1918. Доставка на произвольные хосты будет отклонена (защита от SSRF).
12. **TLS**: без `TLS_CERT/TLS_KEY` и без `BEHIND_PROXY=true` сервер выдаёт warning; Web Push на iOS 16.4+ требует валидного TLS-сертификата (не самоподписанного).

---

## 13. Ссылки

- `docs/main/architecture.md` — высокоуровневый обзор, диаграммы, потоки данных.
- `docs/prd-alignment-progress.md` — статус фаз PRD; `docs/remaining-work-plan.md` — текущие приоритеты.
- `docs/main/deployment.md`, `docs/main/usersguid.md` — operations и сценарии.
- `docs/api-reference.md`, `shared/protocol/` — REST/WS контракты.
- `docs/crypto-rationale.md`, `shared/crypto-contracts/`, `shared/test-vectors/` — крипто.
- `docs/security-audit.md`, `docs/test-plan.md`, `docs/release-checklist.md` — QA/safety.
- `docs/privacy-screen-contract.md`, `docs/ios-update-policy.md` — native security (см. `architecture.md` §10).

---

*Документ актуален на `3c9b58d` (2026-04-27). Основан на `docs/docs-main-update-research.md` и прямом чтении кода репозитория.*
