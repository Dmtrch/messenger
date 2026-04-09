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

- [ ] Подготовить проверенный deployment guide для Cloudflare Tunnel
- [ ] Описать и автоматизировать update path без потери данных
- [ ] Встроить обязательную синхронизацию документации в процесс разработки

## Звонки (этап 9)

- [ ] Реализовать WebRTC-сигнализацию (call_offer / call_answer / ice_candidate / call_end / call_reject)
- [ ] Добавить клиентский UI звонков (входящий, активный, управление камерой/микрофоном)
- [ ] Прописать STUN-конфигурацию в RTCPeerConnection
- [ ] Добавить поддержку TURN-сервера (coturn + временные credentials через /api/calls/ice-servers)
- [ ] Реализовать групповые звонки через SFU (LiveKit)

## Долг и верификация по этапам 1–4

### Этап 1 — Security (закрыт, но требует проверки)

- [ ] **CSP совместимость с production bundle**: `script-src 'self'` может блокировать Vite-inline chunks — проверить сборку `npm run build` под CSP
- [ ] **HSTS за Cloudflare Tunnel**: при HTTP-внутреннем соединении `isHTTPS=false` → HSTS не выставляется; нужен флаг `BEHIND_PROXY=true` или явный `FORCE_HTTPS`
- [ ] **realIP доверяет X-Real-IP без whitelist proxy**: при прямом доступе к серверу заголовок подделывается — зафиксировать в документации или ограничить

### Этап 2 — Media (есть функциональный пропуск)

- [ ] **conversation_id не привязывается при отправке сообщения**: если клиент не передаёт `chat_id` при upload (загрузка до отправки), `ConversationID = ""` → получатель не может скачать файл (только загрузчик). Нужен endpoint `PATCH /api/media/{id}` для привязки к чату после отправки сообщения
- [ ] **Нет очистки orphaned media**: загруженные но не отправленные файлы остаются на диске навсегда — нужен cron-cleanup по `conversation_id IS NULL AND created_at < now-24h`

### Этап 3 — Device model (архитектурный пропуск)

- [ ] **identity_keys — PK по user_id, не по device_id**: `UpsertIdentityKey` при каждом `POST /api/keys/register` перезаписывает единственную запись → ключи предыдущего устройства теряются; настоящий multi-device требует PK `(user_id, device_id)` + миграция таблицы
- [ ] **PopPreKey не учитывает device_id**: `SELECT ... WHERE user_id=?` смешивает ключи всех устройств одного пользователя — получатель может получить OPK не от того устройства
- [ ] **POST /api/keys/register не идемпотентен**: каждый вход создаёт новое устройство — нужен device fingerprint или проверка существующего устройства

### Этап 4 — Message state (пропуски в UI)

- [ ] **markChatRead не вызывается при открытии чата**: `POST /api/chats/{chatId}/read` реализован на сервере, но нигде не вызывается в клиентском коде — `unreadCount` не сбрасывается на сервере после просмотра
- [ ] **lastMessage в ChatSummary не расшифровывается**: клиент получает `encryptedPayload`, но preview в списке чатов не отображает расшифрованный текст — нужна логика decrypt при загрузке чатов
- [ ] **Пагинация: проверить call sites**: `MessagesPage.nextCursor` изменился с `number` на `string` — необходимо проверить `ChatWindow` и другие компоненты, которые читают `nextCursor` для подгрузки истории

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
