# План на следующую сессию

Актуально на: 2026-04-14
Ветка: `feat/spec-tasks`

## Текущий статус

Stage 11C-2 — Android-клиент **завершён и влит в main** ✅

- `./gradlew test` → BUILD SUCCESSFUL (4 теста: X3DHTest ×1, RatchetTest ×3)
- `./gradlew assembleDebug` → BUILD SUCCESSFUL

**В текущей сессии выполнено:**
- ✅ MEDIA-7: файл удаляется при удалении сообщения (миграция 14, `DeleteMediaByMsgID`, `client_msg_id` при загрузке)
- ✅ MSG-6: presence broadcast — зелёная точка в ChatList, `broadcastPresence` в Hub, `presenceMap` в chatStore

## Приоритеты выполнения

### Приоритет 2 — Should-задачи PWA + backend (в процессе)

**MSG-9: Ответ на сообщение (Reply)** (`client/`, `server/`)
- Добавить поле `replyToId` в payload сообщения
- Отобразить цитату в UI (bubble над вводом и в истории)

**E2E-7: Предупреждение при смене Identity Key** (`client/`)
- При получении bundle от `GET /api/keys/:userId` сравнивать с сохранённым IK
- При расхождении выводить системное сообщение в чат: "Identity of Alice has changed"

**E2E-6: Верификация идентичности (Safety Number)** (`client/`)
- Экран "Safety Number" с отображением хеша IK обоих участников
- Защита от MITM при личной проверке

---

### Приоритет 3 — Нативные приложения (Desktop + Android)

**Передача файлов** (`apps/desktop/`, `apps/mobile/android/`)
- Добавить кнопку выбора файла в `ChatWindowScreen.kt`
- Реализовать `uploadEncryptedMedia` / `fetchEncryptedMediaBlobUrl` в `ApiClient.kt` (по аналогии с PWA)

**Звонки WebRTC** (`apps/desktop/`, `apps/mobile/android/`)
- Добавить кнопку вызова в `ChatWindowScreen.kt`
- Интегрировать WebRTC: Google WebRTC для Android, JNA-обёртка для Desktop
- Подключить `/api/calls/ice-servers` в `ApiClient.kt`

---

### Приоритет 4 — Stage 11C-3 — iOS** (SwiftUI + Swift Concurrency)
- libsodium через Swift Package Manager (swift-sodium)
- SQLite через GRDB или SQLite.swift

## Что уже завершено и не трогать повторно

- `apps/mobile/android/` — полный MVP, все тесты зелёные, APK собирается
- `apps/desktop/` — полный MVP, все тесты зелёные
- `shared/native-core/` — runtime modules, web adapters, call stack
- `client/` web PWA — все фичи до этапа 12 включительно
- `server/` Go backend — все миграции #1–14

## Ключевые решения Android (справка)

- `lazysodium-android:5.1.0` (production, JNI) + `lazysodium-java:5.1.4` (тесты JVM, JNA)
- Crypto-классы принимают `LazySodium` (abstract superclass) — тестируемы без Android runtime
- `security-crypto` (EncryptedSharedPreferences) недоступен из Google Maven в dev-среде → plain SharedPreferences + TODO comment
- `ChatListViewModel` / `ChatWindowViewModel` инстанциируются через `remember {}` (не `viewModel()`)

## Ключевые документы

- `docs/superpowers/specs/native-client-architecture.md`
- `docs/superpowers/specs/native-client-compatibility-matrix.md`
- `docs/architecture.md`
- `docs/technical-documentation.md`
- `docs/v1-gap-remediation.md`

## Обязательная проверка после следующего шага

1. `cd apps/desktop && ./gradlew test`
2. `cd client && npm run type-check`
3. `cd client && npm run lint`
4. При изменениях в crypto — сверка с `shared/test-vectors/*.json`
