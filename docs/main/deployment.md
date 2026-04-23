# Руководство по развёртыванию Messenger

> Актуально на коммит `60d7c93` (2026-04-21). Фокус — self-hosted деплой сервера и его операционное сопровождение. Пользовательские сценарии — `docs/main/usersguid.md`. Архитектура — `docs/main/architecture.md`.

---

## 1. Предусловия

Минимум:

- Docker Engine и Docker Compose v2 (`docker compose version`).
- Любая 64-битная Linux/macOS/Windows машина (домашний ПК, VPS).
- Выход в интернет для STUN (по умолчанию `stun:stun.l.google.com:19302`).

Для публичного доступа — одно из:

- домен с A/AAAA-записью на хост и возможностью открыть 443 (Option A в §3.2);
- Cloudflare Tunnel и токен — открытых портов не требует (Option B в §3.2);
- reverse proxy (Caddy/nginx/Traefik) перед контейнером с собственным TLS.

Для работы push на iOS 16.4+ PWA требует валидного TLS-сертификата (не самоподписанного).

Hardware: минимально ~256 МБ RAM и несколько ГБ под `messenger.db` + `media/`. Фактический потолок SQLite — ~50–100 одновременных пользователей (`SetMaxOpenConns(1)`).

---

## 2. Dockerfile и образ

`Dockerfile` в корне репозитория — multi-stage:

1. `client-builder` (node:20-alpine) — `npm install` + `npm run build` → `client/dist/`.
2. `server-builder` (golang) — копирует `client/dist` в `server/cmd/server/static` для `go:embed`, затем `go build -o /bin/messenger ./cmd/server` с `CGO_ENABLED=0`.
3. Final image — статический бинарник + runtime.

Ключевые следствия:
- Один контейнер содержит backend и frontend (PWA встроена через `go:embed`).
- `CGO_ENABLED=0` → образ не зависит от glibc/musl, легко переносится.
- После `git pull` нужно пересобрать образ: `docker compose build`.

---

## 3. Развёртывание через Docker Compose

### 3.1 Быстрый старт

```bash
git clone <repo-url> messenger
cd messenger
cp .env.example .env
# Отредактируйте .env — обязательно задайте JWT_SECRET (≥ 32 символов)
docker compose up -d
```

По умолчанию сервер слушает порт `8080`. Volume `messenger_data` монтируется в `/data` внутри контейнера — там хранятся `messenger.db`, `media/`, `downloads/`.

Healthcheck: `wget /api/server/info` каждые 30 секунд.

### 3.2 Варианты внешней точки входа

**Вариант A — собственный TLS (Let's Encrypt + certbot).**

```bash
sudo certbot certonly --standalone -d chat.example.com --email admin@example.com --agree-tos
```

Добавить в `docker-compose.yml` для сервиса `messenger`:

```yaml
volumes:
  - messenger_data:/data
  - /etc/letsencrypt/live/chat.example.com/fullchain.pem:/certs/fullchain.pem:ro
  - /etc/letsencrypt/live/chat.example.com/privkey.pem:/certs/privkey.pem:ro
```

В `.env`:

```env
TLS_CERT=/certs/fullchain.pem
TLS_KEY=/certs/privkey.pem
ALLOWED_ORIGIN=https://chat.example.com
```

`docker compose up -d`. Сервер поднимет HTTPS на `PORT` (TLS 1.3 only).

**Вариант B — Cloudflare Tunnel.**

Не требует открытых портов и занимается TLS на стороне Cloudflare.

1. Cloudflare Zero Trust → Networks → Tunnels → Create Tunnel → Cloudflared → скопировать токен.
2. В `.env`:

   ```env
   TUNNEL_TOKEN=<токен>
   ALLOWED_ORIGIN=https://chat.example.com
   BEHIND_PROXY=true
   ```

3. В Cloudflare: Public Hostname → subdomain + domain → `Service: http://messenger:8080`.
4. Запуск:

   ```bash
   docker compose --profile cloudflare up -d
   ```

   Этот профиль добавляет сервис `cloudflared` (`cloudflare/cloudflared:latest`) рядом с `messenger`.

`TLS_CERT` / `TLS_KEY` оставить пустыми — TLS делает Cloudflare. HSTS приложение не шлёт (его выставляет Cloudflare).

**Вариант C — собственный reverse proxy (Caddy / nginx / Traefik).**

В `.env`:

```env
BEHIND_PROXY=true
ALLOWED_ORIGIN=https://chat.example.com
```

Proxy должен:

- терминировать TLS;
- пропускать `Upgrade: websocket` для `/ws`;
- проставлять `X-Forwarded-For` / `X-Forwarded-Proto` (сервер доверяет им только при `BEHIND_PROXY=true`).

---

## 4. Переменные окружения

Полный список и значения по умолчанию — `docs/main/technical-documentation.md` §10 и `docs/main/usersguid.md` §3. Для деплоя критичны:

| ENV | Назначение в деплое |
|---|---|
| `JWT_SECRET` | Обязателен. Пустое → `log.Fatal`. Сгенерировать: `openssl rand -hex 32` |
| `ALLOWED_ORIGIN` | CORS + WS `CheckOrigin`. Ровно тот домен, с которого открывается клиент |
| `BEHIND_PROXY` | `true` за Cloudflare/nginx/caddy. Включает доверие `X-Forwarded-*`, HSTS |
| `TLS_CERT`, `TLS_KEY` | Прямой TLS без proxy |
| `REGISTRATION_MODE` | `open` / `invite` / `approval`. Невалидное → `log.Fatal` |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Bootstrap первого админа при пустой БД |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web Push (см. §5). Обязательно фиксировать в `.env` |
| `STUN_URL`, `TURN_URL`, `TURN_SECRET`, `TURN_CREDENTIAL_TTL` | Звонки (см. §6) |
| `FCM_LEGACY_KEY`, `APNS_*` | Push для Android/iOS (см. §5.2) |
| `MAX_UPLOAD_BYTES` | Лимит одного медиа-файла. По умолчанию 100 МБ |
| `MAX_GROUP_MEMBERS`, `ALLOW_USERS_CREATE_GROUPS` | Политика групп |
| `APP_VERSION`, `MIN_CLIENT_VERSION`, `APP_CHANGELOG` | Метаданные `/api/version` |
| `TUNNEL_TOKEN` | Профиль `cloudflare` в `docker-compose.yml` |

Пример `.env`:

```env
JWT_SECRET=замените_длинной_случайной_строкой
ALLOWED_ORIGIN=https://chat.example.com
REGISTRATION_MODE=invite
ADMIN_USERNAME=admin
ADMIN_PASSWORD=замените_сильным_паролем
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
STUN_URL=stun:stun.l.google.com:19302
TURN_URL=turn:turn.example.com:3478
TURN_SECRET=shared_secret
BEHIND_PROXY=true
```

---

## 5. Push-уведомления

### 5.1 Web Push (VAPID) — **обязательно для persistence**

При пустых `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` сервер генерирует пару на старте и выводит её в лог **один раз**. Если их не сохранить, после рестарта будут новые ключи, и все существующие Push-подписки сломаются — пользователи перестанут получать уведомления.

Извлечь из логов первого запуска:

```bash
docker logs messenger 2>&1 | grep VAPID
```

Скопировать обе строки в `.env`, затем `docker compose restart messenger`. Автоматический `install-server.sh` делает это сам (см. `install-server.md`).

### 5.2 Native push

Опционально, для Android и iOS native-приложений:

- `FCM_LEGACY_KEY` — Firebase Server Key для Android. Эндпоинт `POST /api/push/native/register` принимает токены устройства.
- `APNS_KEY_PATH` + `APNS_KEY_ID` + `APNS_TEAM_ID` + `APNS_BUNDLE_ID` — APNs JWT для iOS. `APNS_SANDBOX=true` — для debug-сборок iOS.

Если соответствующие переменные не заданы, native push-ветки просто отключены, web-push продолжает работать.

---

## 6. STUN / TURN / SFU

### 6.1 STUN

По умолчанию сервер отдаёт клиентам публичный `stun:stun.l.google.com:19302`. Этого хватает для ~70–80% 1:1 звонков. Переопределяется переменной `STUN_URL`.

### 6.2 TURN

Нужен при симметричном NAT / строгом корпоративном файрволе (~15–30% случаев без TURN не соединяются).

Шаблон coturn (`/etc/turnserver.conf`):

```
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=ВАШ_ОБЩИЙ_СЕКРЕТ
realm=turn.example.com
```

В `.env` сервера:

```env
TURN_URL=turn:turn.example.com:3478
TURN_SECRET=ВАШ_ОБЩИЙ_СЕКРЕТ
TURN_CREDENTIAL_TTL=86400
```

Эндпоинт `GET /api/calls/ice-servers` выдаёт клиентам временные креды: `username = ts-expiry`, `credential = base64(HMAC-SHA1(username, TURN_SECRET))`, TTL из `TURN_CREDENTIAL_TTL`. Никаких статических логин/пароль не хранится.

TLS-вариант: использовать `turns:turn.example.com:5349` в `TURN_URL`.

### 6.3 SFU для групповых звонков

SFU встроен в серверный бинарник (`server/internal/sfu`), использует `pion/webrtc`. Отдельного сервиса поднимать не нужно.

Поведение:

- `POST /api/calls/room` создаёт комнату, участники присоединяются через `POST /api/calls/room/{id}/join` и WS `group-call.*`.
- Каждый входящий медиа-трек пересылается всем другим участникам (forwarding, без транскодинга).
- Практический потолок — ~10–15 активных участников на комнату. Больше — требует выделенного SFU (LiveKit и т. п.), который в текущей архитектуре не интегрирован.
- Для корректной работы SFU наружу всё равно нужны STUN и TURN (выше).

Известный риск безопасности: `pion/dtls@2.2.12` содержит vuln GO-2026-4479 (random-nonce AES-GCM). Статус и митигация — `docs/security-audit.md`.

---

## 7. Reverse proxy и `BEHIND_PROXY`

Флаг `BEHIND_PROXY=true` включает одновременно:

- доверие `X-Forwarded-For` и `X-Forwarded-Proto` при логировании/расчёте origin;
- отправку `Strict-Transport-Security`;
- ослабление предупреждений об отсутствии прямого TLS.

**Обязательно** задействовать при деплое через Cloudflare Tunnel, nginx, Caddy, Traefik или любой другой reverse proxy. При прямом TLS (`TLS_CERT` + `TLS_KEY`) — наоборот, `BEHIND_PROXY=false`.

Пример блока Caddyfile:

```
chat.example.com {
    reverse_proxy messenger:8080 {
        header_up X-Forwarded-Proto {scheme}
    }
}
```

Пример nginx (ключевые строки):

```
location /ws {
    proxy_pass http://messenger:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
location / {
    proxy_pass http://messenger:8080;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Если WS соединения рвутся сразу после `Upgrade`, наиболее вероятная причина — `ALLOWED_ORIGIN` не совпадает с доменом клиента, либо proxy не пропускает `Upgrade: websocket`.

---

## 8. Bots webhook endpoint

Bots-модуль делает **исходящие** HTTP-POST на `webhook_url` бота:

- Метод: `POST`, тело — JSON c событием.
- Подпись: `X-Messenger-Signature: HMAC-SHA256(body, bot_secret)`.
- Timeout: 5s. Retry: 1s → 2s → 4s (итого до 3 попыток).
- Allowlist: URL должен быть localhost или RFC-1918 (`10/8`, `172.16/12`, `192.168/16`). Публичные адреса отклоняются (защита от SSRF).

Для деплоя это означает:

- Сервис, принимающий webhooks, должен быть доступен в той же приватной сети, что и messenger-сервер (или на том же хосте).
- Если нужен внешний бот — поднимите reverse-connection (например, через SSH-туннель к внутреннему сервису) и дайте боту localhost-адрес.
- Rate-limit на bot-token middleware — `botLimiter` 60 req/min per IP.

---

## 9. Миграции БД

Миграции в `server/db/migrate.go` применяются **автоматически** при каждом старте сервера. Поэтому штатный апдейт — просто:

```bash
git pull
docker compose build
docker compose up -d
```

### 9.1 Ручной запуск через `scripts/db-migrate.sh`

Полезно для dry-run или отладки:

```bash
./scripts/db-migrate.sh --db /path/to/messenger.db --dry-run
./scripts/db-migrate.sh --db /path/to/messenger.db --version 28
./scripts/db-migrate.sh --db /path/to/messenger.db --rollback 1
```

На текущем baseline `TOTAL_MIGRATIONS=28`. Скрипт идемпотентен: `duplicate column name`, `no such table`, `already exists` считаются успешными шагами.

### 9.2 `server/Makefile`

Тестовые таргеты для CI/локальной проверки:

```bash
make -C server test                 # go test ./... -race
make -C server coverage             # coverage.out + HTML
make -C server test-integration     # internal/integration/...
```

### 9.3 Проверка после апдейта

```bash
docker exec messenger sqlite3 /data/messenger.db \
  "SELECT id, datetime(applied_at, 'unixepoch') FROM schema_migrations ORDER BY id;"
```

Последняя строка должна иметь `id=28` (на baseline).

---

## 10. Health и monitoring

### 10.1 Health endpoint

- `GET /api/server/info` — публичный, возвращает имя/описание/режим регистрации/лимиты. Используется как healthcheck в `docker-compose.yml`.
- `GET /api/version` — текущая версия, минимальная версия клиента, changelog.

### 10.2 Admin monitoring

Доступны только при `role=admin`:

- `GET /api/admin/system/stats` — JSON-snapshot (CPU %, RAM used/total, Disk used/total по корню и `MEDIA_DIR`).
- `GET /api/admin/system/stream` — Server-Sent Events с тем же набором метрик в реальном времени.

Источник — `shirou/gopsutil`. UI админ-панели (`client/src/pages/AdminPage.tsx`) отрисовывает графики через `recharts`.

### 10.3 Client error reporting

- `POST /api/client-errors` — приём error-логов с клиента. Пишутся в серверный файловый лог (lumberjack-ротация).

### 10.4 Сервер-логи

Stdout контейнера (`docker logs messenger`). В файловом режиме — путь настраивается через `logger`-модуль; формат — structured (`slog`).

---

## 11. Backup и restore SQLite

Volume `messenger_data` содержит `messenger.db`, `media/`, `downloads/`. SQLite — один файл, бэкап тривиален.

### 11.1 Backup

```bash
docker compose stop messenger
docker cp messenger:/data/messenger.db ./backup-$(date +%Y%m%d-%H%M).db
docker cp messenger:/data/media ./backup-media-$(date +%Y%m%d)     # опционально, крупный объём
docker compose start messenger
```

Остановка на время копирования гарантирует консистентность WAL — альтернативно используйте `sqlite3 messenger.db ".backup"` для online-backup без остановки:

```bash
docker exec messenger sh -c 'sqlite3 /data/messenger.db ".backup /data/backup.db"'
docker cp messenger:/data/backup.db ./backup-$(date +%Y%m%d-%H%M).db
```

### 11.2 Restore

```bash
docker compose stop messenger
docker cp ./backup-20260421-1200.db messenger:/data/messenger.db
docker compose start messenger
```

После рестарта сервер прогонит миграции и ожидаемо довыполнит недостающие (если backup был сделан на более старом `schema_migrations`).

### 11.3 Регламент

- Минимум — ежедневный backup `messenger.db`.
- Ротация: хранить 7 ежедневных + 4 еженедельных + 3 ежемесячных копии.
- Тест восстановления: минимум раз в квартал разворачивать backup в staging и проверять логин/запуск.

---

## 12. Релизы

- Процесс релиза и теги — `docs/release-tag-instructions.md`.
- Предрелизный чеклист (тесты, security-audit, migration dry-run) — `docs/release-checklist.md`.
- Артефакты native-клиентов (`.dmg`, `.deb`, `.msi`, `.apk`) собираются в CI (`.github/workflows/build-native.yml`) при push тега `v*` и публикуются draft-релизом на GitHub.
- Сервер в текущей схеме обновляется через `git pull && docker compose build && docker compose up -d` — тег используется только для native-артефактов.

---

## 13. Troubleshooting

| Симптом | Причина / фикс |
|---|---|
| `JWT_SECRET is required` при старте | Не задан `JWT_SECRET` в `.env` |
| Недопустимое `REGISTRATION_MODE` → `log.Fatal` | Только `open` / `invite` / `approval` |
| Push-уведомления ломаются после рестарта | VAPID-ключи были авто-сгенерированы и не сохранены. Извлечь из логов первого запуска в `.env` |
| WebSocket открывается и сразу закрывается | `ALLOWED_ORIGIN` не совпадает с доменом клиента; либо proxy не пропускает `Upgrade: websocket` |
| Видеозвонки не соединяются у части пользователей | Нужен TURN. Поднять coturn, задать `TURN_URL` + `TURN_SECRET` |
| Групповой звонок «сыпется» у всех при 15+ | Превышен практический потолок встроенного SFU. Большие комнаты требуют выделенного SFU-сервиса |
| `duplicate column name` в логах миграций | Безопасно — migration runner помечает такую миграцию как применённую |
| Bots webhook не отправляется | URL не в allowlist (localhost/RFC-1918). Bot-delivery отклоняет публичные адреса |
| Browser PWA обновилась, а логика не поменялась | Service Worker закэширован. Принудительно обновить: DevTools → Application → Unregister SW, затем hard-reload |
| `certbot` не может получить сертификат | Остановите proxy на 80 порту или используйте `--http-01`-challenge через Caddy/nginx |
| Docker volume потерялся после пересоздания | В `docker-compose.yml` volume называется `messenger_data` — пересоздание сервиса без `-v` его сохраняет, `docker compose down -v` **удалит данные** |

---

## 14. Ссылки

- `docs/main/architecture.md` — схема системы, E2E, SFU, native security.
- `docs/main/technical-documentation.md` — модули, REST/WS, миграции, ENV.
- `docs/main/usersguid.md` — пользовательская установка, admin-панель, FAQ.
- `install-server.md` — автоматический installer (`install-server.sh` / `install-server.bat`).
- `docs/release-checklist.md`, `docs/release-tag-instructions.md` — процесс релиза.
- `docs/security-audit.md` — аудит безопасности, включая `pion/dtls` vuln.
- `docs/privacy-screen-contract.md`, `docs/ios-update-policy.md` — политика native-клиентов.

---

*Документ актуален на `60d7c93` (2026-04-21).*
