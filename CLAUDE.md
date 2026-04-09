# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Язык

В комментариях к коду используй русский язык. Документацию проекта пиши на английском. Prose с контрибьюторами — на русском.

## Команды для разработки

### Frontend (`client/`)

```sh
cd client
npm install
npm run dev        # Vite dev server на :5173 (proxy → :8080)
npm run build      # TypeScript + production bundle → dist/
npm run lint       # ESLint (нулевые warnings)
npm run type-check # tsc --noEmit
```

### Backend (`server/`)

```sh
cd server
go mod tidy
go build -o ./bin/server ./cmd/server
go test ./...
gofmt -w path/to/file.go
```

Hot-reload: `go install github.com/air-verse/air@latest && air`

### Единый бинарник (embedded PWA)

```sh
cd client && npm run build
cp -r dist ../server/cmd/server/static/
cd ../server && go build -o ./bin/messenger ./cmd/server
JWT_SECRET=your-secret ./bin/messenger   # :8080 — API + PWA
```

### Docker

```sh
docker compose build && docker compose up -d   # rebuild + restart
docker logs messenger --tail=50                # логи
docker compose ps                              # статус
```

### Переменные окружения сервера

| Переменная | Описание | По умолчанию |
|---|---|---|
| `JWT_SECRET` | Подпись JWT (обязательно) | — |
| `DB_PATH` | Путь к SQLite | `./messenger.db` |
| `MEDIA_DIR` | Директория медиафайлов | `./media` |
| `PORT` | Порт сервера | `8080` |
| `VAPID_PRIVATE_KEY` | Web Push приватный ключ | авто-генерация |
| `VAPID_PUBLIC_KEY` | Web Push публичный ключ | авто-генерация |
| `TLS_CERT` / `TLS_KEY` | TLS сертификаты | пусто (HTTP) |

## Архитектура

**Go backend + React PWA** — самохостируемый мессенджер с E2E-шифрованием по Signal Protocol.

### Источники истины
- `STATUS.md` — актуальный список реализованного и задач
- `docs/architecture.md` — архитектурные заметки

### Backend (`server/`)

```
server/
├── cmd/server/main.go      # точка входа, роуты, env
├── internal/
│   ├── auth/               # JWT (access 15 мин, refresh 7 дней, httpOnly cookie)
│   ├── chat/               # чаты, история, удаление/редактирование сообщений
│   ├── keys/               # управление ключами Signal Protocol
│   ├── media/              # загрузка и раздача файлов (до 10 МБ)
│   ├── push/               # VAPID Web Push
│   └── ws/                 # WebSocket Hub (gorilla/websocket)
└── db/
    ├── schema.go           # схема + auto-миграция (ALTER TABLE при старте)
    └── queries.go          # типизированные SQL-запросы
```

Пакеты — строчные, короткие имена. Явная обработка ошибок, небольшие request/response-структуры.

### Frontend (`client/src/`)

```
src/
├── api/
│   ├── client.ts           # REST (fetch + auto-refresh)
│   └── websocket.ts        # WS клиент
├── crypto/
│   ├── x3dh.ts             # X3DH initiator + responder
│   ├── ratchet.ts          # Double Ratchet + IndexedDB сериализация
│   ├── session.ts          # E2E Session Manager (кеш в памяти)
│   └── keystore.ts         # IndexedDB хранилище ключей
├── components/
│   ├── ChatWindow/
│   │   ├── ChatWindow.tsx  # чат, контекстное меню, вложения, режим редактирования
│   │   └── *.module.css
│   └── NewChatModal/       # создание direct + group чатов
├── hooks/
│   ├── useMessengerWS.ts   # WS события (message, ack, delete, edit, typing, read)
│   └── usePushNotifications.ts
├── store/
│   ├── chatStore.ts        # Zustand: чаты, сообщения (addMessage, deleteMessage, editMessage)
│   ├── authStore.ts
│   └── wsStore.ts
├── pages/                  # React Router v6 страницы
└── types/index.ts          # общие TypeScript типы
```

Избегай `any` для API payload, crypto state и WebSocket-сообщений.

### Коммуникация

- REST API: `GET|POST|DELETE|PATCH /api/*`
- WebSocket: `WS /ws?token=<JWT>` (реалтайм)
- Push: Web Push VAPID (без plaintext контента в payload)

### WebSocket события (входящие на клиент)

| type | Поля | Описание |
|------|------|----------|
| `message` | messageId, clientMsgId, chatId, senderId, ciphertext, timestamp | новое сообщение |
| `ack` | clientMsgId, chatId, timestamp | подтверждение доставки серверу |
| `message_deleted` | chatId, clientMsgId | сообщение удалено |
| `message_edited` | chatId, clientMsgId, ciphertext, editedAt | сообщение изменено |
| `typing` | chatId, userId | индикатор печати |
| `read` | chatId, messageId | сообщение прочитано |

### Шифрование (E2E — граница безопасности)

Сервер **не может** расшифровать содержимое сообщений:
- **X3DH** — установка сессии (Identity Keys, Signed PreKeys, One-Time PreKeys)
- **Double Ratchet** — шифрование каждого сообщения (XSalsa20-Poly1305)
- Приватные ключи хранятся только в **IndexedDB** устройства
- **Медиа payload**: `JSON.stringify({mediaId, originalName, mediaType, text?})` шифруется как обычный текст

### Ключевые инварианты БД

- `messages.client_msg_id` — UUID отправителя, общий для всех копий одного сообщения
- `messages.recipient_id` — получатель конкретной копии (каждый участник получает свою копию)
- `messages.is_deleted` — soft-delete (строка остаётся в БД)
- `GetMessages` всегда фильтрует по `recipient_id=userID AND is_deleted=0`

## Тестирование

Тестов пока нет. При добавлении: Go-тесты — `*_test.go` рядом с пакетом, frontend — `*.test.ts(x)`.

Минимум перед коммитом:
```sh
cd client && npm run type-check && npm run lint
cd server && go build ./...
```

Для crypto/auth-изменений обязательно тестировать: malformed inputs, replay/duplicate keys, expired tokens, пустые payload.

## Безопасность

- Серверные логи **никогда** не должны содержать: расшифрованный контент, пароли, токены, push subscription secrets
- `.env.example` — шаблон, не коммить реальные секреты
- Медиафайлы доступны без авторизации по случайным именам (16 байт hex) — приемлемо для MVP
- Если одна и та же ошибка повторяется больше 3 раз при отладке — остановись и предложи 3 варианта решения

## документация
Вся документация по проекту находиться в папке docs
