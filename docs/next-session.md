# Next Session

## Контекст

Аудит проекта показал, что базовая изоляция между разными self-hosted серверами достигается за счёт отдельных SQLite/FS-инсталляций, но несколько критичных сценариев продукта не доведены до рабочего состояния. Ниже зафиксированы проблемы и порядок их устранения.

## Проблемы

### 1. Критично: remote-server flow фактически сломан

- Клиент сохраняет адрес выбранного сервера в `serverUrl`, но часть запросов продолжает ходить в текущий origin.
- Логин использует относительный путь `/api/auth/login` вместо `getServerUrl()`.
- Получение VAPID-ключа также использует относительный путь `/api/push/vapid-public-key`.
- На сервере `ALLOWED_ORIGIN` применяется только для WebSocket, полноценного CORS для HTTP API нет.

Ссылки:

- `client/src/pages/AuthPage.tsx:41`
- `client/src/hooks/usePushNotifications.ts:17`
- `server/cmd/server/main.go:100`
- `server/cmd/server/main.go:129`
- `server/internal/ws/hub.go:50`

Риск:

- PWA не работает как универсальный клиент для подключения к отдельному серверу администратора.
- Регистрация/логин/push ломаются при попытке использовать сервер не из того же origin.

### 2. Критично: approval-registration ломает E2E bootstrap

- `RequestRegister` сохраняет key bundle в заявке.
- `ApproveRegistrationRequest` создаёт только пользователя и не переносит `IK/SPK/OPK` в рабочие таблицы.
- После approval login flow не выполняет `registerKeys`, в отличие от обычной регистрации.

Ссылки:

- `server/internal/auth/handler.go:289`
- `server/internal/admin/handler.go:35`
- `client/src/pages/AuthPage.tsx:33`
- `client/src/pages/AuthPage.tsx:96`

Риск:

- Пользователь после approval может войти, но не имеет корректного server-side prekey bundle.
- Новые диалоги, E2E bootstrap и часть call flows становятся ненадёжными или нерабочими.

### 3. Критично: message/SKDM recipient injection

- При `message` и `skdm` сервер проверяет только членство отправителя в чате.
- Для каждого `recipient.userId` не проверяется, что получатель состоит в этом чате.

Ссылки:

- `server/internal/ws/hub.go:321`
- `server/internal/ws/hub.go:403`

Риск:

- Участник любого чата может отправлять ciphertext и realtime-события произвольным пользователям того же сервера.
- Нарушается модель приватности и целостности доставки внутри сервера.

### 4. Важно: слишком широкий user directory / key discovery

- Поиск пользователей идёт по всей таблице `users`.
- Любой аутентифицированный пользователь может запросить prekey bundle любого `userId`.

Ссылки:

- `server/db/queries.go:52`
- `client/src/components/NewChatModal/NewChatModal.tsx:39`
- `server/internal/keys/handler.go:22`

Риск:

- Для приватного self-hosted режима это даёт ненужное перечисление пользователей и раскрытие directory внутри сервера.
- Требуется явное решение по политике discoverability.

### 5. Важно: media upload принимает произвольный `chat_id`

- Upload сохраняет `conversation_id` из формы без проверки, что uploader состоит в чате.
- Далее доступ к файлу проверяется через эту привязку.

Ссылки:

- `server/internal/media/handler.go:45`
- `server/internal/media/handler.go:74`
- `server/internal/media/handler.go:117`

Риск:

- Можно привязывать медиа к чужим чатам.
- Возможны storage abuse и подбрасывание ciphertext в чужой чатовый контекст.

### 6. Умеренно: `typing` рассылается без проверки членства отправителя

Ссылки:

- `server/internal/ws/hub.go:425`

Риск:

- При знании `chatId` можно создавать ложные typing-события.

### 7. Умеренно: server test suite сейчас ненадёжен

- `go test ./...` падает.
- Часть тестов не синхронизирована с текущей schema (`role` стал обязательным по check constraint).
- Из-за этого реальные регрессии скрываются за инфраструктурными падениями тестов.

Ссылки:

- `server/internal/ws/hub_calls_test.go:39`
- `server/internal/keys/handler_test.go:244`

Риск:

- Нельзя надёжно использовать server tests как gate для исправлений.

## План решения

### Этап 1. Починить server selection и cross-origin API flow

Что сделать:

- Привести все клиентские auth/push/server-info запросы к единому API client, завязанному на `getServerUrl()`.
- Убрать оставшиеся относительные fetch-вызовы для серверных API.
- Добавить полноценный CORS middleware на backend для HTTP API, согласованный с `ALLOWED_ORIGIN`.
- Проверить поведение cookie refresh-flow при same-origin и cross-origin режимах.

Проверка:

- Web client может подключиться к серверу по адресу, отличному от origin самой PWA.
- Работают login, refresh, request-register, password-reset-request, получение VAPID-ключа.

### Этап 2. Восстановить approval-registration до рабочего E2E состояния

Что сделать:

- При approve переносить ключевой материал из `registration_requests` в `identity_keys` и `pre_keys`.
- Либо альтернативно: после первого login в approval-flow обязательно выполнять `registerKeys`.
- Выбрать один канонический путь и зафиксировать его тестами.

Проверка:

- Пользователь, прошедший approval, после первого входа имеет валидный bundle.
- Для него доступны поиск, создание диалога и старт E2E сессии.

### Этап 3. Закрыть recipient injection в WebSocket message flows

Что сделать:

- Для `message`, `skdm`, `typing` и смежных realtime-событий валидировать, что все target user/device действительно относятся к участникам чата.
- Отклонять payload целиком или адресно, если в нём есть получатели вне чата.

Проверка:

- Попытка отправить `message` или `skdm` вне состава чата возвращает ошибку и ничего не доставляет.
- `typing` не уходит в чат, если отправитель не является участником.

### Этап 4. Ужесточить media authorization

Что сделать:

- На upload проверять, что `chat_id` либо пустой, либо uploader состоит в этом чате.
- При необходимости отделить незакреплённую загрузку от привязки к чату в явный двухшаговый flow.

Проверка:

- Нельзя загрузить файл и привязать его к чужому чату.
- Доступ к media остаётся только у uploader или участника корректно привязанного чата.

### Этап 5. Определить и реализовать политику discoverability внутри сервера

Что решить до кодинга:

- Должен ли пользователь видеть всех пользователей своего сервера.
- Или только тех, кто выдан админом, есть в контактах, есть в общих чатах, или найден по invite flow.

Что сделать после решения:

- Ограничить `users/search`.
- Ограничить `keys/:userId`.
- Синхронизировать UI создания чата с новой серверной политикой.

Проверка:

- Поиск и key discovery соответствуют выбранной продуктовой модели и не раскрывают лишние аккаунты.

### Этап 6. Починить server tests и закрепить регрессии

Что сделать:

- Обновить тестовые helper’ы под актуальную schema.
- Добавить регрессионные тесты на:
  - remote-server aware client API contracts, где это уместно на client side;
  - approval-registration;
  - recipient validation;
  - media upload authorization;
  - discoverability policy.

Проверка:

- `cd server && go test ./...` проходит.
- `cd client && npm test` проходит.
- `cd client && npm run build` проходит.
- `cd server && go build ./...` проходит.

## Рекомендуемый порядок работы в следующей сессии

1. Сначала поднять server test suite до зелёного состояния, чтобы дальнейшие исправления опирать на рабочие тесты.
2. Затем исправить remote-server flow, потому что это базовый продуктовый сценарий.
3. После этого закрыть approval-registration, чтобы не оставлять сломанный onboarding.
4. Затем закрыть WS/media authorization issues.
5. В конце принять и реализовать политику discoverability.

---

## Нативные клиенты — план выравнивания с backend API

Источник: `docs/native-platform-audit.md` (2026-04-15).

Все три нативных клиента (Android, iOS, Desktop) несовместимы с текущим сервером по нескольким ключевым контрактам. Ниже зафиксированы точные расхождения и порядок их исправления.

### Расхождения (справочно)

**Auth**
- Сервер возвращает `{ accessToken, userId, username, displayName, role }` в JSON и выставляет refresh token как `httpOnly cookie` (`refresh_token`).
- Все три клиента ожидают `{ accessToken, refreshToken }` в JSON и отправляют `{ refreshToken }` в body при refresh.
- Android и Desktop: `userId` сохраняется как `username`. iOS: `userId` сохраняется пустой строкой.

**RegisterKeys** — `POST /api/keys/register`
- Сервер ожидает: `{ deviceName, ikPublic, spkId, spkPublic, spkSignature, opkPublics[] }`.
- Все три клиента отправляют: `{ identityKey, signedPreKey, signedPreKeySignature, oneTimePreKeys[] }` — имена полей другие, `deviceName` и `spkId` отсутствуют.

**Message send**
- Сервер ожидает WS-фрейм: `{ type:"message", chatId, clientMsgId, senderKeyId, recipients:[{userId, deviceId, ciphertext}] }`.
- Android и Desktop: отправляют `{ type:"message", chatId, clientMsgId, plaintext }` — нет `recipients` и `ciphertext`.
- iOS: отправляет в `POST /api/messages`, которого на сервере нет — endpoint не существует.

**SKDM receive (iOS)**
- Сервер отправляет: `{ type:"skdm", chatId, senderId, ciphertext }` — без `senderDeviceId`.
- `WSOrchestrator.swift` ожидает `senderDeviceId` и вернёт без обработки если поля нет.

---

### Этап N-1. Исправить auth flow — Android и Desktop

> Файлы: `apps/mobile/android/.../ApiClient.kt`, `apps/desktop/.../ApiClient.kt`, `apps/mobile/android/.../AppViewModel.kt`, `apps/desktop/.../AppViewModel.kt`

Что сделать:
- `LoginResponse` — убрать `refreshToken`, добавить `userId`, `username`, `displayName`, `role`.
- `RefreshResponse` — убрать `refreshToken`; refresh теперь работает через cookie автоматически (Ktor bearer plugin + cookie jar / OkHttp CookieJar).
- В `refreshTokens` lambda: отправлять `POST /api/auth/refresh` **без body** — сервер читает cookie.
- Убрать `refreshToken` из `TokenStore` — хранить только `accessToken`.
- После логина сохранять `resp.userId` (не `resp.username`) как `currentUserId`.

Проверка:
- Логин возвращает `200` и `accessToken` без ошибки `null refreshToken`.
- После истечения 15 мин access token — refresh выполняется автоматически без выхода из аккаунта.
- `currentUserId` в AppViewModel совпадает с `userId` на сервере.

---

### Этап N-2. Исправить auth flow — iOS

> Файлы: `apps/mobile/ios/.../ApiClient.swift`, `apps/mobile/ios/.../AppViewModel.swift`, `apps/mobile/ios/.../service/TokenStore.swift`

Что сделать:
- `LoginResponse` и `RefreshResponse` — убрать `refreshToken`, добавить `userId`, `username`, `displayName`, `role`.
- Конфигурировать `URLSession` с `HTTPCookieStorage.shared` и `HTTPCookieAcceptPolicy.always`, чтобы cookie автоматически сохранялись и отправлялись при refresh.
- `refreshToken()` — отправлять `POST /api/auth/refresh` без body.
- Убрать сохранение `refreshToken` в `UserDefaults`/`TokenStore`.
- После логина: `userId = resp.userId` (сейчас пустая строка — `AppViewModel.swift:76`).

Проверка:
- Аналогично этапу N-1.

---

### Этап N-3. Исправить `registerKeys` — все платформы

> Файлы: `ApiClient.kt` (Android, Desktop), `ApiClient.swift` (iOS)

Что сделать:
- Переименовать поля в `RegisterKeysRequest`:

  | Было (клиент)        | Должно быть (сервер) |
  |----------------------|----------------------|
  | `identityKey`        | `ikPublic`           |
  | `signedPreKey`       | `spkPublic`          |
  | `signedPreKeySignature` | `spkSignature`   |
  | `oneTimePreKeys`     | `opkPublics`         |
  | *(отсутствует)*      | `deviceName` (String, default `"Unknown device"`) |
  | *(отсутствует)*      | `spkId` (Int)        |

- Убедиться, что ключи кодируются в `base64` (StdEncoding), а не в другом формате.
- `spkId` — передавать реальный идентификатор SPK из локального генератора ключей.

Проверка:
- `POST /api/keys/register` возвращает `201` (или идемпотентный `200`) без `400`.
- Сервер может собрать prekey bundle (`GET /api/keys/:userId`) после регистрации.

---

### Этап N-4. Исправить message transport — Android и Desktop

> Файлы: `AppViewModel.kt` (Android, Desktop)

Что сделать:
- WS send payload изменить на формат сервера:
  ```json
  {
    "type": "message",
    "chatId": "...",
    "clientMsgId": "...",
    "senderKeyId": 0,
    "recipients": [
      { "userId": "<targetUserId>", "deviceId": "", "ciphertext": "<base64>" }
    ]
  }
  ```
- MVP-стратегия без готового E2EE: собирать список участников чата из `ChatStore.chats`, исключать себя, шифровать через `SenderKey` (для группы) или `Ratchet` (для диалога) из локальной БД. Если сессия ещё не установлена — заглушка `base64(plaintext.toByteArray())` до полноценного X3DH bootstrapping.
- Убрать поле `plaintext` из WS-фрейма.

Проверка:
- WS фрейм проходит серверную валидацию (нет ответа `error: chatId and recipients required`).
- Сообщение сохраняется на сервере и доставляется собеседнику.

---

### Этап N-5. Исправить message transport — iOS

> Файлы: `apps/mobile/ios/.../AppViewModel.swift`, `apps/mobile/ios/.../service/ApiClient.swift`

Что сделать:
- Убрать вызов `POST /api/messages` — такого endpoint на сервере нет.
- Перенести отправку сообщений в WS-поток: собирать тот же JSON-фрейм, что в этапе N-4, и отправлять через `WSOrchestrator` / `ws.send(frame)`.
- Убедиться, что `wsSend` доступен из `AppViewModel` на момент отправки.

Проверка:
- Аналогично этапу N-4.

---

### Этап N-6. Исправить SKDM receive и WS-события — iOS

> Файл: `apps/mobile/ios/.../service/WSOrchestrator.swift:149`

Что сделать:
- В `handleSKDM` убрать ожидание `senderDeviceId` — сервер его не шлёт в SKDM payload.
- Сервер возвращает: `{ type:"skdm", chatId, senderId, ciphertext }`.
- Скорректировать парсинг: использовать `senderId` вместо `senderDeviceId`.

Проверка:
- SKDM-сообщения не теряются при получении.
- Входящие `message`-события парсятся корректно с заполненным `senderDeviceId`.

---

### Этап N-7. Безопасное хранение токенов и ключей

> Файлы: `TokenStore.kt` (Android), `KeyStorage.kt` (Android), `TokenStore.swift` (iOS), `KeyStorage.swift` (iOS), `KeyStorage.kt` (Desktop)

Что сделать:
- **Android**: `TokenStore` — перейти на `EncryptedSharedPreferences` (если доступен) или `SharedPreferences` + Android Keystore шифрование.
- **Android**: `KeyStorage` — хранить ключи в `EncryptedSharedPreferences` или зашифрованном файле через Android Keystore.
- **iOS**: `TokenStore` — перейти с `UserDefaults` на `SecItemAdd`/`SecItemCopyMatching` (Keychain).
- **iOS**: `KeyStorage` — аналогично, все ключи в Keychain.
- **Desktop**: `KeyStorage` — убрать hardcoded `"messenger-desktop"` password, заменить на генерируемый при первом запуске и хранимый в системном keyring (macOS Keychain, GNOME Keyring, Windows Credential Store) через `java.security.KeyStore` с системным провайдером или `JNA`-биндингом.

Проверка:
- После повторного запуска приложения токены восстанавливаются без повторного логина.
- Ключи хранятся в защищённом системном хранилище, а не в файлах или прозрачных preferences.

---

### Рекомендуемый порядок для нативных клиентов

1. Начать с Android (наиболее прямой Kotlin-код, легко тестировать без Xcode).
2. Проверить после каждого этапа: `./gradlew testDebugUnitTest` должно быть зелёным.
3. После Android портировать изменения на Desktop (те же Kotlin-паттерны, минимальные отличия).
4. Последним — iOS: те же изменения на Swift.
5. Добавить интеграционный тест на каждый исправленный контракт (unit test на ViewModel или mock-сервер тест на ApiClient).

## Что может сломаться при исправлениях

- Cross-origin auth с cookie refresh может потребовать аккуратной настройки `SameSite`, `Secure` и CORS.
- Исправление approval-flow может повлиять на уже созданные pending requests.
- Ужесточение recipient/media validation может выявить скрытые предположения в клиенте о permissive backend behavior.
- Ограничение user search может потребовать переработки UI создания новых чатов.

## Минимальный набор тестов для следующей сессии

- E2E-like server test: approval request -> admin approve -> login -> bundle available.
- WS tests: отправка сообщения и SKDM пользователю вне чата должна быть отклонена.
- Media test: upload с чужим `chat_id` должен возвращать `403`.
- Client test: все auth/push/server-info запросы должны идти через configured `serverUrl`, а не через текущий origin.
