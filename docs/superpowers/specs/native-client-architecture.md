# RFC: Native Client Architecture

**Статус:** Accepted  
**Дата:** 2026-04-10  
**Этап:** Foundation  
**Связанные документы:**  
- [2026-04-10-cross-platform-client-apps.md](/Users/dim/vscodeproject/messenger/docs/superpowers/plans/2026-04-10-cross-platform-client-apps.md)  
- [2026-04-10-native-client-execution-plan.md](/Users/dim/vscodeproject/messenger/docs/superpowers/plans/2026-04-10-native-client-execution-plan.md)  
- [native-client-compatibility-matrix.md](/Users/dim/vscodeproject/messenger/docs/superpowers/specs/native-client-compatibility-matrix.md)  
- [adr-native-secure-storage.md](/Users/dim/vscodeproject/messenger/docs/superpowers/specs/adr-native-secure-storage.md)  
- [adr-native-local-db.md](/Users/dim/vscodeproject/messenger/docs/superpowers/specs/adr-native-local-db.md)  
- [adr-native-crypto-stack.md](/Users/dim/vscodeproject/messenger/docs/superpowers/specs/adr-native-crypto-stack.md)  
- [adr-native-desktop-framework.md](/Users/dim/vscodeproject/messenger/docs/superpowers/specs/adr-native-desktop-framework.md)  
- [adr-native-ios-ui.md](/Users/dim/vscodeproject/messenger/docs/superpowers/specs/adr-native-ios-ui.md)  
- [messenger-spec.md](/Users/dim/vscodeproject/messenger/docs/superpowers/specs/messenger-spec.md)  
- [technical-documentation.md](/Users/dim/vscodeproject/messenger/docs/technical-documentation.md)

---

## 1. Summary

Этот RFC описывает целевую архитектуру нативных клиентских приложений Messenger для:

- Windows
- Linux
- macOS
- Android
- iOS

Главная идея: новые клиенты проектируются как **native-first family**, а не как продолжение текущего web/PWA-клиента. При этом backend, протоколы и E2E-модель остаются общими.

Предлагаемое архитектурное решение:

- `Kotlin Multiplatform` как основа shared core;
- `Compose Multiplatform Desktop` для desktop family;
- `Compose` для Android;
- `KMP shared core + SwiftUI` для iOS;
- текущий `client/` остаётся отдельным web-каналом, но не служит основой новых приложений.

---

## 2. Context

### 2.1 Текущее состояние проекта

В репозитории реально существует один клиент:

- `client/` — React + TypeScript + Vite PWA

Этот клиент использует:

- IndexedDB
- Service Worker
- Web Push
- browser notifications
- browser lifecycle
- web crypto runtime

На уровне продукта это работает для web/PWA-сценариев, но не является хорошей основой для полноценных нативных приложений под desktop и mobile ОС.

### 2.2 Почему нужен отдельный native architecture track

Требование пользователя звучит как:

- нужны не PWA-приложения;
- нужны полноценные приложения под каждую ОС.

Это означает:

- системная интеграция;
- platform-native lifecycle;
- secure storage по правилам платформы;
- native push model;
- корректная работа с файлами, media permissions, background/resume;
- release/distribution через нативные механизмы платформ.

---

## 3. Goals

## 3.1 Functional goals

- Реализовать полноценные нативные клиенты под desktop и mobile ОС.
- Сохранить совместимость с текущим backend и протоколом.
- Сохранить E2E-модель:
  - приватные ключи только на клиенте;
  - сервер не расшифровывает сообщения.
- Поддержать:
  - auth
  - multi-device
  - chats
  - attachments
  - push
  - offline cache
  - reconnect/sync
  - group messaging

## 3.2 Architectural goals

- Минимизировать дублирование бизнес-логики между платформами.
- Не тащить browser-specific зависимости в native clients.
- Явно разделить:
  - domain/protocol/core
  - platform integrations
  - UI layers

## 3.3 Security goals

- Использовать secure storage, принятый для каждой платформы.
- Не хранить E2E ключи в небезопасном plain storage.
- Обеспечить межклиентскую совместимость шифрования.

---

## 4. Non-Goals

Этот RFC не покрывает:

- детальный UI/UX дизайн экранов;
- полный release process по каждой платформе;
- серверный рефакторинг вне того, что нужно для совместимости клиентов;
- замену текущего web-клиента;
- мгновенный отказ от PWA-канала.

---

## 5. Decision

## 5.1 Принятое решение

Архитектура новых клиентов строится по модели:

- **Shared protocol/domain/core:** Kotlin Multiplatform
- **Desktop family:** Compose Desktop
- **Android:** Kotlin + Compose
- **iOS:** shared KMP core + отдельный iOS UI layer

## 5.2 Почему это решение выбрано

Оно даёт:

- один shared core для desktop/mobile;
- нативный runtime;
- platform-specific secure storage и push;
- меньший риск архитектурного расползания, чем при трёх независимых стеках.

---

## 6. Alternatives Considered

## 6.1 Electron

### Плюсы

- быстрый старт;
- близко к текущему React-стеку;
- дешёвая миграция части UI.

### Минусы

- это desktop web runtime, а не truly-native путь;
- остаётся та же проблема browser-centric архитектуры;
- не решает mobile-native часть;
- увеличивает размер и runtime cost.

### Решение

Отклонено как основа целевой native architecture.

## 6.2 Tauri 2

### Плюсы

- легче Electron;
- хорошо стыкуется с Vite;
- подходит как desktop app shell.

### Минусы

- по сути остаётся web UI внутри desktop app;
- не соответствует строгому требованию “полноценные нативные приложения”;
- не даёт общего ответа для Android/iOS.

### Решение

Не принимается как основная архитектура целевой native platform family.

## 6.3 Flutter

### Плюсы

- сильный кроссплатформенный runtime;
- хорош для mobile и desktop;
- один стек на все платформы.

### Минусы

- почти нулевое переиспользование текущих клиентских наработок;
- отдельный стек и tooling;
- потребует полного переписывания UI и core без явной выгоды по сравнению с KMP.

### Решение

Рассмотрен, но не выбран.

## 6.4 React Native

### Плюсы

- знакомый JS/TS-подход;
- потенциально быстрее для mobile UI.

### Минусы

- почти весь сложный слой всё равно придётся писать заново:
  - secure storage
  - crypto runtime
  - offline storage
  - push
  - media
- остаётся раздвоение web React и mobile React Native;
- не решает desktop-native задачу.

### Решение

Не выбран.

## 6.5 Раздельные нативные клиенты без shared core

### Плюсы

- максимальная platform fit;
- можно делать лучшее решение под каждую ОС.

### Минусы

- катастрофическая стоимость поддержки;
- дублирование crypto/domain/sync;
- высокий риск protocol drift.

### Решение

Отклонено.

---

## 7. High-Level Architecture

## 7.1 Logical layers

```text
┌──────────────────────────────────────────────┐
│              Platform UI Layer               │
│ Desktop UI / Android UI / iOS UI            │
├──────────────────────────────────────────────┤
│           Platform Integration Layer         │
│ notifications / storage / media / lifecycle │
├──────────────────────────────────────────────┤
│                Shared Core Layer             │
│ auth / chats / ws / sync / crypto contract  │
├──────────────────────────────────────────────┤
│             Protocol / Domain Layer          │
│ DTO / schemas / domain models / contracts    │
├──────────────────────────────────────────────┤
│                 Backend API/WS               │
│                Go server + SQLite            │
└──────────────────────────────────────────────┘
```

## 7.2 Rule of dependency

- UI зависит от platform integrations и shared core.
- Platform integrations зависят от shared core contracts, но не от UI.
- Shared core зависит от protocol/domain.
- Protocol/domain не зависят от runtime.
- Backend не зависит от конкретной клиентской платформы.

---

## 8. Repository Architecture

## 8.1 Proposed structure

```text
messenger/
├── client/
├── server/
├── shared/
│   ├── protocol/
│   ├── domain/
│   ├── crypto-contracts/
│   └── test-vectors/
├── apps/
│   ├── desktop/
│   │   ├── app/
│   │   ├── platform/
│   │   ├── storage/
│   │   └── packaging/
│   └── mobile/
│       ├── shared-core/
│       ├── android/
│       ├── ios/
│       ├── push/
│       └── storage/
└── docs/
```

## 8.2 Repo principles

- `client/` не переносится и не ломается.
- Новые native clients живут в `apps/`.
- Shared non-UI артефакты живут в `shared/`.
- Документация по новым клиентам живёт в `docs/superpowers/specs` и `docs/superpowers/plans`.

---

## 9. Shared Protocol Layer

## 9.1 Responsibility

Shared protocol layer определяет:

- REST request/response DTO;
- WebSocket event payloads;
- message payload schema;
- media payload schema;
- call signaling schema;
- protocol versioning.

## 9.2 Rules

- DTO должны быть независимы от UI.
- DTO должны быть независимы от конкретной платформы.
- Все клиенты обязаны проходить через единый protocol compatibility contract.

## 9.3 Versioning

Нужно ввести:

- `protocolVersion`;
- minimum supported server/client version matrix;
- политику backward compatibility.

---

## 10. Shared Domain Layer

## 10.1 Responsibility

Domain layer описывает:

- user;
- device;
- chat;
- message;
- attachment;
- receipts;
- sync states;
- auth session;
- connection state.

## 10.2 Principles

- Никаких platform SDK типов.
- Никаких UI-specific типов.
- Никаких browser-specific сущностей.

---

## 11. Shared Core Layer

## 11.1 Responsibility

Shared core реализует:

- auth/session lifecycle;
- websocket connection management;
- reconnect and sync orchestration;
- local cache orchestration;
- outbox orchestration;
- crypto abstraction contracts;
- repository orchestration.

## 11.2 Explicit non-responsibility

Shared core не должен реализовывать:

- notification SDK integration;
- file picker logic;
- camera/gallery permission logic;
- platform secure storage SDK specifics;
- app lifecycle APIs;
- screen layout.

---

## 12. Crypto Architecture

## 12.1 Requirements

Нужно сохранить совместимость с текущей моделью:

- X3DH
- Double Ratchet
- Sender Keys
- multi-device semantics

## 12.2 Problem

Текущий web-клиент использует web-oriented crypto runtime и storage model. Это нельзя перенести в native клиенты без выделения абстракций.

## 12.3 Decision

Вводится `crypto contracts layer`:

- key generation contract;
- identity key contract;
- signed prekey contract;
- one-time prekey contract;
- session bootstrap contract;
- message encrypt/decrypt contract;
- group sender key contract;
- ratchet persistence contract.

## 12.4 Compatibility strategy

Нужно ввести общие test vectors:

- web encrypt -> native decrypt;
- native encrypt -> web decrypt;
- native A -> native B;
- group message flows;
- skipped key flows;
- ratchet persistence after restart.

## 12.5 Storage of key material

Приватные ключи и ratchet state должны храниться через platform-secure strategy:

- Windows: secure storage adapter
- Linux: encrypted local storage + secret service integration
- macOS: Keychain-backed strategy
- Android: Keystore-backed strategy
- iOS: Keychain-backed strategy

---

## 13. Storage Architecture

## 13.1 Storage classes

Разделяем хранение на три класса:

### A. Secrets

- identity keys
- signed prekeys
- one-time prekeys
- ratchet state
- device identity metadata
- sensitive session state

### B. Operational state

- auth session metadata
- sync cursors
- local settings
- notification routing metadata

### C. Cache

- chat list cache
- message cache
- attachment thumbnails
- outbox

## 13.2 Design rule

- Secrets не должны храниться в plain storage.
- Cache может храниться в app-local DB.
- Operational state должен быть отделён от secrets.

---

## 14. Push Architecture

## 14.1 Reality

Push не может быть единым implementation layer для всех клиентов.

Есть три разных механизма:

- Web Push
- FCM
- APNs

## 14.2 Decision

Push делается как platform integration layer:

- web client: Web Push
- Android: FCM
- iOS: APNs
- desktop: system notifications + optional background delivery strategy

## 14.3 Rule

Shared core может знать только о доменном событии:

- `NotificationReceived`
- `MessageWakeEvent`
- `PushRegistrationUpdated`

Но не должен знать про конкретные SDK/platform tokens.

---

## 15. Media Architecture

## 15.1 Requirements

Нативные клиенты должны поддерживать:

- file picking;
- camera/photo library;
- preview;
- upload/download;
- local caching.

## 15.2 Decision

Media pipeline делится на:

- shared metadata logic;
- platform-specific file/media access logic.

Shared core знает:

- media descriptors;
- upload state;
- decryption contract;
- media message schema.

Platform layer знает:

- file system APIs;
- gallery/camera APIs;
- preview/open flows.

---

## 16. Desktop Architecture

## 16.1 Decision

Desktop family строится как один native product line на Compose Desktop.

## 16.2 Platform-specific integrations

Нужно отдельно реализовать:

- notifications;
- tray;
- startup behavior;
- deep links;
- file system integration;
- secure storage integration;
- packaging/update.

## 16.3 Why desktop first

Desktop проще стабилизировать раньше mobile, потому что:

- меньше ограничений на lifecycle;
- проще отлаживать storage и crypto;
- быстрее получить production-native результат.

---

## 17. Android Architecture

## 17.1 Decision

Android строится как native Android app, использующий shared KMP core.

## 17.2 Responsibilities

- native UI;
- FCM;
- Android Keystore;
- media permissions;
- background/resume behavior;
- deep links/share intents.

## 17.3 Critical concerns

- battery optimization;
- reconnect semantics;
- secure persistence after process death;
- notification routing.

---

## 18. iOS Architecture

## 18.1 Decision

iOS строится как отдельный native iOS app, использующий shared KMP core.

## 18.2 Responsibilities

- iOS-native UI;
- APNs;
- Keychain;
- file/photo/camera integrations;
- lifecycle handling;
- App Store compliant flows.

## 18.3 Critical concerns

- background restrictions;
- APNs integration;
- restore after suspended state;
- secure persistence;
- policy/compliance requirements.

---

## 19. Migration Strategy

## 19.1 Web client status

Текущий `client/` остаётся рабочим каналом и не удаляется.

## 19.2 Native client rollout

Рекомендуемая последовательность:

1. Foundation
2. Shared core
3. Desktop native
4. Android native
5. iOS native

## 19.3 Device semantics

Нужно считать каждый native client полноценным устройством в multi-device модели.

Это означает:

- web client device;
- desktop device;
- android device;
- ios device;

все они должны быть равноправными участниками E2E-модели.

---

## 20. Testing Strategy

## 20.1 Shared testing

- protocol conformance tests;
- crypto compatibility tests;
- repository contract tests;
- sync/outbox tests.

## 20.2 Platform testing

- desktop smoke tests;
- Android real-device tests;
- iOS real-device tests;
- restart/reconnect tests;
- push delivery tests;
- attachment flows.

## 20.3 Must-have cross-client tests

- web -> desktop
- desktop -> android
- android -> ios
- ios -> web
- group chat on mixed clients
- multi-device user on mixed clients

---

## 21. Risks

## 21.1 Crypto portability risk

Если crypto contracts будут определены плохо, совместимость клиентов станет дорогой и хрупкой.

## 21.2 Storage migration risk

Переход от browser-oriented storage к native secure storage требует аккуратной модели восстановления состояния.

## 21.3 Push divergence risk

Web Push, FCM и APNs нельзя проектировать как один и тот же transport.

## 21.4 Team capacity risk

Это по сути новая клиентская платформа, а не небольшой рефакторинг текущего клиента.

## 21.5 iOS risk

iOS остаётся самой дорогой и ограниченной платформой по реализации и release discipline.

---

## 22. Open Questions

Решения Foundation уже приняты для:

1. iOS UI: `SwiftUI`
2. локальной БД: `SQLite` как нативная реализация текущей PWA offline-модели
3. native crypto stack: перенос текущей PWA crypto-модели с `libsodium` family
4. desktop framework: `Compose Multiplatform Desktop`
5. secure storage: platform-native credential stores

Открытыми остаются только вопросы следующих этапов:

1. Где живёт `shared core`: в `apps/mobile/shared-core` или в `shared/native-core`?
2. Нужен ли отдельный desktop-only integration layer, или всё platform-specific держать в `apps/desktop/platform/*`?
3. Нужен ли промежуточный compatibility layer между web crypto implementation и native crypto implementation?
4. Какой minimum version policy вводим для protocol compatibility?

---

## 23. Acceptance Criteria for This RFC

RFC считается принятым, потому что:

- команда подтвердила native-first стратегию;
- стек `KMP + Compose + SwiftUI` утверждён;
- зафиксированы boundaries между:
  - shared protocol
  - shared domain
  - shared core
  - platform integrations
  - UI layers
- утверждена storage strategy;
- утверждена push strategy;
- migration path зафиксирован на уровне Foundation документов;
- ключевые открытые вопросы переведены в отдельные decision records.

---

## 24. Final Recommendation

Для этого проекта архитектурно корректно считать, что:

- текущий `client/` — это отдельный web product channel;
- новые desktop/mobile клиенты — это новая native client platform family;
- shared value нужно искать не в переносе web UI, а в переносе protocol/domain/core;
- desktop надо делать первым;
- mobile надо делать после стабилизации shared core и crypto interoperability.

Это решение дороже на старте, но оно соответствует исходному требованию о полноценных приложениях под каждую ОС и снижает архитектурный долг в среднесрочной перспективе.
