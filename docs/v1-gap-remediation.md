# План закрытия разрывов со спецификацией

## Цель

Закрыть критичные расхождения между текущей реализацией и [`docs/superpowers/specs/messenger-spec.md`](/Users/dim/vscodeproject/messenger/docs/superpowers/specs/messenger-spec.md) без хаотичных изменений в архитектуре.

## Принципы плана

- сначала безопасность и контракт API;
- затем данные и миграции;
- затем криптография и групповые сценарии;
- затем offline/PWA;
- затем тесты и эксплуатация.

## Этап 1. Безопасность и серверный perimeter ✅ Закрыт

### Цель этапа

Сделать текущий backend безопаснее без ломки клиентского UX.

### Задачи

1. Ввести обязательный production TLS policy.
2. Добавить security middleware:
   - CSP
   - HSTS
   - X-Frame-Options
   - X-Content-Type-Options
3. Добавить rate limiting на auth endpoints.
4. Перевести refresh cookie на `SameSite=Strict`.
5. Явно зафиксировать bcrypt cost = 12.
6. Ограничить `CheckOrigin` для WebSocket.

### Выход этапа

- backend соответствует минимальным security-требованиям спецификации; ✅
- снижен риск эксплуатации публичного инстанса в небезопасной конфигурации. ✅

## Этап 2. Media access и media model ✅ Закрыт

### Цель этапа

Перевести медиа из текущей MVP-модели в модель, совместимую со спецификацией.

### Задачи

1. Ввести `mediaId`.
2. Добавить таблицу `media_objects`.
3. Перевести `GET /api/media/:id` под JWT.
4. Реализовать проверку доступа к медиа по участию в чате.
5. Подготовить клиент к работе через authenticated fetch или signed URLs.

### Выход этапа

- медиа перестают быть публичными файлами по случайному имени; ✅
- API начинает соответствовать ожидаемому контракту. ✅

## Этап 3. Device model и key registration ✅ Закрыт

### Цель этапа

Перестроить ключевую модель под устройства, а не только под пользователя.

### Задачи

1. Добавить `devices`. ✅
2. Вынести `identity_keys` и `one_time_prekeys` на уровень устройства. ✅
3. Реализовать `POST /api/keys/register`. ✅
4. Обновить `GET /api/keys/:userId` на возврат bundle по устройствам. ✅ (закрыто в этапе 10)
5. Изменить клиентское хранение session state. (закрывается в этапе 10, клиентская часть)

### Выход этапа

- появляется фундамент для реального multi-device: ✅ `devices` таблица, composite PK `(user_id, device_id)` в `identity_keys`, `PopPreKey` фильтрует по device, `POST /api/keys/register` идемпотентен;
- ключевой API совместим со спецификацией. ✅
- полноценная client-side multi-device модель — закрывается в этапе 10.

## Этап 4. Message state и список чатов ✅ Закрыт

### Цель этапа

Стабилизировать серверную модель чатов и статусов.

### Задачи

1. Реализовать серверные `unreadCount`, `updatedAt`, `lastMessage`.
2. Перевести пагинацию на `messageId` или opaque cursor.
3. Завершить delivery/read receipt flow.
4. Ввести `chat_user_state` или эквивалентный слой.

### Выход этапа

- список чатов становится server-driven; ✅
- история сообщений и статусы перестают зависеть от локальных догадок клиента. ✅

## Этап 5. Криптографическая доработка ✅ Закрыт

### Цель этапа

Закрыть основные разрывы между текущим E2E MVP и целевой криптографической схемой.

### Задачи

1. Добавить skipped message keys.
2. Реализовать lifecycle `prekey_request`.
3. Реализовать Sender Keys для групп.
4. Реализовать encrypted media at rest:
   - client-side encryption media;
   - server-side ciphertext-only storage;
   - local decrypt on download.

### Выход этапа

- E2E-модель покрывает и out-of-order доставку, и группы, и медиа. ✅

## Этап 6. Offline/PWA слой ✅ Закрыт

### Цель этапа

Довести PWA до реального offline сценария, а не только до installable shell.

### Задачи

1. Добавить IndexedDB persistence для истории.
2. Добавить offline sync queue.
3. Реализовать background resend для исходящих сообщений.
4. Обновить Service Worker стратегию.
5. Добавить UI-индикацию offline состояния.

### Выход этапа

- приложение соответствует требованиям offline history viewing; ✅
- пользовательский сценарий в нестабильной сети становится предсказуемым. ✅

## Этап 7. Migration framework и эксплуатация ✅ Закрыт

### Цель этапа

Подготовить проект к эволюции схемы и обновлениям.

### Задачи

1. Ввести versioned migrations.
2. Отказаться от runtime `ALTER TABLE` без журнала.
3. Описать update path.
4. Подготовить deployment guide:
   - TLS
   - Cloudflare Tunnel
   - backup/restore

### Выход этапа

- проект можно обновлять без ручной реконструкции БД;
- deployment становится воспроизводимым.

## Этап 8. Тестовый контур ✅ Закрыт (частично)

### Цель этапа

Зафиксировать критичные сценарии автоматическими тестами.

### Задачи

1. Backend tests: ✅
   - auth — register, login, refresh rotation, change-password, JWT middleware
   - keys — RegisterDevice idempotency, PopPreKey by device, bundle 404
   - chat — non-member forbidden, delete/edit authorization
   - ws — invalid token → close 4001, valid connect, BroadcastToConversation
   - db — RunMigrations idempotent, migration #7 composite PK
2. Frontend tests: ✅ (частично)
   - crypto: `ratchet.test.ts` (11 тестов), `x3dh.test.ts` (6 тестов)
   - api client: `client.test.ts` (9 тестов)
   - ключевые UI-компоненты: не покрыты
3. Smoke-check client/server совместимости: не реализован

### Выход этапа

- критичные изменения в crypto и auth перестают быть blind refactor; ✅
- можно безопаснее двигать security и crypto контур. ✅
- **Bugfix**: `initRatchet` теперь следует Signal spec — Bob (responder) стартует с `dhRemotePublic=null`, первое сообщение Alice триггернёт DH ratchet; исправлен баг "No send chain key" при первом ответе Bob.

## Этап 9. Аудио и видео звонки ✅ Закрыт

### Цель этапа

Добавить возможность совершения звонков между пользователями через WebRTC.

### Задачи

1. **WebRTC сигнализация через WebSocket** — добавить транзитную пересылку WS-событий:
   - `call_offer` — инициатор отправляет SDP offer
   - `call_answer` — получатель отвечает SDP answer
   - `ice_candidate` — обмен ICE-кандидатами
   - `call_end` — завершение звонка
   - `call_reject` — отклонение входящего звонка
   - `call_busy` — пользователь уже в звонке
2. **Клиентский UI** — экран входящего звонка, управление камерой/микрофоном, кнопки принять/завершить/отклонить.
3. **STUN-конфигурация** — прописать публичный STUN-сервер в `RTCPeerConnection` конфиге клиента.
4. **TURN-поддержка** (опционально) — для пользователей за симметричным NAT; конфигурируется через env.
5. **Групповые звонки** (опционально, отдельный подэтап) — интеграция SFU (LiveKit или mediasoup); требует отдельного сервиса.

### Выход этапа

- пользователи могут совершать аудио и видео звонки 1-на-1;
- сервер участвует только в сигнализации, медиатрафик идёт P2P;
- при необходимости TURN-сервер обеспечивает связь через NAT.

### Архитектурные ограничения

- групповые звонки требуют SFU — отдельный тяжёлый сервис, не входит в self-hosted монолит;
- TURN-сервер пропускает через себя весь медиатрафик при невозможности P2P (~15–30% звонков);
- видеозвонок 720p ≈ 1–2 Мбит/с в каждую сторону — домашний интернет с узким upload может стать ограничением при нескольких одновременных звонках через TURN.

## Этап 10. Полноценная multi-device архитектура ✅ Закрыт

### Цель этапа

Завершить поддержку нескольких устройств одного пользователя по Signal Sesame spec:
каждое устройство получает свой bundle, свою ratchet-сессию и свою копию каждого сообщения.

### Задачи

**Серверная часть ✅ Закрыта (коммит 984a28b)**

1. `GET /api/keys/:userId` возвращает `{ "devices": [...] }` — bundle для каждого активного устройства. ✅
2. WS Hub: `client.deviceID`, `ServeWS` принимает `?deviceId=`, валидирует принадлежность пользователю. ✅
3. `DeliverToDevice(userID, deviceID, payload)` — адресная WS-доставка на конкретное устройство. ✅
4. `handleMessage`: `recipient.DeviceID` → `DestinationDeviceID` в БД; `senderDeviceId` в WS payload. ✅
5. Migration #8: `messages.destination_device_id TEXT NOT NULL DEFAULT ''`. ✅

**Клиентская часть ✅ Закрыта**

6. `session.ts`: `sessionKey(peerId, deviceId)` — ключ сессии по паре устройств (Signal Sesame spec). ✅
7. `session.ts`: `encryptForAllDevices(recipientId, bundles[], plaintext)` → `[{deviceId, ciphertext}]`. ✅
8. `session.ts`: `decryptMessage(senderId, senderDeviceId, ciphertext)` — добавлен `senderDeviceId`. ✅
9. `client.ts`: `PreKeyBundleResponse { devices: DeviceBundle[] }` — типы API обновлены. ✅
10. `useMessengerWS.ts`: `senderDeviceId` → `decryptMessage`; `?deviceId=` в WS URL (async через `loadDeviceId()`). ✅
11. `ChatWindowPage.tsx`: fan-out отправка — отдельный ciphertext для каждого устройства получателя. ✅

**Приоритет 2 — тесты и пагинация ✅ Закрыт**

12. `session.test.ts`: 7 тестов (sessionKey isolation, encryptForAllDevices, full round-trip, ratchet chain, fallback). ✅
13. Cursor-based пагинация истории: `IntersectionObserver` на topSentinel + кнопка "Загрузить ещё". ✅

### Выход этапа

- два браузера одного пользователя независимо получают и расшифровывают сообщения; ✅
- ratchet-сессии хранятся по `peerId:deviceId`, не конкурируют; ✅
- `Must`-пункт чеклиста закрыт; ✅
- фронтенд-тесты: 33 теста (ratchet x11, x3dh x6, client x9, session x7). ✅

---

## Рекомендуемый порядок выполнения

1. Этап 1
2. Этап 2
3. Этап 3
4. Этап 4
5. Этап 5
6. Этап 6
7. Этап 7
8. Этап 8
9. Этап 9
10. Этап 10

## Критерий завершения

План считается закрытым, когда:

- все пункты `Must` из [`docs/unimplemented-spec-tasks.md`](/Users/dim/vscodeproject/messenger/docs/unimplemented-spec-tasks.md) выполнены;
- чеклист в [`docs/spec-gap-checklist.md`](/Users/dim/vscodeproject/messenger/docs/spec-gap-checklist.md) закрыт по разделу `Must`;
- документация синхронизирована с новым состоянием кода.
