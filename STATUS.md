# Статус проекта Messenger

> Последнее обновление: 2026-04-08

## Быстрый старт

```bash
cd /Users/dim/vscodeproject/messenger

# Docker (продакшн)
docker compose build && docker compose up -d
# → http://192.168.1.80:8080

# Разработка (два терминала)
cd server && JWT_SECRET=dev ./bin/server   # Go backend :8080
cd client && npm run dev                   # Vite dev :5173 (proxy → :8080)
```

---

## Что реализовано ✅

### Backend (Go)

- `auth` — регистрация / вход / refresh / logout (bcrypt + JWT 15min + httpOnly cookie 7d)
- `ws/hub.go` — WebSocket хаб, per-user delivery, typing, ack, read receipts, BroadcastToConversation
- `chat` — создание чатов (direct + group), список чатов, история сообщений, удаление/редактирование
- `keys` — X3DH key bundle: GET /api/keys/:userId, POST /api/keys/prekeys
- `push` — Web Push VAPID: GET /api/push/vapid-public-key, POST /api/push/subscribe
- `media` — загрузка файлов (POST /api/media/upload, до 10 МБ), раздача (GET /api/media/:filename)
- SQLite WAL: conversations, messages (+ client_msg_id, recipient_id, is_deleted, edited_at), identity_keys, prekeys, push_subs, sessions
- Auto-миграция существующих БД при старте

### Frontend (React PWA)

- `AuthPage` — табы Войти / Регистрация, генерация X3DH ключей при регистрации
- `ChatListPage` — список чатов, кнопка нового чата, запрос push-разрешения
- `ChatWindow` — отправка / получение сообщений, история (GET /api/chats/:id/messages)
- `ChatWindow` — контекстное меню (долгое нажатие / ПКМ): копировать, редактировать, удалить
- `ChatWindow` — прикрепление файлов и фото (превью, загрузка, рендеринг изображений/файлов)
- `NewChatModal` — поиск пользователей + групповые чаты (вкладка "Группа", мультиселект)
- `crypto/x3dh.ts` — X3DH initiator + responder
- `crypto/ratchet.ts` — Double Ratchet encrypt/decrypt + сериализация в IndexedDB
- `crypto/session.ts` — менеджер E2E сессий (X3DH → рэтчет, in-memory кеш)
- `hooks/usePushNotifications.ts` — VAPID ключ с сервера, Web Push подписка
- `hooks/useMessengerWS.ts` — расшифровка входящих, обработка message_deleted / message_edited
- Service Worker (generateSW) + `public/push-handler.js`

---

## Что НЕ СДЕЛАНО / Нужно завершить 🔧

### 🟡 Важно (функция частично работает)

1. **E2E — стор копии у отправителя при загрузке истории**
   - Когда Alice загружает историю, её собственные сообщения дешифруются через сессию с собой
   - `decryptMessage(id, m.senderId, ...)` для своих сообщений ищет сессию с самим собой — может не найти
   - Пока fallback: `tryDecode` возвращает base64-декодированный текст или сам payload

2. **E2E для медиафайлов**
   - Файлы хранятся на сервере в открытом виде (MVP)
   - Метаданные (mediaId, имя, тип) зашифрованы в ciphertext
   - Для полного E2E нужно шифровать файл на клиенте перед загрузкой

3. **Редактирование с E2E**: при PATCH перешифровывает для всех участников — работает только если сессия уже установлена

### 🔴 Следующая сессия — ПРИОРИТЕТ

0. **Аудио и видео звонки в чатах**
   - WebRTC peer-to-peer (или через TURN/STUN сервер)
   - Сигнализация через WebSocket (offer/answer/ICE candidates)
   - UI: кнопка звонка в чате, входящий звонок (модал), активный звонок (управление микрофоном/камерой)
   - Нужны новые WS-события: `call_offer`, `call_answer`, `call_ice`, `call_end`

### 🟢 Желательно (улучшения)

4. **Групповые чаты — Sender Keys**
   - Текущая реализация: N копий сообщения (по одной на участника)
   - Нужны Sender Keys для масштабируемости больших групп

5. **Пагинация истории** — загружается только последние 50, кнопки "загрузить ещё" нет

6. **Статусы в группах** — read/delivered не агрегируются по всем участникам

7. **Профиль пользователя** — страница есть, логика не реализована

8. **Шифрование медиафайлов** — файлы на сервере в открытом виде

---

## Ключевые файлы

| Файл | Роль |
|------|------|
| `server/db/schema.go` | Схема БД + auto-миграция |
| `server/db/queries.go` | SQL: messages (+ recipient_id, client_msg_id, is_deleted, edited_at) |
| `server/internal/ws/hub.go` | WS хаб, Deliver, BroadcastToConversation |
| `server/internal/chat/handler.go` | Чаты, сообщения, Delete/Edit эндпоинты |
| `server/internal/media/handler.go` | Загрузка и раздача медиафайлов |
| `server/cmd/server/main.go` | Роуты, VAPID, MEDIA_DIR |
| `client/src/crypto/session.ts` | E2E Session Manager (X3DH + Ratchet) |
| `client/src/components/ChatWindow/ChatWindow.tsx` | Основной чат-компонент |
| `client/src/store/chatStore.ts` | Стор сообщений и чатов (Zustand) |
| `client/src/hooks/useMessengerWS.ts` | WS-клиент и обработка событий |

---

## Команды для следующей сессии

```bash
# Проверить Go компиляцию
cd /Users/dim/vscodeproject/messenger/server && go build ./...

# Проверить TypeScript
cd /Users/dim/vscodeproject/messenger/client && npm run type-check && npm run lint

# Docker rebuild и деплой
cd /Users/dim/vscodeproject/messenger
docker compose build && docker compose up -d
```

---

## Известные технические детали

- **Libsodium**: CJS-файл через кастомный Vite плагин (`libsodiumCjsPlugin` в vite.config.ts)
- **Cookie Secure**: определяется динамически (`r.TLS != nil || X-Forwarded-Proto: https`)
- **WS auth**: сервер делает Upgrade ПЕРЕД проверкой токена, затем закрывает с кодом 4001
- **Ciphertext wire format**: `btoa(JSON.stringify({v:1, ek?, opkId?, ikPub?, msg: EncryptedMessage}))`
- **Media payload**: текст → plain string; медиа → `JSON.stringify({mediaId, originalName, mediaType, text?})`
- **client_msg_id**: UUID генерируется на клиенте, хранится в БД для delete/edit по всем копиям
- **recipient_id**: каждая копия сообщения имеет recipient_id → GetMessages фильтрует нужную копию
- **Деплой VAPID**: ключи генерируются при старте, добавить в `.env` чтобы сохранить между перезапусками
- **iOS**: `crypto.randomUUID()` недоступен до iOS 15.4 → polyfill в ChatWindow.tsx
