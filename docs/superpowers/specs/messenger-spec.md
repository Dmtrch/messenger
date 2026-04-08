# Техническая спецификация: Self-Hosted Messenger

**Версия:** 1.0  
**Дата:** 2026-04-07  
**Команда:** messenger-team  

---

## 1. Обзор продукта

### 1.1 Назначение

Мессенджер с сквозным шифрованием (E2E), аналогичный WhatsApp, предназначенный для самостоятельного развёртывания на персональном компьютере пользователя. Сервер работает на Linux, macOS или Windows. Клиент — PWA (Progressive Web App), устанавливаемое на iOS и Android.

### 1.2 Целевая аудитория

- Семьи и малые группы (2–20 человек)
- Пользователи, заботящиеся о приватности
- Технически грамотные люди, не желающие зависеть от облачных сервисов

### 1.3 Ключевые принципы

1. **Приватность по умолчанию** — сервер хранит только зашифрованные данные и публичные ключи
2. **Простота деплоя** — один бинарник, один файл конфигурации, один файл базы данных
3. **Работа без облака** — нет зависимости от сторонних сервисов кроме опционального Cloudflare Tunnel
4. **Открытый стандарт шифрования** — Signal Protocol (X3DH + Double Ratchet)

---

## 2. Функциональные требования

### 2.1 Аутентификация

| ID | Требование | Приоритет |
|---|---|---|
| AUTH-1 | Регистрация по имени пользователя + пароль | Must |
| AUTH-2 | Вход с выдачей JWT (TTL 15 мин) + Refresh Token (TTL 7 дней) | Must |
| AUTH-3 | Refresh Token хранится в httpOnly cookie | Must |
| AUTH-4 | Выход с инвалидацией Refresh Token | Must |
| AUTH-5 | Регистрация нескольких устройств одного пользователя | Must |
| AUTH-6 | Смена пароля с инвалидацией всех сессий | Should |

### 2.2 Обмен сообщениями

| ID | Требование | Приоритет |
|---|---|---|
| MSG-1 | Отправка текстовых сообщений в личных чатах | Must |
| MSG-2 | Групповые чаты (до 50 участников) | Must |
| MSG-3 | Доставка сообщений оффлайн-пользователям (буферизация на сервере) | Must |
| MSG-4 | Статусы доставки: отправлено / доставлено / прочитано | Must |
| MSG-5 | Индикатор набора текста (typing indicator) | Should |
| MSG-6 | Индикатор присутствия online/offline | Should |
| MSG-7 | Редактирование отправленного сообщения | Could |
| MSG-8 | Удаление сообщения (у себя / у всех) | Could |
| MSG-9 | Ответ на сообщение (reply) | Should |
| MSG-10 | Реакции на сообщения (emoji) | Could |
| MSG-11 | Пагинация истории сообщений (cursor-based) | Must |

### 2.3 Медиафайлы

| ID | Требование | Приоритет |
|---|---|---|
| MEDIA-1 | Отправка изображений (JPEG, PNG, WebP, GIF) до 10 МБ | Must |
| MEDIA-2 | Отправка видео до 100 МБ | Should |
| MEDIA-3 | Отправка файлов любого типа до 100 МБ | Should |
| MEDIA-4 | Голосовые сообщения (WebM/Opus) | Could |
| MEDIA-5 | Предпросмотр (thumbnail) для изображений | Should |
| MEDIA-6 | Медиа хранится в зашифрованном виде на сервере | Must |
| MEDIA-7 | Авто-удаление медиа при удалении сообщения | Should |

### 2.4 E2E шифрование

| ID | Требование | Приоритет |
|---|---|---|
| E2E-1 | X3DH для установки сессии между двумя пользователями | Must |
| E2E-2 | Double Ratchet для шифрования каждого сообщения | Must |
| E2E-3 | Sender Keys для групповых чатов | Must |
| E2E-4 | Приватные ключи хранятся только в IndexedDB браузера | Must |
| E2E-5 | Сервер не может расшифровать сообщения | Must |
| E2E-6 | Верификация идентичности собеседника (Safety Number / QR) | Should |
| E2E-7 | Предупреждение при смене ключей собеседника | Should |

### 2.5 Push-уведомления

| ID | Требование | Приоритет |
|---|---|---|
| PUSH-1 | Web Push VAPID для доставки уведомлений | Must |
| PUSH-2 | Уведомление содержит только «новое сообщение» без текста | Must |
| PUSH-3 | Работа на iOS 16.4+ (Safari PWA) | Must |
| PUSH-4 | Работа на Android (Chrome) | Must |
| PUSH-5 | Отключение уведомлений для конкретного чата | Should |

### 2.6 PWA / Оффлайн

| ID | Требование | Приоритет |
|---|---|---|
| PWA-1 | Установка на iOS и Android как PWA | Must |
| PWA-2 | Работа без интернета: просмотр истории | Must |
| PWA-3 | Очередь отправки при потере соединения | Should |
| PWA-4 | Service Worker кэширует UI-оболочку | Must |

---

## 3. Нефункциональные требования

### 3.1 Производительность

| Метрика | Целевое значение |
|---|---|
| Latency доставки сообщения (оба онлайн) | < 100 мс |
| Время загрузки PWA (повторный визит) | < 1 с |
| RAM сервера в покое | < 50 МБ |
| RAM сервера при 20 активных соединениях | < 100 МБ |
| Размер SQLite при 1M сообщений | < 500 МБ |

### 3.2 Надёжность

- Сервер должен корректно перезапускаться после сбоя без потери данных
- SQLite WAL обеспечивает целостность при неожиданном завершении
- Клиент должен автоматически переподключаться (экспоненциальный backoff: 1s, 2s, 4s, 8s, max 30s)

### 3.3 Безопасность

- TLS обязателен для всех соединений (HTTPS + WSS)
- JWT подписывается HS256 с секретом из конфигурации
- Пароли хранятся как bcrypt hash (cost=12)
- Rate limiting: 10 запросов/сек на IP для auth эндпоинтов
- Медиафайлы не доступны без валидного JWT
- Content-Security-Policy, X-Frame-Options, HSTS заголовки

### 3.4 Совместимость

| Платформа | Минимальная версия |
|---|---|
| iOS Safari | 16.4 |
| Android Chrome | 90 |
| Desktop Chrome | 90 |
| Desktop Firefox | 90 |
| Desktop Safari | 16 |

---

## 4. Архитектура системы

### 4.1 Компоненты

```
messenger/
├── server/          # Go 1.22 backend
│   ├── api/         # HTTP REST handlers (Chi router)
│   ├── ws/          # WebSocket Hub
│   ├── db/          # SQLite queries (database/sql + modernc.org/sqlite)
│   ├── crypto/      # VAPID push signing
│   └── storage/     # Локальное хранилище медиа
└── client/          # React 18 + Vite PWA
    ├── src/crypto/  # X3DH, Double Ratchet (libsodium-wrappers)
    ├── src/store/   # Zustand state management
    └── public/sw.js # Service Worker
```

### 4.2 Технологический стек

**Backend:**
- Go 1.22
- Chi router v5
- gorilla/websocket v1
- modernc.org/sqlite (чистый Go, без CGO)
- golang.org/x/crypto (bcrypt, HKDF)
- webpush-go (VAPID)

**Frontend:**
- React 18 + TypeScript
- Vite 5 (сборка)
- libsodium-wrappers (X25519, XSalsa20-Poly1305, Ed25519)
- idb-keyval (IndexedDB для ключей)
- Zustand (state)
- TanStack Query (кэш REST-запросов)

---

## 5. API спецификация

### 5.1 Аутентификация

#### POST /api/auth/register
```json
// Request
{
  "username": "alice",
  "password": "s3cr3t",
  "displayName": "Alice"
}

// Response 201
{
  "userId": "uuid-v4",
  "username": "alice"
}

// Response 409 (username занят)
{ "error": "username_taken" }
```

#### POST /api/auth/login
```json
// Request
{ "username": "alice", "password": "s3cr3t" }

// Response 200
{
  "token": "<JWT>",
  "userId": "uuid-v4",
  "expiresIn": 900
}
// + Set-Cookie: refresh_token=<token>; HttpOnly; Secure; SameSite=Strict; Max-Age=604800
```

#### POST /api/auth/refresh
```json
// Request: Cookie refresh_token автоматически
// Response 200
{ "token": "<JWT>", "expiresIn": 900 }
```

#### POST /api/auth/logout
```json
// Request: Authorization: Bearer <JWT>
// Response 200: инвалидирует refresh token
```

### 5.2 Ключи E2E

#### POST /api/keys/register
```json
// Request
{
  "ikPublic": "<base64>",      // Identity Key
  "spkPublic": "<base64>",     // Signed PreKey
  "spkSignature": "<base64>",
  "spkId": 1,
  "oneTimePrekeys": [
    { "id": 1, "public": "<base64>" },
    ...                         // минимум 10
  ]
}
// Response 200: OK
```

#### GET /api/keys/:userId
```json
// Response 200
{
  "userId": "uuid",
  "ikPublic": "<base64>",
  "spkPublic": "<base64>",
  "spkSignature": "<base64>",
  "spkId": 1,
  "oneTimePrekey": { "id": 5, "public": "<base64>" }  // null если закончились
}
```

#### POST /api/keys/prekeys
```json
// Дозагрузка одноразовых ключей
{
  "oneTimePrekeys": [
    { "id": 20, "public": "<base64>" }
  ]
}
```

### 5.3 Чаты и сообщения

#### GET /api/chats
```json
// Response 200
{
  "chats": [
    {
      "id": "uuid",
      "type": "direct",         // "direct" | "group"
      "name": null,             // null для direct
      "lastMessage": {
        "timestamp": 1712345678,
        "preview": null         // null — E2E, превью недоступно
      },
      "unreadCount": 3,
      "members": ["userId1", "userId2"]
    }
  ]
}
```

#### GET /api/chats/:id/messages?before=<messageId>&limit=50
```json
// Response 200
{
  "messages": [
    {
      "id": "uuid",
      "senderId": "userId",
      "encryptedPayload": "<base64>",
      "senderKeyId": 5,
      "timestamp": 1712345678,
      "delivered": true,
      "read": false
    }
  ],
  "hasMore": true
}
```

#### POST /api/chats
```json
// Создать групповой чат
{
  "name": "Семья",
  "memberIds": ["userId2", "userId3"]
}
// Response 201
{ "chatId": "uuid" }
```

### 5.4 Медиафайлы

#### POST /api/media/upload
```
Content-Type: multipart/form-data
Authorization: Bearer <JWT>

Field: file — бинарные данные (зашифрованные клиентом)
Field: mimeType — оригинальный MIME до шифрования
Field: size — оригинальный размер в байтах
```
```json
// Response 201
{ "mediaId": "uuid", "url": "/api/media/uuid" }
```

#### GET /api/media/:id
```
Authorization: Bearer <JWT>
// Response 200: бинарные данные (зашифрованные)
```

### 5.5 Push-уведомления

#### POST /api/push/subscribe
```json
{
  "endpoint": "https://fcm.googleapis.com/...",
  "keys": {
    "p256dh": "<base64>",
    "auth": "<base64>"
  }
}
// Response 200: OK
```

### 5.6 WebSocket протокол

**Соединение:** `WSS /ws?token=<JWT>`

#### Сервер → Клиент

```typescript
// Входящее сообщение
{
  type: "message",
  id: string,
  chatId: string,
  senderId: string,
  encryptedPayload: string,  // base64
  senderKeyId: number,
  timestamp: number
}

// Подтверждение доставки
{ type: "ack", messageId: string }

// Набор текста
{ type: "typing", chatId: string, userId: string }

// Статус прочтения
{ type: "read", chatId: string, messageId: string, userId: string }

// Присутствие
{ type: "presence", userId: string, status: "online" | "offline" }

// Запрос загрузить новые одноразовые ключи
{ type: "prekey_request" }

// Keepalive
{ type: "pong" }
```

#### Клиент → Сервер

```typescript
// Отправить сообщение
{
  type: "message",
  chatId: string,
  recipients: Array<{
    userId: string,
    encryptedPayload: string,  // base64, зашифровано для конкретного получателя
    senderKeyId: number
  }>
}

// Набор текста
{ type: "typing", chatId: string }

// Отметить прочитанным
{ type: "read", chatId: string, messageId: string }

// Keepalive
{ type: "ping" }

// Обновить токен
{ type: "reauth", token: string }
```

---

## 6. Схема E2E шифрования

### 6.1 Генерация ключей при регистрации устройства

```
IK  = Ed25519.generateKeyPair()    // долгосрочный Identity Key
SPK = X25519.generateKeyPair()     // среднесрочный Signed PreKey (ротация раз в неделю)
SPK.signature = Ed25519.sign(IK.private, SPK.public)
OPK[1..20] = X25519.generateKeyPair() × 20  // одноразовые PreKeys

Публикуется на сервер: { IK.public, SPK.public, SPK.signature, spkId, OPK[].public }
Хранится в IndexedDB: { IK.private, SPK.private, OPK[].private }
```

### 6.2 X3DH — установка сессии

```
// Алиса инициирует чат с Бобом:

1. GET /api/keys/bob → { IK_B, SPK_B, SPK_sig_B, OPK_B }
2. Проверить: Ed25519.verify(IK_B, SPK_B, SPK_sig_B)
3. EK_A = X25519.generateKeyPair()  // эфемерный ключ
4. DH1 = X25519.dh(IK_A.private,  SPK_B.public)
   DH2 = X25519.dh(EK_A.private,  IK_B.public)
   DH3 = X25519.dh(EK_A.private,  SPK_B.public)
   DH4 = X25519.dh(EK_A.private,  OPK_B.public)  // если OPK доступен
5. SK = HKDF-SHA256(DH1 || DH2 || DH3 || DH4, info="messenger-x3dh-v1")
6. Инициализировать Double Ratchet с SK
7. Первое сообщение содержит: { IK_A.public, EK_A.public, OPK_B.id, encryptedPayload }
```

### 6.3 Double Ratchet

```
Состояние рatchet (хранится в IndexedDB):
  rootKey: Uint8Array(32)
  sendChainKey: Uint8Array(32)
  recvChainKey: Uint8Array(32)
  sendDHKey: X25519KeyPair
  recvDHKey: Uint8Array(32) | null
  sendMsgNum: number
  recvMsgNum: number
  skippedKeys: Map<string, Uint8Array>  // для out-of-order доставки

Шифрование сообщения:
  [messageKey, nextChainKey] = HKDF(chainKey, "msg")
  ciphertext = XSalsa20-Poly1305.encrypt(messageKey, plaintext)
  chainKey = nextChainKey

DH Ratchet (при получении нового DH-ключа от собеседника):
  [newRootKey, newChainKey] = HKDF(rootKey, DH(sendDHKey, recvDHKey))
```

### 6.4 Шифрование медиафайлов

```
mediaKey = crypto.getRandomValues(32 байта)
encryptedMedia = XSalsa20-Poly1305.encrypt(mediaKey, fileBytes)
POST /api/media/upload (encryptedMedia)
→ mediaId

В сообщении передаётся: { mediaId, mediaKey (зашифрован рatchet-ом вместе с текстом) }
```

---

## 7. Конфигурация сервера

### 7.1 Файл конфигурации

```yaml
# config.yaml
server:
  port: 8443
  host: "0.0.0.0"

tls:
  certFile: "./certs/cert.pem"
  keyFile: "./certs/key.pem"
  # Или: acme: true + domain: "mydomain.com" (Let's Encrypt)

database:
  path: "./data/messenger.db"

storage:
  mediaPath: "./data/media"
  maxFileSizeBytes: 104857600  # 100 МБ

jwt:
  secret: "change-me-to-random-64-char-string"
  accessTokenTTL: "15m"
  refreshTokenTTL: "168h"

vapid:
  publicKey: "<VAPID public key>"
  privateKey: "<VAPID private key>"
  subject: "mailto:admin@example.com"

rateLimit:
  authRequestsPerSecond: 10
```

### 7.2 Генерация TLS сертификата (локальная сеть)

```bash
# Установить mkcert
brew install mkcert  # macOS
mkcert -install      # добавить локальный CA в браузеры

# Сгенерировать сертификат
mkcert -cert-file certs/cert.pem -key-file certs/key.pem \
  localhost 192.168.1.100 "*.local"
```

### 7.3 Деплой через Cloudflare Tunnel (без публичного IP)

```bash
# Установить cloudflared
brew install cloudflared

# Аутентификация
cloudflared tunnel login

# Создать туннель
cloudflared tunnel create messenger

# Запустить
cloudflared tunnel --url http://localhost:8080 run messenger
```

---

## 8. Структура базы данных

```sql
-- Версия схемы
CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
INSERT INTO schema_version VALUES (1);

-- Пользователи
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,  -- bcrypt
    avatar_path TEXT,
    created_at INTEGER NOT NULL   -- unix timestamp
);

-- Refresh токены
CREATE TABLE refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,  -- SHA-256 токена
    device_id TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

-- Identity ключи
CREATE TABLE identity_keys (
    user_id TEXT PRIMARY KEY,
    ik_public BLOB NOT NULL,
    spk_public BLOB NOT NULL,
    spk_signature BLOB NOT NULL,
    spk_id INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Одноразовые PreKeys
CREATE TABLE one_time_prekeys (
    id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    key_public BLOB NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_otpk_unused ON one_time_prekeys(user_id, used) WHERE used = 0;

-- Чаты
CREATE TABLE chats (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('direct', 'group')),
    name TEXT,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Участники чата
CREATE TABLE chat_members (
    chat_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (chat_id, user_id),
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_chat_members_user ON chat_members(user_id);

-- Сообщения
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    encrypted_payload BLOB NOT NULL,
    sender_key_id INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    delivered_at INTEGER,
    read_at INTEGER,
    FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id)
);
CREATE INDEX idx_messages_chat ON messages(chat_id, timestamp DESC);

-- Медиафайлы
CREATE TABLE media (
    id TEXT PRIMARY KEY,
    uploader_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (uploader_id) REFERENCES users(id)
);

-- Push подписки
CREATE TABLE push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh BLOB NOT NULL,
    auth BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_push_user ON push_subscriptions(user_id);
```

---

## 9. Сборка и запуск

### 9.1 Требования

- Go 1.22+
- Node.js 20+
- (Опционально) mkcert для локального TLS

### 9.2 Сборка

```bash
# Backend
cd server
go build -o ../bin/messenger-server ./cmd/server

# Frontend
cd client
npm install
npm run build
# Собранный PWA в client/dist/ — сервер раздаёт его как статику
```

### 9.3 Первый запуск

```bash
# Сгенерировать VAPID ключи
./bin/messenger-server generate-vapid

# Создать config.yaml (интерактивно)
./bin/messenger-server init

# Запустить
./bin/messenger-server --config config.yaml
```

### 9.4 Обновление

```bash
# Скачать новый бинарник
curl -L https://github.com/.../releases/latest/messenger-server -o messenger-server-new
chmod +x messenger-server-new

# Остановить текущий
kill $(cat messenger.pid)

# Запустить новый (автоматически применит миграции БД)
./messenger-server-new --config config.yaml
```

---

## 10. Ограничения и известные компромиссы

| Ограничение | Причина | Обходное решение |
|---|---|---|
| Нет видеозвонков | Требует WebRTC TURN-сервер, сложность | Roadmap v2 |
| Push на iOS только через Safari PWA | Apple не разрешает Web Push в других браузерах | Нет обходного пути |
| Сервер должен быть включён | Self-hosted на ПК | VPS или UPS |
| Нет синхронизации ключей между устройствами | E2E ограничение | Каждое устройство — отдельный identity |
| SQLite не масштабируется горизонтально | Дизайнерское решение | Миграция на PostgreSQL при росте |

---

## 11. Roadmap

### v1.0 (MVP)
- Личные чаты с E2E
- Групповые чаты до 50 человек
- Текст + изображения
- PWA для iOS и Android
- Web Push уведомления

### v1.1
- Голосовые сообщения
- Видео до 100 МБ
- Редактирование и удаление сообщений
- Верификация собеседника (Safety Number)

### v2.0
- Голосовые и видеозвонки (WebRTC)
- Синхронизация между устройствами одного пользователя
- Исчезающие сообщения

---

*Спецификация разработана архитектором команды messenger-team. Версия 1.0, дата 2026-04-07.*
