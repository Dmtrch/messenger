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

## 3. Фактическая структура репозитория

На текущий момент в репозитории реально используются:

```text
messenger/
├── client/                     # React PWA
│   ├── public/
│   │   └── push-handler.js
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   │   └── OfflineIndicator/   # UI-баннер offline-состояния
│   │   ├── crypto/
│   │   ├── hooks/
│   │   ├── pages/
│   │   ├── store/                  # Zustand + IDB модули
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
│   ├── cmd/server/main.go      # entrypoint, роутинг, static hosting
│   ├── db/
│   │   ├── schema.go
│   │   └── queries.go
│   ├── internal/
│   │   ├── auth/
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
- в `server/` лежат локальные файлы SQLite (`messenger.db`, `-wal`, `-shm`) и собранный бинарник `server/bin/server`, то есть репозиторий использовался для локального запуска.

## 4. Технологический стек

### 4.1 Backend

- Go 1.22
- `github.com/go-chi/chi/v5`
- `github.com/golang-jwt/jwt/v5`
- `github.com/gorilla/websocket`
- `modernc.org/sqlite`
- `github.com/SherClockHolmes/webpush-go`
- `golang.org/x/crypto/bcrypt`

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

## 6. Backend: точка входа и конфигурация

Файл: [`server/cmd/server/main.go`](/Users/dim/vscodeproject/messenger/server/cmd/server/main.go)

### 6.1 Переменные окружения

Поддерживаются:

- `PORT`, по умолчанию `8080`
- `DB_PATH`, по умолчанию `./messenger.db`
- `MEDIA_DIR`, по умолчанию `./media`
- `JWT_SECRET`, обязательный
- `ALLOWED_ORIGIN` — разрешённый origin для WebSocket CheckOrigin
- `BEHIND_PROXY` — `true` при запуске за reverse proxy (Cloudflare Tunnel, nginx): включает HSTS, доверяет X-Real-IP/X-Forwarded-For
- `VAPID_PRIVATE_KEY` / `VAPID_PUBLIC_KEY`
- `TLS_CERT` / `TLS_KEY`
- `STUN_URL`, по умолчанию `stun:stun.l.google.com:19302`
- `TURN_URL` / `TURN_SECRET` / `TURN_CREDENTIAL_TTL` (TTL в секундах, по умолчанию 86400)

Если VAPID-ключи не заданы, сервер генерирует их на старте и выводит в лог. Это удобно для локальной разработки, но ломает уже выданные push-подписки после рестарта, если ключи не сохранены.

### 6.2 Инициализация

На старте сервер:

- открывает SQLite через `db.Open`;
- применяет схему и миграции;
- создаёт WebSocket Hub;
- инициализирует хендлеры `auth`, `chat`, `media`, `users`, `keys`, `push`;
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

### 8.5 JWT middleware

`auth.Middleware`:

- требует `Authorization: Bearer <token>`;
- валидирует HMAC JWT;
- извлекает `sub`;
- кладёт `userID` в `request.Context`.

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

Hub хранит `map[userID]set[client]`, то есть несколько активных соединений на одного пользователя. Это позволяет поддерживать multi-device на уровне подключений.

### 10.2 Аутентификация

`GET /ws?token=<JWT>`:

- токен читается из query string;
- upgrade в WebSocket выполняется всегда;
- при невалидном токене соединение закрывается кодом `4001 unauthorized`.

Это важно для клиентской логики: браузер не может передавать произвольный `Authorization` header в стандартный WebSocket API, поэтому query parameter здесь является фактическим механизмом авторизации.

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

При получении `message`:

- проверяется членство отправителя в чате;
- для каждого получателя создаётся отдельная строка в `messages`;
- копия отправителя тоже сохраняется как отдельная запись;
- отправителю приходит `ack` с `clientMsgId`;
- получателям приходит событие `message`;
- если получатель online, сервер помечает сообщение как delivered;
- если получатель offline и это не self-copy, отправляется Web Push.

Текущая модель хранения сообщений не хранит одну сущность сообщения плюс таблицу получателей. Вместо этого создаются отдельные копии на получателя, связанные через `client_msg_id`.

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

## 11. Backend: модуль ключей E2E

Файл: [`server/internal/keys/handler.go`](/Users/dim/vscodeproject/messenger/server/internal/keys/handler.go)

### 11.1 Получение key bundle

`GET /api/keys/{userId}`:

- читает `identity_keys` (первое устройство пользователя);
- атомарно извлекает один неиспользованный `pre_key` через `PopPreKey(userID, deviceID)` — фильтрует по device_id, чтобы не выдать OPK от другого устройства;
- возвращает:
  - `userId`
  - `deviceId` (если есть)
  - `ikPublic`
  - `spkId`, `spkPublic`, `spkSignature`
  - при наличии `opkId` и `opkPublic`

Это соответствует базовому X3DH-потоку.

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
- генерирует UUID `mediaId` (независимый от имени файла на диске);
- создаёт запись в `media_objects`;
- возвращает:
  - `mediaId`
  - `originalName`
  - `contentType`

Клиент шифрует файл через `uploadEncryptedMedia()`: XSalsa20-Poly1305, nonce || ciphertext, случайный media key. Ключ встраивается в зашифрованный message payload.

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
- каждая строка привязана к конкретному `recipient_id`.

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

- `/auth` — экран логина/регистрации
- `/` — список чатов
- `/chat/:chatId` — окно переписки
- `/profile` — профиль пользователя

Неавторизованный пользователь всегда редиректится на `/auth`.

## 17. Frontend: REST API клиент

Файл: [`client/src/api/client.ts`](/Users/dim/vscodeproject/messenger/client/src/api/client.ts)

### 17.1 Общая модель

Клиент использует единый helper `req<T>()`, который:

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

Также реализует:

- `setSession`
- `logout`

### 19.2 `chatStore`

Файл: [`client/src/store/chatStore.ts`](/Users/dim/vscodeproject/messenger/client/src/store/chatStore.ts)

Хранит:

- `chats`
- `messages` как словарь `chatId -> Message[]`
- `typingUsers`

Операции:

- `setChats` — при вызове автоматически сохраняет список в IndexedDB через `saveChats()`
- `upsertChat`
- `addMessage`
- `prependMessages`
- `updateMessageStatus`
- `deleteMessage`
- `editMessage`
- `setTyping`
- `markRead`

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
- push subscription.

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

- symmetric ratchet (chain key → message key derivation);
- DH ratchet при смене ключей (два шага: derive recv chain + send chain за один ratchet step);
- кэш skipped message keys (`skippedKeys`, лимит `MAX_SKIP=100`);
- `prevSendCount` (pn) в заголовке для поддержки out-of-order доставки;
- `ratchetEncrypt` / `ratchetDecrypt` (при расшифровке сначала ищет skipped cache);
- сериализацию/десериализацию состояния для IndexedDB.

### 23.4 `session.ts`

Файл: [`client/src/crypto/session.ts`](/Users/dim/vscodeproject/messenger/client/src/crypto/session.ts)

Orchestration-слой над X3DH, Double Ratchet и Sender Keys:

- `encryptMessage(chatId, recipientId, plaintext)` — direct E2E через X3DH+Ratchet;
- `decryptMessage(chatId, senderId, ciphertext)` — direct E2E decrypt;
- `encryptGroupMessage(chatId, myUserId, members, plaintext)` — lazy SKDM при первом сообщении, затем SenderKey encrypt;
- `decryptGroupMessage(chatId, senderId, ciphertext)` — SenderKey decrypt;
- `handleIncomingSKDM(chatId, senderId, ciphertext)` — расшифровывает SKDM через E2E сессию, сохраняет peer SenderKey.

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

### 28.2 Sender Key ротация при смене состава группы

При добавлении или исключении участника группы SenderKey не пересоздаётся. Новый участник может получить SKDM и расшифровать сообщения, отправленные до его вступления.

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

Остаётся: групповые звонки требуют SFU (LiveKit) — отдельный тяжёлый сервис, не входит в текущий монолит.

## 29. Рекомендации по дальнейшему развитию

### 29.1 Приоритет 1 — Device model (частично закрыт)

Фундамент заложен: composite PK в `identity_keys`, `PopPreKey` по device, идемпотентный `POST /api/keys/register`. Остаётся: GET bundle всех устройств, per-device ratchet на клиенте.

### 29.2 ~~Приоритет 2 — Offline history~~ ✅ Закрыто в этапе 6

IndexedDB persistence реализован: `messageDb.ts` сохраняет историю и список чатов, `outboxDb.ts` хранит очередь исходящих, `useOfflineSync` сбрасывает очередь при reconnect, `OfflineIndicator` сигнализирует об offline-состоянии.

### 29.3 Приоритет 3 — Sender Key ротация

При изменении состава группы (добавление/удаление участника) пересоздавать SenderKey и рассылать новый SKDM всем текущим участникам.

### 29.4 Тесты

- Go-тесты: auth, keys, chat, ws, db — минимум сценарии refresh rotation, forbidden access, prekey depletion;
- Frontend-тесты: Vitest + Testing Library для `ratchet.ts`, `session.ts`, `senderkey.ts`, `AuthPage`, `ChatWindow`.

### 29.6 Аудио/видео звонки ✅ Закрыто (этап 9)

Звонки 1-на-1, STUN, TURN реализованы. Остаётся: групповые звонки (LiveKit SFU) как отдельный Docker-сервис.

### 29.5 Эксплуатация (частично закрыто)

- ~~versioned migrations~~ ✅ — `server/db/migrate.go`, migration runner с `schema_migrations`;
- ~~deployment guide для Cloudflare Tunnel~~ ✅ — `docs/deployment.md`;
- конфигурационный файл сервера — остаётся.

## 30. Итог

Проект уже представляет собой рабочий MVP self-hosted мессенджера с:

- JWT-аутентификацией;
- SQLite persistence;
- real-time доставкой через WebSocket;
- PWA-клиентом;
- локальным клиентским E2E-слоем;
- поддержкой медиа, редактирования и удаления сообщений;
- Web Push уведомлениями.

Этапы 1–6 плана `v1-gap-remediation.md` закрыты. Реализованы:

- security headers, rate limiting, bcrypt=12, SameSite=Strict, WS origin allowlist;
- mediaId, JWT-защищённый медиадоступ, client-side encrypted media at rest;
- device entity, POST /api/keys/register;
- server-driven unreadCount/updatedAt, opaque cursor pagination, read receipt broadcast;
- skipped message keys, prekey_low lifecycle, Sender Keys для групп;
- IndexedDB persistence истории и чатов, offline outbox с auto-resend, OfflineIndicator.

Незакрытые зоны:

- полноценный multi-device (GET bundle всех устройств, per-device ratchet на клиенте);
- Sender Key ротация при смене состава группы;
- тесты backend и frontend;
- конфигурационный файл сервера;
- смена пароля с инвалидацией всех сессий.

С точки зрения разработки проект уже имеет хорошую основу: структура понятна, модули отделены, а ключевые пользовательские сценарии покрыты кодом.
