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
│   │   ├── crypto/
│   │   ├── hooks/
│   │   ├── pages/
│   │   ├── store/
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
- `VAPID_PRIVATE_KEY`
- `VAPID_PUBLIC_KEY`
- `TLS_CERT`
- `TLS_KEY`

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

Подключены:

- `middleware.Logger`
- `middleware.Recoverer`
- `middleware.Timeout(30 * time.Second)`

## 7. Backend: HTTP API

### 7.1 Публичные маршруты

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/push/vapid-public-key`
- `GET /api/media/{filename}`
- `GET /ws`

### 7.2 Защищённые маршруты

Под `auth.Middleware`:

- `GET /api/users/search`
- `GET /api/chats`
- `POST /api/chats`
- `GET /api/chats/{chatId}/messages`
- `DELETE /api/messages/{clientMsgId}`
- `PATCH /api/messages/{clientMsgId}`
- `GET /api/keys/{userId}`
- `POST /api/keys/prekeys`
- `POST /api/push/subscribe`
- `POST /api/media/upload`

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

Текущий ответ содержит только:

- `id`
- `type`
- `name`
- `members`
- `createdAt`

Последнее сообщение, `updatedAt`, `unreadCount` на сервере не считаются и клиент во многом поддерживает эти поля локально.

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
- поддерживает курсорную пагинацию по `created_at`;
- возвращает только сообщения, адресованные текущему пользователю или сообщения без конкретного `recipient_id`;
- не возвращает удалённые сообщения;
- отдаёт `nextCursor`, основанный на timestamp последнего элемента.

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

- `message`
- `typing`
- `read`

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
- дополнительная broadcast-логика read receipts сейчас не реализована.

### 10.7 Исходящие события сервера

Клиенту могут приходить:

- `message`
- `ack`
- `typing`
- `message_deleted`
- `message_edited`
- `prekey_request`
- `error`

## 11. Backend: модуль ключей E2E

Файл: [`server/internal/keys/handler.go`](/Users/dim/vscodeproject/messenger/server/internal/keys/handler.go)

### 11.1 Получение key bundle

`GET /api/keys/{userId}`:

- читает `identity_keys`;
- атомарно извлекает один неиспользованный `pre_key` через `PopPreKey`;
- возвращает:
  - `ikPublic`
  - `spkId`
  - `spkPublic`
  - `spkSignature`
  - при наличии `opkId` и `opkPublic`

Это соответствует базовому X3DH-потоку.

### 11.2 Загрузка новых prekeys

`POST /api/keys/prekeys`:

- принимает массив новых one-time prekeys;
- сохраняет их в таблицу `pre_keys`.

### 11.3 Низкий запас prekeys

В коде предусмотрен механизм `NotifyPreKeyLow`, но он сейчас фактически не подключён в поток выдачи bundle. Есть только комментарий, что клиент сам сможет запросить это при следующем подключении.

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

- принимает multipart `file`;
- ограничивает размер до 10 МБ;
- определяет MIME по первым 512 байтам;
- выбирает расширение из allowlist;
- генерирует случайное имя файла;
- сохраняет файл в `MEDIA_DIR`;
- возвращает:
  - `filename`
  - `url`
  - `originalName`
  - `contentType`

### 13.2 Serve

`GET /api/media/{filename}`:

- без авторизации;
- защищён от path traversal;
- раздаёт файл с long-term cache headers.

Важно: содержимое файла сейчас хранится без шифрования на сервере. В спецификации ожидается encrypted media at rest, но в текущем коде этого нет.

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

Публичные ключи устройства/пользователя:

- `ik_public`
- `spk_public`
- `spk_signature`
- `spk_id`
- `updated_at`

#### `pre_keys`

One-time prekeys:

- `id`
- `user_id`
- `key_public`
- `used`

#### `push_subscriptions`

- `id`
- `user_id`
- `endpoint`
- `p256dh`
- `auth`

### 15.3 Индексы и миграции

Схема содержит индекс по истории сообщений:

- `idx_messages_conv_time` на `(conversation_id, created_at DESC)`

В `schema.go` также есть простые runtime-миграции через `ALTER TABLE` для старых БД:

- `client_msg_id`
- `recipient_id`
- `is_deleted`
- `edited_at`

## 16. Frontend: архитектура приложения

### 16.1 Bootstrap

Файлы:

- [`client/src/main.tsx`](/Users/dim/vscodeproject/messenger/client/src/main.tsx)
- [`client/src/App.tsx`](/Users/dim/vscodeproject/messenger/client/src/App.tsx)

Приложение:

- монтируется в React root;
- использует `BrowserRouter`;
- при наличии авторизации подключает глобальный `useMessengerWS`.

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
- `uploadMedia`
- `mediaUrl`
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

- `setChats`
- `upsertChat`
- `addMessage`
- `prependMessages`
- `updateMessageStatus`
- `deleteMessage`
- `editMessage`
- `setTyping`
- `markRead`

Есть локальная дедупликация сообщений и optimistic update.

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
- при входящих `message` дешифрует payload через `decryptMessage`;
- при `message_edited` обновляет локальный текст;
- при `message_deleted` удаляет сообщение из стора;
- при `typing` ставит typing state;
- при `ack` обновляет статус оптимистичного сообщения;
- если приходит `prekey_request`, клиент может позже догрузить prekeys.

Также хук:

- при необходимости дозагружает список чатов, если сообщение пришло в неизвестный чат;
- выполняет logout при безуспешном refresh WebSocket-токена.

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

- identity key pair;
- signed prekey;
- one-time prekeys;
- ratchet session state;
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

Реализует упрощённый Double Ratchet:

- chain key;
- message key derivation;
- DH ratchet при смене ключей;
- сериализацию и десериализацию состояния;
- `ratchetEncrypt` / `ratchetDecrypt`.

### 23.4 `session.ts`

Файл: [`client/src/crypto/session.ts`](/Users/dim/vscodeproject/messenger/client/src/crypto/session.ts)

Это orchestration-слой над X3DH и Double Ratchet:

- при первом сообщении как инициатор получает key bundle адресата;
- создаёт ephemeral key;
- выполняет X3DH;
- инициализирует ratchet state;
- добавляет X3DH-заголовок в wire payload;
- для последующих сообщений использует сохранённую сессию;
- при первом входящем сообщении может инициализироваться как responder.

Wire payload кодируется как `base64(JSON)` и содержит:

- `v`
- `ek`
- `opkId`
- `ikPub`
- `msg`

## 24. PWA и сборка клиента

Файл: [`client/vite.config.ts`](/Users/dim/vscodeproject/messenger/client/vite.config.ts)

### 24.1 Особенности конфигурации

- alias `@ -> src`
- кастомный resolver для `libsodium-wrappers`, который принудительно ведёт на CJS-сборку
- `VitePWA` с `generateSW`
- `registerType: autoUpdate`

### 24.2 Runtime caching

Настроено кэширование:

- `/api/*` через `NetworkFirst`
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
- локальное IndexedDB-хранилище ключей и ratchet state;
- MVP-поддержка direct и group chat;
- UI уже поддерживает редактирование, удаление, вложения и optimistic sending.

## 28. Расхождения со спецификацией и ограничения текущей реализации

Ниже перечислены самые важные расхождения между кодом и ожидаемой целевой архитектурой.

### 28.1 Структура проекта

В спецификации и старой архитектурной заметке фигурируют каталоги `api/`, `ws/`, `crypto/`, `storage/` и отдельные файлы SQL. В фактическом коде backend организован через `internal/*` и `db/*.go`. Документацию и будущие планы нужно синхронизировать с реальной структурой.

### 28.2 Медиа не шифруются на сервере

Спецификация требует encrypted media at rest. Сейчас на сервере:

- сохраняется обычный файл;
- раздача идёт без авторизации;
- защита строится только на случайном имени файла.

### 28.3 WebSocket origin policy

`CheckOrigin: func(...) bool { return true }`.

Это допустимо для локального MVP, но небезопасно для публичного деплоя.

### 28.4 Read receipts

Сервер умеет помечать сообщение как read в БД, но не рассылает полноценные read receipts обратно участникам. UI-состояния `read` пока поддерживаются частично.

### 28.5 Sender Keys

Спецификация заявляет Sender Keys для групп. Текущая реализация группы устроена иначе:

- клиент шифрует payload отдельно для каждого участника;
- сервер хранит отдельную копию на каждого участника.

Это проще, но не является полноценной Sender Keys реализацией.

### 28.6 Device model

Есть логическая возможность нескольких подключений на одного пользователя в Hub, но:

- нет явной серверной сущности device;
- identity keys привязаны к `user_id`, а не к отдельному устройству;
- multi-device криптографическая модель пока упрощена.

### 28.7 Поиск пользователей

UI пишет "Поиск по имени или username", но backend ищет только по `username`.

### 28.8 Часть документации устарела

Есть несколько расхождений:

- dev-порт `3000` в `vite.config.ts`, но часть текстов всё ещё говорит о `5173`;
- `client/README.md` и старые заметки местами описывают планы, а не фактическое состояние;
- в repo instructions упоминается второй frontend, которого сейчас нет.

### 28.9 Push subscription refresh

Сценарий `pushsubscriptionchange` в Service Worker, вероятно, не сможет обновить подписку без JWT-контекста.

### 28.10 Контакты

Таблица `contacts` и query-функции существуют, но пользовательский API для работы с контактами сейчас не задействован.

## 29. Рекомендации по дальнейшему развитию

### 29.1 Безопасность

- ограничить `CheckOrigin`;
- ввести device-level key model;
- зашифровать media at rest;
- продумать безопасную авторизацию на раздачу медиа;
- добавить нормальную обработку компрометации ratchet state и skipped keys.

### 29.2 Согласование модели данных

- либо продолжить модель "копия сообщения на получателя" и формализовать её;
- либо перейти к единой сущности сообщения + таблице delivery state.

### 29.3 API и realtime

- реализовать read receipt broadcast;
- формализовать `prekey_request` lifecycle;
- синхронизировать DTO между сервером и клиентом;
- стабилизировать поля `lastMessage`, `updatedAt`, `unreadCount` на сервере.

### 29.4 Документация

- привести [`docs/architecture.md`](/Users/dim/vscodeproject/messenger/docs/architecture.md) в соответствие фактической структуре;
- обновить `README.md` по dev-портам и реальному состоянию модулей;
- завести ADR или отдельный раздел по текущей модели E2E и group chat.

## 30. Итог

Проект уже представляет собой рабочий MVP self-hosted мессенджера с:

- JWT-аутентификацией;
- SQLite persistence;
- real-time доставкой через WebSocket;
- PWA-клиентом;
- локальным клиентским E2E-слоем;
- поддержкой медиа, редактирования и удаления сообщений;
- Web Push уведомлениями.

При этом система ещё не завершена как production-grade secure messenger. Основные незакрытые зоны это:

- device-level криптография;
- полноценная групповая криптография;
- encrypted media at rest;
- ужесточение безопасности сети и origin policy;
- выравнивание кода и документации.

С точки зрения разработки проект уже имеет хорошую основу: структура понятна, модули отделены, а ключевые пользовательские сценарии покрыты кодом.
