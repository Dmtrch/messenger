# План на следующую сессию

Актуально на: 2026-04-14
Ветка: `main`

## Текущий статус

Stage 11C-2 — Android-клиент **завершён и влит в main** ✅

- `./gradlew test` → BUILD SUCCESSFUL (4 теста: X3DHTest ×1, RatchetTest ×3)
- `./gradlew assembleDebug` → BUILD SUCCESSFUL

## Следующий приоритет

**Stage 11C-3 — iOS** (SwiftUI + Swift Concurrency)
- libsodium через Swift Package Manager (swift-sodium)
- SQLite через GRDB или SQLite.swift

## Что уже завершено и не трогать повторно

- `apps/mobile/android/` — полный MVP, все тесты зелёные, APK собирается
- `apps/desktop/` — полный MVP, все тесты зелёные
- `shared/native-core/` — runtime modules, web adapters, call stack
- `client/` web PWA — все фичи до этапа 12 включительно
- `server/` Go backend — все миграции #1–13

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
