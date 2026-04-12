# Native Client Execution Plan

**Дата:** 2026-04-10  
**Тип:** Detailed execution plan  
**Источник:** [2026-04-10-cross-platform-client-apps.md](/Users/dim/vscodeproject/messenger/docs/superpowers/plans/2026-04-10-cross-platform-client-apps.md)

---

## Goal

Детализировать выполнение native-first стратегии для клиентских приложений Messenger по этапам:

1. Foundation
2. Shared Core
3. Desktop Native
4. Android Native
5. iOS Native

План должен быть пригоден для поэтапной реализации в репозитории и для трекинга milestone'ов.

---

## Planning Assumptions

- Текущий `client/` остаётся существующим web-каналом и не является базой для нативных приложений.
- Сервер `server/` остаётся общим backend для всех клиентов.
- Основной технологический вектор:
  - shared/domain/protocol/core на `Kotlin Multiplatform`;
  - desktop UI на `Compose Desktop`;
  - Android UI на `Compose`;
  - iOS на `SwiftUI` или `Compose Multiplatform` поверх shared KMP core.
- E2E-совместимость между web-клиентом и нативными клиентами обязательна.
- Multi-device, media, push, offline и sync должны работать как единая продуктовая модель на всех клиентах.

---

## Целевая структура каталогов

```text
messenger/
├── client/                                  # текущий web/PWA-клиент
├── server/                                  # Go backend
├── shared/
│   ├── protocol/                            # DTO, API/WS contracts, schemas
│   ├── domain/                              # платформенно-независимые модели
│   ├── crypto-contracts/                    # интерфейсы и тестовые векторы E2E
│   └── test-vectors/                        # межклиентские crypto fixtures
├── apps/
│   ├── desktop/
│   │   ├── app/                             # Compose Desktop app
│   │   ├── platform/
│   │   │   ├── windows/
│   │   │   ├── linux/
│   │   │   └── macos/
│   │   ├── storage/
│   │   └── packaging/
│   └── mobile/
│       ├── shared-core/                     # KMP shared core для Android/iOS
│       ├── android/
│       ├── ios/
│       ├── push/
│       └── storage/
└── docs/
    └── superpowers/
        ├── plans/
        └── specs/
```

---

## Phase 1: Foundation

## Objective

Подготовить архитектурный и репозиторный фундамент для нативных клиентов без начала полноценной UI-разработки.

## Scope

- определить shared boundaries;
- зафиксировать contracts;
- подготовить каркас каталогов;
- принять storage/push/crypto решения;
- описать compatibility matrix.

## Deliverables

- `docs/superpowers/specs/native-client-architecture.md`
- `docs/superpowers/specs/native-client-compatibility-matrix.md`
- `shared/protocol/`
- `shared/domain/`
- `shared/crypto-contracts/`
- `shared/test-vectors/`

## Tasks

### Task 1.1: Architecture RFC

- Описать:
  - границы web-клиента и native-клиентов;
  - shared core boundaries;
  - runtime-specific responsibilities;
  - migration strategy.

### Task 1.2: Protocol inventory

- Инвентаризировать:
  - REST endpoints;
  - WebSocket события;
  - auth/session model;
  - message payload format;
  - media payload format;
  - call signaling format.

### Task 1.3: Storage decision record

- Зафиксировать storage adapters:
  - Windows secure storage
  - macOS Keychain
  - Linux Secret Service / encrypted file storage
  - Android Keystore
  - iOS Keychain
- Зафиксировать локальную БД:
  - SQLite / SQLDelight / Realm / platform DB choice

### Task 1.4: Crypto compatibility plan

- Описать:
  - как переносится X3DH;
  - как переносится Double Ratchet;
  - какой native crypto stack используется;
  - как тестировать совместимость с текущим web-клиентом.

### Task 1.5: Repo bootstrap

- Создать каталоги:
  - `shared/`
  - `apps/desktop/`
  - `apps/mobile/`
- Добавить базовые README для каждого нового модуля.

## Milestones

### M1.1 Architecture Approved

Готово, когда:

- архитектурный документ написан;
- зафиксирован shared/core boundary;
- зафиксирован стек KMP/Compose/SwiftUI.

### M1.2 Contracts Frozen

Готово, когда:

- описаны все API/WS payload contracts;
- есть схема версионирования протокола;
- определены backward compatibility rules.

### M1.3 Repo Ready

Готово, когда:

- структура каталогов создана;
- модули имеют baseline build files;
- есть базовая developer documentation.

## Complexity

- **Общая сложность:** High
- **Риск:** Medium
- **Причина:** решений ещё много, но стоимость ошибок на этом этапе особенно высока.

## Rough Estimate

- 1.5-3 недели

---

## Phase 2: Shared Core

## Objective

Реализовать платформенно-независимый shared core, который станет базой для desktop, Android и iOS.

## Scope

- domain layer;
- repositories interfaces;
- auth/session engine;
- websocket client abstraction;
- sync engine;
- crypto abstraction;
- offline/outbox logic;
- media metadata layer.

## Целевая структура

```text
apps/mobile/shared-core/
├── auth/
├── chats/
├── messages/
├── websocket/
├── sync/
├── crypto/
├── storage/
├── media/
└── settings/
```

При необходимости этот же core может быть вынесен выше в `shared/native-core/`.

## Tasks

### Task 2.1: Domain models

- Реализовать платформенно-независимые модели:
  - user
  - chat
  - message
  - receipt
  - attachment
  - device
  - typing/presence events

### Task 2.2: Repository contracts

- Описать интерфейсы:
  - auth repository
  - chat repository
  - message repository
  - device repository
  - media repository
  - settings repository

### Task 2.3: Auth/session engine

- Реализовать:
  - login
  - refresh
  - logout
  - token lifecycle
  - device registration flow

### Task 2.4: WebSocket abstraction

- Реализовать:
  - connect/disconnect
  - reconnect policy
  - auth binding
  - inbound/outbound event parsing
  - event dispatch

### Task 2.5: Offline/sync engine

- Реализовать:
  - local chat cache
  - local message cache
  - outbox queue
  - retry policy
  - sync after reconnect

### Task 2.6: Crypto abstraction

- Реализовать интерфейсы:
  - key generation
  - session setup
  - encrypt/decrypt message
  - sender key distribution
  - ratchet state persistence hooks

### Task 2.7: Crypto test vectors

- Создать тесты совместимости:
  - web -> native decrypt
  - native -> web decrypt
  - native A -> native B
  - group sender keys
  - ratchet skipped keys

## Milestones

### M2.1 Core Builds

Готово, когда:

- shared core собирается отдельно;
- доменные модели и repository contracts стабилизированы.

### M2.2 Auth + WS Stable

Готово, когда:

- логин/refresh/logout работают через shared core;
- websocket abstraction стабильно держит reconnect.

### M2.3 Crypto Interop Stable

Готово, когда:

- есть межклиентские тестовые векторы;
- сообщения web/native дешифруются взаимно;
- ratchet state воспроизводим между реализациями.

### M2.4 Offline Ready

Готово, когда:

- работает local cache;
- работает outbox;
- работает sync после reconnect.

## Complexity

- **Общая сложность:** Very High
- **Риск:** High
- **Причина:** это самый критичный слой, и ошибка здесь размножится на все клиенты.

## Rough Estimate

- 4-8 недель

## Dependency Gate

Нельзя полноценно начинать Android/iOS UI до завершения минимум:

- `M2.2`
- `M2.3`

---

## Phase 3: Desktop Native

## Objective

Собрать production-ready desktop-native клиент для Windows, Linux и macOS.

## Scope

- desktop app shell;
- desktop UI;
- desktop storage;
- notifications;
- tray;
- startup behavior;
- packaging;
- auto-update.

## Целевая структура

```text
apps/desktop/
├── app/
│   ├── ui/
│   ├── navigation/
│   ├── screens/
│   ├── components/
│   └── themes/
├── platform/
│   ├── windows/
│   ├── linux/
│   └── macos/
├── storage/
├── packaging/
└── docs/
```

## Tasks

### Task 3.1: Desktop app bootstrap

- Создать Compose Desktop app;
- подключить shared core;
- настроить app lifecycle и navigation.

### Task 3.2: Desktop auth flow

- login/register screen;
- device registration;
- session recovery on startup.

### Task 3.3: Chat experience

- chat list;
- chat window;
- receipts;
- group chat flows;
- search/navigation.

### Task 3.4: Media

- file picker;
- drag-and-drop;
- download/open file;
- local cache for attachments.

### Task 3.5: Notifications and tray

- system notifications;
- unread badge;
- tray icon;
- restore/focus window behavior.

### Task 3.6: Secure storage

- credentials/session binding;
- key material storage;
- ratchet state persistence;
- encrypted local DB integration.

### Task 3.7: Desktop polish

- startup behavior;
- deep links;
- settings;
- logs;
- update channel.

### Task 3.8: Packaging

- Windows installer;
- Linux packaging;
- macOS packaging/signing/notarization plan.

## Milestones

### M3.1 Desktop MVP

Готово, когда:

- можно войти;
- можно читать/отправлять сообщения;
- работает локальная история;
- работает reconnect.

### M3.2 Desktop Secure Storage

Готово, когда:

- ключи и сессии хранятся не в plain local files;
- ratchet state персистентен и не ломает decrypt после рестарта.

### M3.3 Desktop UX Complete

Готово, когда:

- notifications;
- tray;
- attachments;
- settings;
- polished navigation.

### M3.4 Desktop Release Candidate

Готово, когда:

- есть release artifacts под 3 ОС;
- smoke test matrix пройдена;
- documented install/update flow готов.

## Complexity

- **Общая сложность:** High
- **Риск:** Medium
- **Причина:** runtime контролируемый, но много platform-specific packaging и storage деталей.

## Rough Estimate

- 5-9 недель

---

## Phase 4: Android Native

## Objective

Собрать production-ready Android-клиент.

## Scope

- native Android UI;
- secure storage;
- FCM;
- lifecycle/background logic;
- camera/gallery/files;
- mobile navigation and UX.

## Целевая структура

```text
apps/mobile/android/
├── app/
│   ├── ui/
│   ├── navigation/
│   ├── screens/
│   ├── components/
│   └── theme/
├── notifications/
├── storage/
├── media/
└── release/
```

## Tasks

### Task 4.1: Android app bootstrap

- создать Android app module;
- подключить shared core;
- настроить navigation, state restoration и app lifecycle.

### Task 4.2: Auth and device setup

- login/register;
- secure session restore;
- device identity setup;
- permissions flow if needed.

### Task 4.3: Chat UX

- chat list;
- message thread;
- input actions;
- group chat;
- receipts;
- unread handling.

### Task 4.4: Native notifications

- FCM integration;
- push routing;
- open chat from notification;
- badge handling.

### Task 4.5: Storage

- Android Keystore;
- encrypted local DB;
- cached attachments;
- ratchet/session persistence.

### Task 4.6: Media and permissions

- file picker;
- camera/gallery;
- image/file preview;
- upload/download flow.

### Task 4.7: Background/reconnect

- app foreground/background behavior;
- sync on resume;
- retry policy;
- battery optimization handling.

### Task 4.8: Release pipeline

- signed release build;
- `.aab`;
- Play Console readiness checklist.

## Milestones

### M4.1 Android MVP

Готово, когда:

- базовые auth/chat flows работают;
- shared core стабильно подключён;
- app работает на реальном устройстве.

### M4.2 Android Push Stable

Готово, когда:

- FCM доставляет push;
- tap on notification открывает правильный chat;
- foreground/background сценарии покрыты.

### M4.3 Android Media + Storage Stable

Готово, когда:

- media permissions работают;
- secure storage работает;
- restart/resume не ломают ключи и сессии.

### M4.4 Android Release Candidate

Готово, когда:

- есть подписанный release build;
- пройдены smoke/regression тесты;
- готова release documentation.

## Complexity

- **Общая сложность:** Very High
- **Риск:** High
- **Причина:** push, lifecycle, secure storage и mobile UX сильно сложнее desktop.

## Rough Estimate

- 6-10 недель

## Dependency Gate

Нельзя начинать production Android без завершения:

- `M2.2`
- `M2.3`
- `M2.4`

---

## Phase 5: iOS Native

## Objective

Собрать production-ready iOS-клиент.

## Scope

- iOS-native UI;
- Keychain;
- APNs;
- background constraints;
- camera/photo/files flows;
- App Store compliance.

## Целевая структура

```text
apps/mobile/ios/
├── App/
├── Features/
│   ├── Auth/
│   ├── Chats/
│   ├── Messages/
│   ├── Media/
│   └── Settings/
├── Notifications/
├── Storage/
├── Integrations/
└── Release/
```

## Tasks

### Task 5.1: iOS app bootstrap

- создать iOS app project;
- интегрировать shared KMP core;
- настроить app lifecycle и state restoration.

### Task 5.2: Auth and session recovery

- login/register;
- device registration;
- session recovery after restart.

### Task 5.3: Chat UX

- chat list;
- message thread;
- composer;
- groups;
- receipts;
- unread navigation.

### Task 5.4: APNs

- push registration;
- token sync with backend;
- notification routing;
- app open behavior from push.

### Task 5.5: Storage

- Keychain integration;
- encrypted local DB;
- key/session persistence;
- attachment cache.

### Task 5.6: Media and permissions

- photo library;
- camera;
- files;
- previews;
- upload/download flow.

### Task 5.7: iOS-specific lifecycle hardening

- foreground/background transitions;
- reconnect on resume;
- handling of suspended state;
- user-visible recovery flows.

### Task 5.8: Release readiness

- signing;
- TestFlight pipeline;
- App Store checklist;
- privacy declarations.

## Milestones

### M5.1 iOS MVP

Готово, когда:

- auth/chat flows работают на реальном устройстве;
- shared core стабильно интегрирован;
- app usable end-to-end.

### M5.2 iOS Push Stable

Готово, когда:

- APNs работает;
- notification routing корректный;
- foreground/background сценарии покрыты.

### M5.3 iOS Storage Stable

Готово, когда:

- Keychain работает;
- restart/resume не ломают E2E state;
- локальный кэш стабилен.

### M5.4 iOS Release Candidate

Готово, когда:

- TestFlight build проходит smoke test;
- privacy/compliance документы готовы;
- есть план App Store submission.

## Complexity

- **Общая сложность:** Very High
- **Риск:** Very High
- **Причина:** iOS накладывает самые жёсткие ограничения и требует отдельной release/compliance дисциплины.

## Rough Estimate

- 7-12 недель

## Dependency Gate

Нельзя начинать production iOS без завершения:

- `M2.2`
- `M2.3`
- `M2.4`

Желательно также завершить:

- `M4.2`

Потому что Android помогает стабилизировать mobile shared core до входа в самый дорогой iOS-этап.

---

## Suggested Milestone Order

1. `M1.1 Architecture Approved`
2. `M1.2 Contracts Frozen`
3. `M1.3 Repo Ready`
4. `M2.1 Core Builds`
5. `M2.2 Auth + WS Stable`
6. `M2.3 Crypto Interop Stable`
7. `M2.4 Offline Ready`
8. `M3.1 Desktop MVP`
9. `M3.2 Desktop Secure Storage`
10. `M3.3 Desktop UX Complete`
11. `M3.4 Desktop Release Candidate`
12. `M4.1 Android MVP`
13. `M4.2 Android Push Stable`
14. `M4.3 Android Media + Storage Stable`
15. `M4.4 Android Release Candidate`
16. `M5.1 iOS MVP`
17. `M5.2 iOS Push Stable`
18. `M5.3 iOS Storage Stable`
19. `M5.4 iOS Release Candidate`

---

## Overall Complexity Matrix

| Phase | Complexity | Risk | Estimate |
|---|---|---|---|
| Foundation | High | Medium | 1.5-3 недели |
| Shared Core | Very High | High | 4-8 недель |
| Desktop Native | High | Medium | 5-9 недель |
| Android Native | Very High | High | 6-10 недель |
| iOS Native | Very High | Very High | 7-12 недель |

---

## Critical Path

Самый важный критический путь проекта:

1. Foundation
2. Shared Core
3. Crypto interoperability
4. Desktop release candidate
5. Android release candidate
6. iOS release candidate

Если shared core и crypto interoperability не будут стабилизированы рано, весь план сдвинется вправо.

---

## Pragmatic Recommendation

Исполнять план стоит в таком режиме:

- сначала архитектура и shared core;
- потом desktop, чтобы быстрее получить production-native канал;
- затем Android;
- затем iOS.

Это минимизирует риск, даёт ранний полезный результат и не загоняет проект сразу в самый дорогой mobile-only контур.
