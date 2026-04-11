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

Существующие документы (созданы ранее, требуют актуализации):
- `docs/superpowers/plans/2026-04-10-cross-platform-client-apps.md`
- `docs/superpowers/plans/2026-04-10-native-client-execution-plan.md`
- `docs/superpowers/specs/native-client-architecture.md`

### Этап A — Foundation (стартовый приоритет)

**Цель:** зафиксировать архитектурные решения и создать каркас репозитория.

**Задачи:**

1. Создать `docs/superpowers/specs/native-client-compatibility-matrix.md`:
   - матрица платформа × capability (auth, crypto, storage, push, media, calls)
   - decision record: какую crypto lib использовать на каждой платформе
   - decision record: SwiftUI vs Compose Multiplatform для iOS UI

2. Подготовить каркас каталогов в репозитории:
   ```
   shared/
     protocol/      # типы WS-фреймов, REST-контракты (shared definitions)
     domain/        # модели: Chat, Message, User, Device
     crypto-contracts/  # интерфейсы: Ratchet, X3DH, SenderKey (язык-независимо)
     test-vectors/  # cross-platform crypto test vectors
   apps/
     desktop/       # Electron или Tauri (TBD)
     mobile/
       android/
       ios/
   ```

3. Зафиксировать decision records (ADR-формат) по:
   - **Secure storage**: keychain (iOS), Android Keystore, OS credential store (desktop)
   - **Local DB**: SQLite (все платформы) или SQLCipher для шифрования
   - **Native crypto stack**: libsodium-sys (Rust/Tauri), libsodium Java wrapper (Android), libsodium Swift (iOS)
   - **Desktop framework**: Tauri (Rust + WebView, меньше размер) vs Electron (больше экосистема)

### Этап B — Shared Core

**Цель:** реализовать платформенно-независимый core.

**Задачи:**
- Описать интерфейсы (не реализации): `AuthEngine`, `WSClient`, `CryptoEngine`, `MessageRepository`
- Зафиксировать cursor-based pagination как обязательный capability всех клиентов
- Подготовить `shared/test-vectors/` для cross-platform crypto верификации

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

**Ключевые файлы для понимания протокола:**
- `client/src/crypto/session.ts` — полная E2E сессия (X3DH + Double Ratchet)
- `client/src/crypto/x3dh.ts` — X3DH initiator/responder
- `client/src/crypto/ratchet.ts` — Double Ratchet + skipped keys
- `client/src/crypto/senderkey.ts` — Sender Keys для групп
- `client/src/api/client.ts` — REST API контракты (TypeScript)
- `client/src/types/index.ts` — WS фреймы (WSFrame, WSSendFrame)
- `server/internal/ws/hub.go` — WS Hub с device routing
- `server/db/schema.go` — схема БД
