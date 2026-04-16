# Baseline билдов перед PRD alignment

Дата фиксации: 2026-04-17
Коммит (HEAD на момент замера): `8da774c` — `feat(native): реализация SessionManager и унификация API-клиентов`
Локальные изменения: есть незакоммиченные правки в `apps/desktop/...`, `apps/mobile/android/...`, `apps/mobile/ios/...`, `docs/next-session.md` и новые файлы `apps/*/ui/screens/NewChatScreen.*`, `docs/prd-vs-implementation.md`, `docs/prd-alignment-plan.md`, `prd.md`.

## Окружение

| Компонент | Версия |
|---|---|
| Go | 1.26.2 (darwin/arm64) |
| Node.js | 22.19.0 |
| npm | из Node 22 |
| Java (OpenJDK) | 17.0.14 LTS |
| Gradle | 8.13 (desktop + android) |
| Xcode | 26.4 (Build 17E192) |
| Swift | встроенный в Xcode 26.4 |

## Результаты

| Модуль | Команда | Статус | Примечание |
|---|---|---|---|
| **server** | `go build ./...` | ✅ exit=0 | — |
| **server** | `go test ./...` | ✅ exit=0 | все пакеты зелёные |
| **client** | `npm install` | ✅ exit=0 | up to date |
| **client** | `npm run lint` | ✅ exit=0 | 0 warnings |
| **client** | `npm run type-check` | ✅ exit=0 | `tsc --noEmit` чистый |
| **client** | `npm run test` | ✅ exit=0 | 5 файлов, 36 тестов |
| **client** | `npm run build` | ✅ exit=0 | dist/index-*.js 1622 KiB (gzip 501 KiB); PWA precache 6 entries |
| **shared/test-vectors** | `node --test shared/test-vectors/contracts.test.mjs` из корня репо | ✅ 14/14 pass | при запуске из `shared/test-vectors/` падает (ищет пути от cwd) — нужно всегда запускать из корня |
| **shared/native-core** | `npm test` | ⚠️ n/a | в `package.json` нет скрипта `test`; тестов как таковых нет, криптоспек покрыта в `client/` и `shared/test-vectors/contracts.test.mjs` |
| **apps/desktop** | `./gradlew assemble --no-daemon` | ✅ exit=0 | после фикса `NewChatScreen.kt` (disabled→enabled) и добавления `import io.ktor.client.request.parameter` в `ApiClient.kt`. Остаётся warning: `Icons.Filled.ArrowBack` deprecated — не блокер. |
| **apps/mobile/android** | `./gradlew assembleDebug --no-daemon` | ✅ exit=0 | после фикса `NewChatScreen.kt` (disabled→enabled). Warning Gradle 9.0 deprecations — не блокер. |
| **apps/mobile/ios** | `swift build` | ✅ exit=0 | warning: `grdb.swift` не используется ни одним target (не блокер); MessengerCrypto module emitted |

## История бейзлайна: падения Kotlin и их устранение (2026-04-17)

На первом прогоне 2026-04-17 desktop и android были красные. Ошибки находились в **незакоммиченных** правках (`M apps/desktop/src/main/kotlin/service/ApiClient.kt`, `?? apps/*/ui/screens/NewChatScreen.kt`).

### Что было
- `apps/desktop/.../service/ApiClient.kt:169` — `Unresolved reference 'parameter'`.
- `apps/desktop/.../ui/screens/NewChatScreen.kt:196` — `No parameter with name 'disabled' found`.
- `apps/desktop/.../ui/screens/NewChatScreen.kt:198` — `@Composable invocations can only happen from the context of a @Composable function` (следствие сломанной сигнатуры Button).
- Зеркально в `apps/mobile/android/.../NewChatScreen.kt:196-198`.

### Как починили (подготовительный шаг 0.5)
1. `apps/desktop/src/main/kotlin/service/ApiClient.kt` — добавлен `import io.ktor.client.request.parameter`. В android-версии этот импорт уже присутствует через `io.ktor.client.request.*`.
2. `apps/desktop/src/main/kotlin/ui/screens/NewChatScreen.kt` и `apps/mobile/android/src/main/kotlin/com/messenger/ui/screens/NewChatScreen.kt` — в Material3 `Button(...)` параметра `disabled` нет, есть `enabled`. Заменили `disabled = creating || selected.size < 2 || groupName.isBlank()` на `enabled = !creating && selected.size >= 2 && groupName.isNotBlank()`. Ошибка про @Composable пропала как следствие.

### Результат повторного прогона
- `apps/desktop`: `./gradlew assemble --no-daemon` → `BUILD SUCCESSFUL in 10s` (exit=0).
- `apps/mobile/android`: `./gradlew assembleDebug --no-daemon` → `BUILD SUCCESSFUL in 14s` (exit=0).

## Баннер-ворнинги (не блокеры)

- **client build**: один chunk > 500 KB (index-*.js). Candidate для `manualChunks` сплита, но не влияет на PRD alignment.
- **android gradle**: deprecated Gradle features (будет несовместимо с Gradle 9.0). Не трогаем в этой фазе.
- **ios swift**: неиспользуемый depend `grdb.swift`. В Фазе 2 (P2-LOC-2) перейдём на SQLCipher; тогда и пересмотрим зависимости.

## Критерии зелёного бейзлайна для последующих фаз

- `go build ./... && go test ./...` остаются зелёными.
- `npm run lint && npm run type-check && npm run test && npm run build` остаются зелёными.
- `node --test shared/test-vectors/contracts.test.mjs` (из корня) — 14/14 pass.
- `swift build` в `apps/mobile/ios` — успех.
- `./gradlew assemble` в `apps/desktop` и `assembleDebug` в `apps/mobile/android` — **должны быть восстановлены до зелёного** в первом же PR фазы 1 (или отдельным подготовительным PR).

## Как повторить замер

```bash
# server
cd server && go build ./... && go test ./...

# client
cd ../client && npm ci && npm run lint && npm run type-check && npm run test && npm run build

# shared contracts (ВАЖНО: из корня репо!)
cd .. && node --test shared/test-vectors/contracts.test.mjs

# native
cd apps/desktop && ./gradlew assemble --no-daemon
cd ../mobile/android && ./gradlew assembleDebug --no-daemon
cd ../ios && swift build
```
