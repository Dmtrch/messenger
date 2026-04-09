# Чеклист закрытия разрывов со спецификацией

Источник: [`docs/unimplemented-spec-tasks.md`](/Users/dim/vscodeproject/messenger/docs/unimplemented-spec-tasks.md)

## Must

- [ ] Ввести полноценную multi-device модель
- [ ] Реализовать `POST /api/keys/register`
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

- [ ] Добавить смену пароля с инвалидцией всех сессий
- [x] Перейти на пагинацию истории по `messageId` или opaque cursor
- [x] Реализовать серверные `unreadCount`, `updatedAt`, `lastMessage`
- [x] Довести lifecycle `prekey_request`
- [x] Добавить полноценный offline sync слой поверх IndexedDB
- [x] Ограничить `CheckOrigin` для WebSocket
- [ ] Ввести конфигурационный файл сервера
- [x] Перейти на versioned migrations и целевую схему БД
- [ ] Добавить backend tests
- [ ] Добавить frontend tests

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

### Этап 4 — Message state (пропуски в UI)

- [x] **markChatRead вызывается при открытии чата**: `api.markChatRead(chatId)` добавлен в useEffect открытия в ChatWindow.tsx
- [ ] **lastMessage в ChatSummary не расшифровывается**: клиент получает `encryptedPayload`, но preview в списке чатов не отображает расшифрованный текст — нужна логика decrypt при загрузке чатов
- [x] **Пагинация: nextCursor тип `string`**: `MessagesPage.nextCursor?: string` в `client.ts` — тип корректен везде

### Этап 5 — Crypto (закрыт, но требует тестирования)

- [ ] **Skipped keys — нет автоматического TTL**: кэш пропущенных ключей растёт без ограничения по времени — при долгих сессиях может вырасти до MAX_SKIP=100 записей без очистки старых; рекомендуется добавить timestamp и очищать ключи старше N дней
- [ ] **Sender Keys — ротация при смене состава группы не реализована**: при добавлении или удалении участника SenderKey не пересоздаётся — новый участник может расшифровать старые сообщения, если получит старый SKDM
- [ ] **Encrypted media — MIME-тип хранится в открытом виде**: `content_type` в `media_objects` виден серверу; при необходимости можно маскировать под `application/octet-stream`
- [ ] **prekey_low — нет backoff**: при каждом подключении WS может прийти `prekey_low` и спровоцировать повторную загрузку 20 ключей; нужна защита от дублирующих пополнений за короткий период

## Контрольные вехи

- [ ] Закрыты все `Must`
- [ ] Закрыты все security-пункты из спецификации
- [ ] Закрыты все data-model и migration-пункты
- [x] Закрыты все crypto-пункты (этап 5)
- [ ] Закрыты все test-пункты
