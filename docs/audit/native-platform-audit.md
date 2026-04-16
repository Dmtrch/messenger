# Аудит нативных клиентов

Дата: 2026-04-15
Проект: `messenger`

## Цель отчёта

Этот отчёт фиксирует текущее состояние нативных клиентов проекта по платформам:
- `Android`
- `iOS`
- `Desktop`

Для каждой платформы указано:
- что клиент умеет делать по коду;
- каких возможностей не хватает;
- какие ошибки и риски обнаружены;
- насколько клиент соответствует текущему Go-серверу.

В конце приведён общий список критичных фиксов в порядке приоритета.

## Общий вывод

Во всех трёх нативных клиентах есть рабочие UI-заготовки для базового мессенджера: логин, список чатов, окно чата, работа с файлами, профиль, сетевой слой, WebSocket и элементы криптографии. Однако все три клиента сейчас не соответствуют текущим контрактам backend API.

Ключевая проблема не в отсутствии экранов, а в несовместимости с сервером:
- контракт логина и refresh-token flow не совпадает с сервером;
- регистрация криптографических ключей не совпадает по формату;
- отправка сообщений реализована не так, как ожидает сервер;
- в части клиентов есть критические баги с `userId`;
- хранение токенов и ключей сделано небезопасно.

Практический вывод: нативные клиенты выглядят как частично реализованные приложения, но в текущем виде не могут считаться надёжно совместимыми с сервером проекта.

## Android

### Что умеет клиент

- выбрать адрес сервера;
- выполнить логин;
- показать список чатов;
- открыть чат;
- отправить текстовое сообщение из UI;
- прикрепить файл и скачать файл;
- открыть профиль и выйти из аккаунта;
- инициализировать WebSocket-подключение;
- хранить локальное состояние, очередь и локальную БД;
- выполнять регистрацию FCM push-токена;
- использовать заготовки для E2EE и звонков.

Ключевые файлы:
- [App.kt](/Users/dim/vscodeproject/messenger/apps/mobile/android/src/main/kotlin/com/messenger/ui/App.kt:1)
- [AuthScreen.kt](/Users/dim/vscodeproject/messenger/apps/mobile/android/src/main/kotlin/com/messenger/ui/screens/AuthScreen.kt:1)
- [ChatListScreen.kt](/Users/dim/vscodeproject/messenger/apps/mobile/android/src/main/kotlin/com/messenger/ui/screens/ChatListScreen.kt:1)
- [ChatWindowScreen.kt](/Users/dim/vscodeproject/messenger/apps/mobile/android/src/main/kotlin/com/messenger/ui/screens/ChatWindowScreen.kt:1)
- [ProfileScreen.kt](/Users/dim/vscodeproject/messenger/apps/mobile/android/src/main/kotlin/com/messenger/ui/screens/ProfileScreen.kt:1)
- [AppViewModel.kt](/Users/dim/vscodeproject/messenger/apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/AppViewModel.kt:1)

### Чего нет или не видно по коду

- нет полноценного UI регистрации нового пользователя;
- не видно UI admin-flow для модерации и approval;
- не видно UI создания нового чата через поиск пользователей;
- не видно реализации смены пароля;
- не видно законченного сценария invite/join для self-hosted сервера.

### Ошибки и риски

#### Критичные

- Клиент ждёт `refreshToken` в JSON-ответе логина, а сервер выдаёт refresh token через cookie.
  Файлы:
  - [ApiClient.kt](/Users/dim/vscodeproject/messenger/apps/mobile/android/src/main/kotlin/com/messenger/service/ApiClient.kt:23)
  - [handler.go](/Users/dim/vscodeproject/messenger/server/internal/auth/handler.go:244)

- Refresh реализован как запрос с `refreshToken` в body, но сервер ждёт cookie-based refresh.
  Файлы:
  - [ApiClient.kt](/Users/dim/vscodeproject/messenger/apps/mobile/android/src/main/kotlin/com/messenger/service/ApiClient.kt:79)
  - [handler.go](/Users/dim/vscodeproject/messenger/server/internal/auth/handler.go:133)

- Формат `registerKeys` не совпадает с контрактом `/api/keys/register`.
  Файлы:
  - [ApiClient.kt](/Users/dim/vscodeproject/messenger/apps/mobile/android/src/main/kotlin/com/messenger/service/ApiClient.kt:46)
  - [handler.go](/Users/dim/vscodeproject/messenger/server/internal/keys/handler.go:76)

- После логина `userId` сохраняется как `username`, а не как реальный идентификатор пользователя.
  Файл:
  - [AppViewModel.kt](/Users/dim/vscodeproject/messenger/apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/AppViewModel.kt:73)

- Отправка сообщений идёт в WS как `plaintext`, а сервер ждёт `recipients` и `ciphertext`.
  Файлы:
  - [AppViewModel.kt](/Users/dim/vscodeproject/messenger/apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/AppViewModel.kt:137)
  - [hub.go](/Users/dim/vscodeproject/messenger/server/internal/ws/hub.go:321)

#### Важные

- Локальное хранение токенов выполнено через обычные `SharedPreferences`.
  Файл:
  - [TokenStore.kt](/Users/dim/vscodeproject/messenger/apps/mobile/android/src/main/kotlin/com/messenger/service/TokenStore.kt:1)

- Криптографические ключи тоже лежат без защищённого хранилища.
  Файл:
  - [KeyStorage.kt](/Users/dim/vscodeproject/messenger/apps/mobile/android/src/main/kotlin/com/messenger/crypto/KeyStorage.kt:1)

### Итог по Android

Android-клиент покрывает базовый пользовательский сценарий на уровне UI, но в текущем виде не совместим с backend-контрактами. Основной риск не в Compose-экранах, а в сломанной интеграции: логин, refresh, key registration и message transport реализованы несовместимо с сервером.

## iOS

### Что умеет клиент

- выбрать и сменить сервер;
- выполнить логин;
- показать список чатов;
- фильтровать уже загруженные чаты;
- открыть чат;
- отправить текст;
- прикрепить и скачать файл;
- открыть профиль и выйти;
- показать кнопки voice/video call;
- инициализировать APNs registration flow;
- использовать локальное состояние, WebSocket и криптографические заготовки.

Ключевые файлы:
- [App.swift](/Users/dim/vscodeproject/messenger/apps/mobile/ios/Sources/Messenger/App.swift:1)
- [AppViewModel.swift](/Users/dim/vscodeproject/messenger/apps/mobile/ios/Sources/Messenger/viewmodel/AppViewModel.swift:1)
- [AuthScreen.swift](/Users/dim/vscodeproject/messenger/apps/mobile/ios/Sources/Messenger/ui/screens/AuthScreen.swift:1)
- [ChatListScreen.swift](/Users/dim/vscodeproject/messenger/apps/mobile/ios/Sources/Messenger/ui/screens/ChatListScreen.swift:1)
- [ChatWindowScreen.swift](/Users/dim/vscodeproject/messenger/apps/mobile/ios/Sources/Messenger/ui/screens/ChatWindowScreen.swift:1)
- [ProfileScreen.swift](/Users/dim/vscodeproject/messenger/apps/mobile/ios/Sources/Messenger/ui/screens/ProfileScreen.swift:1)

### Чего нет или не видно по коду

- нет UI регистрации нового пользователя;
- не видно отдельного UI для создания нового чата и поиска пользователей сервера;
- не видно admin UI;
- смена пароля не доведена до реального API-вызова.

### Ошибки и риски

#### Критичные

- Логин и refresh реализованы в расчёте на `refreshToken` в JSON, а сервер использует refresh cookie.
  Файлы:
  - [ApiClient.swift](/Users/dim/vscodeproject/messenger/apps/mobile/ios/Sources/Messenger/service/ApiClient.swift:9)
  - [handler.go](/Users/dim/vscodeproject/messenger/server/internal/auth/handler.go:244)

- iOS отправляет сообщения в `POST /api/messages`, но такого маршрута на сервере нет.
  Файлы:
  - [ApiClient.swift](/Users/dim/vscodeproject/messenger/apps/mobile/ios/Sources/Messenger/service/ApiClient.swift:129)
  - [main.go](/Users/dim/vscodeproject/messenger/server/cmd/server/main.go:156)

- Формат `registerKeys` не совпадает с сервером.
  Файлы:
  - [ApiClient.swift](/Users/dim/vscodeproject/messenger/apps/mobile/ios/Sources/Messenger/service/ApiClient.swift:45)
  - [handler.go](/Users/dim/vscodeproject/messenger/server/internal/keys/handler.go:76)

- После логина `userId` в состоянии клиента сохраняется пустой строкой.
  Файл:
  - [AppViewModel.swift](/Users/dim/vscodeproject/messenger/apps/mobile/ios/Sources/Messenger/viewmodel/AppViewModel.swift:76)

- Обработка SKDM ожидает `senderDeviceId`, которого сервер сейчас не отправляет.
  Файлы:
  - [WSOrchestrator.swift](/Users/dim/vscodeproject/messenger/apps/mobile/ios/Sources/Messenger/service/WSOrchestrator.swift:149)
  - [hub.go](/Users/dim/vscodeproject/messenger/server/internal/ws/hub.go:414)

#### Важные

- Смена пароля в профиле помечена как `TODO`.
  Файл:
  - [ProfileScreen.swift](/Users/dim/vscodeproject/messenger/apps/mobile/ios/Sources/Messenger/ui/screens/ProfileScreen.swift:1)

- Токены хранятся в `UserDefaults`, а не в Keychain.
  Файл:
  - [TokenStore.swift](/Users/dim/vscodeproject/messenger/apps/mobile/ios/Sources/Messenger/service/TokenStore.swift:1)

- Ключи тоже хранятся в `UserDefaults`.
  Файл:
  - [KeyStorage.swift](/Users/dim/vscodeproject/messenger/apps/mobile/ios/Sources/Messenger/crypto/KeyStorage.swift:1)

### Итог по iOS

iOS-клиент по UI выглядит наиболее полным среди нативных приложений, но это обманчиво: несколько ключевых сетевых сценариев несовместимы с реальным сервером. Самая серьёзная проблема в том, что отправка сообщений завязана на несуществующий REST endpoint, а идентификатор пользователя после логина вообще не заполняется корректно.

## Desktop

### Что умеет клиент

- выбрать адрес сервера;
- выполнить логин;
- показать список чатов;
- открыть окно чата;
- отправить текст;
- прикрепить файл и скачать файл;
- открыть профиль и выйти;
- инициализировать WebSocket;
- использовать локальное хранилище;
- инициализировать заготовки для WebRTC и медиа.

Ключевые файлы:
- [Main.kt](/Users/dim/vscodeproject/messenger/apps/desktop/src/main/kotlin/Main.kt:1)
- [App.kt](/Users/dim/vscodeproject/messenger/apps/desktop/src/main/kotlin/ui/App.kt:1)
- [AppViewModel.kt](/Users/dim/vscodeproject/messenger/apps/desktop/src/main/kotlin/viewmodel/AppViewModel.kt:1)
- [ChatListScreen.kt](/Users/dim/vscodeproject/messenger/apps/desktop/src/main/kotlin/ui/screens/ChatListScreen.kt:1)
- [ChatWindowScreen.kt](/Users/dim/vscodeproject/messenger/apps/desktop/src/main/kotlin/ui/screens/ChatWindowScreen.kt:1)
- [ProfileScreen.kt](/Users/dim/vscodeproject/messenger/apps/desktop/src/main/kotlin/ui/screens/ProfileScreen.kt:1)
- [DesktopWebRtcController.kt](/Users/dim/vscodeproject/messenger/apps/desktop/src/main/kotlin/service/call/DesktopWebRtcController.kt:1)

### Чего нет или не видно по коду

- нет UI регистрации;
- не видно UI для поиска пользователей и создания новых чатов;
- не видно admin UI;
- не видно законченного user-management flow.

### Ошибки и риски

#### Критичные

- Логин и refresh ожидают `refreshToken` в JSON, но сервер работает через cookie-based refresh.
  Файлы:
  - [ApiClient.kt](/Users/dim/vscodeproject/messenger/apps/desktop/src/main/kotlin/service/ApiClient.kt:32)
  - [handler.go](/Users/dim/vscodeproject/messenger/server/internal/auth/handler.go:244)

- Формат `registerKeys` не совпадает с `/api/keys/register`.
  Файлы:
  - [ApiClient.kt](/Users/dim/vscodeproject/messenger/apps/desktop/src/main/kotlin/service/ApiClient.kt:55)
  - [handler.go](/Users/dim/vscodeproject/messenger/server/internal/keys/handler.go:76)

- После логина `userId` сохраняется как `username`, а не как реальный id.
  Файл:
  - [AppViewModel.kt](/Users/dim/vscodeproject/messenger/apps/desktop/src/main/kotlin/viewmodel/AppViewModel.kt:58)

- Отправка сообщений идёт в WS как plaintext-пакет, а сервер ждёт payload с зашифрованными данными и списком получателей.
  Файлы:
  - [AppViewModel.kt](/Users/dim/vscodeproject/messenger/apps/desktop/src/main/kotlin/viewmodel/AppViewModel.kt:119)
  - [hub.go](/Users/dim/vscodeproject/messenger/server/internal/ws/hub.go:321)

#### Важные

- Хранилище ключей использует hardcoded password `messenger-desktop` для keystore.
  Файл:
  - [KeyStorage.kt](/Users/dim/vscodeproject/messenger/apps/desktop/src/main/kotlin/crypto/KeyStorage.kt:12)

- Desktop-клиент также не выглядит синхронизированным с реальным backend-flow для E2EE.

### Итог по Desktop

Desktop-клиент покрывает базовый пользовательский сценарий на уровне интерфейса, но, как и Android, реализует сетевую интеграцию по старому или несогласованному контракту. В текущем виде его нельзя считать рабочим self-hosted клиентом для этого сервера.

## Сравнение по платформам

### Android

- Сильная сторона: базовый мобильный chat UI уже собран.
- Слабая сторона: критично расходится с backend по auth, keys и WS message flow.

### iOS

- Сильная сторона: наиболее полный и аккуратный пользовательский интерфейс.
- Слабая сторона: часть ключевых сценариев вообще направлена в несуществующие backend endpoints.

### Desktop

- Сильная сторона: есть desktop UI и заготовки для звонков/WebRTC.
- Слабая сторона: логика интеграции с сервером повторяет те же ошибки, что и Android.

## Критичные фиксы в порядке приоритета

### 1. Привести auth flow всех нативных клиентов к реальному серверному контракту

Нужно:
- убрать ожидание `refreshToken` из JSON login-response;
- перейти на cookie-based refresh там, где это поддерживается;
- отдельно определить рабочую стратегию refresh для мобильных и desktop-клиентов, если cookie-модель для них не подходит.

Почему это первое:
- без исправления auth flow невозможно считать клиенты рабочими даже до уровня “войти в систему и стабильно жить с access token”.

Затронутые платформы:
- Android
- iOS
- Desktop

### 2. Синхронизировать `/api/keys/register` и весь device-key flow

Нужно:
- привести payload клиентов к реальному формату сервера;
- проверить, что после логина и регистрации device keys сервер может собрать рабочий prekey bundle;
- согласовать обязательные поля устройства и ключей.

Почему это второе:
- без этого не будет корректного E2EE bootstrapping и дальнейшего message/session flow.

Затронутые платформы:
- Android
- iOS
- Desktop

### 3. Исправить message transport contract

Нужно:
- выбрать единый реальный transport path;
- для Android и Desktop привести WS send payload к серверному формату;
- для iOS убрать отправку в несуществующий `POST /api/messages` и перевести на поддерживаемый механизм;
- затем проверить совместимость со входящими WS событиями.

Почему это третье:
- сейчас клиенты не совпадают с сервером по базовой операции мессенджера: отправке сообщения.

Затронутые платформы:
- Android
- iOS
- Desktop

### 4. Исправить хранение и использование `userId`

Нужно:
- на Android и Desktop сохранять серверный `userId`, а не `username`;
- на iOS перестать сохранять пустую строку;
- проверить все места, где `userId` используется для авторства сообщений, звонков и фильтрации событий.

Почему это четвёртое:
- даже при частично рабочей сети неправильный `userId` ломает поведение клиента логически.

Затронутые платформы:
- Android
- iOS
- Desktop

### 5. Привести WS event contracts к единому формату

Нужно:
- синхронизировать поля входящих событий;
- для iOS решить проблему с `senderDeviceId` в SKDM;
- проверить соответствие push/call/message событий реальному серверу.

Почему это пятое:
- это нужно для устойчивой realtime-работы после исправления auth и message send.

Затронутые платформы:
- Android
- iOS
- Desktop

### 6. Исправить хранение токенов и криптографических ключей

Нужно:
- Android: перейти на encrypted storage;
- iOS: перейти на Keychain;
- Desktop: убрать hardcoded keystore password и пересмотреть модель хранения.

Почему это шестое:
- это критично для безопасности, но логически идёт после восстановления базовой работоспособности.

Затронутые платформы:
- Android
- iOS
- Desktop

### 7. Доделать отсутствующие пользовательские сценарии

Нужно:
- регистрация пользователя;
- создание нового чата;
- поиск пользователей;
- смена пароля;
- server-admin / approval-related UX, если он нужен в нативных клиентах.

Почему это седьмое:
- это уже второй слой готовности после исправления поломанных базовых контрактов.

## Проверка

Фактически выполненные проверки:
- `Android`: `./gradlew testDebugUnitTest` прошло успешно.
- `Desktop`: `./gradlew test` прошло успешно.
- `iOS`: `swift test` не удалось прогнать из-за sandbox/permission проблемы записи в `/Users/dim/.cache/clang/ModuleCache`, поэтому вывод по iOS основан на статическом аудите кода.

## Практический вывод

Если цель проекта — self-hosted мессенджер уровня “WhatsApp/Telegram на своём сервере”, то главная проблема нативных клиентов сейчас не в количестве экранов, а в несогласованности протокола между клиентами и сервером.

Следующий разумный шаг:
- сначала выбрать один эталонный backend contract;
- затем привести к нему один клиент целиком;
- после этого переносить те же исправления на остальные платформы.

Из трёх платформ для такого выравнивания удобнее всего сначала брать одну:
- либо `Android` как наиболее прямой Kotlin-клиент;
- либо `iOS`, если нужен самый полный UI;
- либо `Desktop`, если приоритет — отладка без мобильной сборки.
