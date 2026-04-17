# Прогресс PRD alignment

Источник задач: `docs/prd-alignment-plan.md`.
Обновлять строку статуса при старте/завершении задачи; дату ставить в формате `YYYY-MM-DD`.

Статусы: `pending` · `in_progress` · `blocked` · `done` · `skipped`.

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
| P2-EPH-1a | DB-схема: миграции `messages.expires_at` + `conversations.default_ttl` | pending | — | Миграции 21-22 в `migrate.go`; обновить `schema.go`. |
| P2-EPH-1b | DB-запросы: `SaveMessage` с `expires_at`, `SetConversationTTL`, `DeleteExpiredMessages` | pending | — | `queries.go`: новые поля в `Message`, функции на запись/удаление. Зависит от P2-EPH-1a. |
| P2-EPH-1c | Server API: `POST /api/chats/{id}/ttl` + `ttlSeconds` в WS `handleMessage` | pending | — | `chat/handler.go`: `SetChatTTL`; `ws/hub.go`: поле `TtlSeconds` в `inMsg`, вычисление `expires_at`. Зависит от P2-EPH-1b. |
| P2-EPH-2a | Воркер `hub.StartCleaner()`: тикер 30с, удаление просроченных, рассылка `message_expired` | pending | — | Горутина внутри `ws/hub.go`; использует `db.DeleteExpiredMessages`. Зависит от P2-EPH-1b. |
| P2-EPH-2b | Запуск воркера в `main.go` + маршрут `SetChatTTL` | pending | — | `cmd/server/main.go`: `hub.StartCleaner()`, новый route. Зависит от P2-EPH-1c и P2-EPH-2a. |
| P2-EPH-3a | Клиент-стор: обработка `message_expired` фрейма, удаление из IndexedDB | pending | — | `useMessengerWS.ts` или оркестратор; `chatStore.deleteMessage`; `appendMessages` clean-up. Зависит от P2-EPH-2a. |
| P2-EPH-3b | UI сообщения: иконка таймера + countdown до `expires_at` | pending | — | Компонент сообщения: поле `expiresAt` из стора, `setInterval` 1с, авто-скрытие по истечении. Зависит от P2-EPH-3a. |
| P2-EPH-3c | UI чат-меню: выбор TTL (5м / 1ч / 1д / 1нед / выкл) + POST /api/chats/{id}/ttl | pending | — | Компонент меню чата; сохранение дефолтного TTL в стор. Зависит от P2-EPH-1c. |

### 2.2 Multi-device QR pairing

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P2-MD-1 | Протокол device-linking (доки + endpoints) | pending | — | — |
| P2-MD-2 | Клиенты: desktop QR, mobile scanner, E2E-передача Ratchet | pending | — | — |
| P2-MD-3 | Re-keying при удалении устройства | pending | — | — |
| P2-MD-4 | UI управления устройствами в Settings | pending | — | — |

### 2.3 Локальное шифрование клиента

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P2-LOC-1 | PWA passphrase/WebAuthn PRF + wrap idb-keyval | pending | — | — |
| P2-LOC-2 | Native SQLCipher (Android/iOS/Desktop) + OS-keystore | pending | — | — |
| P2-LOC-3 | Encrypted media blobs + zeroing out | pending | — | — |

### 2.4 Privacy Tools нативных

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P2-NAT-1 | Биометрия/PIN на запуск | pending | — | — |
| P2-NAT-2 | Запрет скриншотов (FLAG_SECURE/iOS dimming) | pending | — | — |

## Фаза 3 (P3). Масштабирование и расширения

### 3.1 Групповые звонки

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P3-CALL-1 | SFU (pion) + расширенный сигналинг | pending | — | — |
| P3-CALL-2 | Grid UI + мьют/pin | pending | — | — |

### 3.2 Админ-возможности

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P3-ADM-1 | Дисковые квоты | pending | — | — |
| P3-ADM-2 | Retention для медиа | pending | — | — |
| P3-ADM-3 | Мониторинг CPU/RAM/диск (gopsutil + recharts) | pending | — | — |
| P3-ADM-4 | Роль «модератор» | pending | — | — |
| P3-ADM-5 | Лимит участников группы | pending | — | — |
| P3-ADM-6 | Флаг `ALLOW_USERS_CREATE_GROUPS` | pending | — | — |

### 3.3 Local Bot API

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P3-BOT-1 | Модель + API (bots/tokens/webhooks) | pending | — | — |
| P3-BOT-2 | Security hardening (rotate, rate-limit, локальные webhook) | pending | — | — |

### 3.4 Auto-update клиентов

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P3-UPD-1 | Манифест версий (shared с P1-DIST-2) | pending | — | — |
| P3-UPD-2 | Апдейтеры Desktop/Android/iOS | pending | — | — |

### 3.5 UX-пробелы

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| P3-UX-1 | Встроенная медиа-галерея | pending | — | — |
| P3-UX-2 | Voice-notes UI (запись, waveform) | pending | — | — |
| P3-UX-3 | Лимит размера загрузки (`MAX_UPLOAD_BYTES`) | pending | — | — |
| P3-UX-4 | Документ `crypto-rationale.md` + AES-GCM обёртка | pending | — | — |

## Фаза 4. Валидация и выпуск

| ID | Задача | Статус | Дата | Примечание |
|---|---|---|---|---|
| V-1 | Тест-план (unit + Playwright E2E) | pending | — | — |
| V-2 | Security review + govulncheck/npm audit/trivy | pending | — | — |
| V-3 | Обновление документации (README, docs, PRD-vs-impl) | pending | — | — |
| V-4 | Скрипт миграций БД (`server/db/migrate.go`) | pending | — | — |
| V-5 | Релиз 1.0-PNM (сборка и публикация бинарей) | pending | — | — |

---

## Правила ведения

1. При старте задачи: `pending → in_progress` + проставить дату.
2. При блокере: `in_progress → blocked` + причина в «Примечании».
3. При завершении: `in_progress → done` + дата + ссылки на PR/коммиты в «Примечании».
4. Если задача отменяется: `skipped` + причина.
5. Изменения в прогрессе и самом плане идут одним PR с изменением кода; разрыв не допускается.
