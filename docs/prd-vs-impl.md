# PRD vs Implementation Status

## Overview

- **Total tasks completed:** 47 / 50
- **Date:** 2026-04-20
- **Source:** `docs/prd-alignment-progress.md`

---

## Implementation Status by Phase

### Phase 0: Baseline

| Requirement ID | Requirement | Status | Notes |
|---|---|---|---|
| F0-1 | Baseline & metrics (green builds, CHANGELOG, progress doc) | ✅ done | See `prd-alignment-baseline.md`. Fully green after step 0.5. |
| F0-1.5 | Compilation fix for desktop/android (`NewChatScreen.kt`, `ApiClient.kt`) | ✅ done | Desktop assemble ✅, Android assembleDebug ✅. |
| F0-2 | Control test vectors (invites, Argon2id, SQLCipher) | ✅ done | `shared/test-vectors/`: `invites.json`, `argon2id.json`, `sqlcipher.json`. Placeholder data pending P1-PWD-1 / P1-INV-1 / P2-LOC. |

---

### Phase 1: Gatekeeping & Crypto

#### 1.1 Invites

| Requirement ID | Requirement | Status | Notes |
|---|---|---|---|
| P1-INV-1 | Hard TTL=180s for invites | ✅ done | TTL 180s default, range [60..600], 422 out-of-bounds. Errors: 410 `invite_expired`, 410 `invite_revoked`, 409 `invite_already_used`. Tests: `server/internal/admin/invite_test.go`. |
| P1-INV-2 | QR code in admin panel | ✅ done | `qrcode.react` SVG level M; payload `https://<origin>/auth?invite=<code>`. Shown via "Show QR" button for active invites. |
| P1-INV-3 | Invite revocation (`DELETE /api/admin/invite-codes/{id}`) | ✅ done | Migration 17 (`revoked_at`). DELETE `/api/admin/invite-codes/{code}` → 204/404. "Revoke" button in UI. |
| P1-INV-4 | Activation log (IP, UA) | ✅ done | Migration 18 (`invite_activations`). `GET /api/admin/invite-codes/{code}/activations`. IP via `secmw.ClientIP` with `BEHIND_PROXY` support. |
| P1-INV-5 | Visual countdown timer in admin panel | ✅ done | Live mm:ss timer on active invites, updates every second, switches status to `expired` on timeout. |

#### 1.2 Argon2id Passwords

| Requirement ID | Requirement | Status | Notes |
|---|---|---|---|
| P1-PWD-1 | `password` module with Argon2id (PHC-string) | ✅ done | `server/internal/password/password.go`: Argon2id (m=64MiB, t=3, p=4), PHC string, NFC normalization, bcrypt-legacy. Tests: `password_test.go`. |
| P1-PWD-2 | Lazy migration from bcrypt | ✅ done | `Login` after successful `password.Verify` checks `NeedsRehash` and rewrites hash to Argon2id. Test: `server/internal/auth/lazy_rehash_test.go`. |
| P1-PWD-3 | Rate-limit + constant-time compare | ✅ done | `authLimiter = NewRateLimiter(20, 1min, BEHIND_PROXY)` covers register/login/refresh/request-register/password-reset-request. `subtle.ConstantTimeCompare` in `password.Verify`. Tests: `middleware/ratelimit_test.go`, `password_test.go`. |

#### 1.3 TLS 1.3

| Requirement ID | Requirement | Status | Notes |
|---|---|---|---|
| P1-TLS-1 | Enforce `MinVersion: tls.VersionTLS13` | ✅ done | `cmd/server/main.go:tlsConfig()` returns `*tls.Config` with `MinVersion: tls.VersionTLS13`. Applied when `TLS_CERT/TLS_KEY` are set. Contract test: `cmd/server/tls_test.go`. |

#### 1.4 Native Binary Distribution

| Requirement ID | Requirement | Status | Notes |
|---|---|---|---|
| P1-DIST-1 | CI artifact build (exe/dmg/deb/apk/ipa) + signing | ✅ done | `.github/workflows/build-native.yml`: 7 jobs — macOS arm64/x86_64 DMG, Linux DEB, Windows MSI, Android APK, iOS crypto check, GitHub Release. macOS codesign + Windows signtool (optional, via secrets). |
| P1-DIST-2 | Protected `/api/downloads/*` zone with manifest | ✅ done | `server/internal/downloads/handler.go`: `GET /api/downloads/manifest` (JSON+SHA256+size), `GET /api/downloads/{filename}` (stream, anti-traversal). Auth required. `DOWNLOADS_DIR` env var. |
| P1-DIST-3 | `/downloads` page + auto-OS + redirect after registration | ✅ done | `DownloadsPage.tsx`: manifest fetch + OS-detect + blob-download (Bearer). CSS in `pages.module.css`. Route in `App.tsx`. Redirect `navigate('/downloads')` after successful registration. |
| P1-DIST-4 | Auto-config (embedded `server_url`) in distribution build | ✅ done | `SERVER_URL` env var read by Gradle (Android BuildConfig, Desktop generateBuildConfig); iOS: `BuildConfig.swift` patched via `scripts/set-server-url.sh`; Web: `VITE_SERVER_URL` in `initServerUrl`. |

#### 1.5 Kill Switch / Suspend / Remote Wipe

| Requirement ID | Requirement | Status | Notes |
|---|---|---|---|
| P1-SEC-1 | Account statuses (`active/suspended/banned`) + middleware | ✅ done | Migration 19 (`status`). `db.SetUserStatus`. `AccountStatusMiddleware` checks status + epoch on every authorized request. 403 `account_suspended`/`account_banned`. |
| P1-SEC-2 | Revoke all sessions (session_epoch) | ✅ done | Migration 20 (`session_epoch`). `db.IncrementSessionEpoch` + `DeleteUserSessionsExcept`. JWT claim `epoch`; middleware rejects tokens with epoch < DB. Admin: `POST /api/admin/users/{id}/revoke-sessions`. |
| P1-SEC-3 | Remote Wipe (WS frame + local storage clear) | ✅ done | `POST /api/admin/users/{id}/remote-wipe` → epoch++ + `Deliver remote_wipe`. Client: `useMessengerWS` intercepts frame → `localStorage.clear()` + `indexedDB.deleteDatabase` + `logout()`. |
| P1-SEC-4 | Admin UI: Suspend/Ban/Kill Switch/Remote Wipe | ✅ done | `AdminPage.tsx` users tab: status badge, buttons Suspend/Restore/Ban/Kill switch/Remote wipe. `ws.Hub.DisconnectUser` for immediate WS disconnect. |

---

### Phase 2: Privacy & Multi-device

#### 2.1 Disappearing Messages

| Requirement ID | Requirement | Status | Notes |
|---|---|---|---|
| P2-EPH-1a | DB schema: migrations `messages.expires_at` + `conversations.default_ttl` | ✅ done | Migrations 21–22 in `migrate.go`. `schema.go`: `messages.expires_at INTEGER`, `conversations.default_ttl INTEGER`. |
| P2-EPH-1b | DB queries: `SaveMessage` with `expires_at`, `SetConversationTTL`, `DeleteExpiredMessages` | ✅ done | `queries.go`: `Message.ExpiresAt`, `SaveMessage`/`GetMessage*` with column, `SetConversationTTL`, `GetConversationDefaultTTL`, `DeleteExpiredMessages` → `[]ExpiredMessage`. |
| P2-EPH-1c | Server API: `POST /api/chats/{id}/ttl` + `ttlSeconds` in WS `handleMessage` | ✅ done | `chat/handler.go`: `SetChatTTL` [5..604800], broadcast `chat_ttl_updated`, `ExpiresAt` in `MessageDTO`. `ws/hub.go`: `inMsg.TtlSeconds`, `GetConversationDefaultTTL`, `expiresAt` in `SaveMessage` and WS frame. |
| P2-EPH-2a | Worker `hub.StartCleaner()`: 30s ticker, delete expired, broadcast `message_expired` | ✅ done | `ws/hub.go`: goroutine `time.NewTicker(30s)` → `db.DeleteExpiredMessages` → `BroadcastToConversation` with `message_expired` frame. |
| P2-EPH-2b | Worker start in `main.go` + `SetChatTTL` route | ✅ done | `hub.StartCleaner()` in `cmd/server/main.go`. Route already added in P2-EPH-1c. |
| P2-EPH-3a | Client store: handle `message_expired` frame, delete from IndexedDB | ✅ done | `useMessengerWS.ts` intercepts frame before orchestrator: `chatStore.deleteMessage` + `deleteMessageFromDb`. New type `WSMessageExpiredFrame` in `ws-frame-types.ts`. |
| P2-EPH-3b | Message UI: timer icon + countdown to `expires_at` | ✅ done | `Bubble` in `ChatWindow.tsx`: `useEffect` + `setInterval` 1s, ⏱mm:ss in meta, auto-calls `onExpire` → `deleteMessage` + IDB. Filters already-expired messages in render. |
| P2-EPH-3c | Chat menu UI: TTL selector (5m / 1h / 1d / 1w / off) + `POST /api/chats/{id}/ttl` | ✅ done | `setChatTtl` in `browser-api-client.ts`. ⏱ button in `ChatWindow` header, dropdown with Off/5m/1h/1d/1w options. |

#### 2.2 Multi-device QR Pairing

| Requirement ID | Requirement | Status | Notes |
|---|---|---|---|
| P2-MD-1 | Device-linking protocol (docs + endpoints) | ✅ done | Migration 23 (`device_link_tokens`). `POST /api/auth/device-link-request` (auth, TTL 120s) + `POST /api/auth/device-link-activate` (no auth). `GET /api/devices` + `DELETE /api/devices/{deviceId}`. |
| P2-MD-2 | Web client: QR display + activate flow | ✅ done | `LinkDeviceModal.tsx` (qrcode.react SVG, TTL timer, refresh). `LinkDevicePage.tsx` (token input → key gen → `activateDeviceLink` → login → `/chats`). Route `/link-device` in `App.tsx`. |
| P2-MD-3 | Re-keying on device removal | ✅ done | `hub.DisconnectDeviceOnly(userID, deviceID)` in `ws/hub.go`. After `DeleteDevice` → `DisconnectDeviceOnly` + `Deliver(device_removed)`. Client: `useMessengerWS.ts` intercepts `device_removed` → if `deviceId` matches `currentDeviceId` → clear storage + logout. |
| P2-MD-4 | Device management UI in Settings | ✅ done | `DevicesSection` in `Profile.tsx`: device list (`GET /api/devices`), current marked ★, "Unlink" button (`DELETE /api/devices/{id}`), "+ Add device" → `LinkDeviceModal`. `deviceId` in `authStore` (persist). |

#### 2.3 Local Client Encryption

| Requirement ID | Requirement | Status | Notes |
|---|---|---|---|
| P2-LOC-1 | PWA passphrase/WebAuthn PRF + wrap idb-keyval | ✅ done | `cryptoVault.ts`: PBKDF2 (600k iter, SHA-256) → AES-256-GCM, salt in localStorage, 12B prepended nonce. `encryptedStore.ts`: encrypt/decrypt wrapper over idb-keyval. `PassphraseGate.tsx`: create/unlock vault screen. `VaultPasswordSection` in `Profile.tsx`. `vaultMigration.ts`: migration of unencrypted IDB data. **WebAuthn PRF not implemented** (deferred). |
| P2-LOC-2 | Native SQLCipher (Android/iOS/Desktop) + OS-keystore | ⏭️ skipped | Native apps not in production scope for current release. High risk (3 platforms × native code, SQLCipher license). Revisit when native clients reach production. |
| P2-LOC-3 | Encrypted media blobs + zeroing out | ✅ done | Auto-revoke blob URL after 60s. `AuthImage`/`AuthFileLink` revoke on unmount. `combined.fill(0)` + `key.fill(0)` after decryption. `messageDb.ts` switched to `encryptedSet`/`encryptedGet` (AES-256-GCM via vault key). |

#### 2.4 Native Privacy Tools

| Requirement ID | Requirement | Status | Notes |
|---|---|---|---|
| P2-NAT-1 | Biometric/PIN lock on launch | ✅ done | `BiometricLockStore` on all 3 platforms: `AppLockSettings` (enabled, relockTimeout, pinHashSha256), SHA-256 PIN. Android: `BiometricHelper.kt` (BiometricPrompt + DEVICE_CREDENTIAL). iOS: `BiometricGateView.swift` (LAContext + PIN fallback). Desktop: `BiometricGateScreen.kt` (PIN-only; macOS Touch ID deferred — JNA). |
| P2-NAT-2 | Screenshot prevention (`FLAG_SECURE`/iOS dimming) | ✅ done | Contract: `docs/privacy-screen-contract.md`. Android: `PrivacyScreenStore.kt` + `FLAG_SECURE` in `MainActivity`. iOS: `BlurOverlayView` in `RootView`, `scenePhase` + `UIScreen.capturedDidChangeNotification`. Desktop: overlay via `LocalWindowInfo.isWindowFocused`. Limitations: `docs/privacy-screen-desktop-limitations.md`. |

---

### Phase 3: Scaling & Extensions

#### 3.1 Group Calls

| Requirement ID | Requirement | Status | Notes |
|---|---|---|---|
| P3-CALL-1 | SFU (pion) + extended signaling | ✅ done | `server/internal/sfu/manager.go`: pion/webrtc v3.3.6, `CreateRoom`, `Join` (offer/answer + track forwarding), `Leave`. 4 WS frame types. 5 REST endpoints. 14 unit tests + 6 HTTP integration tests — all PASS, race-clean. |
| P3-CALL-2 | Grid UI + mute/pin | ✅ done | `GroupCallView.tsx`: responsive CSS Grid (1/2/4/N layout), `ParticipantTile` with video/avatar, pinned span-2. VAD via AudioContext+AnalyserNode RMS. muted 🔇 / camera-off 📷 overlays. networkQuality dot. |

#### 3.2 Admin Capabilities

| Requirement ID | Requirement | Status | Notes |
|---|---|---|---|
| P3-ADM-1 | Disk quotas | ✅ done | Migration 24: `user_quotas`. Quota check before upload → 413 `quota_exceeded`. Admin `GET/PUT /api/admin/users/{id}/quota`. Inline editor in `AdminPage.tsx` (MB → bytes, ∞ display). |
| P3-ADM-2 | Media retention | ✅ done | Migration 25: `settings`. `media/cleaner.go`: `StartRetentionCleaner` — 1h ticker, reads `media_retention_days`, deletes old `media_objects` + files from disk. Admin `GET/PUT /api/admin/settings/retention`. |
| P3-ADM-3 | CPU/RAM/disk monitoring (gopsutil + recharts) | ✅ done | `monitoring/handler.go`: `GetStats` (REST), `StreamStats` (SSE, 5s ticker). Admin panel: recharts LineChart (CPU/RAM history, 20 points) + ProgressBar. SSE auth via `?token=` query param fallback. |
| P3-ADM-4 | "Moderator" role | ✅ done | Migration 26. Schema CHECK: `('user','moderator','admin')`. `RequireAdminOrModerator` middleware. `DeleteMessage` skips authorship check for admin/moderator. `PUT /api/admin/users/{id}/role`. Role badge in `AdminPage.tsx`. |
| P3-ADM-5 | Group member limit | ✅ done | Migration 27: `max_members` in `conversations`. Env `MAX_GROUP_MEMBERS` (default 50). 422 `group_member_limit_reached` on `AddMember`. Admin `GET/PUT /api/admin/settings/max-group-members`. Counter `N / M members` in `ChatWindow` header. |
| P3-ADM-6 | `ALLOW_USERS_CREATE_GROUPS` flag | ✅ done | `config.go`: `AllowUsersCreateGroups bool` (env `ALLOW_USERS_CREATE_GROUPS`, default true). 403 `groups_creation_disabled` when disabled and non-admin creates group. `GET /api/server/info` exposes flag. Group tab hidden in UI when disabled. |

#### 3.3 Local Bot API

| Requirement ID | Requirement | Status | Notes |
|---|---|---|---|
| P3-BOT-1 | Model + API (bots/tokens/webhooks) | ✅ done | Migration 28: `bots` table. `internal/bots/handler.go`: `POST/GET/DELETE /api/bots`, `POST /api/bots/{id}/token`. Token: crypto/rand 32B hex, stored as SHA-256 hash. Webhook retry 3× backoff 1/2/4s, timeout 5s. |
| P3-BOT-2 | Security hardening (rotate, rate-limit, local webhook block) | ✅ done | `POST /api/bots/{botId}/token/rotate`. `botLimiter = NewRateLimiter(60, 1min)`. `isLocalURL` blocks localhost/127.x/10.x/192.168.x. `DeliverWebhook`: HMAC-SHA256 header `X-Messenger-Signature: sha256=<hex>`. |

#### 3.4 Client Auto-update

| Requirement ID | Requirement | Status | Notes |
|---|---|---|---|
| P3-UPD-1 | Version manifest (shared with P1-DIST-2) | ✅ done | `config.go`: `AppVersion`/`MinClientVersion`/`AppChangelog`. `GET /api/version` (public, no auth) → `{version, minClientVersion, buildDate}`. `client/src/config/version.ts`: `compareSemver`, `checkForUpdate()` → `{hasUpdate, latestVersion, isForced}`. |
| P3-UPD-2 | Desktop/Android/iOS updaters | ✅ done | Desktop: `UpdateCheckerStore.kt`, 24h polling, AlertDialog. Android: polling + DownloadManager + FileProvider Intent for APK install. iOS: `UpdateCheckerService.swift` + `UpdateBannerView.swift` (banner/fullscreen, itms-apps:// deep-link). See `docs/ios-update-policy.md`. |

#### 3.5 UX Gaps

| Requirement ID | Requirement | Status | Notes |
|---|---|---|---|
| P3-UX-1 | Built-in media gallery | ✅ done | `GET /api/chats/{chatId}/media?page=&limit=`. `GalleryModal.tsx`: 3-col grid, infinite scroll (IntersectionObserver), tabs All/Images/Files. Lightbox: fullscreen, prev/next + keyboard, download, ESC/backdrop. |
| P3-UX-2 | Voice notes UI (record, waveform) | ✅ done | `VoiceRecorder.tsx`: getUserMedia, MediaRecorder (audio/webm+opus), AnalyserNode level bar, mm:ss timer. `VoiceMessage.tsx`: play/pause, progress bar, fake waveform 40 bars, cur/total time. `content_type` form field in media upload. |
| P3-UX-3 | Upload size limit (`MAX_UPLOAD_BYTES`) | ✅ done | `config.go`: `MaxUploadBytes` (default 100MB, env `MAX_UPLOAD_BYTES`). 413 JSON `{error:"file_too_large", maxBytes:N}`. `GET /api/server/info` exposes `maxUploadBytes`. Client validates in `handleFileChange` and `handleVoiceSend`. |
| P3-UX-4 | `crypto-rationale.md` doc + AES-GCM wrapper | ✅ done | `docs/crypto-rationale.md`: threat model, X3DH+DR+SenderKeys, PBKDF2 vault, Argon2id, TLS 1.3, VAPID. `shared/native-core/crypto/aesGcm.ts`: `encryptAesGcm`/`decryptAesGcm`, nonce 12B prepended. `shared/crypto-contracts/aes-gcm-spec.md`. |

---

### Phase 4: Validation & Release

| Requirement ID | Requirement | Status | Notes |
|---|---|---|---|
| V-1 | Test plan (unit + Playwright E2E) | ✅ done | `docs/test-plan.md`. `client/e2e/smoke.spec.ts` (Playwright 1.59): auth flow + /setup. `server/internal/integration/`: auth_flow (5), invite_flow (3), chat_flow (3) — 11 tests, all PASS. Coverage v8 threshold 60% (client), 50% (server CI). |
| V-2 | Security review + govulncheck/npm audit/trivy | ✅ done | `docs/security-audit.md`. Fixed: jwt→v5.2.2, x/crypto→v0.35.0, vite→8+vitest→4, CORS wildcard+creds, JWT in URL. Remaining: GO-2026-4479 pion/dtls (no upstream patch). |
| V-3 | Documentation update (README, docs, PRD-vs-impl) | 🔄 in_progress | Subtasks: `3a` README.md, `3b` docs/deployment.md, `3c` docs/api-reference.md, **`3d` docs/prd-vs-impl.md** (this file). |
| V-4 | DB migration script (`server/db/migrate.go`) | ⏳ pending | `4a` verify all 28 migrations idempotent. `4b` `scripts/db-migrate.sh` with `--dry-run`/`--version`/`--rollback`. `4c` migration tests on in-memory SQLite. |
| V-5 | Release 1.0-PNM (build + publish binaries) | ⏳ pending | `5a` CHANGELOG.md, version bump in package.json/build.gradle.kts/BuildConfig.swift. `5b` GitHub Release tag `v1.0.0`, draft + artifacts. `5c` production Dockerfile (multi-stage, non-root, health check). `5d` release checklist doc. |

---

## Delta (Not Yet Implemented)

| ID | Description |
|---|---|
| P2-LOC-1 (partial) | WebAuthn PRF for vault unlock — passphrase-only implemented; PRF deferred |
| P2-NAT-1 (partial) | macOS Touch ID on Desktop — PIN-only; JNA integration deferred |
| V-3 | README.md quick-start update (`3a`), `docs/deployment.md` production checklist (`3b`), `docs/api-reference.md` full REST reference (`3c`) |
| V-4 | DB migration verification script + rollback support + migration tests |
| V-5 | v1.0.0 release: CHANGELOG, version bumps, GitHub Release draft, production Dockerfile, release checklist |

---

## Known Limitations

| Item | Description |
|---|---|
| GO-2026-4479 | pion/dtls vulnerability — no upstream patch available; tracked in `docs/security-audit.md` |
| P2-LOC-2 | Native SQLCipher (Android/iOS/Desktop) — skipped; not in production scope for current release |
| WebAuthn PRF | Not implemented in `P2-LOC-1`; vault uses PBKDF2 passphrase only |
| WS rate limiting | Rate limiting covers REST auth endpoints but not WebSocket connection establishment |
| `temp_password` | Stored as plaintext in request flow (noted in security audit) |
| macOS Touch ID (Desktop) | Not implemented in `P2-NAT-1`; requires JNA or native bridge |
| iOS IPA (CI) | Compile-check only in CI — full IPA build requires Xcode project with provisioning profile |

---

## Summary Metrics

| Metric | Count | Percentage |
|---|---|---|
| Total tasks | 50 | 100% |
| Done ✅ | 47 | 94% |
| Skipped ⏭️ | 1 | 2% (P2-LOC-2, justified) |
| In Progress 🔄 | 1 | 2% (V-3) |
| Pending ⏳ | 2 | 4% (V-4, V-5) |
| Blocked 🚫 | 0 | 0% |
