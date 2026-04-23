# Test Plan — Messenger (V-1a)

**Последнее обновление:** 2026-04-23 — добавлены native-клиенты (Desktop/Android/iOS) в scope после перевода native-апп в production (коммит `51c4762`).

## 1. Scope

| Layer | Tool | Description |
|---|---|---|
| Unit (Go) | `go test` + `-race` | Isolated package tests, no external deps |
| Unit (TS) | Vitest | Crypto utils, stores, pure functions |
| Integration (Go) | `httptest` + real SQLite in-memory | Auth flows, invite flows, chat API |
| E2E (web) | Playwright | Browser smoke tests against running server |
| Unit (Desktop Kotlin) | `kotlin.test` + JUnit5 | `ApiClient`, `ChatStore`, `AppViewModel`, vault/crypto |
| Unit (Android Kotlin) | JUnit4 + Robolectric | `ApiClient`, `SessionManager`, `BiometricLockStore` |
| UI (Android Compose) | `androidx.compose.ui.test` | Smoke UI-flows (Auth, Chat, Admin) |
| Unit (iOS Swift) | XCTest + URLProtocol mocks | `ApiClient`, `AppViewModel`, Decodable DTOs |
| Crypto vectors | Custom runner | `shared/test-vectors/*.json` validated in Go + TS |

Out of scope (пока): полная UI-автоматизация iOS (XCUITest требует Xcode-агента в CI); end-to-end цепочка WebRTC-звонка на native.

---

## 2. Coverage Targets by Component

### Backend + Web

| Component | Type | Target | Key Files |
|---|---|---|---|
| `server/internal/auth` | Unit + Integration | ≥70% lines | `handler.go`, `middleware.go` |
| `server/internal/chat` | Unit + Integration | ≥70% lines | `handler.go` |
| `server/internal/ws` | Unit | ≥60% lines | `hub.go` |
| `server/internal/media` | Unit | ≥60% lines | `handler.go` |
| `server/internal/admin` | Unit + Integration | ≥70% lines | `handler.go` |
| `server/internal/password` | Unit | ≥90% lines | `password.go` |
| `server/internal/sfu` | Unit | ≥80% lines | `sfu.go` |
| `server/internal/calls` | Unit + Integration | ≥70% lines | `handler.go` |
| `server/internal/middleware` | Unit | ≥80% lines | `ratelimit.go` |
| `shared/native-core/crypto` | Unit (Vitest) | ≥80% lines | `*.ts` |
| `client/src/store` | Unit (Vitest) | ≥70% lines | `authStore.ts`, `callStore.ts` |
| `client/src/components` | E2E only | — | Playwright covers UI flows |

### Native Desktop (Kotlin Compose)

| Component | Type | Target | Key Files |
|---|---|---|---|
| `apps/desktop/.../service/ApiClient` | Unit (`MockEngine`) | ≥70% lines | `ApiClient.kt` |
| `apps/desktop/.../store/ChatStore` | Unit | ≥70% lines | `ChatStore.kt` (typing-timer) |
| `apps/desktop/.../viewmodel/AppViewModel` | Unit | ≥60% lines | `AppViewModel.kt` (login, sendMessage, WebRTC SDP) |
| `apps/desktop/.../store/UpdateCheckerStore` | Unit | ≥70% lines | `UpdateCheckerStore.kt` (semver compare) |
| UI screens | Manual smoke | — | AdminScreen, DownloadsScreen, LinkDeviceScreen |

### Native Android (Kotlin + Compose)

| Component | Type | Target | Key Files |
|---|---|---|---|
| `.../service/ApiClient` | Unit (`MockEngine`) | ≥70% lines | `ApiClient.kt` |
| `.../crypto/SessionManager` | Unit | ≥80% lines | `SessionManager.kt` (no plain-base64 fallback) |
| `.../store/BiometricLockStore` | Unit (Robolectric) | ≥70% lines | SharedPrefs + SHA-256 PIN |
| `.../store/UpdateCheckerStore` | Unit | ≥70% lines | polling + DownloadManager |
| UI smoke (Compose) | `composeTestRule` | — | AuthScreen, ChatScreen, AdminScreen |

### Native iOS (SwiftUI)

| Component | Type | Target | Key Files |
|---|---|---|---|
| `.../service/ApiClient` | XCTest + URLProtocol | ≥70% lines | `ApiClient.swift` |
| `.../viewmodel/AppViewModel` | XCTest | ≥60% lines | `AppViewModel.swift` (changePassword error, mediaId wiring) |
| DTO Decodable | XCTest | 100% (happy+sad) | `AdminUserDto`, `DownloadArtifactDto`, `AdminInviteCodeDto` |
| UI smoke (XCUITest) | Out of scope | — | Manual QA only |

---

## 3. CI Gates (GitHub Actions)

Gates that **block merge**:

| Check | Tolerance | Notes |
|---|---|---|
| `go test ./... -race` | Zero failures | Race detector mandatory |
| `npm run type-check` | Zero errors | TypeScript strict mode |
| `npm run lint` | Zero warnings | ESLint + TS-ESLint |
| Go coverage on touched packages | < 60% blocks merge | `goverage` or `go tool cover` per-package |
| Crypto test-vector validation | Zero failures | `shared/test-vectors/` |
| Desktop `./gradlew test` | Zero failures | Desktop app unit tests |
| Android `./gradlew testDebugUnitTest` | Zero failures | Android unit tests |
| iOS `xcodebuild test` | Zero failures | XCTest на macOS-агенте; advisory если агент недоступен |

Gates that are **advisory** (warn, don't block):

| Check | Notes |
|---|---|
| E2E Playwright smoke tests | Require running server; run on `workflow_dispatch` or staging env |
| Overall Go coverage < 70% | Warning only — per-package gate is stricter |
| Native per-module coverage ≥ targets in §2 | Warn-only initially, ужесточить после первого цикла |
| Android `connectedDebugAndroidTest` | Требует эмулятор; запускается на nightly |
| iOS XCUITest | Требует Xcode simulator; manual only |

---

## 4. Run Commands

```bash
# ── Backend: unit + integration ──────────────────────────────────────────────
cd server
go test ./... -race -coverprofile=coverage.out
go tool cover -func=coverage.out          # per-function summary
go tool cover -html=coverage.out          # HTML report

# Per-package threshold check (example: fail if auth < 70%)
go test ./internal/auth/... -coverprofile=auth.out
go tool cover -func=auth.out | awk '/^total/ { if ($3+0 < 70) exit 1 }'

# ── Frontend: unit ───────────────────────────────────────────────────────────
cd client
npm run test                              # single run (Vitest)
npm run test:coverage                     # with coverage thresholds (c8/istanbul)

# ── E2E ──────────────────────────────────────────────────────────────────────
# Requires: server running on :8080, client on :5173 (or single binary on :8080)
cd client
npx playwright install --with-deps       # first time
npx playwright test                       # all specs in client/e2e/
npx playwright test --ui                  # interactive

# ── Crypto test-vectors ──────────────────────────────────────────────────────
cd shared/native-core
npx vitest run crypto/                    # TS vector tests

cd server
go test ./internal/crypto/... -run TestVectors   # Go vector tests (when added)

# ── Native Desktop (Kotlin Compose) ──────────────────────────────────────────
cd apps/desktop
./gradlew test                            # unit tests
./gradlew jacocoTestReport                # coverage (when jacoco plugin добавлен)

# ── Native Android ───────────────────────────────────────────────────────────
cd apps/mobile/android
./gradlew testDebugUnitTest               # unit + Robolectric
./gradlew jacocoTestReport                # coverage (jacoco plugin required)
./gradlew connectedDebugAndroidTest       # на эмуляторе: Compose UI smoke

# ── Native iOS (требуется macOS + Xcode) ────────────────────────────────────
cd apps/mobile/ios
xcodebuild test \
  -scheme Messenger \
  -destination 'platform=iOS Simulator,name=iPhone 15,OS=latest' \
  -enableCodeCoverage YES
# Отчёт coverage: xcrun xccov view --report TestResults.xcresult
```

---

## 5. Crypto Test Vectors

Location: `shared/test-vectors/`

| File | What it validates |
|---|---|
| `argon2id.json` | Argon2id KDF output for known inputs — validates `server/internal/password` and JS crypto |
| `sqlcipher.json` | SQLCipher-compatible key derivation (if used for local DB on native) |
| `invites.json` | Invite code generation/validation logic |

Both Go and TypeScript consumers must pass all vectors before merge. New crypto primitives require corresponding vector additions in the same PR.

---

## 6. Known Gaps

| Gap | Impact | Plan |
|---|---|---|
| WebSocket flows not covered by integration tests | Hub disconnect, message routing, presence — untested | Add `httptest`-based WS tests in V-1b |
| E2E requires running server | Can't run in pure unit CI job | Use `go run` server setup in Playwright `globalSetup.ts` |
| Native unit-тесты отсутствуют | Регрессии в Desktop/Android/iOS ловятся только вручную | `docs/remaining-work-plan.md` #5 — создать минимальный набор (ApiClient, SessionManager, AppViewModel, DTO decode) до выпуска v1.1 |
| Media upload E2E — missing | File send/receive flow not exercised | Planned post V-1 |
| Call signaling (WebRTC) — partial | SFU unit-tested; browser WebRTC not testable in Playwright without mediapipe | Mock ICE in E2E; real call test manual only |
| Push-уведомления native — не покрыты | FcmService удалён, APNs не реализован — негде проверять регистрацию токена | Будут добавлены после `#1/#2` из `remaining-work-plan.md` |
| iOS XCUITest в CI | Требует macOS-агента + Xcode | Остаётся manual smoke до появления macOS runner в workflow |
