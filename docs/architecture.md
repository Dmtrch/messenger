# Архитектура мессенджера (WhatsApp-аналог)

## Обзор системы

Self-hosted мессенджер с E2E-шифрованием, серверной частью на ПК пользователя и PWA-фронтендом для iOS/Android.

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
Sender Keys (как в Signal):
  - Каждый участник генерирует SenderKey
  - Распространяет его остальным через X3DH-сессии (индивидуально)
  - Сообщения шифруются один раз SenderKey → доставляются всем
```

---

## API-контракт (REST + WebSocket)

### REST эндпоинты

```
POST /api/auth/register        — регистрация пользователя
POST /api/auth/login           — вход, получение JWT
GET  /api/keys/:userId         — получение публичных ключей пользователя
POST /api/keys/prekeys         — загрузка новых одноразовых ключей
GET  /api/chats                — список чатов
GET  /api/chats/:id/messages   — история сообщений (пагинация)
POST /api/media/upload         — загрузка медиафайлов
GET  /api/media/:id            — скачивание медиафайла
POST /api/push/subscribe       — регистрация Push-подписки
```

### WebSocket протокол

```
Соединение: WSS /ws?token=<JWT>

Входящие события (сервер → клиент):
  { type: "message", chatId, encryptedPayload, senderKeyId, timestamp }
  { type: "ack", messageId }
  { type: "typing", chatId, userId }
  { type: "presence", userId, status }
  { type: "prekey_request" }  // просьба загрузить новые одноразовые ключи

Исходящие события (клиент → сервер):
  { type: "message", chatId, recipients: [{userId, encryptedPayload}] }
  { type: "typing", chatId }
  { type: "read", chatId, messageId }
```

---

## Схема базы данных

```sql
-- Пользователи
CREATE TABLE users (
    id TEXT PRIMARY KEY,       -- UUID
    username TEXT UNIQUE,
    display_name TEXT,
    avatar_path TEXT,
    created_at INTEGER
);

-- Публичные ключи (для E2E)
CREATE TABLE identity_keys (
    user_id TEXT PRIMARY KEY,
    ik_public BLOB,            -- Identity Key
    spk_public BLOB,           -- Signed PreKey
    spk_signature BLOB,
    spk_id INTEGER,
    updated_at INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE one_time_prekeys (
    id INTEGER PRIMARY KEY,
    user_id TEXT,
    key_public BLOB,
    used INTEGER DEFAULT 0,    -- 0/1
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Сообщения (хранятся в зашифрованном виде)
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT,
    sender_id TEXT,
    encrypted_payload BLOB,    -- шифрованное содержимое
    sender_key_id INTEGER,     -- какой ключ использован
    timestamp INTEGER,
    delivered INTEGER DEFAULT 0,
    read INTEGER DEFAULT 0
);

-- Чаты
CREATE TABLE chats (
    id TEXT PRIMARY KEY,
    type TEXT,                 -- 'direct' | 'group'
    name TEXT,
    created_at INTEGER
);

CREATE TABLE chat_members (
    chat_id TEXT,
    user_id TEXT,
    joined_at INTEGER,
    PRIMARY KEY (chat_id, user_id)
);

-- Push-подписки
CREATE TABLE push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    endpoint TEXT,
    p256dh BLOB,
    auth BLOB
);
```

---

## Структура проекта

```
messenger/
├── docs/
│   └── architecture.md        ← этот файл
├── server/                    ← Go backend
│   ├── main.go
│   ├── config/
│   ├── api/
│   │   ├── auth.go
│   │   ├── keys.go
│   │   ├── messages.go
│   │   └── media.go
│   ├── ws/
│   │   └── hub.go
│   ├── db/
│   │   ├── schema.sql
│   │   └── queries.go
│   ├── crypto/
│   │   └── push.go            ← VAPID Web Push
│   └── storage/
│       └── media.go
├── client/                    ← React PWA
│   ├── public/
│   │   ├── manifest.json
│   │   └── sw.js              ← Service Worker
│   ├── src/
│   │   ├── crypto/
│   │   │   ├── x3dh.ts        ← X3DH key exchange
│   │   │   ├── ratchet.ts     ← Double Ratchet
│   │   │   └── keystore.ts    ← IndexedDB key storage
│   │   ├── store/             ← Zustand stores
│   │   ├── components/
│   │   └── api/
│   ├── vite.config.ts
│   └── package.json
└── README.md
```

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
4. **JWT с коротким TTL** (15 мин) + Refresh Token (7 дней) в httpOnly cookie
5. **Rate limiting** на все эндпоинты
6. **Медиафайлы** хранятся с рандомизированными именами, не публичны без токена
7. **TLS обязателен** — HTTP запрещён даже в локальной сети

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
