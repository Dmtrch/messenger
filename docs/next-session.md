# Задачи на следующую сессию

Актуально на: 2026-04-11. Ветка: `feature/stage9-multi-device`.

---

## Выполнено в этой сессии

### Клиентская часть (фазы 1.1–1.5) — multi-device архитектура

- **session.ts** — `sessionKey` → `peerId:deviceId` (Signal Sesame spec); `encryptForAllDevices`; `decryptMessage(senderId, senderDeviceId, ct)`; `handleIncomingSKDM` + `tryDecryptPreview` + `encryptMessage` обновлены
- **client.ts** — `DeviceBundle`, `PreKeyBundleResponse { devices: DeviceBundle[] }`, `getKeyBundle` → `PreKeyBundleResponse`
- **types/index.ts** — `senderDeviceId?: string` в WSFrame `message`
- **useMessengerWS.ts** — `senderDeviceId` извлекается из `message` фрейма и передаётся в `decryptMessage`
- **websocket.ts** — `?deviceId=<id>` добавляется в WS URL из `loadDeviceId()` (keystore)
- **ChatWindow.tsx**, **ChatListPage.tsx**, **ChatWindowPage.tsx** — вызовы `encryptMessage`/`tryDecryptPreview` обновлены под новые сигнатуры

---

## Приоритет 1 — Must ✅ Закрыт

Все Must задачи клиентской части multi-device выполнены:
- session.ts: Signal Sesame sessionKey, encryptForAllDevices, decryptMessage(senderId, deviceId, ct)
- client.ts: DeviceBundle, PreKeyBundleResponse
- useMessengerWS.ts: senderDeviceId → decryptMessage; ?deviceId= в WS URL
- ChatWindow.tsx: fan-out — getKeyBundle + encryptForAllDevices для каждого участника DM
- types/index.ts: deviceId? в WSSendFrame recipients

---

## Приоритет 2 — Should ✅ Закрыт

### 2.1 Тесты session.ts ✅

- `client/src/crypto/session.test.ts` — 7 тестов: sessionKey (peerId:deviceId), encryptForAllDevices (2 устройства → 2 разных ciphertext), decryptMessage round-trip, раздельные сессии per-device, multi-message ratchet, encryptMessage fallback, fallback ошибка без устройств

### 2.2 Cursor-based догрузка истории ✅

- **ChatWindow.tsx**: `decodeMessages` вынесен в отдельный useCallback; `loadHistory` сохраняет `nextCursor`; `loadOlderMessages(chatId, cursor)` загружает предыдущие сообщения; `IntersectionObserver` на `topSentinelRef` авто-триггерит при прокрутке вверх; кнопка "Загрузить ещё" как fallback; состояние `hasMoreHistory` управляет видимостью
- **ChatWindow.module.css**: стиль `.loadMore` для кнопки

Следствие:

- web-клиент пока не даёт полноценного подъёма к старой истории;
- для будущих desktop/mobile native клиентов это тоже должно считаться обязательным требованием с первого релиза истории чата.

Что нужно сделать:

- реализовать client-side cursor pagination для web-клиента;
- зафиксировать это как обязательный capability для:
  - web client
  - desktop native
  - Android native
  - iOS native
- не ограничивать историю только:
  - первичной серверной загрузкой;
  - локальным хвостом из offline-кэша.

Критерий готовности:

- при прокрутке вверх клиент догружает предыдущие сообщения по `before=<oldestMessageId>`;
- дедупликация работает;
- локальный кэш не ломает порядок сообщений;
- один и тот же принцип пагинации используется во всех клиентских каналах.

---

## Контекст для быстрого старта

Ветка: `feature/stage9-multi-device`. Серверная часть коммита: `984a28b`.

**Что работает на сервере:**
- `GET /api/keys/:userId` возвращает `{ devices: [...] }` — по одному bundle на устройство
- WS сообщение содержит `senderDeviceId`
- WS принимает `?deviceId=` и валидирует владельца
- `messages.destination_device_id` хранится в БД; `DeliverToDevice` доставляет адресно

**Что осталось на клиенте:**
- Рефактор `sessionKey` с `chatId:peerId` → `peerId:deviceId`
- Обновить типы API (`DeviceBundle[]` вместо плоского bundle)
- `decryptMessage(senderId, senderDeviceId, ciphertext)` — использовать `senderDeviceId`
- Fan-out: шифровать отдельно для каждого устройства получателя
- WS connect: передавать `?deviceId=`
- Реализовать cursor-based догрузку старой истории вверх; сейчас сервер умеет, клиент — ещё нет

**Ключевые файлы этой сессии:**
- `server/db/migrate.go` — migration #8
- `server/db/queries.go` — GetIdentityKeysByUserID, Message.DestinationDeviceID
- `server/internal/keys/handler.go` — GetBundle multi-device
- `server/internal/ws/hub.go` — deviceID, DeliverToDevice, senderDeviceId
- `docs/superpowers/plans/2026-04-10-stage9-multi-device.md` — полный план

**Ключевые файлы для следующей сессии:**
- `client/src/crypto/session.ts` — sessionKey, encryptForAllDevices, decryptMessage
- `client/src/api/client.ts` — PreKeyBundleResponse тип
- `client/src/hooks/useMessengerWS.ts` — senderDeviceId, ?deviceId= в URL
- `client/src/pages/ChatWindowPage.tsx` — fan-out отправка

---

## Отдельный трек — нативные приложения для разных ОС

В этой сессии подготовлен отдельный архитектурный трек под **полноценные нативные приложения**, а не PWA-обёртки.

### Созданные документы

- [План по кроссплатформенным нативным клиентам](/Users/dim/vscodeproject/messenger/docs/superpowers/plans/2026-04-10-cross-platform-client-apps.md)
- [Детальный execution plan](/Users/dim/vscodeproject/messenger/docs/superpowers/plans/2026-04-10-native-client-execution-plan.md)
- [RFC: native client architecture](/Users/dim/vscodeproject/messenger/docs/superpowers/specs/native-client-architecture.md)

### Рекомендуемая последовательность реализации

#### Этап A — Foundation

Цель:

- утвердить native-first стратегию;
- зафиксировать архитектурные границы;
- подготовить структуру каталогов и shared contracts.

Основные результаты:

- `shared/protocol/`
- `shared/domain/`
- `shared/crypto-contracts/`
- `shared/test-vectors/`
- RFC и compatibility matrix

#### Этап B — Shared Core

Цель:

- реализовать платформенно-независимый core для desktop/mobile клиентов.

Основные результаты:

- auth/session engine
- websocket abstraction
- sync/outbox engine
- crypto abstraction
- repository contracts
- единый контракт cursor-based pagination истории для всех клиентов

#### Этап C — Desktop Native

Цель:

- первым выпустить production-ready нативный клиент для:
  - Windows
  - Linux
  - macOS

Причина приоритета:

- desktop проще стабилизировать раньше mobile;
- это даёт первый реальный native delivery channel.

Дополнительное обязательное требование:

- подъём к старой переписке должен догружать историю с сервера по cursor-pagination, а не ограничиваться локальным кэшем.

#### Этап D — Android Native

Цель:

- выпустить полноценный Android-клиент на shared core с:
  - secure storage
  - FCM
  - media permissions
  - reconnect/background handling
  - cursor-based загрузкой старой истории вверх

#### Этап E — iOS Native

Цель:

- выпустить полноценный iOS-клиент после стабилизации shared core и Android mobile-path.

Причина последнего приоритета:

- iOS самый дорогой и рискованный этап по lifecycle, storage, APNs и release/compliance.

Дополнительное обязательное требование:

- тот же механизм cursor-based истории, что и у остальных клиентов, без отдельной логики “только локальный хвост”.

### Практический приоритет на следующую сессию

Если продолжать именно трек нативных приложений, следующий логичный шаг:

1. Создать `docs/superpowers/specs/native-client-compatibility-matrix.md`
2. Подготовить `Foundation`-каркас каталогов:
   - `shared/`
   - `apps/desktop/`
   - `apps/mobile/`
3. Зафиксировать decision records по:
   - secure storage
   - local DB
   - native crypto stack
   - iOS UI strategy (`SwiftUI` или `Compose Multiplatform`)
