# Native Client Compatibility Matrix

**Статус:** Accepted  
**Дата:** 2026-04-11  
**Этап:** Foundation  
**Связанные документы:**  
- [native-client-architecture.md](/Users/dim/vscodeproject/messenger/docs/superpowers/specs/native-client-architecture.md)  
- [adr-native-secure-storage.md](/Users/dim/vscodeproject/messenger/docs/superpowers/specs/adr-native-secure-storage.md)  
- [adr-native-local-db.md](/Users/dim/vscodeproject/messenger/docs/superpowers/specs/adr-native-local-db.md)  
- [adr-native-crypto-stack.md](/Users/dim/vscodeproject/messenger/docs/superpowers/specs/adr-native-crypto-stack.md)  
- [adr-native-desktop-framework.md](/Users/dim/vscodeproject/messenger/docs/superpowers/specs/adr-native-desktop-framework.md)  
- [adr-native-ios-ui.md](/Users/dim/vscodeproject/messenger/docs/superpowers/specs/adr-native-ios-ui.md)  
- [technical-documentation.md](/Users/dim/vscodeproject/messenger/docs/technical-documentation.md)  

---

## 1. Назначение

Этот документ фиксирует совместимость capability-слоя между текущим PWA-клиентом и будущими нативными клиентами. Его задача не описать реализацию по файлам, а заморозить архитектурные решения, которые обязательны для этапов `Shared Core`, `Desktop`, `Android`, `iOS`.

Ключевой принцип Foundation:

- backend и wire contracts общие для всех клиентов;
- криптографическая модель переносится из текущего PWA без смены алгоритмов и message format;
- offline-модель клиента сохраняется концептуально, но на нативных платформах реализуется через platform-native storage;
- platform-specific интеграции не должны менять продуктовый контракт.

---

## 2. Зафиксированные решения

### 2.1 Platform stack

- `Desktop`: `Kotlin Multiplatform + Compose Multiplatform Desktop`
- `Android`: `Kotlin + Compose` поверх shared core
- `iOS`: `KMP shared core + SwiftUI`

### 2.2 Shared core boundary

В shared-слой выносятся:

- REST/WS contracts;
- domain-модели (`User`, `Chat`, `Message`, `Device`, `Attachment`);
- auth/session semantics;
- reconnect/sync semantics;
- crypto contracts и test vectors;
- pagination contract.

В platform-слой остаются:

- secure storage;
- push transport;
- media permissions и file integration;
- app lifecycle;
- системные уведомления;
- platform packaging/distribution.

### 2.3 Storage and crypto constraints

- локальная модель хранения должна повторять текущий PWA-клиент по семантике: cache, outbox, sync queue, cursor-based pagination;
- нативная реализация этой модели фиксируется через `SQLite`;
- криптографическая модель переносится из `client/src/crypto/` без замены `X3DH`, `Double Ratchet`, `Sender Keys`;
- кроссплатформенная совместимость подтверждается через общие test vectors и wire-format compatibility.

---

## 3. Матрица capability × platform

| Capability | Desktop | Android | iOS | Общий статус |
|---|---|---|---|---|
| Auth | Shared contract + platform session persistence | Shared contract + platform session persistence | Shared contract + platform session persistence | Обязательно для shared core |
| Crypto | Shared crypto model + native bindings | Shared crypto model + native bindings | Shared crypto model + native bindings | Алгоритмы и wire-format одинаковые |
| Local storage | `SQLite` + OS secure storage | `SQLite` + Android Keystore | `SQLite` + Keychain | Семантика как в PWA |
| Push / notifications | System notifications, push не обязателен как mobile transport | FCM | APNs | Platform-specific transport |
| Media | Native file system integration | Native media/file intents | Native media/file access | Platform-specific integration |
| Calls | WebRTC-native implementation | WebRTC-native implementation | WebRTC-native implementation | Signaling контракт общий |
| Cursor pagination | Обязательна | Обязательна | Обязательна | Must-have для всех клиентов |
| Offline cache | Обязательна | Обязательна | Обязательна | Семантика как в PWA |
| Outbox / retry | Обязательна | Обязательна | Обязательна | Shared sync semantics |
| Multi-device | Обязательна | Обязательна | Обязательна | Совместимость с текущим backend |

---

## 4. Capability notes

### 4.1 Auth

Общим остаётся:

- JWT access token model;
- refresh semantics;
- device registration flow;
- `WSS /ws?token=<JWT>&deviceId=<deviceId>` модель подключения.

Platform-specific остаётся:

- secure persistence refresh/session state;
- background resume;
- системная реакция на logout или token expiry.

### 4.2 Crypto

Нативные клиенты не получают новую криптографическую схему. Они обязаны повторить уже реализованный в PWA стек:

- `X3DH`
- `Double Ratchet`
- `skipped message keys`
- `Sender Keys`
- совместимая сериализация payload
- совместимая session/device semantics из multi-device этапа

Изменение алгоритмов без отдельного RFC запрещено.

### 4.3 Storage

Текущий web-клиент использует browser-specific storage, но product-semantics уже сформированы:

- локальный кэш истории;
- оффлайн-чтение истории;
- outbox для исходящих сообщений;
- фоновый retry;
- cursor-based догрузка с сервера.

Нативные клиенты должны повторять именно эту модель, а не придумывать новую offline-архитектуру.

### 4.4 Push

Push transport не унифицируется в один runtime API:

- `Desktop`: системные уведомления и runtime-specific delivery model
- `Android`: `FCM`
- `iOS`: `APNs`

Общим остаётся только продуктовый контракт:

- без plaintext message content;
- routing по пользователю и устройству;
- корректная реактивация синка после resume/open.

### 4.5 Media

Общим остаётся:

- media API contract;
- encrypted-media model;
- access control через backend.

Platform-specific остаётся:

- camera/gallery/files;
- preview/open-in-app;
- share intents и OS-level permissions.

### 4.6 Calls

Нативные клиенты должны использовать тот же signaling contract, что уже заложен в проекте для WebRTC:

- `call_offer`
- `call_answer`
- `ice_candidate`
- `call_end`
- `call_reject`
- `call_busy`

Менять signaling payloads на platform-specific формат нельзя.

---

## 5. Decision records summary

| Topic | Decision |
|---|---|
| Secure storage | iOS `Keychain`, Android `Android Keystore`, Desktop `OS credential store` |
| Local DB | `SQLite` как нативная реализация текущей PWA offline-модели |
| Crypto stack | Перенос текущей PWA crypto-модели с `libsodium` family и общими test vectors |
| Desktop framework | `Compose Multiplatform Desktop` |
| iOS UI | `SwiftUI` поверх shared core |

---

## 6. Rules for next phases

Следующие этапы обязаны соблюдать:

1. Нельзя менять криптографическую модель ради удобства конкретной платформы.
2. Нельзя заменять cursor-based pagination на локальную-only пагинацию.
3. Нельзя проектировать storage/push/media как web-wrapper над `client/`.
4. Нельзя вводить отдельные REST/WS payload contracts для нативных клиентов.
5. Любое отклонение от этих решений требует отдельного ADR.
