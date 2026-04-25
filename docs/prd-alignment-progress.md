# Прогресс PRD alignment

Источник задач: `docs/prd-alignment-plan.md`.
Обновлять строку статуса при старте/завершении задачи; дату ставить в формате `YYYY-MM-DD`.

Статусы: `pending` · `in_progress` · `blocked` · `done` · `skipped`.

**Последнее обновление:** 2026-04-25. Закрыты PR-PUSH-1 (FCM Android), PR-PUSH-2 (APNs iOS), PR-TEST-1 (native unit-тесты), PR-REL-1 (release-checklist). Итого 66/68 done (97%).

## Фаза 0. Подготовка

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| F0-1 | Бейзлайн и метрики (зелёные билды, CHANGELOG, progress doc) | done | 2026-04-17 | См. `prd-alignment-baseline.md`. Бейзлайн полностью зелёный после шага 0.5. |
| F0-1.5 | Подготовительный фикс компиляции desktop/android (`NewChatScreen.kt`, `ApiClient.kt`) | done | 2026-04-17 | Desktop assemble ✅, Android assembleDebug ✅. Детали — в baseline doc. |
| F0-2 | Контрольные тест-векторы (invites, Argon2id, SQLCipher) | done | 2026-04-17 | См. `shared/test-vectors/invites.json`, `argon2id.json`, `sqlcipher.json`. Эталонные данные — placeholder до реализации P1-PWD-1 / P1-INV-1 / P2-LOC. |

## Фаза 1 (P1). Gatekeeping и криптография сервера

### 1.1 Инвайты

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P1-INV-1 | Жёсткий TTL=180с для инвайтов | done | 2026-04-17 | TTL 180с по умолчанию, диапазон [60..600], 422 out-of-bounds. Ошибки активации: 410 `invite_expired`, 410 `invite_revoked`, 409 `invite_already_used`. Тесты: `server/internal/admin/invite_test.go`. |
| P1-INV-2 | QR-код в админке | done | 2026-04-17 | `qrcode.react` SVG level M; payload `https://<origin>/auth?invite=<code>`. Показывается по кнопке «Показать QR» для активных инвайтов. |
| P1-INV-3 | Аннулирование инвайта (DELETE /api/admin/invite-codes/{id}) | done | 2026-04-17 | Миграция 17 (`revoked_at`). DELETE `/api/admin/invite-codes/{code}` → 204/404. Кнопка «Аннулировать» в UI. |
| P1-INV-4 | Журнал активаций (IP, UA) | done | 2026-04-17 | Миграция 18 (`invite_activations`). GET `/api/admin/invite-codes/{code}/activations`. IP берётся через `secmw.ClientIP` с учётом `BEHIND_PROXY`. |
| P1-INV-5 | Визуальный таймер обратного отсчёта в админке | done | 2026-04-17 | Live-таймер mm:ss на активных инвайтах, обновляется раз в секунду, переключает статус на `expired` по истечении TTL. |

### 1.2 Пароли Argon2id

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P1-PWD-1 | Модуль `password` с Argon2id (PHC-string) | done | 2026-04-17 | `server/internal/password/password.go`: Argon2id (m=64MiB, t=3, p=4), PHC-строка, NFC-нормализация, bcrypt-legacy. Тесты: `password_test.go`. |
| P1-PWD-2 | Lazy-миграция с bcrypt | done | 2026-04-17 | `Login` после успешного `password.Verify` проверяет `NeedsRehash` и перезаписывает хеш в Argon2id. Тест: `server/internal/auth/lazy_rehash_test.go`. |
| P1-PWD-3 | Rate-limit + constant-time compare | done | 2026-04-17 | `authLimiter = NewRateLimiter(20, 1min, BEHIND_PROXY)` в `cmd/server/main.go` покрывает register/login/refresh/request-register/password-reset-request. Constant-time — `subtle.ConstantTimeCompare` в `password.Verify`. Тесты: `middleware/ratelimit_test.go`, `password_test.go:TestVerify_ConstantTimeCompare`. |

### 1.3 TLS 1.3

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P1-TLS-1 | Принудительный `MinVersion: tls.VersionTLS13` | done | 2026-04-17 | `cmd/server/main.go:tlsConfig()` возвращает `*tls.Config` с `MinVersion: tls.VersionTLS13`; подключается к `http.Server` при `TLS_CERT/TLS_KEY`. Контрактный тест — `cmd/server/tls_test.go`. |

### 1.4 Дистрибуция нативных бинарей

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P1-DIST-1 | CI-сборка артефактов (exe/dmg/deb/apk/ipa) + подпись | done | 2026-04-17 | `.github/workflows/build-native.yml`: 7 jobs — macOS arm64/x86_64 DMG, Linux DEB, Windows MSI, Android APK, iOS crypto check, GitHub Release. Подпись: macOS codesign + Windows signtool (опционально, по секретам). `-PappVersion` в desktop+android Gradle. iOS IPA — compile-check only (Xcode project требуется для полного IPA). |
| P1-DIST-2 | Защищённая зона `/api/downloads/*` с manifest | done | 2026-04-17 | `server/internal/downloads/handler.go`: GET `/api/downloads/manifest` (JSON+SHA256+size), GET `/api/downloads/{filename}` (stream, anti-traversal). Auth required. `DOWNLOADS_DIR` env var (default `./downloads`). |
| P1-DIST-3 | Страница `/downloads` + авто-OS + редирект после регистрации | done | 2026-04-17 | `DownloadsPage.tsx`: manifest fetch + OS-детект + blob-download (Bearer). CSS в `pages.module.css`. Маршрут в `App.tsx`. Редирект `navigate('/downloads')` после успешной регистрации в `AuthPage.tsx`. |
| P1-DIST-4 | Auto-config (встроенный `server_url`) при сборке дистрибутива | done | 2026-04-17 | `SERVER_URL` env var читается Gradle (Android BuildConfig, Desktop generateBuildConfig task); iOS: `BuildConfig.swift` патчится `scripts/set-server-url.sh`; Web: `VITE_SERVER_URL` в `initServerUrl`. |

### 1.5 Kill Switch / Suspend / Remote Wipe

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P1-SEC-1 | Статусы аккаунтов (`active/suspended/banned`) + middleware | done | 2026-04-17 | Миграция 19 (`status`). `db.SetUserStatus`. `AccountStatusMiddleware` — проверка статуса + epoch на каждый запрос в авторизованной группе. 403 `account_suspended`/`account_banned`. |
| P1-SEC-2 | Revoke all sessions (session_epoch) | done | 2026-04-17 | Миграция 20 (`session_epoch`). `db.IncrementSessionEpoch` + `DeleteUserSessionsExcept`. JWT claim `epoch`; middleware отклоняет токены с epoch < DB. Admin: `POST /api/admin/users/{id}/revoke-sessions` (Kill switch). |
| P1-SEC-3 | Remote Wipe (WS-фрейм + очистка локального хранилища) | done | 2026-04-17 | `POST /api/admin/users/{id}/remote-wipe` → epoch++ + `Deliver remote_wipe`. Клиент: `useMessengerWS` перехватывает кадр → `localStorage.clear()` + `indexedDB.deleteDatabase` + `logout()`. |
| P1-SEC-4 | UI админки: Suspend/Ban/Kill Switch/Remote Wipe | done | 2026-04-17 | `AdminPage.tsx` users tab: бейдж статуса, кнопки «Приостановить/Восстановить/Заблокировать/Kill switch/Remote wipe». `ws.Hub.DisconnectUser` для немедленного разрыва WS. |

## Фаза 2 (P2). UX приватности и multi-device

### 2.1 Исчезающие сообщения

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P2-EPH-1a | DB-схема: миграции `messages.expires_at` + `conversations.default_ttl` | done | 2026-04-17 | Миграции 21-22 в `migrate.go`. `schema.go`: `messages.expires_at INTEGER`, `conversations.default_ttl INTEGER`. |
| P2-EPH-1b | DB-запросы: `SaveMessage` с `expires_at`, `SetConversationTTL`, `DeleteExpiredMessages` | done | 2026-04-17 | `queries.go`: `Message.ExpiresAt`, `SaveMessage`/`GetMessage*` с колонкой, `SetConversationTTL`, `GetConversationDefaultTTL`, `DeleteExpiredMessages` → `[]ExpiredMessage`. |
| P2-EPH-1c | Server API: `POST /api/chats/{id}/ttl` + `ttlSeconds` в WS `handleMessage` | done | 2026-04-17 | `chat/handler.go`: `SetChatTTL` [5..604800], broadcast `chat_ttl_updated`, `ExpiresAt` в `MessageDTO`. `ws/hub.go`: `inMsg.TtlSeconds`, `GetConversationDefaultTTL`, `expiresAt` в `SaveMessage` и WS-фрейме. Маршрут в `main.go`. |
| P2-EPH-2a | Воркер `hub.StartCleaner()`: тикер 30с, удаление просроченных, рассылка `message_expired` | done | 2026-04-18 | `ws/hub.go`: горутина `time.NewTicker(30s)` → `db.DeleteExpiredMessages` → `BroadcastToConversation` с фреймом `message_expired`. |
| P2-EPH-2b | Запуск воркера в `main.go` + маршрут `SetChatTTL` | done | 2026-04-18 | `hub.StartCleaner()` в `cmd/server/main.go`. Маршрут `SetChatTTL` уже был добавлен в P2-EPH-1c. |
| P2-EPH-3a | Клиент-стор: обработка `message_expired` фрейма, удаление из IndexedDB | done | 2026-04-18 | `useMessengerWS.ts` перехватывает фрейм до оркестратора: `chatStore.deleteMessage` + `deleteMessageFromDb`. Новый тип `WSMessageExpiredFrame` в `ws-frame-types.ts`. `expiresAt` в `RealtimeMessage` + `WSMessageFrame`. |
| P2-EPH-3b | UI сообщения: иконка таймера + countdown до `expires_at` | done | 2026-04-18 | `Bubble` в `ChatWindow.tsx`: `useEffect` + `setInterval` 1с, ⏱mm:ss в meta, авто-вызов `onExpire` → `deleteMessage` + IDB. Фильтр уже-истёкших в render. |
| P2-EPH-3c | UI чат-меню: выбор TTL (5м / 1ч / 1д / 1нед / выкл) + POST /api/chats/{id}/ttl | done | 2026-04-18 | `setChatTtl` добавлен в `browser-api-client.ts`. Кнопка ⏱ в хедере `ChatWindow`, dropdown с вариантами Выкл/5м/1ч/1д/1нед. |

### 2.2 Multi-device QR pairing

> **Шаг 1 (сервер)** — P2-MD-1 + P2-MD-3. **Шаг 2 (клиент)** — P2-MD-2 + P2-MD-4.

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P2-MD-1 | Протокол device-linking (доки + endpoints) | done | 2026-04-18 | Миграция 23 (`device_link_tokens`). `POST /api/auth/device-link-request` (auth, TTL 120с) + `POST /api/auth/device-link-activate` (no auth) в `auth/handler.go`. `GET /api/devices` + `DELETE /api/devices/{deviceId}` в новом `server/internal/devices/handler.go`. `db.SaveDeviceLinkToken`, `GetDeviceLinkToken`, `MarkDeviceLinkTokenUsed`, `DeleteDevice` в `queries.go`. |
| P2-MD-2 | Web-клиент: QR-отображение + activate flow | done | 2026-04-18 | `LinkDeviceModal.tsx` (qrcode.react SVG, TTL-таймер, refresh). `LinkDevicePage.tsx` (ввод токена → генерация ключей → `activateDeviceLink` → login → `/chats`). Маршрут `/link-device` в `App.tsx`. `requestDeviceLink`/`activateDeviceLink`/`getDevices`/`deleteDevice` в `browser-api-client.ts`. |
| P2-MD-3 | Re-keying при удалении устройства | done | 2026-04-18 | `hub.DisconnectDeviceOnly(userID, deviceID)` в `ws/hub.go`. После `DeleteDevice` → `DisconnectDeviceOnly` + `Deliver(device_removed)`. Клиент: `useMessengerWS.ts` перехватывает `device_removed` → если `deviceId` совпадает с `currentDeviceId` → clear storage + logout. `WSDeviceRemovedFrame` в `ws-frame-types.ts`. `currentDeviceId` в `BrowserWSBindings` и `authStore`. |
| P2-MD-4 | UI управления устройствами в Settings | done | 2026-04-18 | `DevicesSection` в `Profile.tsx`: список устройств (`GET /api/devices`), текущее помечается ★, кнопка «Отвязать» (`DELETE /api/devices/{id}`), кнопка «+ Добавить устройство» → `LinkDeviceModal`. `deviceId` добавлен в `authStore` (persist). |

### 2.3 Локальное шифрование клиента

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P2-LOC-1 | PWA passphrase/WebAuthn PRF + wrap idb-keyval | done | 2026-04-18 | `1a` `cryptoVault.ts`: PBKDF2 (600k iter, SHA-256) → AES-256-GCM-256, salt в localStorage, nonce 12b prepended. `1b` `encryptedStore.ts`: encrypt/decrypt обёртка над idb-keyval UseStore. `1c` `browser-keystore.ts`: все операции через encryptedSet/Get/Del. `1d` `PassphraseGate.tsx`: экран создания/разблокировки vault + CSS. `1e` `App.tsx`: guard — authenticated+locked → PassphraseGate. `1f` `Profile.tsx`: VaultPasswordSection — смена пароля vault + re-encrypt. `1g` `vaultMigration.ts`: миграция незашифрованных IDB-данных при первом unlock. WebAuthn PRF — не реализован (оставлен на будущее). |
| P2-LOC-2 | Native SQLCipher (Android/iOS/Desktop) + OS-keystore | pending | 2026-04-23 | **Переоткрыто**: native-клиенты переведены в production (коммит `51c4762`), отметка «не в production scope» больше не применима. Vault (AES-GCM через passphrase) реализован в коммите `60d7c93` — базовая защита есть. SQLCipher остаётся желательным для полного шифрования локальной БД. Подзадачи: `2a` Desktop — `sqldelight-sqlcipher-driver` + OS-keystore (Keychain/DPAPI/libsecret). `2b` Desktop `KeyStorage.kt` — мастер-ключ через Credential Manager. `2c` Android — `android-database-sqlcipher` + Android Keystore. `2d` iOS — SQLCipher SPM + SecureEnclave/Keychain. |
| P2-LOC-3 | Encrypted media blobs + zeroing out | done | 2026-04-18 | `3a` auto-revoke blob URL через 60с (`setTimeout` + `mediaBlobCache.delete`). `3b` `AuthImage` revoke на unmount + `AuthFileLink` revoke после `a.click()`. `3c` `combined.fill(0)` + `key.fill(0)` после расшифровки в `fetchEncryptedMediaBlobUrl`. `3d` `messageDb.ts` переключён на `encryptedSet`/`encryptedGet` (AES-256-GCM через vault key). TypeScript ✅. |

### 2.4 Privacy Tools нативных

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P2-NAT-1 | Биометрия/PIN на запуск | done | 2026-04-18 | `1a` `BiometricLockStore` на всех 3 платформах: `AppLockSettings` (enabled, relockTimeout, pinHashSha256), SHA-256 PIN, SharedPrefs/UserDefaults/java.prefs. `1b` Android: `BiometricHelper.kt` (BiometricPrompt + DEVICE_CREDENTIAL), `BiometricGateScreen.kt`, guard в `MainActivity`. `1c` iOS: `BiometricGateView.swift` (LAContext + PIN fallback), guard в `RootView`. `1d` Desktop: `BiometricGateScreen.kt` (PIN-only, macOS Touch ID — TODO JNA). `1e` `AppLockSection` в ProfileScreen на всех 3 платформах: toggle enabled, смена PIN. |
| P2-NAT-2 | Запрет скриншотов (FLAG_SECURE/iOS dimming) | done | 2026-04-19 | `2a` `docs/privacy-screen-contract.md` — контракт: флаг `privacyScreenEnabled`, lifecycle hooks, платформенные ограничения. `2b` Android: `PrivacyScreenStore.kt` + `FLAG_SECURE` в `MainActivity` через `lifecycleScope`. `2c` iOS: `PrivacyScreenStore.swift` + `BlurOverlayView` в `RootView`, `scenePhase` + `UIScreen.capturedDidChangeNotification`. `2d` Desktop: `PrivacyScreenStore.kt` + `LocalWindowInfo.isWindowFocused` overlay в `App.kt`; ограничения — `docs/privacy-screen-desktop-limitations.md`. `2e` `PrivacyScreenSection` в ProfileScreen на всех 3 платформах; smoke-тесты — `docs/privacy-screen-smoke-tests.md`. |

## Фаза 3 (P3). Масштабирование и расширения

### 3.1 Групповые звонки

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P3-CALL-1 | SFU (pion) + расширенный сигналинг | done | 2026-04-19 | `1a` `server/internal/sfu/manager.go`: pion/webrtc v3.3.6, `NewManager`, `CreateRoom`, `GetRoom`, `DeleteRoom`, `Join` (offer/answer + track forwarding), `Leave`. `1b` 4 типа в `ws-frame-types.ts` + Go-структуры + `BroadcastRoomCreated/ParticipantJoined/ParticipantLeft/TrackAdded` в `hub.go`. `1c` `server/internal/calls/handler.go`: 5 эндпоинтов (CreateRoom, DeleteRoom, GetParticipants, JoinRoom, LeaveRoom); маршруты в `main.go`. `1d` 14 unit-тестов SFU (`sfu_test.go`) + 6 HTTP-интеграционных (`handler_test.go`); все PASS, race detector чист. |
| P3-CALL-2 | Grid UI + мьют/pin | done | 2026-04-19 | `2a` `GroupCallView.tsx`: CSS Grid responsive (grid1/grid2/grid4/gridN), `ParticipantTile` с video/аватаром, pinned span-2. `2b` `callStore`: `ParticipantState` (stream, isMuted, isCameraOff, isSpeaking, networkQuality), setGroupRoom/clearGroupRoom/upsertParticipant/removeParticipant/setParticipantStream/setParticipantSpeaking/setParticipantMuted/setParticipantCameraOff/setPinnedUser. `2c` `CallOverlay`: ветка `isGroupCall && active` с GroupCallView + mute/cam/hangup; clearGroupRoom при завершении. `2d` VAD через AudioContext+AnalyserNode RMS в ParticipantTile; muted 🔇 / camera-off 📷 overlays; networkQuality dot. TypeScript ✅. |

### 3.2 Админ-возможности

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P3-ADM-1 | Дисковые квоты | done | 2026-04-19 | `1a` Миграция 24: `user_quotas(user_id PK, quota_bytes, used_bytes)`; `db.GetUserQuota`, `UpsertUserQuota`, `AddUsedBytes`. `1b` `media/handler.go`: quota check перед сохранением → 413 `quota_exceeded`; `AddUsedBytes` после успешного upload. `1c` `admin/handler.go`: `GetQuota`/`SetQuota`; `ListUsers` возвращает `userWithQuota` с `quotaBytes`/`usedBytes`; маршруты `GET/PUT /api/admin/users/{id}/quota` в `main.go`. `1d` `AdminPage.tsx`: `AdminUser` расширен полями квоты; inline-редактор (МБ → байты, Enter/✓/✕); отображение `∞` или `N МБ / M МБ`. Go ✅, TS ✅. |
| P3-ADM-2 | Retention для медиа | done | 2026-04-19 | `2a` Миграция 25: `settings(key PK, value)`; `db.GetSetting`, `SetSetting`, `DeleteMediaOlderThan`. `2b` `media/cleaner.go`: `StartRetentionCleaner` — тикер 1ч, читает `media_retention_days`, удаляет `media_objects` старше N дней + файлы с диска; запуск в `main.go`. `2c` `admin/handler.go`: `GetRetentionSettings`/`SetRetentionSettings`; маршруты `GET/PUT /api/admin/settings/retention`. `2d` `AdminPage.tsx`: вкладка «Настройки» с полем «Хранить медиа (дней)» (0 = бессрочно), сохранение через PUT. Go ✅, TS ✅. |
| P3-ADM-3 | Мониторинг CPU/RAM/диск (gopsutil + recharts) | done | 2026-04-19 | `3d` `go.mod`: добавлен `github.com/shirou/gopsutil/v3`. `3a` `monitoring/handler.go`: `GetStats` (REST) — CPU% через `cpu.Percent`, RAM через `mem.VirtualMemory`, Disk через `disk.Usage("/")`. `3b` `StreamStats` (SSE): тикер 5с, `event: stats\ndata:...`, `X-Accel-Buffering: no`. `3c` `AdminPage.tsx`: вкладка «Система», `recharts` LineChart (CPU/RAM история 20 точек) + ProgressBar Диск/RAM. SSE авторизация через `?token=` в URL; `auth.Middleware` расширен fallback на `r.URL.Query().Get("token")`. Go ✅, TS ✅. |
| P3-ADM-4 | Роль «модератор» | done | 2026-04-19 | `4a` Миграция 26 (маркер), `schema.go` CHECK обновлён на `('user','moderator','admin')`, `db.SetUserRole`. `4b` `RequireAdminOrModerator` в `auth/middleware.go`; `DeleteMessage` пропускает проверку авторства для admin/moderator; `BanUser` запрещает модератору банить admin/moderator. `4c` `PUT /api/admin/users/{id}/role` в `admin/handler.go` + маршрут в `main.go`. `4d` `AdminPage.tsx`: бейдж с цветом (синий=Мод, фиолетовый=admin), кнопка ✎ → inline `<select>`. |
| P3-ADM-5 | Лимит участников группы | done | 2026-04-20 | `5a` Миграция 27: `max_members INTEGER` в `conversations`. Env `MAX_GROUP_MEMBERS` (default 50). `db.CountConversationMembers`, `GetConversationMaxMembers`, `SetConversationMaxMembers`, `AddConversationMember`. `5b` `chat/handler.go`: `AddMember` POST `/api/chats/{id}/members` + проверка лимита → 422 `group_member_limit_reached`; лимит также в `CreateChat`. `5c` `admin/handler.go`: `GetMaxGroupMembers`/`SetMaxGroupMembers`, маршруты `GET/PUT /api/admin/settings/max-group-members`, ключ `max_group_members` в таблице `settings`. `5d` `ChatWindow.tsx`: счётчик `N / M участн.` в заголовке группы. `AdminPage.tsx`: поле «Макс. участников в группе» на вкладке Настройки. |
| P3-ADM-6 | Флаг `ALLOW_USERS_CREATE_GROUPS` | done | 2026-04-20 | `6a` `config.go`: поле `AllowUsersCreateGroups bool` (default true), парсинг env `ALLOW_USERS_CREATE_GROUPS`. `6b` `chat/handler.go`: `CreateChat` при `type==group` + флаг false + роль не admin/moderator → 403 `groups_creation_disabled`. `6c` `serverinfo/handler.go`: поле `allowUsersCreateGroups: bool` в ответе `GET /api/server/info`. `6d` `ChatListPage.tsx` + `NewChatModal.tsx`: fetch server/info при монтировании, таб «Группа» скрывается если `allowUsersCreateGroups==false`. |

### 3.3 Local Bot API

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P3-BOT-1 | Модель + API (bots/tokens/webhooks) | done | 2026-04-20 | `1a` Миграция 28: таблица `bots` (id, name, owner_id, token_hash, webhook_url, active, created_at). `db`: `CreateBot`, `GetBotByID`, `GetBotByTokenHash`, `ListBotsByOwner`, `DeleteBot`, `UpdateBotToken`. `1b` `internal/bots/handler.go`: `POST/GET/DELETE /api/bots`, `POST /api/bots/{id}/token`; токен — crypto/rand 32B hex, хранится SHA-256 hash. `1c` `internal/bots/middleware.go`: `Authorization: Bot <token>` → SHA-256 → `GetBotByTokenHash`; WS hub: fallback bot auth, `userID="bot:<id>"`. `1d` `internal/bots/webhook.go`: `DeliverWebhook` retry 3x backoff 1/2/4s timeout 5s; `db.GetActiveBotsByConversation`; вызов в `hub.handleMessage` после ack. |
| P3-BOT-2 | Security hardening (rotate, rate-limit, локальные webhook) | done | 2026-04-20 | `2a` `POST /api/bots/{botId}/token/rotate` → `RegenerateToken` (зарегистрирован ДО `/token` в Chi); `2b` `botLimiter = NewRateLimiter(60, 1min)` на все `/api/bots/*` маршруты; `2c` `isLocalURL` в `webhook.go`: localhost/127.x/10.x/192.168.x → 422 `webhook_url_not_allowed` в CreateBot + defence-in-depth в DeliverWebhook; `2d` `DeliverWebhook(url, payload, secret)`: HMAC-SHA256 заголовок `X-Messenger-Signature: sha256=<hex>`, secret=`TokenHash[:16]`. |

### 3.4 Auto-update клиентов

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P3-UPD-1 | Манифест версий (shared с P1-DIST-2) | done | 2026-04-20 | `1a` `config.go`: поля `AppVersion`/`MinClientVersion`/`AppChangelog` (env APP_VERSION/MIN_CLIENT_VERSION/APP_CHANGELOG); `downloads/handler.go`: поля Version/MinClientVersion/Changelog/BuildDate в Handler и Manifest. `1b` `downloads/handler.go`: `ServeVersion` → `GET /api/version` (публичный, без auth) → `{version, minClientVersion, buildDate}`. `1c` `client/src/config/version.ts`: `APP_VERSION` из VITE_APP_VERSION, `compareSemver`, `checkForUpdate()` → `{hasUpdate, latestVersion, isForced}`; `App.tsx`: useEffect вызывает checkForUpdate при монтировании. |
| P3-UPD-2 | Апдейтеры Desktop/Android/iOS | done | 2026-04-20 | `2a` `apps/desktop/store/UpdateCheckerStore.kt`: polling 24ч через HttpURLConnection, semver-сравнение, `App.kt`: AlertDialog обычного/принудительного обновления. `2b` `apps/mobile/android/store/UpdateCheckerStore.kt`: polling + DownloadManager + FileProvider Intent для установки APK; `AndroidManifest.xml`: REQUEST_INSTALL_PACKAGES + FileProvider; `App.kt`: AlertDialog. `2c` `docs/ios-update-policy.md`: ограничения OTA, сравнение TestFlight/AppStore/MDM; `UpdateCheckerService.swift`: URLSession async polling 24ч; `UpdateBannerView.swift`: баннер/fullscreen overlay, deep-link itms-apps://. |

### 3.5 UX-пробелы

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P3-UX-1 | Встроенная медиа-галерея | done | 2026-04-20 | `1a` `GET /api/chats/{chatId}/media?page=&limit=` в `media/handler.go`, `db.ListChatMedia` с пагинацией. `1b` `GalleryModal.tsx`: сетка 3 колонки, бесконечный скролл (IntersectionObserver), табы Все/Изображения/Файлы. `1c` Lightbox внутри GalleryModal: fullscreen, prev/next + клавиатура, download, ESC/backdrop. `1d` Кнопка 🖼 в header ChatWindow. Go build ✅, TS type-check ✅. |
| P3-UX-2 | Voice-notes UI (запись, waveform) | done | 2026-04-20 | `2a` `VoiceRecorder.tsx`: getUserMedia, MediaRecorder (audio/webm+opus), AnalyserNode level bar, таймер mm:ss, кнопки ✕/✓. `2b` `VoiceMessage.tsx`: скрытый audio, play/pause, прогресс-бар, fake waveform 40 баров (seed=mediaId), cur/total time. `2c` `media/handler.go`: `content_type` form-поле → сохранять audio/* в БД; Upload ответ возвращает contentType. `2d` `ChatWindow.tsx`: кнопка 🎙, `showVoiceRecorder` state, `handleVoiceSend`, `pendingDuration`, parsePayload обновлён для 'audio'. Go build ✅, TS type-check ✅. |
| P3-UX-3 | Лимит размера загрузки (`MAX_UPLOAD_BYTES`) | done | 2026-04-20 | `3a` `config.go`: `MaxUploadBytes` (def 100МБ, env `MAX_UPLOAD_BYTES`); `media/handler.go`: `MaxUploadBytes` в Handler, 413 JSON `{error:"file_too_large", maxBytes:N}`. `3b` `serverinfo/handler.go`: `MaxUploadBytes` поле + `"maxUploadBytes"` в JSON. `3c` `serverInfoStore.ts`: `maxUploadBytes` (def 100МБ); `ChatListPage.tsx`: читает из /api/server/info; `ChatWindow.tsx`: проверка в `handleFileChange` и `handleVoiceSend`, динамический title на кнопке clip. Go build ✅, TS type-check ✅. |
| P3-UX-4 | Документ `crypto-rationale.md` + AES-GCM обёртка | done | 2026-04-20 | `4a` `docs/crypto-rationale.md`: модель угроз, X3DH+DR+SenderKeys, AES-256-GCM медиа, PBKDF2 vault (600k iter, SHA-256, nonce 12B prepended), Argon2id (m=64МБ,t=3,p=4), TLS 1.3, VAPID. `4b` `shared/native-core/crypto/aesGcm.ts`: `encryptAesGcm`/`decryptAesGcm`, globalThis.crypto.subtle, nonce 12B prepended, ре-экспорт в index.ts. `4c` `shared/crypto-contracts/aes-gcm-spec.md` + README.md с перекрёстными ссылками. TS type-check ✅. |

## Фаза 4. Валидация и выпуск

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| V-1 | Тест-план (unit + Playwright E2E) | done | 2026-04-20 | `1a` `docs/test-plan.md`: scope 4 слоя, coverage targets, CI gates, known gaps. `1b` `client/e2e/smoke.spec.ts` (Playwright 1.59): auth flow + /setup; `playwright.config.ts`; `@playwright/test` установлен. `1c` `server/internal/integration/`: `auth_flow_test.go` (5 тестов), `invite_flow_test.go` (3), `chat_flow_test.go` (3) — все 11 PASS. `1d` `vite.config.ts`: coverage v8 (text/lcov/html, порог 60%); `server/Makefile`; CI job `test-server` с порогом 50% в `build-native.yml`. |
| V-2 | Security review + govulncheck/npm audit/trivy | done | 2026-04-20 | `docs/security-audit.md`. Исправлено: jwt→v5.2.2 (GO-2025-3553), x/crypto→v0.35.0 (CVE-2025-22869), vite→8+vitest→4 (10 NPM HIGH), CORS wildcard+creds, JWT в URL (только WS/SSE), input validation верхние границы. Остаток: GO-2026-4479 pion/dtls (нет патча upstream). |
| V-3 | Обновление документации (README, docs, PRD-vs-impl) | done | 2026-04-20 | `3a` `README.md` — badges, 15 фич, ASCII-архитектура, Docker/dev quick start, env vars таблица. `3b` `docs/deployment.md` — 28 env vars, TLS (прямой/Nginx/Caddy/Cloudflare), VAPID, SQLite VACUUM INTO, security checklist 10 пунктов. `3c` `docs/api-reference.md` — 60+ эндпоинтов (auth, chats, media, keys, calls, bots, admin, WS фреймы). `3d` `docs/prd-vs-impl.md` — 47/50 задач выполнено (94%), delta, known limitations. |
| V-4 | Скрипт миграций БД (`server/db/migrate.go`) | done | 2026-04-21 | `4a` `migrate.go`: migration 7 — `CREATE TABLE IF NOT EXISTS identity_keys_new`; добавлена обработка `"already exists"` в список idempotent-ошибок. `4b` `scripts/db-migrate.sh`: `--version`, `--dry-run`, `--rollback N` (с подтверждением), `--db PATH`; требует `sqlite3`. `4c` `server/db/migrate_test.go`: 5 новых тестов (Migration24..28) + `legacySchema` helper; все 10 db-тестов PASS. |
| V-5 | Релиз 1.0-PNM (сборка и публикация бинарей) | done | 2026-04-21 | `5a` CHANGELOG.md → [1.0.0] 2026-04-21 (все фазы PRD); package.json 0.1.0→1.0.0; android appVersion "1.0"→"1.0.0"; iOS BuildConfig добавлен `appVersion`. `5b` CI workflow: job `publish-release` → `draft:true`, `tag_name`, release body с таблицей артефактов; `docs/release-tag-instructions.md`. `5c` Dockerfile: non-root user `messenger`, `/data`+`/data/media` с chown, `VOLUME ["/data"]`, HEALTHCHECK wget, LABEL, убран двойной go mod tidy. docker-compose.yml: healthcheck. `5d` `docs/release-checklist.md`: 7 разделов — pre-release, backup (VACUUM INTO/tar/volume), deploy, rollback, monitoring, key rotation (JWT/VAPID/TLS), post-deploy verification. Go build ✅, TS ✅, YAML ✅. Для публикации: `git tag -a v1.0.0 -m "Release v1.0.0" && git push origin v1.0.0`. |

---

## Фаза 5. Post-release: native-client parity

> Добавлено 2026-04-23 на основе коммитов `60d7c93` (фаза 1 native: биометрика/vault), `53693f6` (декомпозиция P2-EPH в native) и `51c4762` (Admin/Downloads/LinkDevice × 3 + устранение заглушек).

### 5.1 Устранение native-заглушек

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| PR-NAT-1 | Desktop: убрать `stub-sdp` в WebRTC | done | 2026-04-23 | `apps/desktop/.../viewmodel/AppViewModel.kt` — ошибка SDP прокидывается в UI, звонок не стартует с заглушкой. |
| PR-NAT-2 | Android: убрать plain-base64 fallback в `SessionManager` | done | 2026-04-23 | `apps/mobile/android/.../crypto/SessionManager.kt` — при отсутствии сессии отправка запрещена. |
| PR-NAT-3 | Desktop: typing-indicator auto-reset таймер | done | 2026-04-23 | `apps/desktop/.../store/ChatStore.kt` — `typingTimers` + `typingTimeoutMs = 5_000L`. |
| PR-NAT-4 | iOS: ошибки `changePassword` в UI | done | 2026-04-23 | `apps/mobile/ios/.../viewmodel/AppViewModel.swift` + `ui/screens/ProfileScreen.swift` — прокидывание async-ошибок. |
| PR-NAT-5 | iOS: `ApiClient.changePassword` реализован | done | 2026-04-23 | `apps/mobile/ios/.../service/ApiClient.swift`. |
| PR-NAT-6 | iOS: `mediaId`/`mediaKey` прикрепляются к сообщению | done | 2026-04-23 | `AppViewModel.swift` — поля передаются в `sendMessage`. |
| PR-NAT-7 | Desktop: macOS Touch ID через JNA + LAContext | pending | — | `apps/desktop/.../ui/screens/BiometricGateScreen.kt:14`. Опционально, P3. См. `docs/remaining-work-plan.md` #4. |

### 5.2 Native-паритет экранов с PWA

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| PR-SCR-1 | `AdminScreen` × 3 платформы (Users/Requests/Resets/Invites/Settings/System) | done | 2026-04-23 | 6 табов: Desktop/Android — `ScrollableTabRow`; iOS — сегментированный Picker. Coverage: CRUD пользователей, инвайт-коды, retention/max-members, system stats (CPU/RAM/Disk). |
| PR-SCR-2 | `DownloadsScreen` × 3 платформы | done | 2026-04-23 | Manifest из `/api/downloads/manifest`, скачивание: Desktop → `~/Downloads`, Android → `getExternalFilesDir(DIRECTORY_DOWNLOADS)` + `FileProvider` + `ACTION_VIEW` для APK, iOS → `FileManager.documentDirectory` + `UIActivityViewController`. |
| PR-SCR-3 | `LinkDeviceScreen` × 3 платформы | done | 2026-04-23 | Активация устройства по токену, привязка к аккаунту через `POST /api/auth/device-link-activate`. |

### 5.3 Остаточные замечания (детализированы в `docs/remaining-work-plan.md`)

| ID | Задача | Статус | Дата | Приоритет | Примечание |
|---|---|---|---|---|---|
| PR-PUSH-1 | Android: восстановить FCM-сервис (регистрация токена + notifications) | done | 2026-04-25 | P0 | `MessengerFirebaseService`, runtime-permission, prime-токен — реализованы в `a09eecf`. Smoke-тест требует реального Firebase-проекта. |
| PR-PUSH-2 | iOS: реализовать APNs (AppDelegate, регистрация токена, foreground/background presentation) | done | 2026-04-25 | P0 | `AppDelegate` с `@UIApplicationDelegateAdaptor`, deep-link через `pendingChatId` — реализованы в `778dfee`. Xcode-проект и `.p8` ключ — на стороне владельца. |
| PR-DOCS-1 | Финализация `docs/main/*` по чеклисту `docs-main-update-plan.md` | in_progress | 2026-04-23 | P1 | 4 файла переработаны, осталась сверка внутренних ссылок + ENV-переменных против `config.go`. |
| PR-TEST-1 | Minimal test-harness для native (Desktop Kotlin Test / Android JUnit / iOS XCTest) | done | 2026-04-25 | P1 | Desktop: 11 тестов (`./gradlew test`); Android: 5 тестов (`./gradlew testDebugUnitTest`); iOS: 12 DtoDecodingTests (`swift test`). CI jobs в `build-native.yml`. |
| PR-REL-1 | Актуализировать `release-checklist.md` под native-артефакты (DMG/DEB/MSI/APK/IPA) | done | 2026-04-25 | P2 | Добавлены шаги: `npm run test`, `./gradlew test`, `./gradlew testDebugUnitTest`, `swift test`, уточнение GO-2026-4479. |

### 5.4 Сводный статус (2026-04-23)

| Категория | Всего | Done | Pending | Skipped |
|---|---|---|---|---|
| Фаза 0 | 3 | 3 | 0 | 0 |
| Фаза 1 (Gatekeeping) | 16 | 16 | 0 | 0 |
| Фаза 2 (Privacy + Multi-device) | 14 | 13 | 1 (P2-LOC-2 переоткрыт) | 0 |
| Фаза 3 (Scaling) | 15 | 15 | 0 | 0 |
| Фаза 4 (Release) | 5 | 5 | 0 | 0 |
| **Фаза 5 (Post-release parity)** | **15** | **13** | **1** | **0** |
| **Итого** | **68** | **66** | **1** | **0** |

Сравнение с предыдущей версией документа (2026-04-23): было 62/68 done (91%). Сейчас 66/68 done (97%) — закрыты PR-PUSH-1 (FCM), PR-PUSH-2 (APNs), PR-TEST-1 (native tests), PR-REL-1 (release-checklist). Осталось: PR-DOCS-1 (in_progress, финализация docs/main/*) и PR-NAT-7 (Touch ID, опционально P3).

---

## Правила ведения

1. При старте задачи: `pending → in_progress` + проставить дату.
2. При блокере: `in_progress → blocked` + причина в «Примечании».
3. При завершении: `in_progress → done` + дата + ссылки на PR/коммиты в «Примечании».
4. Если задача отменяется: `skipped` + причина.
5. Изменения в прогрессе и самом плане идут одним PR с изменением кода; разрыв не допускается.
