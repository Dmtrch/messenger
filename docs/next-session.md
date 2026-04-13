# План на следующую сессию

Актуально на: 2026-04-13
Ветка: `main`

## Следующий приоритет

Stage 11C-2 — Android-клиент (Kotlin + Compose).

Desktop MVP (Stage 11C-1) завершён и запушен. Все Kotlin-тесты, TypeScript type-check и lint — зелёные.

## Что делать дальше

1. **Stage 11C-2 — Android** (следующий крупный этап)
   - Brainstorm архитектуру Android-клиента (Jetpack Compose, Room или SQLDelight, Ktor)
   - Создать `apps/mobile/android/` каркас (Gradle, Compose Activity, минимальный Manifest)
   - Переиспользовать крипто-логику из `apps/desktop/src/main/kotlin/crypto/` (lazysodium-android)
   - Реализовать адаптеры: `ApiClient`, `MessengerWS`, `DatabaseProvider` под Android
   - Cursor-based пагинация обязательна

2. **Stage 11C-3 — iOS** (после Android)
   - SwiftUI + Swift Concurrency
   - libsodium через Swift Package Manager (swift-sodium)
   - SQLite через GRDB или SQLite.swift

3. Возможные мелкие доработки (не блокируют):
   - Обновить `docs/technical-documentation.md` по мере роста native track
   - Встроить обязательную синхронизацию документации в процесс разработки (`spec-gap-checklist.md` — единственный незакрытый Could)

## Stage 11C-1 — Desktop MVP: завершён ✅

Все 13 задач выполнены. Коммиты на `main`:

| Коммит | Содержание |
|--------|-----------|
| `c8307d9` | push main after rebase on remote deletions |
| `123bece` | fix(client): eslint exhaustive-deps |
| `a83d4b1` | fix(desktop): @Volatile wsSend + suspend logout |
| `a4473d5` | feat(desktop): sendMessage — outbox + WS dispatch |
| `3ff9560` | fix(desktop): ChatStore onTypingStop + ChatWindowViewModel DB/WS merge |
| `9d9373a` | feat(desktop): Stores + ViewModels + полный UI |
| `2506ce0` | fix(desktop): WSOrchestrator handleEdited |
| `003d19a` | feat(desktop): MessengerWS + WSOrchestrator |

Реализованные файлы `apps/desktop/`:
- `build.gradle.kts`, `settings.gradle.kts`, `gradle/libs.versions.toml`
- `crypto/X3DH.kt`, `crypto/Ratchet.kt`, `crypto/SenderKey.kt`, `crypto/KeyStorage.kt`
- `db/messenger.sq`, `db/DatabaseProvider.kt`
- `service/ApiClient.kt`, `service/TokenStore.kt`, `service/MessengerWS.kt`, `service/WSOrchestrator.kt`
- `store/AuthStore.kt`, `store/ChatStore.kt`
- `viewmodel/AppViewModel.kt`, `viewmodel/ChatListViewModel.kt`, `viewmodel/ChatWindowViewModel.kt`
- `ui/App.kt`, `ui/screens/ServerSetupScreen.kt`, `ui/screens/AuthScreen.kt`, `ui/screens/ChatListScreen.kt`, `ui/screens/ChatWindowScreen.kt`, `ui/screens/ProfileScreen.kt`

Целевые платформы в `build.gradle.kts`: `TargetFormat.Dmg` (macOS), `TargetFormat.Msi` (Windows), `TargetFormat.Deb` (Linux).

## Что уже завершено и не трогать повторно

- Весь `shared/native-core/` (runtime modules, web adapters, call stack)
- `apps/desktop/` — полный MVP, все тесты зелёные
- `client/` web PWA — все фичи до этапа 12 включительно
- `server/` Go backend — все миграции #1–13
- WS wiring рефакторинг (`useMessengerWS` принимает `apiClient + bindings`)

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
