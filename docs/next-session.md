# План на следующую сессию

Актуально на: 2026-04-14
Ветка: `main`

## Текущий статус

Priority 3 — **в работе** (Android file transfer завершён).

**В текущей сессии выполнено:**
- ✅ MEDIA-8: E2E передача файлов Android — XSalsa20 через lazysodium, Coil EncryptedMediaFetcher, inline изображения, карточка скачивания, DB schema v2
  - `./gradlew test` → BUILD SUCCESSFUL (7 тестов)
  - `./gradlew assembleDebug` → BUILD SUCCESSFUL

**Ранее завершено:**
- ✅ MSG-9: Reply (DB migration #15, WS, REST, shared/native-core, UI)
- ✅ E2E-7: Предупреждение при смене IK
- ✅ E2E-6: Safety Number
- ✅ MEDIA-7: файл удаляется при удалении сообщения
- ✅ MSG-6: presence broadcast

## Приоритеты выполнения

### Приоритет 3 — Нативные приложения (Desktop + Android)

**Передача файлов Android** ✅ ЗАВЕРШЕНО

**Передача файлов Desktop** (`apps/desktop/`) — **следующий шаг**
- По аналогии с Android: кнопка 📎 в chat окне, шифрование через JVM-crypto (XSalsa20), multipart upload, inline preview + download card
- Спецификация и план: создать по аналогии с `docs/superpowers/specs/2026-04-14-android-file-transfer-design.md`

**Звонки WebRTC** (`apps/desktop/`, `apps/mobile/android/`)
- Добавить кнопку вызова в chat окно
- Интегрировать WebRTC: Google WebRTC для Android, JNA-обёртка для Desktop
- Подключить `/api/calls/ice-servers` в `ApiClient.kt` (Android) / аналог Desktop

---

### Приоритет 4 — iOS** (SwiftUI + Swift Concurrency)
- libsodium через Swift Package Manager (swift-sodium)
- SQLite через GRDB или SQLite.swift

## Что уже завершено и не трогать повторно

- `apps/mobile/android/` — полный MVP + file transfer, все тесты зелёные, APK собирается
- `apps/desktop/` — полный MVP, все тесты зелёные
- `shared/native-core/` — runtime modules, web adapters, call stack
- `client/` web PWA — все фичи до этапа 12 включительно
- `server/` Go backend — все миграции #1–15

## Ключевые решения Android (справка)

- `lazysodium-android:5.1.0` (production, JNI) + `lazysodium-java:5.1.4` (тесты JVM, JNA)
- Crypto-классы принимают `LazySodium` (abstract superclass) — тестируемы без Android runtime
- `security-crypto` (EncryptedSharedPreferences) недоступен из Google Maven в dev-среде → plain SharedPreferences + TODO comment
- `ChatListViewModel` / `ChatWindowViewModel` инстанциируются через `remember {}` (не `viewModel()`)
- DB schema v2: 4 nullable media-колонки в `message`, миграция `1.sqm`
- Coil `EncryptedMediaFetcher` — кастомный fetcher, расшифровывает медиа на лету через `ApiClient.fetchDecryptedMedia`

## Ключевые документы

- `docs/superpowers/specs/native-client-architecture.md`
- `docs/superpowers/specs/native-client-compatibility-matrix.md`
- `docs/superpowers/specs/2026-04-14-android-file-transfer-design.md`
- `docs/architecture.md`
- `docs/technical-documentation.md`

## Обязательная проверка после следующего шага

1. `cd apps/mobile/android && ./gradlew test`
2. `cd apps/mobile/android && ./gradlew assembleDebug`
3. `cd client && npm run type-check`
4. `cd client && npm run lint`
5. При изменениях в crypto — сверка с `shared/test-vectors/*.json`
