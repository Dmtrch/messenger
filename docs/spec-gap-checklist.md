# Чеклист закрытия разрывов со спецификацией

Источник: [`docs/unimplemented-spec-tasks.md`](/Users/dim/vscodeproject/messenger/docs/unimplemented-spec-tasks.md)

## Must

- [ ] Ввести полноценную multi-device модель — **сервер ✅, клиент в работе**
  - [x] GET /api/keys/:userId возвращает `{ devices: [...] }` — bundle для каждого устройства
  - [x] WS Hub: `client.deviceID`, `DeliverToDevice`, `senderDeviceId` в WS payload
  - [x] `messages.destination_device_id` (migration #8) — адресное хранение
  - [ ] `session.ts`: sessionKey → `peerId:deviceId`; `encryptForAllDevices`; `decryptMessage(senderId, deviceId, ct)`
  - [ ] `client.ts`: тип `PreKeyBundleResponse { devices: DeviceBundle[] }`
  - [ ] `useMessengerWS.ts`: передавать `senderDeviceId` в `decryptMessage`; `?deviceId=` в WS URL
  - [ ] `ChatWindowPage.tsx`: fan-out шифрование — отдельный ciphertext на каждое устройство получателя
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

**Клиент — ожидает следующей сессии:**
- [ ] `session.ts`: `sessionKey(peerId, deviceId)` — Signal Sesame spec
- [ ] `session.ts`: `encryptForAllDevices`, `decryptMessage(senderId, deviceId, ct)`
- [ ] `client.ts`: `PreKeyBundleResponse { devices: DeviceBundle[] }`
- [ ] `useMessengerWS.ts`: `senderDeviceId` → decrypt; `?deviceId=` в WS URL
- [ ] `ChatWindowPage.tsx`: fan-out — отдельный ciphertext на каждое устройство

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

## Контрольные вехи

- [ ] Закрыты все `Must` (остаётся: клиентская часть multi-device — session.ts, client.ts, useMessengerWS.ts, ChatWindowPage.tsx)
- [x] Закрыты все security-пункты из спецификации
- [x] Закрыты все data-model и migration-пункты (identity_keys composite PK, versioned migrations, destination_device_id)
- [x] Закрыты все crypto-пункты (этап 5)
- [x] Закрыты все test-пункты (backend 5 пакетов, frontend 26 тестов)
- [x] Серверная часть multi-device: GET bundle всех устройств, WS device routing, senderDeviceId
