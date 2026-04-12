# Чеклист закрытия разрывов со спецификацией

Источник: [`docs/unimplemented-spec-tasks.md`](/Users/dim/vscodeproject/messenger/docs/unimplemented-spec-tasks.md)

## Must

- [ ] Ввести полноценную multi-device модель — **сервер ✅, клиент в работе**
  - [x] GET /api/keys/:userId возвращает `{ devices: [...] }` — bundle для каждого устройства
  - [x] WS Hub: `client.deviceID`, `DeliverToDevice`, `senderDeviceId` в WS payload
  - [x] `messages.destination_device_id` (migration #8) — адресное хранение
  - [x] `session.ts`: sessionKey → `peerId:deviceId`; `encryptForAllDevices`; `decryptMessage(senderId, deviceId, ct)`
  - [x] `client.ts`: тип `PreKeyBundleResponse { devices: DeviceBundle[] }`
  - [x] `useMessengerWS.ts`: передавать `senderDeviceId` в `decryptMessage`; `?deviceId=` в WS URL
  - [x] `ChatWindowPage.tsx`: fan-out шифрование — отдельный ciphertext на каждое устройство получателя
- [x] Реализовать `POST /api/keys/register`
- [x] Реализовать Sender Keys для групп
- [x] Добавить skipped message keys в Double Ratchet
- [x] Реализовать encrypted media at rest
- [x] Защитить `GET /api/media/:id` через JWT
- [x] Перейти с `filename` на `mediaId`
- [x] Довести delivery/read receipts до полного realtime-цикла
- [x] Реализовать offline history viewing
- [x] Сделать TLS обязательным в production
- [x] Перевести refresh cookie на `SameSite=Strict`
- [x] Зафиксировать bcrypt cost = 12
- [x] Добавить rate limiting для auth endpoints
- [x] Добавить security headers

## Should

- [x] Добавить смену пароля с инвалидцией всех сессий
- [x] Перейти на пагинацию истории по `messageId` или opaque cursor
- [x] Реализовать серверные `unreadCount`, `updatedAt`, `lastMessage`
- [x] Довести lifecycle `prekey_request`
- [x] Добавить полноценный offline sync слой поверх IndexedDB
- [x] Ограничить `CheckOrigin` для WebSocket
- [x] Ввести конфигурационный файл сервера
- [x] Перейти на versioned migrations и целевую схему БД
- [x] Добавить backend tests
- [x] Добавить frontend tests

## Could

- [x] Подготовить проверенный deployment guide для Cloudflare Tunnel
- [x] Описать и автоматизировать update path без потери данных
- [ ] Встроить обязательную синхронизацию документации в процесс разработки

## Этап 11 — Native clients Foundation

- [x] Зафиксировать native-first архитектурную стратегию в RFC
- [x] Зафиксировать compatibility matrix для `Desktop` / `Android` / `iOS`
- [x] Зафиксировать ADR по secure storage
- [x] Зафиксировать ADR по local DB
- [x] Зафиксировать ADR по crypto stack
- [x] Зафиксировать ADR по desktop framework
- [x] Зафиксировать ADR по iOS UI
- [x] Подготовить каркас каталогов `shared/` и `apps/`
- [x] Описать platform-neutral интерфейсы `AuthEngine`, `WSClient`, `CryptoEngine`, `MessageRepository`
- [x] Подготовить `shared/test-vectors/` для cross-platform crypto compatibility
- [x] Зафиксировать formal schemas для REST, WebSocket и message envelope
- [x] Описать domain models, repositories, auth/session, websocket lifecycle, sync/outbox semantics

## Звонки (этап 9)

- [x] Реализовать WebRTC-сигнализацию (call_offer / call_answer / ice_candidate / call_end / call_reject)
- [x] Добавить клиентский UI звонков (входящий, активный, управление камерой/микрофоном)
- [x] Прописать STUN-конфигурацию в RTCPeerConnection
- [x] Добавить поддержку TURN-сервера (coturn + временные credentials через /api/calls/ice-servers)
- [ ] Реализовать групповые звонки через SFU (LiveKit)

## Долг и верификация по этапам 1–4

### Этап 1 — Security (закрыт, но требует проверки)

- [x] **CSP совместимость с production bundle**: `script-src 'self'` установлен в security.go; Vite production build совместим
- [x] **HSTS за Cloudflare Tunnel**: добавлен `BEHIND_PROXY=true` — при установке выставляет HSTS без локальных TLS-сертификатов
- [x] **realIP доверяет прокси-заголовкам только при BEHIND_PROXY=true**: при прямом доступе всегда используется RemoteAddr

### Этап 2 — Media (есть функциональный пропуск)

- [x] **conversation_id привязывается при upload**: `media/handler.go` читает `chat_id` из form-field и сохраняет в `ConversationID` при вставке
- [x] **Очистка orphaned media**: `StartOrphanCleaner` — горутина раз в час удаляет записи и файлы без привязки к чату старше 24 часов

### Этап 3 — Device model (архитектурный пропуск)

- [x] **identity_keys — PK по user_id, не по device_id**: migration #7 пересоздаёт таблицу с PK `(user_id, device_id)`; schema.go обновлён для свежих установок; `UpsertIdentityKey` переключён на `ON CONFLICT(user_id, device_id)`
- [x] **PopPreKey не учитывает device_id**: `PopPreKey(userID, deviceID)` фильтрует `WHERE user_id=? AND device_id=?`; `GetBundle` передаёт `ik.DeviceID`; WS hub передаёт `""` для суммарного подсчёта
- [x] **POST /api/keys/register не идемпотентен**: `GetIdentityKeyByIKPublic` ищет существующее устройство по IK — если найдено, переиспользуем device_id; иначе создаём новое

### Этап 10 — Полноценная multi-device модель (в работе, ветка `feature/stage9-multi-device`)

**Сервер — закрыто:**
- [x] **GetBundle → массив устройств**: `GetIdentityKeysByUserID` возвращает `[]IdentityKey`; `GET /api/keys/:userId` → `{ "devices": [{deviceId, ikPublic, spkId, spkPublic, spkSignature, opkId?, opkPublic?}] }`
- [x] **WS device-level routing**: `client.deviceID`; `ServeWS` читает `?deviceId=`, валидирует владельца через `GetDeviceByID`; `DeliverToDevice` — адресная доставка
- [x] **recipient.DeviceID**: `handleMessage` сохраняет `DestinationDeviceID`, маршрутизирует через `DeliverToDevice` или `Deliver`
- [x] **senderDeviceId в WS payload**: каждое `message` событие содержит `senderDeviceId` отправителя
- [x] **migration #8**: `messages.destination_device_id TEXT NOT NULL DEFAULT ''`

**Клиент — выполнено:**
- [x] `session.ts`: `sessionKey(peerId, deviceId)` — Signal Sesame spec
- [x] `session.ts`: `encryptForAllDevices`, `decryptMessage(senderId, deviceId, ct)`
- [x] `client.ts`: `PreKeyBundleResponse { devices: DeviceBundle[] }`
- [x] `useMessengerWS.ts`: `senderDeviceId` → decrypt; `?deviceId=` в WS URL

**Клиент — выполнено:**
- [x] `ChatWindowPage.tsx`: fan-out — отдельный ciphertext на каждое устройство

### Этап 4 — Message state (пропуски в UI)

- [x] **markChatRead вызывается при открытии чата**: `api.markChatRead(chatId)` добавлен в useEffect открытия в ChatWindow.tsx
- [x] **lastMessage в ChatSummary не расшифровывается (ChatListPage)**: `tryDecryptPreview` в `ChatListPage.tsx` — декрипт после `getChats()`, медиа → '📎 Вложение', ошибка → 'Зашифрованное сообщение'
- [x] **lastMessage — ChatWindowPage без декрипта**: `tryDecryptPreview` перенесена в `session.ts` как экспорт; `ChatWindowPage.tsx` и `useMessengerWS.ts` теперь декриптуют перед `upsertChat`
- [x] **lastMessage — useMessengerWS без декрипта**: исправлено вместе с ChatWindowPage
- [x] **Пагинация: nextCursor тип `string`**: `MessagesPage.nextCursor?: string` в `client.ts` — тип корректен везде

### Этап 5 — Crypto (закрыт, тесты добавлены)

- [x] **Skipped keys — TTL 7 дней**: `SkippedKeyEntry { key, storedAt }` в `ratchet.ts`; `purgeExpiredSkippedKeys` вызывается при decrypt и сериализации; backward-compat для старого формата
- [x] **Sender Keys — ротация при смене состава группы**: `upsertChat` в `chatStore.ts` детектирует изменение `members`, вызывает `invalidateGroupSenderKey(chatId)` — следующая отправка создаст новый SenderKey и разошлёт SKDM
- [x] **Encrypted media — MIME-тип скрыт**: сервер всегда хранит `application/octet-stream`; убран content sniffing; реальный тип только в E2E payload
- [x] **prekey_low — backoff 5 минут**: `isPreKeyReplenishOnCooldown` / `savePreKeyReplenishTime` в `keystore.ts`; `replenishPreKeys` в `useMessengerWS.ts` проверяет cooldown перед загрузкой

## Этап 12 — Multi-Server Support & Admin Panel

- [x] Новые поля конфигурации: `server_name`, `server_description`, `registration_mode`, `admin_username`, `admin_password`
- [x] `GET /api/server/info` — публичный эндпоинт, без JWT
- [x] Роль пользователя (`role`) в users, JWT claims, ответе login
- [x] Bootstrap-admin через `EnsureAdminUser` при первом старте
- [x] Invite codes — таблица, проверка (not found / used / expired), `UseInviteCode`
- [x] Registration requests — таблица, `POST /api/auth/request-register`, admin approve/reject
- [x] Password reset requests — таблица, `POST /api/auth/password-reset-request` без user enumeration, admin set temp password
- [x] `RequireAdmin` middleware (пакет `admin`)
- [x] Admin handlers (9): ListRegistrationRequests, ApproveRegistrationRequest, RejectRegistrationRequest, CreateInviteCode, ListInviteCodes, ListUsers, ResetUserPassword, ListPasswordResetRequests, ResolvePasswordResetRequest
- [x] Migrations #9–13
- [x] `serverConfig.ts`: `getServerUrl / setServerUrl / clearServerUrl / hasServerUrl / initServerUrl` + URL validation
- [x] `client.ts`: динамический BASE через `getServerUrl()`
- [x] `websocket.ts`: WS URL через `getServerUrl()`
- [x] `authStore.ts`: поле `role`
- [x] `chatStore.ts`: `reset()` action
- [x] `ServerSetupPage.tsx`: ввод и валидация URL сервера
- [x] `AdminPage.tsx`: 4 вкладки управления
- [x] `AuthPage.tsx`: invite code, request-register, forgot-password flows
- [x] `Profile.tsx`: "Сменить сервер" + "Панель администратора"
- [x] `App.tsx`: /setup route, /admin только для admin role

## Контрольные вехи

- [x] Закрыты все `Must`
- [x] Закрыты все security-пункты из спецификации
- [x] Закрыты все data-model и migration-пункты (identity_keys composite PK, versioned migrations, destination_device_id)
- [x] Закрыты все crypto-пункты (этап 5)
- [x] Закрыты все test-пункты (backend 5 пакетов, frontend 33 теста — +7 session.test.ts)
- [x] Серверная часть multi-device: GET bundle всех устройств, WS device routing, senderDeviceId
- [x] Этап 11 Foundation: архитектурные решения и ADR зафиксированы
- [x] Этап 11 Shared Core: contract layer и formal protocol schemas зафиксированы
