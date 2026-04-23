# План приведения проекта к PRD

Дата: 2026-04-16
Источник расхождений: `docs/prd-vs-implementation.md`
Цель: закрыть разрывы между кодом и `prd.md` (Private Node Messenger).

Легенда приоритетов:
- **P1** — заявленные ключевые свойства Private Node (блокеры соответствия).
- **P2** — UX-приватность и multi-device.
- **P3** — масштабирование и расширения.

Формат задачи: **ID · Название** → *цель* · *затрагиваемые модули* · *шаги* · *критерии приёмки* · *риски/зависимости*.

---

## Фаза 0. Подготовка

- **F0-1 · Бейзлайн и метрики**
  - Зафиксировать текущие зелёные билды (`go build ./...`, `npm run build`, `npm run test`, `./gradlew build` для desktop/android, `xcodebuild` для ios).
  - Завести CHANGELOG раздел `Unreleased → PRD alignment`.
  - В `docs/` создать `prd-alignment-progress.md` с чек-листом из ID задач ниже.

- **F0-2 · Контрольные тест-векторы**
  - Дополнить `shared/test-vectors/` кейсами для инвайтов (TTL, revoke), Argon2id, SQLCipher.

---

## Фаза 1 (P1). Gatekeeping и криптография сервера

### 1.1 Инвайты: TTL=180с, QR, ревок, журнал
- **P1-INV-1 · Жёсткий TTL**
  - `server/db/queries.go`: `ExpiresAt` обязателен; при `CreateInviteCode` дефолт = `now+180s`.
  - `server/internal/admin/handler.go`: принимать `ttl_seconds` только из whitelist `[60..600]`, по умолчанию 180.
  - `server/internal/auth/handler.go`: отказ при `ExpiresAt == 0 || now > ExpiresAt`.
  - Миграция: пометить существующие коды `expired=true`.
  - Тесты: unit на expiry, e2e на регистрацию просроченным кодом (должен быть 410).
- **P1-INV-2 · QR в админке**
  - Клиент: добавить `qrcode` (или `qrcode.react`) в `client/package.json`; компонент `InviteQrDialog`.
  - Payload QR = `https://<origin>/auth?invite=<code>`.
  - Native: `apps/*`/admin web — тот же URL.
- **P1-INV-3 · Аннулирование**
  - `DELETE /api/admin/invite-codes/{id}` + `revoked_at`, `revoked_by`.
  - UI: кнопка «Аннулировать» в `AdminPage` рядом с таймером.
- **P1-INV-4 · Журнал активаций**
  - Таблица `invite_activations(invite_id, user_id, ip, user_agent, activated_at)`.
  - `auth/handler.go`: при регистрации по инвайту писать строку (учитывать `BEHIND_PROXY` для IP).
  - Endpoint `GET /api/admin/invite-codes/{id}/activations`.
- **P1-INV-5 · Визуальный таймер**
  - В `AdminPage` tab «Приглашения»: обратный отсчёт до `expires_at`, автообновление статуса.

### 1.2 Пароли: Argon2id
- **P1-PWD-1 · Модуль `password`**
  - Создать `server/internal/password/argon2id.go` с параметрами `time=3, memory=64MiB, threads=4, saltLen=16, keyLen=32`.
  - Формат хранения PHC-string: `$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>`.
- **P1-PWD-2 · Миграция с bcrypt**
  - В `users` добавить `password_algo TEXT NOT NULL DEFAULT 'bcrypt'`.
  - При успешном логине со старым bcrypt — пересчитать в Argon2id и обновить запись (lazy upgrade).
  - Новые регистрации и сбросы пароля — только Argon2id.
  - Переключить проверку в `auth/handler.go:Login`, `Register`, админский `reset-password`.
- **P1-PWD-3 · Rate-limit и таймконстантное сравнение**
  - Убедиться, что существующий лимитер применяется и к reset; использовать `subtle.ConstantTimeCompare`.

### 1.3 TLS 1.3 принудительно
- **P1-TLS-1 · Конфиг сервера**
  - В `server/cmd/server/main.go`: `&tls.Config{MinVersion: tls.VersionTLS13, CipherSuites: nil}`.
  - Документировать в README требования к сертификату (ECDSA или RSA≥2048).

### 1.4 Дистрибуция нативных бинарей
- **P1-DIST-1 · Сборочные артефакты**
  - CI: собирать `apps/desktop` (exe/dmg/deb), `apps/mobile/android` (apk), `apps/mobile/ios` (ipa через TestFlight/Ad-hoc), подписывать.
  - Складывать в `server/cmd/server/downloads/<version>/<os>/…` + `manifest.json` (`version`, `sha256`, `url`, `min_supported`).
- **P1-DIST-2 · Защищённая зона скачивания**
  - `GET /api/downloads/manifest` (JWT или временный токен по инвайту).
  - `GET /api/downloads/{os}/{file}` с `X-Accel-Redirect`/стримингом, проверкой прав.
  - Guard: анонимам отдавать 401, кроме пост-регистрационного short-lived токена (TTL=10 мин).
- **P1-DIST-3 · Страница загрузок после регистрации**
  - React-страница `/downloads` с автоопределением OS (`navigator.userAgent`).
  - Редирект из `AuthPage` после успешного `register` → `/downloads` (не в чаты).
  - Старые пользователи: в меню «Скачать клиент».
- **P1-DIST-4 · Auto-config в дистрибутивах**
  - Встраивать `server_url` в бинарь при сборке (Gradle/Xcode build-arg: `MESSENGER_SERVER_URL`).
  - Клиент при первом запуске пропускает `/setup`, сразу показывает логин.

### 1.5 Kill Switch / Suspend / Remote Wipe
- **P1-SEC-1 · Статусы аккаунтов**
  - `users.status ENUM('active','suspended','banned')` + миграция.
  - Middleware: suspended/banned → 403 на всех защищённых ручках, закрытие WS.
- **P1-SEC-2 · Revoke all sessions**
  - `POST /api/admin/users/{id}/revoke-sessions`: инкремент `session_epoch` у пользователя; JWT валиден только если `epoch == user.session_epoch`.
  - Инвалидация refresh-tokens.
- **P1-SEC-3 · Remote Wipe**
  - WS-фрейм `wipe` → клиент очищает IndexedDB/SQLCipher, keystore, рефреш и локальный конфиг.
  - Нативные: `apps/*/ui/AppViewModel`/`App.swift` — обработчик `wipe`.
- **P1-SEC-4 · UI админки**
  - `AdminPage` → tab «Пользователи»: статус-бейдж, кнопки Suspend/Ban/Kill Switch с подтверждением.

---

## Фаза 2 (P2). UX приватности и multi-device

### 2.1 Исчезающие сообщения
- **P2-EPH-1 · Схема и API**
  - `messages.expires_at INTEGER NULL`, `chats.default_ttl INTEGER NULL`.
  - `POST /api/chats/{id}/ttl`, `POST /api/messages` принимает `ttl_seconds` (5..604800).
- **P2-EPH-2 · Фоновый уборщик**
  - Go-воркер каждые 30с: `DELETE FROM messages WHERE expires_at <= now`, уведомление клиентов через WS `message_expired`.
- **P2-EPH-3 · Клиент**
  - UI: индикатор таймера, выбор TTL в меню чата; локально удалять из IndexedDB по таймеру.

### 2.2 Multi-device QR pairing
- **P2-MD-1 · Протокол пэринга**
  - Документ `shared/crypto-contracts/device-linking.md`: QR = `pair_id + desktop_pub + nonce`.
  - Endpoints: `POST /api/devices/link/init` (desktop), `GET /api/devices/link/{pair_id}` (смартфон), `POST /api/devices/link/{pair_id}/deliver` (зашифрованный Ratchet-пакет).
  - Sessions TTL=120с, один-разовые.
- **P2-MD-2 · Клиенты**
  - Desktop: экран «Ожидание авторизации сессии», генерация эфемерных Curve25519, отображение QR.
  - Mobile: в Settings → Devices → «Привязать новое устройство», сканер QR (`apps/mobile/android` CameraX, iOS `AVFoundation`).
  - Перенос Ratchet state через E2E-tunnel (шифр публичным ключом desktop).
- **P2-MD-3 · Re-keying при удалении**
  - `DELETE /api/devices/{id}` → триггер смены ключей и broadcast новым prekey bundle.
- **P2-MD-4 · UI устройств**
  - `Settings → Devices`: список, last_seen, «Удалить».

### 2.3 Локальное шифрование клиента
- **P2-LOC-1 · PWA passphrase**
  - При первом входе: генерация master-key, wrap через PBKDF2(passphrase) или WebAuthn PRF (если доступно).
  - Обёртка `messageDb.ts`: шифровать значения libsodium `secretbox` перед `idb-keyval.set`.
- **P2-LOC-2 · Native SQLCipher**
  - Android: `net.zetetic:android-database-sqlcipher` + ключ из Android Keystore (StrongBox при наличии).
  - iOS: `SQLCipher` pod + ключ в Keychain с `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.
  - Desktop: SQLDelight + SQLCipher JDBC, ключ через OS-keychain (macOS Keychain, Windows DPAPI, Linux libsecret).
- **P2-LOC-3 · Encrypted media blobs**
  - Per-file AES-256-GCM ключ, хранимый в таблице `Messages`; файлы в `app-data/media/<hash>.bin`.
  - Zeroing out: перезапись нулями перед `unlink` (под флагом `secure_delete=true`).

### 2.4 Privacy Tools нативных
- **P2-NAT-1 · Биометрия/PIN на запуск**
  - Android `BiometricPrompt`, iOS `LAContext`, Desktop — passphrase.
- **P2-NAT-2 · Запрет скриншотов**
  - Android: `FLAG_SECURE`; iOS: затемнение при `willResignActive`.

---

## Фаза 3 (P3). Масштабирование и расширения

### 3.1 Групповые звонки
- **P3-CALL-1 · SFU**
  - Выбрать: mediasoup (Node) как sidecar или pion (Go, в процессе сервера) — рекомендуется pion для single-binary.
  - Сигналинг: расширить WS (`call_join`, `call_leave`, `call_participant`, `sdp_offer/answer` per-peer).
- **P3-CALL-2 · Клиенты**
  - `CallOverlay` → grid UI, мьют, pinning, стат-индикаторы.

### 3.2 Админ-возможности
- **P3-ADM-1 · Квоты**
  - `users.disk_quota_bytes`, `messages.size_bytes`, периодический подсчёт.
  - Отказ upload при превышении (413 + message).
- **P3-ADM-2 · Retention**
  - `media_retention_days` per-server; джоб на очистку старых медиа, с учётом закреплённых.
- **P3-ADM-3 · Мониторинг**
  - `/api/admin/metrics` (CPU/RAM/disk через `gopsutil`); графики на AdminPage (recharts).
- **P3-ADM-4 · Роль «модератор»**
  - `users.role ENUM('user','moderator','admin')`; модератор может только выпускать инвайты.
- **P3-ADM-5 · Лимит участников группы**
  - Конфиг `MAX_GROUP_MEMBERS`, проверка в `chat/handler.go:AddMember`.
- **P3-ADM-6 · Ограничение создания групп**
  - Флаг `ALLOW_USERS_CREATE_GROUPS` (default false → только admin/moderator).

### 3.3 Local Bot API
- **P3-BOT-1 · Модель**
  - Таблица `bots(id, owner_id, token_hash, webhook_url, scopes)`.
  - Ручки: `POST /api/bots`, `POST /api/bots/{id}/rotate`, `POST /api/bots/{id}/send`, webhook-пуши от сервера к боту.
- **P3-BOT-2 · Безопасность**
  - Bot-токен = `bot_<id>.<random>`; rate-limit; only server-local webhooks (приватная зона).

### 3.4 Auto-update клиентов
- **P3-UPD-1 · Манифест**
  - Реиспользовать `/api/downloads/manifest` (см. P1-DIST-2).
- **P3-UPD-2 · Клиентский апдейтер**
  - Desktop (Compose): на старте сравнивать версию, предлагать установку `.exe/.dmg/.deb`.
  - Android: скачивать APK через `DownloadManager` + `PackageInstaller`; требовать permission `REQUEST_INSTALL_PACKAGES`.
  - iOS: показывать инструкцию (AppStore не используется) — enterprise/Ad-hoc manifest `.plist`.

### 3.5 UX-пробелы
- **P3-UX-1 · Встроенная галерея**
  - Компонент `MediaGallery` (react-photo-view или свой), триггер из `ChatWindow`.
- **P3-UX-2 · Voice-notes UI**
  - Кнопка hold-to-record, waveform (`wavesurfer.js`), сохранение как `audio/webm;codecs=opus`.
- **P3-UX-3 · Лимит размера файла**
  - Конфиг `MAX_UPLOAD_BYTES` (default 100 MiB), проверка в `media/handler.go` и на клиенте.
- **P3-UX-4 · AES-256-GCM везде, где ожидает PRD**
  - Оставляем XChaCha20-Poly1305 как основной (аудит-безопасный), но документируем в `docs/crypto-rationale.md` и добавляем обёртку для AES-GCM в `shared/native-core/crypto` на будущее (без замены протокола).

---

## Фаза 4. Валидация и выпуск

- **V-1 · Тест-план**
  - Интеграционные тесты: pytest/go-test/Vitest на каждую ручку.
  - E2E (Playwright): регистрация по QR → загрузка клиента → создание чата → исчезающее сообщение → multi-device pairing → remote wipe.
- **V-2 · Security review**
  - Самоаудит против PRD §«Резюме безопасности».
  - Прогон `govulncheck`, `npm audit --omit=dev`, `trivy fs`.
- **V-3 · Документация**
  - Обновить `README.md`, `docs/`, `prd-vs-implementation.md` (перевести строки в ✅).
- **V-4 · Миграции**
  - Скрипт `server/db/migrate.go` с up-only миграциями; smoke на копии БД.
- **V-5 · Релиз 1.0-PNM**
  - Собрать бинари, прошить `server_url`, опубликовать через P1-DIST-2.

---

## Последовательность работ и вехи

| Веха | Состав | Критерий готовности |
|---|---|---|
| M1 (неделя 1–2) | F0, 1.1, 1.2, 1.3 | Инвайты соответствуют PRD, Argon2id в проде, TLS 1.3 форсирован |
| M2 (неделя 3–4) | 1.4, 1.5 | Клиенты скачиваются с сервера, Kill Switch работает |
| M3 (неделя 5–7) | 2.1, 2.2 | Исчезающие сообщения + QR-pairing |
| M4 (неделя 8–9) | 2.3, 2.4 | Локальное шифрование на всех клиентах |
| M5 (неделя 10–12) | 3.1, 3.2 | Группо-звонки и расширенная админка |
| M6 (неделя 13–14) | 3.3, 3.4, 3.5 | Bot API, автообновление, UX-галерея |
| M7 (неделя 15) | Фаза 4 | Валидация, 1.0-PNM релиз |

---

## Открытые вопросы для владельца продукта

1. **AES-256-GCM vs XChaCha20-Poly1305** — оставляем libsodium (надёжнее, меньше side-channel рисков на мобильных без AES-NI) и описываем в `docs/crypto-rationale.md`, или переписываем на AES-GCM ради буквы PRD?
2. **TTL инвайтов** — делать ли настраиваемым (60..600с) или хардкодить 180с?
3. **iOS дистрибуция** — TestFlight/Ad-hoc или Enterprise-сертификат? (напрямую влияет на P1-DIST-1 и P3-UPD-2).
4. **SFU для групповых звонков** — pion встраиваемый или отдельный сервис?
5. **Biometric PRF в PWA** — использовать WebAuthn PRF или ограничиться passphrase?
6. **Журнал активаций** — хранить IP как есть или хешировать (для GDPR-совместимости)?

---

*План составлен по `docs/prd-vs-implementation.md`; каждая задача имеет однозначный маппинг на строку отчёта и раздел `prd.md`. Отклонения фиксировать в `docs/prd-alignment-progress.md`.*
