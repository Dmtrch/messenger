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

## Этап 11. Нативные приложения для разных ОС 🟡 Foundation и Shared Core contract layer зафиксированы

### Цель этапа

Реализовать полноценные нативные клиенты (не PWA-обёртки) для Desktop, Android и iOS с полной E2E-криптографией и cursor-based пагинацией.

### Этап A — Foundation ✅ Архитектурные решения зафиксированы

**Цель:** зафиксировать архитектурные решения и подготовить почву для каркаса репозитория.

**Выполнено:**

1. Создан `docs/superpowers/specs/native-client-compatibility-matrix.md`:
   - матрица платформа × capability (`auth`, `crypto`, `storage`, `push`, `media`, `calls`, `cursor pagination`);
   - зафиксированы общие и platform-specific boundaries;
   - добавлены ссылки на ADR.
2. Зафиксированы ADR по:
   - **Secure storage**: `Keychain` (iOS), `Android Keystore`, `OS credential store` (desktop);
   - **Local DB**: `SQLite` как нативная реализация текущей PWA offline-модели;
   - **Native crypto stack**: перенос текущей PWA crypto-модели на базе `libsodium` family;
   - **Desktop framework**: `Compose Multiplatform Desktop`;
   - **iOS UI**: `SwiftUI`.
3. Обновлён `docs/superpowers/specs/native-client-architecture.md`:
   - статус переведён в `Accepted`;
   - закрыты основные open questions Foundation;
   - RFC привязан к новым decision records.

**Следующий подэтап:**

1. Подготовить каркас каталогов:
   ```
   shared/protocol/, shared/domain/, shared/crypto-contracts/, shared/test-vectors/
   apps/desktop/, apps/mobile/android/, apps/mobile/ios/
   ```
2. Описать platform-neutral интерфейсы `AuthEngine`, `WSClient`, `CryptoEngine`, `MessageRepository`.
3. Подготовить `shared/test-vectors/` как канонический источник cross-platform crypto compatibility.

### Этап B — Shared Core ✅ Контрактный слой зафиксирован

**Цель:** реализовать платформенно-независимый core.

**Выполнено:**

1. Описаны интерфейсы:
   - `AuthEngine`
   - `WSClient`
   - `CryptoEngine`
   - `MessageRepository`
2. Зафиксированы:
   - domain models;
   - domain events;
   - repository contracts;
   - auth/session lifecycle;
   - websocket lifecycle;
   - sync/outbox semantics.
3. `cursor-based pagination` зафиксирована как обязательный capability всех клиентов.
4. Подготовлены `shared/test-vectors/` для `X3DH`, `Double Ratchet`, `Sender Keys`.
5. Добавлены formal schemas:
   - `shared/protocol/rest-schema.json`
   - `shared/protocol/ws-schema.json`
   - `shared/protocol/message-envelope.schema.json`

**Следующий подэтап:**

1. Ужесточить formal schemas до полноценного JSON Schema-слоя.
2. Начать первый runtime-модуль `shared/native-core` или platform adapters на основе уже зафиксированных контрактов.

### Этапы C / D / E — Desktop → Android → iOS

**Последовательность:** Desktop первым (проще стабилизировать), Android вторым, iOS последним.

**Обязательное требование для всех:** cursor-based догрузка старой истории с сервера.

### Выход этапа

- нативные клиенты на трёх платформах с полным E2E по Signal Protocol;
- общий crypto-контракт и formal protocol layer верифицированы seed-набором cross-platform test-vectors.

## Этап 12. Multi-Server Support & Admin Panel ✅ Закрыт

### Цель этапа

Добавить поддержку нескольких серверов на клиенте (динамический BASE URL) и полноценную панель администрирования сервера: управление пользователями, режимы регистрации, инвайт-коды, запросы на регистрацию, сброс паролей.

### Задачи

**Backend ✅ Закрыт**

1. Config — новые поля: `server_name`, `server_description`, `registration_mode`, `admin_username`, `admin_password`. ✅
2. Endpoint `GET /api/server/info` — публичный, без JWT, возвращает name/description/registrationMode. ✅
3. Роль пользователя — `role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin'))` в users; роль в JWT claims и ответе `/api/auth/login`. ✅
4. Bootstrap-admin — `EnsureAdminUser` создаёт из конфига при первом старте. ✅
5. Invite codes — `invite_codes` таблица; `POST /api/auth/register` проверяет код (not found/used/expired → 403); `UseInviteCode` — атомарное потребление. ✅
6. Registration requests — `registration_requests` таблица; `POST /api/auth/request-register` → 201; admin API для подтверждения/отклонения. ✅
7. Password reset requests — `password_reset_requests` таблица; `POST /api/auth/password-reset-request` → 200 (без user enumeration); admin API для установки временного пароля. ✅
8. `RequireAdmin` middleware — читает роль из JWT context (через `auth.RoleFromCtx`); 403 если не admin. ✅
9. Admin handlers — 9 handler'ов: ListRegistrationRequests, ApproveRegistrationRequest (проверка дубля username → 409), RejectRegistrationRequest, CreateInviteCode, ListInviteCodes, ListUsers, ResetUserPassword, ListPasswordResetRequests, ResolvePasswordResetRequest. ✅
10. Migrations #9–13 — добавляют role, invite_codes, registration_requests, password_reset_requests, indexes. ✅

**Client ✅ Закрыт**

11. `client/src/config/serverConfig.ts` — `getServerUrl/setServerUrl/clearServerUrl/hasServerUrl/initServerUrl` через localStorage; URL-валидация через `new URL()` + http/https protocol check. ✅
12. `client/src/api/client.ts` — динамический BASE через `getServerUrl()`; `AuthRegisterReq.inviteCode?: string`. ✅
13. `client/src/api/websocket.ts` — WS base строится через `getServerUrl()` с конвертацией http→ws. ✅
14. `client/src/store/authStore.ts` — поле `role: 'admin' | 'user' | null`; устанавливается из ответа login; включён в `partialize`. ✅
15. `client/src/store/chatStore.ts` — добавлен `reset()` action для очистки при смене сервера. ✅
16. `client/src/pages/ServerSetupPage.tsx` — ввод URL, fetch `/api/server/info`, preview карточки сервера, `setServerUrl`, редирект на /auth. ✅
17. `client/src/pages/AdminPage.tsx` — 4 вкладки: Заявки / Пользователи / Инвайты / Сброс паролей; всё через API с inline error/success messages. ✅
18. `client/src/pages/AuthPage.tsx` — invite code поле (при registrationMode === 'invite'); request-register flow; forgot-password flow (без user enumeration); `serverInfo` из `/api/server/info`. ✅
19. `client/src/components/Profile/Profile.tsx` — кнопка "Сменить сервер" (logout + clearServerUrl + chatStore.reset + wsStore.setSend(null) → /setup); кнопка "Панель администратора" (только для role === 'admin'). ✅
20. `client/src/App.tsx` — `initServerUrl()` на старте; роут /setup; `/admin` только для role === 'admin'. ✅
21. `client/tsconfig.json` — exclude test files из production build. ✅
22. `client/vite.config.ts` — `maximumFileSizeToCacheInBytes: 4 MB` (libsodium ~2.38 MB превышает дефолт). ✅

### Ключевые дизайнерские решения

- **Temp password** — admin устанавливает plaintext-пароль, который читает и сообщает пользователю out-of-band. Intentional MVP design, не хранится долго.
- **No user enumeration** в `password-reset-request` — ответ 200 независимо от наличия пользователя.
- **Registration keys saved after server confirm** — `handleRequestRegister` сохраняет ключи в IndexedDB только после `res.ok`, чтобы исключить mismatch при отказе сервера.
- **chatStore.reset() при смене сервера** — чаты предыдущего сервера не утекают в новый контекст.

### Выход этапа

- клиент поддерживает подключение к любому серверу по URL; ✅
- администратор управляет регистрацией, пользователями и сбросом паролей; ✅
- три режима регистрации: `open | invite | approval`; ✅
- роль admin встроена в JWT и отражена в клиентском UI. ✅

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
11. Этап 11 (A → B → C → D → E)
12. Этап 12

## Критерий завершения

План считается закрытым, когда:

- все пункты `Must` из [`docs/unimplemented-spec-tasks.md`](/Users/dim/vscodeproject/messenger/docs/unimplemented-spec-tasks.md) выполнены;
- чеклист в [`docs/spec-gap-checklist.md`](/Users/dim/vscodeproject/messenger/docs/spec-gap-checklist.md) закрыт по разделу `Must`;
- документация синхронизирована с новым состоянием кода.
