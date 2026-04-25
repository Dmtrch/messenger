# Архитектура мессенджера

> Актуально на коммит `60d7c93` (2026-04-21). Источник истины — код репозитория и `docs/docs-main-update-research.md`. При расхождениях приоритет у кода.

---

## 1. Обзор системы

Self-hosted E2E-мессенджер, развёрнутый из одного Go-бинарника. Аудитория — семья/малая команда на собственном сервере или домашнем ПК. Клиенты:

- **Web PWA** (`client/`) — основной канал, встраивается в бинарник через `go:embed`.
- **Native Desktop** (`apps/desktop/`) — Kotlin Compose Multiplatform, упакован в `.dmg/.deb/.msi`.
- **Android** (`apps/mobile/android/`) — Kotlin + Jetpack Compose + SQLDelight.
- **iOS** (`apps/mobile/ios/`) — SwiftUI + Swift Package Manager (SPM собирает `MessengerCrypto`; полный IPA — внешнее Xcode-задание).

Все клиенты работают с одним backend по REST + WebSocket. Единый E2E-контракт задан в `shared/protocol/`, `shared/crypto-contracts/` и `shared/domain/`. Текущий рабочий рантайм — `shared/native-core/` (TypeScript); Web использует его напрямую, native-приложения реализуют те же контракты в своих ЯП.

Сервер только маршрутизирует зашифрованный трафик, хранит публичные ключи/метаданные и обслуживает signalling звонков. Приватные ключи и plaintext-контент никогда не покидают устройства.

---

## 2. Стек технологий

### 2.1 Backend (`server/`)

| Компонент | Технология |
|---|---|
| Runtime | Go 1.23, `CGO_ENABLED=0`, статический бинарник |
| HTTP-router | `github.com/go-chi/chi/v5` |
| WebSocket | `github.com/gorilla/websocket` |
| WebRTC (SFU) | `github.com/pion/webrtc/v3` |
| БД | SQLite (`modernc.org/sqlite`), WAL, FK ON, `max_open_conns=1` |
| Сессии/JWT | собственная реализация в `internal/auth` (bcrypt cost 12, lazy rehash) |
| Push (web) | Web Push VAPID |
| Push (native) | FCM legacy HTTP + APNs JWT (`APNs p8`) |
| Мониторинг | `shirou/gopsutil` (CPU/RAM/Disk) |
| Ограничение скорости | token bucket per-IP (`internal/middleware`) |
| Logger | stdlib `log/slog` + lumberjack ротация |
| Embed статики | `//go:embed server/cmd/server/static` |

### 2.2 Web PWA (`client/`)

| Компонент | Технология |
|---|---|
| Framework | React 18 + TypeScript 5.5 |
| Bundler | Vite 8 (`vite@^8.0.9` в `package.json`) |
| State | Zustand 4 |
| Router | React Router v6 |
| Crypto | `libsodium-wrappers` (+ `-sumo` для тестов) |
| Локальное хранилище | IndexedDB через `idb-keyval` |
| Vault | AES-GCM поверх IndexedDB, passphrase-gate |
| PWA | `vite-plugin-pwa` (generateSW, autoUpdate, custom `push-sw.js`) |
| Тесты | Vitest + coverage v8 (threshold 60%), Playwright (`test:e2e`) |
| Lint | ESLint, `--max-warnings 0` |
| Прочее | `qrcode.react`, `recharts`, `date-fns`, `clsx` |

### 2.3 Shared (`shared/`)

- `shared/native-core/` — TypeScript runtime: `auth`, `api`, `websocket`, `messages`, `crypto`, `storage`, `calls`, `sync`. В каждой подпапке есть web-адаптеры (`*/web/`).
- `shared/protocol/` — JSON-схемы REST-контрактов и WebSocket envelope.
- `shared/crypto-contracts/` — спецификация X3DH/Double Ratchet/Sender Keys и AES-GCM vault.
- `shared/domain/` — language-neutral модели, события, repositories, auth-session, websocket-lifecycle, sync-engine.
- `shared/test-vectors/` — cross-platform crypto-векторы (используются в Go, TS, Kotlin, Swift).

### 2.4 Native (`apps/`)

| Приложение | Язык/UI | Crypto | HTTP/WS | Хранилище |
|---|---|---|---|---|
| Desktop (`apps/desktop`) | Kotlin + Compose Multiplatform | lazysodium | Ktor | локальная FS |
| Android (`apps/mobile/android`) | Kotlin + Jetpack Compose | lazysodium-android | Ktor (okhttp, websockets, content-negotiation, auth) | SQLDelight |
| iOS (`apps/mobile/ios`) | SwiftUI + SPM | swift-sodium 0.9.1 | URLSession | GRDB.swift 6.27.0 |

Build/CI — `.github/workflows/build-native.yml`: `packageDmg/packageDeb/packageMsi`, `assembleRelease|assembleDebug`, `swift build --product MessengerCrypto`. Подробности см. `technical-documentation.md` §Native apps.

---

## 3. Логические слои и их границы

Границы описаны по направлению зависимостей (сверху вниз).

```
┌────────────────────────────────────────────────────────────────┐
│ UI-слой                                                        │
│   web: client/src/{pages, components}                          │
│   native: apps/{desktop,mobile/*}/…/ui                         │
└──────────────▲─────────────────────────────────────────────────┘
               │ state, intents
┌──────────────┴─────────────────────────────────────────────────┐
│ App/runtime-слой (shared/native-core)                          │
│   auth · api · websocket · messages · calls · sync · storage   │
│   web-адаптеры живут рядом: crypto/web, websocket/web, ...     │
└──────────────▲─────────────────────────────────────────────────┘
               │ контракты
┌──────────────┴─────────────────────────────────────────────────┐
│ Домен/протокол (shared/domain, shared/protocol,                │
│                 shared/crypto-contracts)                       │
│   models · events · repositories · aes-gcm-spec · ...          │
└──────────────▲─────────────────────────────────────────────────┘
               │ JSON/WS/HTTP по одному контракту
┌──────────────┴─────────────────────────────────────────────────┐
│ Backend (server/)                                              │
│   cmd/server → internal/{auth,admin,chat,keys,media,push,      │
│    calls,sfu,ws,bots,downloads,monitoring,...}                 │
│   db/ (schema, queries, migrations) + media_dir + downloads_dir│
└────────────────────────────────────────────────────────────────┘
```

Ключевые инварианты границ:
- Сервер **не** знает о внутренних схемах шифрования: хранит `ciphertext BLOB`, `sender_key_id`, метаданные маршрутизации.
- Web-клиент **не** имеет собственной реализации crypto/ws/calls — он вызывает `shared/native-core`.
- Native-приложения реализуют контракты `shared/protocol` и `shared/crypto-contracts` в своих ЯП, **не** импортируя TS-рантайм, но сверяются с ним через `shared/test-vectors/`.

---

## 4. Компонентная диаграмма

```
              ┌─────────────────────────────────────────────┐
              │                  Клиенты                    │
              │                                             │
   PWA (Vite) │  Desktop Compose │ Android Compose │ iOS SwiftUI
       │            │                  │                │
       ▼            ▼                  ▼                ▼
 ┌──────────────────────────────────────────────────────────┐
 │          shared/protocol, shared/crypto-contracts        │
 │             (REST, WS, X3DH, Double Ratchet, AES-GCM)    │
 └──────────────────────────────────────────────────────────┘
       │                     │                       │
       │ HTTPS / WSS         │ Web Push              │ FCM / APNs
       ▼                     ▼                       ▼
 ┌──────────────────────────────────────────────────────────┐
 │                    Go-бинарник (server/)                 │
 │                                                          │
 │  cmd/server ── Chi router ── /api/* ── internal/{auth,   │
 │  admin, serverinfo, users, chat, keys, media, downloads, │
 │  push, calls, bots, monitoring, clienterrors, devices}   │
 │                       │                                  │
 │                  ws.Hub ── /ws (gorilla) ── sfu.Manager  │
 │                       │                         │        │
 │                       ▼                         ▼        │
 │                   SQLite (WAL)            pion/webrtc    │
 │                       │                                  │
 │                       ▼                                  │
 │                 media_dir / downloads_dir                │
 └──────────────────────────────────────────────────────────┘
```

Все запросы идут через middleware-цепочку `RequestLogger → Recoverer → Timeout(30s) → SecurityHeaders → CORS`. Rate-limiters: `authLimiter` (20 req/min), `botLimiter` (60 req/min).

---

## 5. Потоки данных

### 5.1 Регистрация и login

1. Клиент запрашивает `GET /api/server/info` — получает `registrationMode` (`open`/`invite`/`approval`) и квоты.
2. В зависимости от режима:
   - `open` — `POST /api/auth/register`.
   - `invite` — `POST /api/auth/register` с `invite_code` (одноразовый, транзакционная активация в `invite_codes` + `invite_activations`).
   - `approval` — `POST /api/auth/request-register` → запись в `registration_requests`, админ решает через `/api/admin/registration-requests/:id/{approve,reject}`.
3. При успехе сервер возвращает access-JWT (TTL 15 мин) + refresh-cookie (httpOnly, SameSite=Strict, запись в `sessions`).
4. `AccountStatusMiddleware` блокирует заблокированных/saspended пользователей на каждом запросе; `session_epoch` инвалидирует все JWT при admin `revoke-sessions` / `remote-wipe`.

### 5.2 Отправка/получение сообщения

```
[Клиент A]                       [Сервер]                     [Клиент B]
   │ client_msg_id = uuid()          │                              │
   │ для каждого recipient device:   │                              │
   │   session.encrypt(plaintext)    │                              │
   │─── WS {type:"message", chatId,  │                              │
   │    recipients:[{userId, dev,    │                              │
   │    ciphertext}]} ──────────────▶│                              │
   │                                 │ persist в messages (1 копия  │
   │                                 │ на получателя)               │
   │                                 │ fan-out через ws.Hub         │
   │                                 │                              │
   │                                 │── WS {type:"message", ...} ─▶│
   │                                 │                              │ ratchet.decrypt
   │                                 │                              │ UI render
   │◀── WS {type:"ack",              │                              │
   │    clientMsgId, timestamp} ─────│                              │
```

Offline: если получателя нет онлайн, сообщение остаётся в `messages`; WS-клиент при `connect` дозагружает хвост через `GET /api/chats/:id/messages` (opaque cursor). `outboxDb` в PWA хранит неотправленные сообщения и переигрывает их через `useOfflineSync`.

### 5.3 Групповые сообщения (Sender Keys)

1. Отправитель генерирует (или ротирует) `SenderKey` (chain_key + signing keypair).
2. Раздаёт `SKDM` каждому участнику через личную X3DH/Double Ratchet сессию: `WS {type:"skdm", chatId, recipients:[{userId, ciphertext}]}`.
3. Групповое сообщение шифруется один раз `SenderKey` (AES-CBC + HMAC) и пересылается всем участникам через `ws.Hub`.
4. Ротация при изменении состава группы — см. `docs/prd-alignment-progress.md` (частично реализовано).

### 5.4 Звонки 1:1

Медиапоток — P2P WebRTC; сервер только передаёт сигналы через `ws.Hub`:

```
call_offer    → sdp (инициатор → получатель)
call_answer   → sdp (получатель → инициатор)
ice_candidate → ICE (обе стороны)
call_end | call_reject | call_busy
```

ICE-серверы отдаются через `GET /api/calls/ice-servers` (STUN из env + при наличии TURN — временные креды: HMAC(username=ts, secret), TTL `TURN_CREDENTIAL_TTL`).

Client-side: web использует `RTCPeerConnection`; Android — `AndroidWebRtcController` + `SurfaceViewRenderer`; iOS — `iOSWebRtcController` + `RTCMTLVideoView`; Desktop — stub SDP (ровно как зафиксировано в планах фазы; актуальный статус платформ см. `docs/prd-alignment-progress.md`).

### 5.5 Групповые звонки (SFU)

Модуль `server/internal/sfu`:

- `Manager` — реестр комнат.
- `Room{ID, ChatID, CreatorID, Participants, peers, api}` — одна `webrtc.API` на комнату.
- `participant{localTracks}` — каждый входящий трек пересылается всем остальным участникам (SFU-forwarding, без транскодинга).

REST-поверх `internal/calls`:

- `POST /api/calls/room` — создать комнату.
- `DELETE /api/calls/room/{roomId}` — закрыть.
- `POST /api/calls/room/{roomId}/{join,leave}`, `GET /participants`.

Сигнализация идёт через WS-фреймы `group-call.join/leave/offer/answer/ice`, обработчик — `ws.Hub` вызывает `sfu.Manager`.

### 5.6 Медиафайлы

```
Клиент: encrypt(blob, XSalsa20-Poly1305, fresh key)
 │
 │ POST /api/media/upload (multipart, JWT)  ──▶ server: сохранить в media_dir,
 │                                               строчка в media_objects
 │ ciphertext-id возвращается клиенту
 │
 │ Клиент встраивает media_id + ключ расшифровки в message payload,
 │ шифрует message через X3DH/Ratchet
 │ PATCH /api/media/:id {chat_id} ──▶ server: привязка к чату
 │
 Получатель: GET /api/media/:id (JWT)  ──▶ server: стрим ciphertext
            decrypt на клиенте
```

Retention / cleanup — `internal/media/cleaner.go` (orphan и по чат-retention).

### 5.7 Vault и passphrase gate

Клиентский vault (`shared/native-core/storage/web/encryptedStore.ts` + `crypto/cryptoVault`):

- Ключи и чувствительные состояния хранятся в IndexedDB под AES-GCM поверх master-key, выводимого из passphrase.
- Web-клиент показывает `PassphraseGate` до разблокировки; после паузы/блокировки vault закрывается.
- Миграция старых хранилищ — `storage/web/vaultMigration.ts`.

### 5.8 Привязка устройства (device linking)

1. На существующем устройстве: `POST /api/auth/device-link-request` — сервер генерирует QR-токен, хранит в `device_link_tokens` (TTL 120s).
2. Новое устройство показывает QR / принимает код: `POST /api/auth/device-link-activate` с токеном + свежим bundle ключей через `POST /api/keys/register`.
3. Сервер регистрирует устройство (`devices`), привязывает `identity_keys` под `(user_id, device_id)` и возвращает пару токенов.
4. Админ может отключить любое устройство через `GET/DELETE /api/devices/{deviceId}`.

---

## 6. E2E-модель

### 6.1 X3DH (Extended Triple Diffie-Hellman)

- `IK` — Identity Key (Ed25519, долговременная пара).
- `SPK` — Signed PreKey (X25519, подписан IK).
- `OPK` — One-Time PreKeys (X25519, расход по одному).

Запрос связки: `GET /api/keys/:userId`. При нехватке OPK сервер шлёт WS `prekey_low` → клиент пополняет через `POST /api/keys/prekeys`.

DH: `DH1=DH(IK_A,SPK_B); DH2=DH(EK_A,IK_B); DH3=DH(EK_A,SPK_B); DH4=DH(EK_A,OPK_B)` → `SK = KDF(DH1||DH2||DH3||DH4)`.

Обоснование — `docs/crypto-rationale.md`.

### 6.2 Double Ratchet

- Symmetric chain — новый ключ на каждое сообщение (forward secrecy).
- DH-ratchet — ротация публичных ключей при каждом новом raw-сообщении от другой стороны (break-in recovery).
- Шифр сообщения — XSalsa20-Poly1305 (libsodium `crypto_secretbox`).
- Skipped keys: `MAX_SKIP=100` для out-of-order доставки.

Реализации: `client/src/crypto/ratchet.ts` ↔ `shared/native-core/crypto/web/ratchet-web.ts`; в iOS — `Sources/MessengerCrypto/Ratchet.swift`; Android — в lazysodium-хелперах `apps/mobile/android/…`.

### 6.3 Sender Keys для групп

- Каждый отправитель держит собственный `SenderKey` в группе (chain_key + signing pair).
- Распространение — через `SKDM`, обёрнутый в личный 1:1 Double Ratchet.
- Сообщение в группе шифруется AES-CBC + HMAC под `SenderKey`.

### 6.4 AES-GCM vault

Отдельный слой шифрования **на устройстве** для приватного состояния клиента:

- IK private / ratchet state / sender keys / message cache.
- Master-key выводится из passphrase (см. §5.7).
- Спецификация — `shared/crypto-contracts/aes-gcm-spec.md`.
- Test vectors — `shared/test-vectors/`.

---

## 7. SFU и звонки

Подробности рантайма см. §5.4–5.5. Здесь — архитектурные решения:

- SFU выбран вместо mesh, потому что mesh квадратичен по отправляющим потокам (для N=5 каждый клиент шлёт 4 копии).
- SFU встроен в тот же Go-бинарник — без LiveKit/внешнего сервиса. Это упрощает self-hosted деплой ценой масштабируемости (ориентир — ≤ 10–15 активных участников в комнате).
- TURN опционален: при симметричном NAT его необходимо поднимать отдельно (coturn). Креды подписываются `TURN_SECRET` через HMAC и имеют TTL.
- Известный риск: `pion/dtls@2.2.12` содержит уязвимость GO-2026-4479 (random-nonce AES-GCM). Статус и митигация — в `docs/security-audit.md`.

---

## 8. Bots API и webhooks

Модуль `server/internal/bots/`:

- Bot — сущность с `token_hash`, `webhook_url`, `active`. Управление через admin-эндпоинты.
- Исходящие webhooks (`webhook.go`): POST на зарегистрированный URL, подпись `X-Messenger-Signature = HMAC-SHA256(body, bot_secret)`, timeout 5s, retry 1s/2s/4s.
- **Allowlist**: webhook URL должен быть localhost или RFC-1918 (10/8, 172.16/12, 192.168/16). Это защита от SSRF к внутренним сервисам.
- Бот может слать сообщения в чаты, где он участник (через `bot_token` middleware), и получать входящие через свой webhook.

Rate limit: отдельный `botLimiter` (60 req/min per IP).

---

## 9. Monitoring

Модуль `server/internal/monitoring/`:

- Сбор метрик host через `shirou/gopsutil`: CPU %, RAM used/total, Disk used/total по корню + `MEDIA_DIR`.
- Админские эндпоинты: `GET /api/admin/system/stats` (snapshot) и `GET /api/admin/system/stream` (Server-Sent Events для реального времени).
- UI админ-панели (`client/src/pages/AdminPage.tsx`) рисует графики через `recharts`.

Ошибки клиента отдельно отправляются на `POST /api/client-errors` (модуль `clienterrors`) и пишутся в файловый лог через `logger` + `lumberjack`.

---

## 10. Native security

### 10.1 Biometric lock

Биометрический гейт на native-приложениях блокирует приложение при запуске и при возврате из фона:

- **Android**: `BiometricPrompt` (BiometricPromptManager) — по классу BIOMETRIC_STRONG; fallback на device credential (PIN/pattern). Экран `BiometricGateScreen`.
- **iOS**: `LAContext` с `.deviceOwnerAuthenticationWithBiometrics`, fallback на passcode. View `BiometricGateView`.
- **Desktop**: собственный passphrase-gate (биометрика ОС не используется напрямую).

Vault на всех платформах остаётся зашифрованным до прохождения гейта.

### 10.2 Privacy screen

Скрывает контент в app switcher и при захвате экрана (спецификация — `docs/privacy-screen-contract.md`):

| Сценарий | Android | iOS | Desktop |
|---|---|---|---|
| App switcher / Recent Apps | `FLAG_SECURE` → серая карточка | Blur overlay при `.inactive/.background` | Overlay при потере фокуса окна |
| Screen recording | `FLAG_SECURE` блокирует | `UIScreen.capturedDidChangeNotification` | Не поддерживается (см. `privacy-screen-desktop-limitations.md`) |
| OS screenshot hotkey | `FLAG_SECURE` блокирует | Не блокируется | Не блокируется |

Флаг `privacyScreenEnabled` (Boolean, по умолчанию `false`) хранится платформозависимо (SharedPrefs / UserDefaults / `java.prefs`). Smoke-тесты — `docs/privacy-screen-smoke-tests.md`.

### 10.3 Update checker

- Источник версий — `GET /api/version` (возвращает `current`, `min`, `changelog`) и `GET /api/downloads/manifest`.
- **Android** — встроенный `PackageInstaller` flow (download → установка через системный диалог).
- **Desktop** — ссылка на артефакт в `downloads_dir` + показ changelog.
- **iOS** — прямой sideload невозможен по политике Apple. Сервис `UpdateCheckerService.swift` показывает уведомление и отсылает пользователя в TestFlight/App Store. Политика — `docs/ios-update-policy.md`.

---

## 11. Безопасность платформы

1. **E2E**: сервер не видит plaintext, только ciphertext и метаданные маршрутизации. Приватные ключи не покидают устройство.
2. **Forward secrecy / break-in recovery** — Double Ratchet.
3. **Skipped keys**: `MAX_SKIP=100` (корректная расшифровка out-of-order).
4. **JWT**: access TTL 15 мин, refresh TTL 7 дней в httpOnly cookie, `SameSite=Strict`. `session_epoch` на пользователе + admin `revoke-sessions` / `remote-wipe`.
5. **bcrypt cost = 12**; lazy rehash при успешном логине (см. `auth.lazy_rehash_test.go`).
6. **Rate limiting** — `authLimiter` 20/min, `botLimiter` 60/min per IP.
7. **Security headers**: CSP, HSTS (только при `BEHIND_PROXY=true` или собственном TLS), X-Frame-Options, X-Content-Type-Options, Referrer-Policy.
8. **CORS / WS origin allowlist** — `ALLOWED_ORIGIN`; WS `CheckOrigin` читает тот же список.
9. **Медиа**: ciphertext-only upload; ключ — внутри зашифрованного message payload; `GET /api/media/:id` требует JWT.
10. **Registration modes** — `open` / `invite` / `approval`. Инвайты — одноразовые, транзакционная активация с `expires_at` и `revoked_at`, журнал IP/UA в `invite_activations`.
11. **No user enumeration** — `POST /api/auth/password-reset-request` всегда отвечает 200.
12. **Role-based access**: `role ∈ {user, moderator, admin}` в JWT; `RequireAdmin` возвращает 403 для остальных.
13. **Bots SSRF guard**: webhook URL допустим только на localhost / RFC-1918.
14. **TLS**: либо прямые `TLS_CERT/TLS_KEY`, либо `BEHIND_PROXY=true` + reverse-proxy (Cloudflare Tunnel / Caddy / nginx). Без TLS и без proxy — warning в логе.
15. **Multi-server isolation**: `clearServerUrl()` + `chatStore.reset()` + vault re-lock при смене URL сервера.
16. **Известный vuln**: `pion/dtls@2.2.12` → см. `docs/security-audit.md`.

---

## 12. Связи с другими документами

| Документ | Роль |
|---|---|
| `docs/main/technical-documentation.md` | Справочник по модулям/схеме БД/REST/WS, детализация §3–§5 |
| `docs/prd-alignment-progress.md` | Статус закрытия PRD-разрывов; актуальный статус платформ по фазам |
| `docs/remaining-work-plan.md` | Текущие приоритеты и блокеры |
| `docs/main/usersguid.md` | Пользовательские сценарии |
| `docs/main/deployment.md` | Развёртывание, ENV, proxy, миграции |
| `docs/api-reference.md` | Автогенерируемые REST/WS контракты |
| `docs/crypto-rationale.md` | Обоснование крипто-решений |
| `docs/security-audit.md` | Результаты аудита, vuln-трекинг |
| `docs/prd-alignment-progress.md` | Прогресс по фазам PRD alignment |
| `docs/privacy-screen-contract.md`, `privacy-screen-desktop-limitations.md`, `privacy-screen-smoke-tests.md` | Контракт §10.2 |
| `docs/ios-update-policy.md` | Политика обновлений iOS §10.3 |
| `docs/release-checklist.md`, `docs/release-tag-instructions.md` | Процесс релиза и тэгов |
| `shared/protocol/`, `shared/crypto-contracts/`, `shared/domain/` | Формальные контракты |
| `shared/test-vectors/` | Cross-platform crypto-векторы |

---

*Документ актуален на `60d7c93` (2026-04-21). Основан на `docs/docs-main-update-research.md` — там же указаны известные расхождения и риски (например, `pion/dtls` vuln, iOS IPA вне CI, статус Desktop WebRTC).*
