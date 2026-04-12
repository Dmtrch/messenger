# Задачи на следующую сессию

Актуально на: 2026-04-11. Ветка: `feature/stage9-multi-device`.

---

## Выполнено в этой сессии

### Этап 10 — Полная multi-device архитектура (клиент + сервер)

**Сервер (фазы 1–5, коммит 984a28b):**
- Migration #8 — `messages.destination_device_id`
- `GET /api/keys/:userId` → `{ devices: [...] }` multi-device bundle
- WS Hub: `client.deviceID`, `DeliverToDevice`, `senderDeviceId` в payload
- `ServeWS`: читает `?deviceId=`, валидирует принадлежность пользователю

**Клиент (фазы 1.1–1.5, коммит deae7c0 + fan-out f162e57):**
- `session.ts` — `sessionKey` → `peerId:deviceId` (Signal Sesame); `encryptForAllDevices`; `decryptMessage(senderId, senderDeviceId, ct)`
- `client.ts` — `DeviceBundle`, `PreKeyBundleResponse`
- `types/index.ts` — `senderDeviceId?` в WSFrame message; `deviceId?` в WSSendFrame recipients
- `useMessengerWS.ts` — `senderDeviceId` → `decryptMessage`; `?deviceId=` в WS URL
- `ChatWindow.tsx` — fan-out DM: `getKeyBundle` + `encryptForAllDevices` для каждого участника

**Приоритет 2 (коммит a1810db):**
- `session.test.ts` — 7 тестов (33 всего, все проходят)
- Cursor-based пагинация истории: `IntersectionObserver` на topSentinel + кнопка fallback

---

## Следующий трек — Нативные приложения для разных ОС

Цель: реализовать полноценные нативные клиенты (не PWA-обёртки) для Desktop, Android, iOS.

### Стартовая точка

Документы Foundation уже зафиксированы:
- `docs/superpowers/plans/2026-04-10-cross-platform-client-apps.md`
- `docs/superpowers/plans/2026-04-10-native-client-execution-plan.md`
- `docs/superpowers/specs/native-client-architecture.md`
- `docs/superpowers/specs/native-client-compatibility-matrix.md`
- `docs/superpowers/specs/adr-native-secure-storage.md`
- `docs/superpowers/specs/adr-native-local-db.md`
- `docs/superpowers/specs/adr-native-crypto-stack.md`
- `docs/superpowers/specs/adr-native-desktop-framework.md`
- `docs/superpowers/specs/adr-native-ios-ui.md`

### Этап A — Foundation (стартовый приоритет)

**Статус:** выполнен.

**Принятые решения:**

1. `Desktop`: `Kotlin Multiplatform + Compose Multiplatform Desktop`
2. `Android`: `Kotlin + Compose` поверх shared core
3. `iOS`: `KMP shared core + SwiftUI`
4. `Local DB`: нативная реализация через `SQLite`, но с той же offline/outbox/pagination-семантикой, что уже есть у PWA
5. `Crypto stack`: перенос текущей модели из `client/src/crypto/` без смены `X3DH`, `Double Ratchet`, `Sender Keys`; базовый примитивный слой остаётся в семействе `libsodium`
6. `Cursor-based pagination`: обязательна для всех нативных клиентов

**Что уже подготовлено в репозитории:**

1. Создан каркас каталогов:
   - `shared/protocol`
   - `shared/domain`
   - `shared/crypto-contracts`
   - `shared/test-vectors`
   - `apps/desktop`
   - `apps/mobile/android`
   - `apps/mobile/ios`
2. Добавлены baseline `README.md` для `shared/` и `apps/`.
3. Созданы formal schemas:
   - `shared/protocol/rest-schema.json`
   - `shared/protocol/ws-schema.json`
   - `shared/protocol/message-envelope.schema.json`

### Этап B — Shared Core

**Статус:** выполнен в контрактном слое, без runtime-реализаций.

**Что уже сделано:**
- описаны platform-neutral интерфейсы `AuthEngine`, `WSClient`, `CryptoEngine`, `MessageRepository`;
- описаны domain models, repositories, auth/session lifecycle, websocket lifecycle, sync/outbox semantics;
- `cursor-based pagination` зафиксирована как обязательный capability всех клиентов;
- подготовлен стартовый набор `shared/test-vectors/` для `X3DH`, `Double Ratchet`, `Sender Keys`;
- formal protocol schemas связаны с текущими REST/WS/message envelope контрактами.

**Следующий шаг:** начать писать runtime-код для `shared/native-core`.

**Важно для следующей сессии:**

Если пользователь пишет фразу уровня:

- `начинаем писать код для shared`
- `переходим к shared`
- `начинай реализацию shared/native-core`

то это означает:

1. не возвращаться к этапу проектирования;
2. не предлагать снова RFC / ADR / совместимость;
3. сразу начинать реализацию кода в `shared/native-core`;
4. первый приоритет — `shared/native-core/auth` и `shared/native-core/websocket`;
5. работать от уже зафиксированных контрактов в:
   - `shared/protocol/*.json`
   - `shared/domain/*.md`
   - `shared/crypto-contracts/interfaces.md`
   - `shared/test-vectors/*`

**Первый кодовый трек для старта:**

1. Создать структуру `shared/native-core/` по модулям:
   - `auth/`
   - `websocket/`
   - `sync/`
   - `crypto/`
   - `storage/`
   - `messages/`
2. Начать с runtime-контрактов и минимальных реализаций для:
   - session state / token lifecycle
   - websocket connection state machine
   - reconnect policy
3. Сразу добавлять тесты на новый runtime-слой, а не только документы.

### Этапы C/D/E — Desktop → Android → iOS

**Последовательность:** Desktop первым (проще стабилизировать), Android вторым, iOS последним.

**Обязательное требование для всех:** cursor-based догрузка старой истории с сервера — не только локальный кэш.

---

## Контекст для быстрого старта

**Текущее состояние репозитория:**
- Ветка: `feature/stage9-multi-device` (последний коммит: `a1810db`)
- Все Must из spec-gap-checklist закрыты
- Web-клиент полностью работает с multi-device (Signal Sesame spec)
- Сервер: Go, SQLite, WebSocket Hub с device routing
- Frontend: React PWA, Vite, TypeScript, libsodium, IndexedDB
- Foundation и Shared Core для native track зафиксированы на уровне RFC, ADR, каркаса каталогов и formal contract layer

**Ключевые файлы для понимания протокола:**
- `client/src/crypto/session.ts` — полная E2E сессия (X3DH + Double Ratchet)
- `client/src/crypto/x3dh.ts` — X3DH initiator/responder
- `client/src/crypto/ratchet.ts` — Double Ratchet + skipped keys
- `client/src/crypto/senderkey.ts` — Sender Keys для групп
- `client/src/api/client.ts` — REST API контракты (TypeScript)
- `client/src/types/index.ts` — WS фреймы (WSFrame, WSSendFrame)
- `server/internal/ws/hub.go` — WS Hub с device routing
- `server/db/schema.go` — схема БД
- `shared/protocol/rest-schema.json` — formal REST schema
- `shared/protocol/ws-schema.json` — formal WS schema
- `shared/protocol/message-envelope.schema.json` — formal message envelope schema
- `shared/native-core/module.json` — стартовый runtime-модуль Shared Core
