# Архитектура мессенджера (WhatsApp-аналог)

## Обзор системы

Self-hosted мессенджер с E2E-шифрованием, серверной частью на ПК пользователя и текущим web-клиентом в виде PWA. Начиная с этапа 11, архитектура проекта расширяется до семейства нативных клиентов для Desktop, Android и iOS, при этом backend, REST/WS-контракты и E2E-модель остаются общими.

---

## Стек технологий

### Backend (Self-hosted)
| Компонент | Технология | Обоснование |
|---|---|---|
| Runtime | **Go 1.22** | Низкое потребление памяти, статический бинарник, нет зависимостей для установки |
| WebSocket | **gorilla/websocket** | Реал-тайм доставка сообщений |
| HTTP API | **Chi router** | Лёгкий, без лишних зависимостей |
| База данных | **SQLite + WAL** | Файловая, не требует отдельного процесса, подходит для self-hosted |
| Медиафайлы | Локальная файловая система | Простота, без внешних зависимостей |
| Push-уведомления | **Web Push (VAPID)** | Стандарт для PWA, работает на iOS 16.4+ и Android |
| TLS | **Let's Encrypt / mkcert** | Авто-обновление или локальный CA для локальной сети |

### Frontend (PWA)
| Компонент | Технология | Обоснование |
|---|---|---|
| Framework | **React 18 + Vite** | Быстрая сборка, широкая экосистема |
| State | **Zustand** | Минималистичный, без boilerplate |
| Шифрование | **libsodium-wrappers** | Порт NaCl, аудированная библиотека, работает в браузере |
| Offline | **Service Worker + Cache API** | Обязательно для PWA |
| Push | **Push API + Notifications API** | Системные уведомления на iOS/Android |
| Хранилище ключей | **IndexedDB (idb-keyval)** | Хранение приватных ключей локально в браузере |

### Native clients (Foundation decisions)
| Направление | Решение | Обоснование |
|---|---|---|
| Desktop | **Kotlin Multiplatform + Compose Multiplatform Desktop** | Native-first desktop family без web-wrapper |
| Android | **Kotlin + Compose** | Общий технологический вектор со shared core |
| iOS UI | **SwiftUI** | Лучшее соответствие native iOS lifecycle и UX |
| Shared core | **KMP shared core** | Общие domain/protocol/core контракты |
| Local DB | **SQLite** | Повторяет offline/outbox/pagination-семантику текущего PWA |
| Crypto | **Текущая модель PWA + libsodium family** | Без смены X3DH / Double Ratchet / Sender Keys |
| Formal protocol layer | **shared/protocol/*.json + shared/domain/*.md** | Machine-readable contracts и language-neutral модели |

---

## Общая архитектура

```
┌─────────────────────────────────────────────────────┐
│                  КЛИЕНТ (PWA)                        │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ UI React │  │ Zustand  │  │  E2E Crypto Layer │  │
│  │          │←→│  Store   │←→│  (libsodium)      │  │
│  └──────────┘  └──────────┘  └───────────────────┘  │
│         ↕ WebSocket + REST                           │
│  ┌────────────────────────────────────────────────┐  │
│  │         Service Worker (offline + push)        │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                        ↕ TLS (HTTPS/WSS)
┌─────────────────────────────────────────────────────┐
│              СЕРВЕР (Go, Self-hosted ПК)             │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ HTTP API │  │  WS Hub  │  │  Push Dispatcher  │  │
│  │  (Chi)   │  │          │  │  (VAPID)          │  │
│  └──────────┘  └──────────┘  └───────────────────┘  │
│         ↕                                            │
│  ┌────────────────────────────────────────────────┐  │
│  │              SQLite (WAL mode)                 │  │
│  │  users | messages | keys | devices | chats     │  │
│  └────────────────────────────────────────────────┘  │
│         ↕                                            │
│  ┌────────────────────────────────────────────────┐  │
│  │          Локальное хранилище медиа             │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Расширение архитектуры для native track

Проект имеет несколько клиентских рантаймов с общим backend и E2E-моделью:

- `Desktop` ✅ **MVP завершён** — Kotlin Compose Desktop, file transfer, WebRTC Step A (stub SDP);
- `Android` ✅ **Полный MVP завершён** — Kotlin + Jetpack Compose, file transfer (XSalsa20), WebRTC Step A + Step B (реальный SDP/ICE, video UI с `SurfaceViewRenderer`), push (FCM);
- `iOS` ✅ **MVP + Push завершён** — SwiftUI + swift-sodium 0.9.1 + GRDB.swift 6.27.0; полный E2E crypto (X3DH, Double Ratchet, SenderKey, SessionManager), REST + WebSocket (URLSession), SQLite v2, все экраны, APNs push; `swift test` → 6/6 зелёных;
- shared остаются только protocol/domain/core контракты и E2E-модель.

`client/` остаётся web-каналом, но не становится базой для новых приложений.

### Текущее состояние Shared Core

В репозитории уже есть не только контрактный слой, но и рабочий runtime-пакет `shared/native-core`.

Слои сейчас выглядят так:

- `shared/protocol/` — formal schemas для REST, WebSocket и message envelope;
- `shared/domain/` — language-neutral модели, события, repositories, auth/session, websocket lifecycle, sync/outbox;
- `shared/crypto-contracts/` — общий crypto contract;
- `shared/test-vectors/` — seed-набор cross-platform crypto vectors;
- `shared/native-core/` — platform-neutral runtime и browser/web adapters.

`shared/native-core` уже содержит:

- runtime-модули:
  - `auth/session-runtime.ts`
  - `websocket/connection-runtime.ts`
  - `messages/message-repository.ts`
  - `sync/sync-engine.ts`
  - `storage/storage-runtime.ts`
  - `crypto/crypto-runtime.ts`
- browser/web adapters и orchestrators:
  - `api/web/browser-api-client.ts`
  - `websocket/web/browser-websocket-client.ts`
  - `websocket/web/browser-websocket-platform.ts`
  - `websocket/web/browser-messenger-ws-deps.ts`
  - `websocket/web/ws-frame-types.ts`
  - `websocket/web/ws-model-types.ts`
  - `websocket/web/messenger-ws-orchestrator.ts`
  - `storage/web/browser-keystore.ts`
  - `crypto/web-crypto-adapter.ts`
  - `crypto/web/session-web.ts`
  - `calls/call-session.ts`
  - `calls/call-controller.ts`
  - `calls/web/browser-webrtc-runtime.ts`
  - `calls/web/browser-webrtc-platform.ts`
  - `calls/web/call-ws-types.ts`
  - `calls/web/call-handler-orchestrator.ts`

Web-клиент уже использует shared source-of-truth для:

- `api/client.ts`
- `api/websocket.ts`
- `crypto/x3dh.ts`
- `crypto/ratchet.ts`
- `crypto/senderkey.ts`
- `crypto/session.ts`
- `crypto/keystore.ts`
- `hooks/useMessengerWS.ts`
- `hooks/useCallHandler.ts`
- `hooks/useWebRTC.ts`
- `store/callStore.ts`
- `store/wsStore.ts`
- `components/CallOverlay/CallOverlay.tsx`

То есть `shared` уже является каноническим слоем не только для контрактов, но и для значительной части runtime-логики web-клиента. Для call-стека это теперь включает полный доменный слой (`call-session`, `call-controller`), browser signalling/runtime adapters и top-level wiring без скрытых runtime callbacks в Zustand. Для realtime-слоя дополнительно вынесены shared-local frame/model contracts, поэтому `calls/web/*` и `websocket/web/*` больше не зависят от `client/src/types`. Отдельно в shared уже вынесены browser platform helpers для `WebSocket`, browser timers, `RTCPeerConnection` и `getUserMedia`, а `useMessengerWS` использует shared helper для browser scheduler и маппинга `api.getChats()` в shared realtime model.

---

## Схема E2E шифрования (Signal Protocol)

Используем упрощённый вариант Signal Protocol на основе **X3DH** (Extended Triple Diffie-Hellman) для установки сессии и **Double Ratchet** для шифрования сообщений.

### 1. Регистрация устройства

```
Клиент генерирует:
  IK  — Identity Key (долговременная пара Ed25519)
  SPK — Signed PreKey (среднесрочная пара X25519, подписана IK)
  OPK — One-Time PreKeys (набор одноразовых X25519 ключей)

Клиент публикует на сервер:
  { IK.public, SPK.public, SPK.signature, [OPK.public, ...] }

Сервер хранит только публичные ключи — приватные остаются в IndexedDB клиента.
```

### 2. Инициализация сессии (X3DH)

```
Алиса хочет написать Бобу:

1. Алиса запрашивает у сервера ключи Боба: IK_B, SPK_B, OPK_B
2. Алиса генерирует эфемерный ключ EK_A
3. Вычисляет DH:
   DH1 = DH(IK_A, SPK_B)
   DH2 = DH(EK_A, IK_B)
   DH3 = DH(EK_A, SPK_B)
   DH4 = DH(EK_A, OPK_B)  // если OPK доступен
4. SK = KDF(DH1 || DH2 || DH3 || DH4)  // общий секрет
5. Алиса шифрует первое сообщение, включает {IK_A.public, EK_A.public, OPK_B.id}
6. Боб получает сообщение, воспроизводит те же DH-операции → тот же SK
```

### 3. Double Ratchet (последующие сообщения)

```
На основе SK инициализируется Double Ratchet:
  - Symmetric Ratchet: каждое сообщение — новый ключ (forward secrecy)
  - Diffie-Hellman Ratchet: периодическая смена ключей (break-in recovery)

Каждое сообщение шифруется XSalsa20-Poly1305 (libsodium secretbox).
```

### 4. Групповые чаты

```
Sender Keys (lazy distribution, как в Signal):
  - Каждый участник генерирует SenderKey (chain_key + signing keypair)
  - При первом сообщении в группе: SKDM рассылается каждому участнику
    индивидуально через X3DH/Double Ratchet E2E-сессию
  - Групповое сообщение шифруется один раз SenderKey (AES-CBC + HMAC)
    → все участники расшифровывают одним SenderKey
  - При смене состава — ротация SenderKey (TODO: не реализована)
```

---

## API-контракт (REST + WebSocket)

### REST эндпоинты

```
POST /api/auth/register        — регистрация пользователя
POST /api/auth/login           — вход, получение JWT
POST /api/auth/refresh         — обновление access token
POST /api/auth/logout          — выход, инвалидация refresh cookie
GET  /api/keys/:userId         — получение публичных ключей пользователя
POST /api/keys/prekeys         — загрузка новых одноразовых ключей
POST /api/keys/register        — регистрация/обновление device key bundle
GET  /api/chats                — список чатов (unreadCount, updatedAt, lastMessage)
POST /api/chats                — создание чата (direct / group)
GET  /api/chats/:id/messages   — история сообщений (opaque cursor)
POST /api/chats/:id/read       — сброс unreadCount для чата
DELETE /api/messages/:id       — удаление сообщения (soft-delete, broadcast)
PATCH  /api/messages/:id       — редактирование сообщения (broadcast)
POST /api/media/upload         — загрузка зашифрованного blob (ciphertext only)
GET  /api/media/:id            — скачивание медиафайла (JWT required)
PATCH /api/media/:id           — привязка медиафайла к чату (chat_id)
POST /api/push/subscribe       — регистрация Push-подписки
GET  /api/users/search         — поиск пользователей по username

-- Этап 12: server info, registration flows, admin --
GET  /api/server/info          — публичный, без JWT: name/description/registrationMode
POST /api/auth/request-register — заявка на регистрацию (режим approval)
POST /api/auth/password-reset-request — запрос сброса пароля (без user enumeration)

-- Admin (требует JWT + role=admin) --
GET  /api/admin/registration-requests        — список заявок на регистрацию
POST /api/admin/registration-requests/:id/approve  — одобрить заявку
POST /api/admin/registration-requests/:id/reject   — отклонить заявку
POST /api/admin/invite-codes                 — создать инвайт-код
GET  /api/admin/invite-codes                 — список инвайт-кодов
GET  /api/admin/users                        — список пользователей
POST /api/admin/users/:id/reset-password     — установить временный пароль
GET  /api/admin/password-reset-requests      — список запросов сброса пароля
POST /api/admin/password-reset-requests/:id/resolve  — закрыть запрос
```

### WebSocket протокол

```
Соединение: WSS /ws?token=<JWT>

Входящие события (сервер → клиент):
  { type: "message",         chatId, messageId, clientMsgId, senderId, ciphertext, senderKeyId, timestamp }
  { type: "ack",             chatId, clientMsgId, timestamp }
  { type: "message_deleted", chatId, clientMsgId }
  { type: "message_edited",  chatId, clientMsgId, ciphertext, editedAt }
  { type: "typing",          chatId, userId }
  { type: "read",            chatId, messageId, userId }
  { type: "skdm",            chatId, senderId, ciphertext }    // Sender Key Distribution Message
  { type: "prekey_low",      count }                           // OPK < 10, нужно пополнить
  { type: "prekey_request" }                                   // устаревший; заменён prekey_low

Исходящие события (клиент → сервер):
  { type: "message",  chatId, recipients: [{userId, ciphertext}] }
  { type: "typing",   chatId }
  { type: "read",     chatId, messageId }
  { type: "skdm",     chatId, recipients: [{userId, ciphertext}] }  // рассылка SenderKey
```

---

## Схема базы данных

```sql
-- Пользователи
CREATE TABLE users (
    id TEXT PRIMARY KEY,       -- UUID
    username TEXT UNIQUE,
    display_name TEXT,
    password_hash TEXT,
    avatar_path TEXT,
    created_at INTEGER,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin'))
);

-- Устройства (один пользователь — несколько устройств)
CREATE TABLE devices (
    id TEXT PRIMARY KEY,       -- UUID
    user_id TEXT NOT NULL,
    device_name TEXT,
    created_at INTEGER,
    last_seen_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Публичные ключи (для E2E) — PK составной для multi-device
CREATE TABLE identity_keys (
    user_id   TEXT NOT NULL,
    device_id TEXT NOT NULL DEFAULT '',
    ik_public BLOB,            -- Identity Key
    spk_public BLOB,           -- Signed PreKey
    spk_signature BLOB,
    spk_id INTEGER,
    updated_at INTEGER,
    PRIMARY KEY (user_id, device_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE one_time_prekeys (   -- a.k.a. pre_keys
    id INTEGER PRIMARY KEY,
    user_id TEXT,
    key_public BLOB,
    used INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Сессии (refresh tokens)
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    token_hash TEXT,
    expires_at INTEGER
);

-- Чаты (conversations)
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    type TEXT,                 -- 'direct' | 'group'
    name TEXT,
    created_at INTEGER
);

CREATE TABLE conversation_members (
    conversation_id TEXT,
    user_id TEXT,
    joined_at INTEGER,
    PRIMARY KEY (conversation_id, user_id)
);

-- Состояние чата на пользователя (unread, last_read)
CREATE TABLE chat_user_state (
    conversation_id TEXT,
    user_id TEXT,
    last_read_message_id TEXT,
    unread_count INTEGER DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id)
);

-- Сообщения (хранятся в зашифрованном виде, копия на получателя)
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    client_msg_id TEXT,        -- UUID от отправителя, общий для всех копий
    conversation_id TEXT,
    sender_id TEXT,
    recipient_id TEXT,         -- конкретный получатель этой копии
    ciphertext TEXT,           -- зашифрованный payload (base64)
    sender_key_id INTEGER,
    is_deleted INTEGER DEFAULT 0,
    edited_at INTEGER,
    created_at INTEGER,
    delivered_at INTEGER,
    read_at INTEGER
);

-- Медиафайлы
CREATE TABLE media_objects (
    id TEXT PRIMARY KEY,       -- mediaId (UUID)
    uploader_id TEXT,
    conversation_id TEXT,      -- может быть NULL до привязки к чату
    storage_path TEXT,
    content_type TEXT,
    size_bytes INTEGER,
    created_at INTEGER
);

-- Push-подписки
CREATE TABLE push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    endpoint TEXT,
    p256dh BLOB,
    auth BLOB
);

-- Инвайт-коды (этап 12)
CREATE TABLE invite_codes (
    id TEXT PRIMARY KEY,       -- UUID / short prefix
    created_by TEXT NOT NULL,  -- admin user_id
    used_by TEXT,              -- NULL пока не использован
    expires_at INTEGER DEFAULT 0  -- 0 = без ограничения
);

-- Запросы на регистрацию (режим approval)
CREATE TABLE registration_requests (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    created_at INTEGER
);

-- Запросы на сброс пароля
CREATE TABLE password_reset_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    temp_password TEXT,        -- устанавливается админом
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved')),
    created_at INTEGER
);
```

---

## Структура проекта

```
messenger/
├── docs/
│   ├── architecture.md        ← этот файл
│   ├── technical-documentation.md
│   ├── unimplemented-spec-tasks.md
│   ├── spec-gap-checklist.md
│   └── v1-gap-remediation.md
├── server/                    ← Go backend
│   ├── cmd/server/
│   │   ├── main.go            ← точка входа, роутинг, middleware
│   │   └── config.go          ← Config struct + YAML + env overrides
│   ├── internal/
│   │   ├── auth/              ← JWT, bcrypt, refresh rotation, role in claims
│   │   ├── admin/             ← RequireAdmin middleware, admin handlers
│   │   ├── serverinfo/        ← GET /api/server/info (публичный)
│   │   ├── chat/              ← чаты, история, delete/edit
│   │   ├── keys/              ← X3DH key bundles, prekey management
│   │   ├── media/             ← upload/download (JWT required)
│   │   ├── push/              ← VAPID Web Push
│   │   ├── users/             ← поиск пользователей
│   │   └── ws/                ← WebSocket Hub (gorilla)
│   └── db/
│       ├── schema.go          ← схема + миграции (#1–13)
│       ├── migrate.go         ← versioned migration runner
│       └── queries.go         ← типизированные SQL-запросы
├── client/                    ← React PWA
│   ├── public/
│   │   └── push-handler.js    ← Service Worker (push + cache)
│   ├── src/
│   │   ├── api/
│   │   │   ├── client.ts      ← REST + encrypted media helpers
│   │   │   └── websocket.ts   ← WS с reconnect + auth failure
│   │   ├── crypto/
│   │   │   ├── x3dh.ts        ← X3DH initiator/responder
│   │   │   ├── ratchet.ts     ← Double Ratchet + skipped keys
│   │   │   ├── session.ts     ← E2E session manager (direct + group)
│   │   │   ├── senderkey.ts   ← Sender Keys для групп
│   │   │   └── keystore.ts    ← IndexedDB (keys, ratchet, sender keys)
│   │   ├── config/
│   │   │   └── serverConfig.ts  ← getServerUrl / setServerUrl / initServerUrl
│   │   ├── store/             ← Zustand stores (authStore: role, chatStore: reset)
│   │   ├── hooks/
│   │   │   ├── useMessengerWS.ts ← WS orchestration
│   │   │   └── usePushNotifications.ts
│   │   ├── components/
│   │   └── pages/
│   │       ├── ServerSetupPage.tsx  ← выбор и валидация URL сервера
│   │       ├── AdminPage.tsx        ← панель администратора
│   │       └── AuthPage.tsx         ← логин / регистрация / инвайт / запрос / forgot
│   ├── vite.config.ts
│   └── package.json
└── README.md
```

---

## Аудио/Видео звонки (WebRTC)

### Архитектура

Медиатрафик не проходит через Go-сервер. Сервер участвует только в **сигнализации** — обмене SDP и ICE через WebSocket.

```
[Клиент A] ──── WS сигнализация ────→ [Go сервер] ──── WS ────→ [Клиент B]
[Клиент A] ◄─────────── WebRTC P2P медиапоток ───────────────→ [Клиент B]
               (при невозможности P2P — через TURN-релей)
```

### Статус реализации по платформам

| Платформа | Сигнализация | SDP/ICE | Video UI |
|---|---|---|---|
| Web PWA | ✅ | ✅ (`RTCPeerConnection`) | ✅ (`<video>` элементы) |
| Desktop (Kotlin) | ✅ | stub | stub (intentional) |
| Android (Kotlin) | ✅ | ✅ (`AndroidWebRtcController`) | ✅ (`SurfaceViewRenderer`) |
| iOS (SwiftUI) | ⬜ | ⬜ | ⬜ |

### WS-события сигнализации ✅ Реализованы (этап 9)

```
call_offer      chatId, callId, sdp           — инициатор → получатель
call_answer     chatId, callId, sdp           — получатель → инициатор
ice_candidate   chatId, callId, candidate     — обе стороны
call_end        chatId, callId               — любая сторона
call_reject     chatId, callId               — получатель отклонил
call_busy       chatId, callId               — получатель уже в звонке
```

Сервер только транзитно пересылает события участникам звонка и хранит in-memory состояние активных звонков.

### STUN / TURN

- **STUN** — публичный сервер (Google/Cloudflare), бесплатно, для большинства соединений достаточно
- **TURN** — нужен при симметричном NAT (~15–30% звонков); coturn на том же хосте или отдельном VPS; credentials — временные (TURN secret + timestamp TTL 24ч), выдаются через `GET /api/calls/ice-servers`

### Групповые звонки

Требуют отдельного **SFU** (Selective Forwarding Unit). Рекомендуется LiveKit — Go-сервис, хорошо интегрируется с текущим стеком. Без SFU при 5+ участниках каждый клиент шлёт N-1 потоков (mesh), что создаёт квадратичную нагрузку на клиент и сеть.

### Ограничения self-hosted

| Сценарий | Реализуемость |
|---|---|
| Звонки 1-на-1, хорошая сеть | Только STUN — бесплатно |
| Звонки 1-на-1, NAT/firewall | Нужен TURN, умеренный трафик |
| Групповые 3–5 человек | Нужен LiveKit SFU |
| Групповые 10+ человек | Требует выделенного сервера |

---

## Деплой (Self-hosted)

### Локальная сеть
```bash
# Запуск сервера
./messenger-server --db ./data/messenger.db --port 8443 --tls-cert ./certs/cert.pem

# Клиент доступен по адресу
https://192.168.x.x:8443
```

### Интернет (ngrok / Cloudflare Tunnel)
```bash
# Через Cloudflare Tunnel (бесплатно, без публичного IP)
cloudflared tunnel --url http://localhost:8080
```

### PWA установка
- iOS 16.4+: Safari → «Поделиться» → «На экран Домой»
- Android: Chrome → «Установить приложение»

---

## Соображения безопасности

1. **Ключи никогда не покидают устройство** — сервер хранит только публичные ключи
2. **Perfect Forward Secrecy** — компрометация ключа не раскрывает прошлые сообщения
3. **Break-in Recovery** — DH Ratchet ограничивает ущерб от компрометации текущего состояния
4. **Skipped message keys** — кэш пропущенных ключей (MAX_SKIP=100) обеспечивает корректную расшифровку при out-of-order доставке
5. **JWT с коротким TTL** (15 мин) + Refresh Token (7 дней) в httpOnly `SameSite=Strict` cookie
6. **Rate limiting** — token bucket на `/api/auth/*`
7. **Security headers** — CSP, HSTS, X-Frame-Options, X-Content-Type-Options
8. **Медиафайлы зашифрованы** — XSalsa20-Poly1305 на клиенте до upload; сервер хранит только ciphertext; ключ встроен в зашифрованный message payload
9. **Медиадоступ защищён JWT** — `GET /api/media/:id` требует валидный Bearer token
10. **TLS обязателен** — при отсутствии сертификатов сервер выдаёт предупреждение
11. **WS origin allowlist** — `CheckOrigin` ограничен `ALLOWED_ORIGINS` из env
12. **bcrypt cost = 12** — зафиксирован в константе
13. **Role-based access** — `role` в JWT claims; `RequireAdmin` middleware возвращает 403 для non-admin
14. **Registration modes** — `open | invite | approval`; invite code validates expiry + single-use атомарно
15. **No user enumeration** — `POST /api/auth/password-reset-request` всегда возвращает 200 независимо от наличия пользователя
16. **Multi-server client isolation** — `clearServerUrl()` + `chatStore.reset()` при смене сервера предотвращает утечку данных между серверами

---

## Ограничения self-hosted подхода

- Доступность: сервер работает только пока включён ПК
- Масштабируемость: SQLite ограничен ~10K одновременных соединений
- Push-уведомления на iOS требуют HTTPS с валидным сертификатом (не самоподписанным)
- Рекомендуется UPS или использование VPS для продакшена

---

---

## Сравнение архитектурных подходов

Ниже рассмотрены три реалистичных подхода к реализации self-hosted мессенджера. Выбранная архитектура — **Подход 1**.

---

### Подход 1: Monolith Go + SQLite + PWA (выбранный)

**Описание:** Единый Go-бинарник обслуживает REST API, WebSocket Hub и раздаёт статику PWA. SQLite в WAL-режиме — единственное хранилище. E2E реализован на стороне клиента через libsodium.

```
[PWA клиент] ←WSS/HTTPS→ [Go monolith] ←→ [SQLite файл]
                                        ←→ [Локальная FS (медиа)]
```

**Преимущества:**
- Минимальные требования к окружению: один бинарник, один файл БД
- Простой деплой: скачал, запустил — всё работает
- Нет Docker, нет внешних процессов, нет сетевых зависимостей между сервисами
- SQLite с WAL без проблем держит 50–100 одновременных пользователей (домашний мессенджер)
- Легко бэкапить: `cp messenger.db messenger.db.bak`

**Недостатки:**
- Горизонтальное масштабирование невозможно (SQLite — только один писатель)
- При росте до тысяч пользователей потребуется миграция на PostgreSQL
- Все компоненты в одном процессе — падение одного = падение всего

**Когда подходит:** домашний/семейный мессенджер, небольшая команда до 50 человек.

---

### Подход 2: Микросервисы (Go) + PostgreSQL + Redis

**Описание:** Отдельные сервисы: Auth Service, Message Service, Media Service, Push Service. PostgreSQL как основная БД, Redis для pub/sub и очередей доставки сообщений. Nginx или Caddy как reverse proxy.

```
[PWA] ←→ [Nginx/Caddy]
             ├→ [Auth Service :8001]    ←→ [PostgreSQL]
             ├→ [Message Service :8002] ←→ [PostgreSQL]
             │                          ←→ [Redis pub/sub]
             ├→ [Media Service :8003]   ←→ [S3 / локальная FS]
             └→ [Push Service :8004]    ←→ [Redis queue]
```

**Преимущества:**
- Масштабируется горизонтально: можно запустить N инстансов Message Service
- Независимые деплои: обновить Auth не затрагивает Media
- Redis pub/sub решает fan-out для групповых чатов без блокировок
- PostgreSQL даёт полноценные транзакции, JSON-поля, индексы

**Недостатки:**
- Сложный деплой: Docker Compose минимум с 6 контейнерами
- Требует настройки PostgreSQL, Redis, Nginx — нетривиально для self-hosted
- Высокий overhead для маленькой аудитории: PostgreSQL + Redis потребляют 200–400 МБ RAM в холостую
- Межсервисная коммуникация добавляет latency и точки отказа

**Когда подходит:** мессенджер для организации, 100–10 000 пользователей, есть DevOps-компетенция.

---

### Подход 3: Peer-to-Peer (местный сервер только для сигнализации)

**Описание:** Сервер хранит только публичные ключи, маршрутизирует WebRTC-сигналы и толкает уведомления. Все сообщения передаются напрямую между устройствами через WebRTC DataChannel (в локальной сети — без сервера вообще).

```
[Устройство A] ←──── WebRTC DataChannel ────→ [Устройство B]
        ↕                                              ↕
   [Сервер сигнализации] ← только signaling + ключи →
```

**Преимущества:**
- Сервер не видит никаких сообщений даже в зашифрованном виде
- В локальной сети (дом, офис) работает полностью без интернета
- Минимальная нагрузка на сервер: только signaling и ключи

**Недостатки:**
- WebRTC требует STUN/TURN серверов для NAT traversal через интернет
- TURN-сервер (ретранслятор) нужен когда P2P невозможен — это снова сервер трафика
- Доставка сообщений оффлайн-пользователям невозможна без серверного буфера
- Группы сложнее: нет центрального Sender Key distribution
- iOS Safari имеет ограничения на фоновые WebRTC соединения

**Когда подходит:** максимальная приватность важнее надёжности доставки, все пользователи в одной локальной сети.

---

### Итоговое сравнение

| Критерий | Подход 1 (Monolith) | Подход 2 (Microservices) | Подход 3 (P2P) |
|---|---|---|---|
| Сложность установки | Минимальная | Высокая | Средняя |
| RAM на старте | ~30 МБ | ~400 МБ | ~20 МБ |
| Масштаб пользователей | до 50 | до 10 000 | до 20 (P2P) |
| Оффлайн-доставка | Да | Да | Нет |
| Push-уведомления | Да (VAPID) | Да (VAPID) | Ограниченно |
| Надёжность доставки | Высокая | Высокая | Низкая |
| Приватность (сервер) | Только зашифр. | Только зашифр. | Ноль данных |
| Бэкап | Один файл | pg_dump + Redis | Нет данных |

### Рекомендация

**Выбран Подход 1** как оптимальный для self-hosted мессенджера на ПК пользователя.

Ключевые доводы:
1. Целевая аудитория — семья или малая команда (2–20 человек). SQLite справляется с запасом.
2. Self-hosted означает отсутствие DevOps-инфраструктуры. Docker Compose с 6 сервисами — барьер для большинства пользователей.
3. P2P не обеспечивает надёжную оффлайн-доставку, что критично для мессенджера.
4. **Путь роста**: если аудитория вырастет, миграция SQLite → PostgreSQL в монолите проще, чем рефакторинг P2P в серверную модель. Монолит можно разбить на сервисы позже, когда появится реальная потребность.

---

*Документ разработан архитектором команды messenger-team. Дата: 2026-04-07.*
