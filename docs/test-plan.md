# Test Plan — Messenger (V-1a)

## 1. Scope

| Layer | Tool | Description |
|---|---|---|
| Unit (Go) | `go test` + `-race` | Isolated package tests, no external deps |
| Unit (TS) | Vitest | Crypto utils, stores, pure functions |
| Integration (Go) | `httptest` + real SQLite in-memory | Auth flows, invite flows, chat API |
| E2E | Playwright | Browser smoke tests against running server |
| Crypto vectors | Custom runner | `shared/test-vectors/*.json` validated in Go + TS |

Out of scope: iOS/Android automated testing (no toolchain in CI).

---

## 2. Coverage Targets by Component

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

Gates that are **advisory** (warn, don't block):

| Check | Notes |
|---|---|
| E2E Playwright smoke tests | Require running server; run on `workflow_dispatch` or staging env |
| Overall Go coverage < 70% | Warning only — per-package gate is stricter |

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
| iOS/Android — no automated tests | Native UI regressions caught manually only | Out of scope until native clients reach production readiness |
| Media upload E2E — missing | File send/receive flow not exercised | Planned post V-1 |
| Call signaling (WebRTC) — partial | SFU unit-tested; browser WebRTC not testable in Playwright without mediapipe | Mock ICE in E2E; real call test manual only |
