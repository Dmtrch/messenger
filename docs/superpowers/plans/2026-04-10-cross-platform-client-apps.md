# Native Client Apps Plan

**Дата:** 2026-04-10  
**Приоритет:** High  
**Источник:** `docs/superpowers/specs/messenger-spec.md`, `docs/architecture.md`, `docs/technical-documentation.md`, фактическая структура `client/`

---

## Goal

Спланировать создание **полноценных приложений** Messenger для:

- Windows
- Linux
- macOS
- Android
- iOS

Под “полноценными приложениями” в этом плане понимаются не PWA и не thin-shell над web-клиентом, а отдельные приложения с нативным runtime, системной интеграцией, собственным lifecycle и поставкой через привычные для платформы механизмы.

---

## Жёсткая рамка проекта

Текущее состояние репозитория:

- реально существует только один клиент: `client/`;
- это web-клиент на `React + TypeScript + Vite`;
- он сильно опирается на браузерные API:
  - IndexedDB
  - Service Worker
  - Notifications API
  - Web Push
  - browser routing
- crypto-слой уже написан под web-среду;
- спецификация MVP изначально ориентирована на PWA для iOS/Android.

Следствие:

- **desktop native apps** можно строить с частичным переиспользованием доменной логики и UI-паттернов;
- **Android/iOS native apps** нельзя честно считать продолжением текущего web-клиента;
- для mobile потребуется отдельная нативная клиентская ветка, а не упаковка текущего `client/`.

---

## Архитектурное решение

### Основной принцип

Строим **семейство нативных клиентов**, а не один web-клиент с оболочками.

Целевая архитектура:

```text
messenger/
├── client/                         # текущий web/PWA-клиент, остаётся отдельным каналом
├── apps/
│   ├── desktop/                    # desktop family
│   │   ├── shared/
│   │   ├── windows/
│   │   ├── linux/
│   │   └── macos/
│   └── mobile/                     # mobile family
│       ├── shared/
│       ├── android/
│       └── ios/
└── server/
```

### Разделение на две продуктовые линии

1. **Desktop family**
   - Windows / Linux / macOS
   - единый desktop codebase допустим
   - общие UI-компоненты и shared core допустимы

2. **Mobile family**
   - Android / iOS
   - единый mobile codebase допустим
   - но это должен быть именно mobile-native client, а не web-wrapper

### Что можно шарить между всеми платформами

Шарить стоит только то, что не завязано на конкретный runtime:

- API contracts;
- DTO/типы протокола;
- бизнес-правила чатов;
- сериализацию сообщений;
- части криптографической модели;
- тестовые векторы;
- документацию и acceptance-критерии.

### Что нельзя шарить без переработки

- web storage слой;
- push слой;
- background execution;
- файловый слой;
- media permissions;
- notifications;
- app lifecycle;
- часть текущего crypto runtime, завязанного на `libsodium-wrappers` и браузерную среду.

---

## Recommended Stack

### Desktop apps

Для Windows, Linux и macOS рекомендую:

- **Kotlin Multiplatform + Compose Multiplatform** как основной кандидат

или, если команда хочет остаться ближе к существующему JS/TS стеку:

- **Tauri 2 + React** не подходит под это уточнённое требование как “полноценное приложение” в строгом смысле;
- **Electron** технически полноценный desktop app, но это всё ещё web-runtime внутри desktop app;
- поэтому для truly-native desktop направления лучше закладывать **Compose Multiplatform Desktop**.

Итоговая рекомендация для desktop:

- **Primary choice:** `Kotlin Multiplatform + Compose Multiplatform`

Это даст:

- нативный lifecycle;
- один desktop codebase;
- доступ к системным API;
- реальную desktop-модель, а не browser-in-desktop.

### Mobile apps

Для Android и iOS рекомендую:

- **Kotlin Multiplatform Mobile + Compose Multiplatform**

Альтернативы:

- `Flutter`
- `React Native`
- полностью раздельные `Kotlin + Swift`

Итоговая рекомендация:

- **Primary choice:** `Kotlin Multiplatform`
- UI:
  - Android: `Compose`
  - iOS: либо `Compose Multiplatform`, либо native SwiftUI-обёртка поверх shared domain/core

### Почему не React Native

React Native дал бы ускорение по UI, но:

- проект уже имеет web React-клиент, а не mobile React Native базу;
- crypto, storage, websocket, media, offline и push всё равно придётся пересобирать;
- получится третий JS-рантайм вместо консолидации.

### Почему не Flutter

Flutter технологически сильный вариант, но:

- это ещё один полностью отдельный стек;
- с текущим репозиторием он почти ничего напрямую не переиспользует;
- при наличии уже существующего Go backend и перспективы общего shared-domain слоя Kotlin Multiplatform выглядит более системно.

---

## Принятое направление

### Целевой стек плана

- **Windows / Linux / macOS:** Kotlin Multiplatform + Compose Desktop
- **Android:** Kotlin + Compose, с shared KMP core
- **iOS:** KMP shared core + iOS UI слой

Это не самый дешёвый старт, но это единственный путь, который соответствует уточнению “нужны полноценные приложения под каждую ОС”.

---

## Product Strategy

## Track 1: Desktop Native

Создаётся один desktop-native клиент с тремя целевыми платформами:

- Windows
- Linux
- macOS

Функциональные цели:

- авторизация;
- список чатов;
- личные и групповые сообщения;
- вложения;
- системные уведомления;
- локальный кэш истории;
- хранение ключей вне браузерной модели;
- автозапуск и tray;
- deep links;
- обновление приложения.

## Track 2: Mobile Native

Создаётся отдельный mobile-native клиент:

- Android app
- iOS app

Функциональные цели:

- авторизация;
- список чатов;
- личные и групповые сообщения;
- вложения;
- native push;
- background/resume логика;
- secure local storage;
- работа с камерой/галереей/файлами;
- mobile-first UX, а не адаптированный desktop/web layout.

---

## Phase 0: Foundation

Цель этапа: выделить общий, не-web-зависимый слой, который можно использовать в новых клиентах.

### Задачи

- Описать платформенно-независимый domain model:
  - `User`
  - `Chat`
  - `Message`
  - `Device`
  - `Attachment`
  - `WS events`
  - `Auth session`
- Вынести protocol contracts из web-клиента в отдельный shared package:
  - REST contracts
  - WS payload contracts
  - message payload schema
  - media payload schema
- Подготовить crypto abstraction:
  - key generation
  - key storage contract
  - session bootstrap
  - ratchet state contract
- Зафиксировать offline contracts:
  - local chat cache
  - outbox
  - sync queue
  - retry policy

### Deliverables

- `docs/superpowers/specs/native-client-architecture.md`
- `shared/protocol/`
- `shared/domain/`
- `shared/test-vectors/`

---

## Phase 1: Native Architecture RFC

Перед написанием приложений нужен один обязательный архитектурный документ.

### RFC должен ответить на вопросы

- где живёт shared core;
- как устроено E2E на mobile и desktop;
- где хранить приватные ключи:
  - Windows DPAPI / encrypted file storage
  - macOS Keychain
  - Linux Secret Service / encrypted app storage
  - Android Keystore
  - iOS Keychain
- как будет работать offline-кэш;
- как будут устроены push-уведомления;
- как будет работать media pipeline;
- как будет устроен app update и versioning.

### Acceptance criteria

- технология утверждена;
- storage strategy утверждена;
- push strategy утверждена;
- migration strategy от текущего web-клиента описана.

---

## Phase 2: Shared Core

Это фундамент для всех нативных приложений.

### Состав shared core

- auth module;
- chats module;
- messages module;
- websocket client abstraction;
- sync engine;
- crypto abstraction;
- repository interfaces;
- media metadata layer.

### Что не входит в shared core

- platform UI;
- native permissions;
- push SDK;
- file picker integration;
- OS notification layer;
- app lifecycle hooks.

### Ключевая идея

Shared core не должен зависеть ни от браузера, ни от Android SDK, ни от iOS UIKit/SwiftUI, ни от desktop shell.

---

## Phase 3: Desktop Native App

### 3.1 Структура

Создать:

- `apps/desktop/shared/`
- `apps/desktop/windows/`
- `apps/desktop/linux/`
- `apps/desktop/macos/`

или единый desktop app module, если Compose Desktop покроет всё без platform split.

### 3.2 Подсистемы

- desktop auth flow;
- desktop chat list;
- desktop chat window;
- desktop notifications;
- tray;
- launch at startup;
- local encrypted storage;
- file download/open;
- drag-and-drop attachments;
- desktop call UX.

### 3.3 Platform-specific integrations

#### Windows

- installer;
- WebRTC device permissions;
- notification center integration;
- secure secret storage;
- auto-update channel.

#### Linux

- `.deb` / `.AppImage`;
- secret storage integration;
- desktop notifications;
- distro-specific dependency matrix.

#### macOS

- `.dmg`;
- Keychain;
- notification center;
- sandbox/signing/notarization.

### 3.4 Acceptance criteria

- приложение устанавливается и запускается нативно на всех трёх ОС;
- не использует браузер как основной runtime;
- хранит чувствительные данные в платформенно корректном secure storage;
- поддерживает сообщения, вложения, offline cache и notifications.

---

## Phase 4: Android Native App

### Цели

- полноценное Android-приложение;
- native push;
- secure key storage;
- background-aware reconnect/sync;
- работа с media permissions;
- mobile-first UI.

### Подсистемы

- login/register;
- chat list;
- chat detail;
- create chat/group;
- attachment picker;
- camera/gallery support;
- notification routing;
- background sync;
- encrypted local cache;
- app settings.

### Android-specific requirements

- Android Keystore;
- FCM integration;
- foreground/background handling;
- battery optimization behavior;
- share intents;
- deep links.

### Acceptance criteria

- подписываемый release build;
- стабильный push;
- корректная работа после resume/background;
- secure storage не завязан на webview/IndexedDB.

---

## Phase 5: iOS Native App

### Цели

- полноценное iOS-приложение;
- native push;
- secure key storage;
- foreground/background lifecycle;
- media permissions;
- store-compliant UX.

### Подсистемы

- auth;
- chats;
- messages;
- attachments;
- notifications;
- local encrypted cache;
- account/device management;
- settings.

### iOS-specific requirements

- APNs integration;
- Keychain;
- background limitations;
- camera/photo library/files integration;
- universal links;
- App Store compliance.

### Критический риск

iOS накладывает самые жёсткие ограничения на background behavior и сетевую активность. Это должно быть отражено в архитектуре sync/push, а не “допилено потом”.

### Acceptance criteria

- сборка и запуск на реальном устройстве;
- стабильный APNs flow;
- secure storage через Keychain;
- сценарии login/chat/notifications работают без web-слоя.

---

## Data and Security Plan

### Storage

Для каждой платформы нужен собственный storage adapter:

- secure secrets storage;
- encrypted local database;
- attachments cache;
- outbox queue;
- ratchet/session store.

### Crypto

Нужно уйти от текущего web-only runtime.

Требуется:

- platform-independent crypto interfaces;
- реализация на нативных библиотеках;
- единые test vectors между web/native;
- верификация совместимости ciphertext между клиентами.

### Migration

Нужно отдельно описать:

- можно ли переносить устройство между web и native клиентом;
- как выглядит регистрация нового device;
- как избежать потери ratchet state;
- как не сломать multi-device модель.

---

## Build and Release Plan

### Desktop

- Windows installer pipeline
- Linux package pipeline
- macOS signed/notarized pipeline

### Mobile

- Android CI/CD build
- iOS archive/signing pipeline

### Versioning

Один product version policy для всех клиентов:

- backend compatibility matrix;
- protocol versioning;
- minimum supported client versions.

---

## Risks

### 1. Масштаб работ

Это уже не “адаптация текущего клиента”, а фактически новая клиентская платформа.

### 2. Crypto portability

Самый опасный технический риск: нужно гарантировать совместимость E2E между web-клиентом и новыми native-клиентами.

### 3. Push divergence

Web Push, FCM и APNs — три разные модели доставки. Нельзя проектировать их как один и тот же механизм.

### 4. Storage migration

Переход от browser storage к native secure storage требует отдельной migration strategy.

### 5. iOS review and restrictions

Даже технически рабочий клиент может потребовать дополнительной адаптации под политику App Store.

---

## Recommended Execution Order

1. Подтвердить native-first стратегию как официальное решение проекта.
2. Создать Architecture RFC.
3. Выделить shared protocol/domain layer.
4. Реализовать shared core.
5. Запустить desktop-native трек первым.
6. После этого делать Android-native.
7. Затем iOS-native.

---

## Pragmatic Recommendation

Если задача действительно звучит как “нужны полноценные приложения под каждую ОС”, то для этого проекта рекомендую такой порядок:

- сначала **Windows + Linux + macOS** как единый desktop-native продукт;
- затем **Android**;
- затем **iOS**;
- текущий `client/` оставить как существующий web-канал, но не считать его основой новых приложений.

Это самый честный и технически последовательный путь.
