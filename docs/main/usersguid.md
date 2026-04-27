# Руководство пользователя Messenger

> Актуально на коммит `3c9b58d` (2026-04-27). Охватывает self-hosted развёртывание, веб-клиент, native-приложения и админ-панель. Справочная техническая документация — `docs/main/technical-documentation.md`. Deployment-only материалы — `docs/main/deployment.md`.

---

## 1. Быстрая установка сервера (Docker)

Автоматические скрипты в корне репозитория делают всё за один запуск: задают вопросы, создают `.env`, генерируют `JWT_SECRET`, запускают контейнер, извлекают VAPID-ключи и сохраняют данные администратора в `server-main.txt`.

### Требования

- Docker Desktop (Windows, macOS) или Docker Engine + Docker Compose (Linux).
- Доступ в интернет для скачивания базовых образов.

### macOS / Linux

```bash
git clone <repo-url> messenger
cd messenger
chmod +x install-server.sh
./install-server.sh
```

### Windows

1. `git clone <repo-url> messenger`
2. Открыть папку `messenger` в Проводнике.
3. Правый клик на `install-server.bat` → «Запуск от имени администратора».

### Что будет спрошено

- Имя сервера (`SERVER_NAME`) и описание (`SERVER_DESCRIPTION`).
- Внешний URL и порт.
- Режим регистрации (см. §4.2).
- Логин и пароль администратора.

### Что создаст скрипт

- `.env` — полный конфигурационный файл.
- Контейнер `messenger` из `docker-compose.yml`, порт по умолчанию `8080`.
- `server-main.txt` — памятка с URL, логином/паролем администратора, `JWT_SECRET`, VAPID-ключами и командами управления.

> `.env` и `server-main.txt` содержат секреты. Храните их вне репозитория.

Подробнее по скрипту — `install-server.md` в корне проекта. Команды управления Docker-контейнером см. в `docs/main/deployment.md`.

---

## 2. Ручная установка (для разработчиков)

Подходит, если нужен dev-режим с Vite hot-reload и возможностью редактировать код.

### 2.1 Инструменты

- Git.
- Go 1.23+.
- Node.js 20 LTS + npm.
- (Опционально) JDK 17 для native desktop.

macOS:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install git go node openjdk@17
```

Ubuntu/Debian:

```bash
sudo apt update
sudo apt install git golang-go nodejs npm openjdk-17-jdk
```

Windows: Git for Windows, MSI установщик Go, Node.js через `nvm-windows`, Adoptium JDK 17.

### 2.2 Запуск в dev-режиме

```bash
# Терминал 1 — backend
cd server
JWT_SECRET=<не_менее_32_символов> go run ./cmd/server
# слушает http://localhost:8080

# Терминал 2 — frontend
cd client
npm install
npm run dev
# Vite на http://localhost:5173 с dev-proxy /api /ws /media → :8080
```

Откройте `http://localhost:5173`. Первый экран — «Настройка сервера» (`ServerSetupPage`); для dev-окружения нажмите «Использовать текущий адрес» либо введите `http://localhost:8080`.

### 2.3 Production-бинарник

```bash
cd client && npm install && npm run build
cp -R dist/* ../server/cmd/server/static/

cd ../server
go build -o messenger ./cmd/server
JWT_SECRET=<секрет> ./messenger
```

При запуске сервер создаст `messenger.db`, `media/`, `downloads/`. Если заданы `ADMIN_USERNAME` и `ADMIN_PASSWORD` — создастся первый администратор.

---

## 3. Полный список переменных окружения

Приоритет значений: `env > config.yaml > defaults`. Имя файла конфига — `config.yaml`.

### 3.1 Обязательные

| ENV | Назначение |
|---|---|
| `JWT_SECRET` | Подпись JWT. Пустое значение — сервер завершится с `log.Fatal`. Минимум 32 символа |

### 3.2 Базовые

| ENV | Дефолт | Назначение |
|---|---|---|
| `PORT` | `8080` | HTTP-порт |
| `DB_PATH` | `./messenger.db` | Файл SQLite |
| `MEDIA_DIR` | `./media` | Каталог медиа |
| `DOWNLOADS_DIR` | `./downloads` | Каталог native-артефактов |
| `SERVER_NAME` | `Messenger` | Публичное имя |
| `SERVER_DESCRIPTION` | — | Описание |
| `APP_VERSION` | `dev` | Версия сборки сервера |
| `MIN_CLIENT_VERSION` | `0.0.0` | Минимальная версия клиента |
| `APP_CHANGELOG` | — | Changelog для `/api/version` |

### 3.3 TLS / CORS / proxy

| ENV | Дефолт | Назначение |
|---|---|---|
| `TLS_CERT`, `TLS_KEY` | — | Прямой TLS (TLS 1.3) |
| `ALLOWED_ORIGIN` | — | CORS и WS `CheckOrigin` (через запятую) |
| `BEHIND_PROXY` | `false` | Доверие `X-Forwarded-*`, HSTS |

### 3.4 Регистрация и админ

| ENV | Дефолт | Назначение |
|---|---|---|
| `REGISTRATION_MODE` | `open` | `open` / `invite` / `approval`. Другое значение → `log.Fatal` |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | — | Bootstrap первого администратора |

### 3.5 Push

| ENV | Дефолт | Назначение |
|---|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | авто | Web Push. Если пустые — ключи генерируются разово и выводятся в лог; без сохранения подписки сломаются после рестарта |
| `FCM_LEGACY_KEY` | — | FCM Server Key |
| `APNS_KEY_PATH`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` | — | APNs .p8 и метаданные |
| `APNS_SANDBOX` | `false` | APNs sandbox |

### 3.6 Звонки (STUN/TURN)

| ENV | Дефолт | Назначение |
|---|---|---|
| `STUN_URL` | `stun:stun.l.google.com:19302` | STUN-сервер |
| `TURN_URL` | — | TURN (не обязателен) |
| `TURN_SECRET` | — | HMAC для временных TURN-creds |
| `TURN_CREDENTIAL_TTL` | `86400` | TTL TURN-creds, сек |

### 3.7 Группы, квоты, upload

| ENV | Дефолт | Назначение |
|---|---|---|
| `MAX_GROUP_MEMBERS` | `50` | Лимит участников группы (`0` = дефолт) |
| `ALLOW_USERS_CREATE_GROUPS` | `true` | Разрешение создавать группы обычным пользователям |
| `MAX_UPLOAD_BYTES` | `100<<20` (100 МБ) | Лимит одного media-upload |

### 3.8 Docker-специфичные

- `TUNNEL_TOKEN` — токен Cloudflare Tunnel для профиля `cloudflare` в `docker-compose.yml`.

Пример `config.yaml`:

```yaml
port: "8080"
db_path: "./messenger.db"
jwt_secret: "замените_на_32+_символа"
vapid_public_key: "извлечь_из_логов_первого_запуска"
vapid_private_key: "извлечь_из_логов_первого_запуска"
registration_mode: "approval"
server_name: "Наш мессенджер"
stun_url: "stun:stun.l.google.com:19302"
turn_url: "turn:turn.example.com:3478"
turn_secret: "shared_secret"
```

---

## 4. Первый запуск

### 4.1 Bootstrap администратора

Если на момент первого запуска в БД нет ни одного пользователя, сервер создаёт администратора по `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Войдите этими данными в веб-клиенте и смените пароль через «Профиль → Сменить пароль».

Если bootstrap-параметры не заданы, первый администратор создаётся одним из двух способов:

**Через веб-интерфейс (рекомендуется):** откройте `http://<IP>:<ПОРТ>/admin/` — сервер определит, что администраторов нет, и перенаправит на страницу `/admin/setup` для создания аккаунта.

**Через SQL (резервный способ):**
1. Создайте аккаунт через стандартную регистрацию (зависит от `REGISTRATION_MODE`).
2. Выполните:
   ```sql
   UPDATE users SET role = 'admin' WHERE username = 'ваш_логин';
   ```
3. Разлогиньтесь и войдите заново — роль берётся из JWT.

### 4.2 Режимы регистрации (`REGISTRATION_MODE`)

| Режим | Поведение |
|---|---|
| `open` | Любой желающий регистрируется через `AuthPage` без ограничений |
| `invite` | Регистрация только по одноразовому коду. Коды создаются администратором в «Админ-панель → Инвайты». Активация транзакционная, истёкшие и отозванные коды отбрасываются |
| `approval` | Пользователь подаёт заявку через `AuthPage` → «Запросить регистрацию». Заявка попадает в «Админ-панель → Заявки на регистрацию» и требует одобрения |

Примечание: в старой документации и некоторых комментариях встречается термин `request` — это устаревший синоним `approval`. Сервер принимает только `approval`.

### 4.3 Сброс пароля

Пользователь на `AuthPage` → «Забыли пароль?» → запрос направляется администратору (без утечки факта существования логина). Администратор в панели выдаёт временный пароль, пользователь логинится и меняет его через профиль.

---

## 5. Веб-клиент (PWA)

Веб-клиент (`client/`) одинаково работает в браузере и в режиме установленного PWA.

### 5.1 Регистрация и первый вход

1. Открыть URL сервера. Первый экран — `ServerSetupPage`: ввести адрес сервера (используется `/api/server/info` для проверки).
2. `AuthPage`: вкладки «Вход», «Регистрация», «Инвайт», «Запрос», «Забыли пароль» — набор зависит от `REGISTRATION_MODE`.
3. При регистрации клиент локально генерирует ключи X3DH (IK, SPK + подпись, OPK-набор) и отправляет публичные части на сервер через `POST /api/keys/register` / `POST /api/keys/prekeys`. Приватные ключи остаются в IndexedDB, зашифрованные vault-ключом.

### 5.2 Passphrase gate

После логина веб-клиент просит passphrase. Это ключ шифрования локального vault (AES-GCM поверх IndexedDB) — под ним хранятся приватные ключи X3DH/Ratchet/SenderKey и кэш сообщений. Пока vault не разблокирован, UI чатов скрыт.

- На ранее использованном устройстве — введите passphrase, заданный при регистрации.
- На новом устройстве — passphrase создаётся при первом входе.
- Забытая passphrase эквивалентна потере ключей: vault придётся обнулить, старые сообщения станут нерасшифруемыми.

### 5.3 Чаты 1:1 и групповые

- Список чатов: `ChatListPage` слева/сверху в зависимости от ширины экрана.
- Создание: кнопка «Новый чат» → `NewChatModal` (поиск по username через `GET /api/users/search`).
- Группа: в `NewChatModal` включить «Группа», добавить участников, задать имя.
- Просмотр: `ChatWindowPage` (история, ввод, прикрепление медиа, запись голосового).
- Удаление сообщения — меню сообщения → «Удалить» (soft-delete, рассылается всем получателям).
- Редактирование — меню сообщения → «Редактировать» (broadcast новому получателю).
- Read markers и индикатор набора — автоматически.

### 5.4 Медиа и галерея

- Прикрепление файлов и изображений — через кнопку-скрепку в `ChatWindow`.
- Файлы шифруются XSalsa20-Poly1305 на клиенте, upload — ciphertext only (`POST /api/media/upload`). Ключ расшифровки вложен в E2E-payload сообщения.
- Галерея чата: кнопка «Медиа» в заголовке → `GalleryModal` со списком из `GET /api/chats/{id}/media`.
- Лимит одного файла — `MAX_UPLOAD_BYTES` (по умолчанию 100 МБ). Квоты на пользователя управляются администратором.

### 5.5 Голосовые сообщения

- Запись: нажать и удерживать кнопку микрофона в `ChatWindow` (`VoiceRecorder`).
- После отпускания — аудио кодируется браузером, шифруется как обычное медиа и отправляется.
- Воспроизведение: `VoiceMessage` с прогрессом и кнопкой паузы.

Требуется разрешение на микрофон в браузере/ОС.

### 5.6 Аудио/видео-звонки

- 1:1 звонок: кнопка звонка в заголовке `ChatWindow` → `CallOverlay`. Клиент получает ICE-серверы через `GET /api/calls/ice-servers` и инициирует WebRTC через shared `call-controller`.
- Групповой звонок: в групповом чате — кнопка звонка → `GroupCallView`. Серверная часть использует SFU (`server/internal/sfu`): комната создаётся через `POST /api/calls/room`, участники присоединяются через WS `group-call.join` и REST `POST /api/calls/room/{id}/join`. Практический потолок — ≤ 10–15 активных участников.
- Для звонков за симметричным NAT требуется TURN (см. §3.6 и `docs/main/deployment.md`).

### 5.7 Привязка устройства (multi-device)

- На исходном устройстве: «Профиль → Устройства → Привязать новое устройство» (`LinkDevicePage` → `LinkDevice`). Сервер выдаёт QR-токен (TTL 120s).
- На новом устройстве: «Привязать это устройство» → отсканировать/ввести токен. Клиент генерирует собственный набор X3DH-ключей и регистрирует себя через `POST /api/auth/device-link-activate`.
- История сообщений на новом устройстве изначально пуста: ключи Double Ratchet у старых устройств. Новые сообщения расшифровываются автоматически после обмена ключами.

### 5.8 Безопасность сессии: Safety Number

Модуль `SafetyNumber` показывает отпечаток пары IK (локального и собеседника). Используйте при первом звонке или сомнениях, что собеседник — тот, за кого себя выдаёт: сверьте числа по другому каналу.

### 5.9 Профиль

Страница `ProfilePage`:

- Смена display name и аватара.
- Смена пароля (`POST /api/auth/change-password`).
- Список устройств с возможностью отвязать (`DELETE /api/devices/{id}`).
- Включение биометрической защиты и privacy screen (только на native-клиентах).
- Логаут — `POST /api/auth/logout`, инвалидирует refresh-токен.

### 5.10 Offline

- `OfflineIndicator` в верхней части показывает, что сеть недоступна.
- Исходящие сообщения буферизуются в IndexedDB (`outboxDb`). При возврате сети `useOfflineSync` их переигрывает.
- Push-уведомления приходят даже при закрытом клиенте при условии, что VAPID-ключи задействованы (см. §3.5).

---

## 6. Native-приложения

Устанавливаются из артефактов, публикуемых в `/api/downloads/manifest` + `/api/downloads/{filename}` (админ-панель → «Релизы»).

### 6.1 Desktop (Compose Multiplatform)

- Платформы: macOS (arm64, x86_64), Windows, Linux.
- Пакеты: `.dmg`, `.msi`, `.deb`. Сборка в CI из тегов `v*`, опциональная подпись macOS (`MACOS_SIGNING_IDENTITY`) и Windows (`signtool`).
- Первый запуск — экран «Настройка сервера», аналог web-клиента.
- Пароль vault: на desktop используется собственный passphrase-gate (ОС-биометрика напрямую не задействована).
- Privacy screen: overlay при потере фокуса окна (см. `docs/privacy-screen-contract.md`). Ограничения — `docs/privacy-screen-desktop-limitations.md`.
- Обновления: приложение запрашивает `GET /api/version` + `GET /api/downloads/manifest`, показывает changelog и ссылку на новый артефакт. Установка ручная — скачать и запустить новый пакет.

### 6.2 Android (Kotlin + Compose)

- Пакет: APK (`assembleRelease` при заданном keystore, иначе `assembleDebug`).
- Установка: скачать APK → разрешить «Установка из неизвестных источников» → открыть файл. Для обновлений клиент использует системный `PackageInstaller`.
- Биометрика: `BiometricPrompt` (класс BIOMETRIC_STRONG), fallback на PIN/pattern устройства. Экран `BiometricGateScreen` — блокирует запуск и возврат из фона.
- Privacy screen: `FLAG_SECURE` блокирует app switcher, screen recording и скриншоты системы (см. `docs/privacy-screen-contract.md`). Флаг `privacyScreenEnabled` в SharedPrefs.
- Push: FCM (токен регистрируется через `POST /api/push/native/register`).

### 6.3 iOS (SwiftUI)

- Полноценный IPA **не собирается в CI** — только криптопакет `MessengerCrypto` через SPM. Дистрибуция: TestFlight или App Store (см. `docs/ios-update-policy.md`).
- Установка с произвольной ссылки запрещена iOS. Обновления — через TestFlight/App Store.
- Биометрика: `LAContext` → Face ID / Touch ID / passcode, экран `BiometricGateView`.
- Privacy screen: blur-overlay при `scenePhase == .inactive/.background` + реакция на `UIScreen.capturedDidChangeNotification`. Не блокирует OS screenshot hotkey (ограничение платформы).
- Push: APNs (токен регистрируется через `POST /api/push/native/register`).

### 6.4 Общие свойства native

- Vault работает так же, как в web: AES-GCM поверх локального хранилища, passphrase либо биометрика (если включена).
- Те же X3DH/Double Ratchet/Sender Keys, сверяются с web через `shared/test-vectors/`.
- Первый экран — «Настройка сервера». URL можно «запечь» в CI через `scripts/set-server-url.sh`.

---

## 7. Администрирование

Администрирование доступно через два интерфейса:

- **Серверная веб-панель** — `http://<IP>:<ПОРТ>/admin/` — server-side rendered интерфейс без зависимостей от React-клиента. Работает в любом браузере, использует сессии (cookie). Точка входа: `/admin/login`; при отсутствии администраторов — `/admin/setup`.
- **React AdminPage** — встроена в веб-клиент PWA (доступ при `role=admin`). REST-эквиваленты — `docs/main/technical-documentation.md` §4.5.

Обе панели предоставляют одинаковый набор операций над пользователями, инвайтами и заявками. Серверная панель дополнительно показывает дашборд с метриками (CPU, RAM, Disk, количество сообщений и чатов).

### 7.1 Пользователи

- Список пользователей, поиск.
- Действия: `reset-password` (выдать временный пароль), `suspend` / `unsuspend`, `ban`, `revoke-sessions` (инвалидирует все JWT через `session_epoch`), `remote-wipe` (выход со всех устройств + требование перезайти).
- Изменение роли: `user`, `moderator`, `admin`.
- Квота на пользователя: `GET/PUT /api/admin/users/{id}/quota` (суммарный лимит медиа в байтах).

### 7.2 Инвайты

- «Инвайт-коды»: создание, список, удаление, просмотр активаций (IP/UA/время — журнал в `invite_activations`).
- Инвайт одноразовый: активация транзакционная, отозванные (`revoked_at`) и истёкшие (`expires_at`) отклоняются.

### 7.3 Заявки на регистрацию

- При `REGISTRATION_MODE=approval` заявки пользователей попадают в раздел «Заявки на регистрацию».
- Действия: одобрить (пользователь создаётся), отклонить (заявка помечается `rejected`).

### 7.4 Сбросы паролей

- Список запросов сброса. Для pending-запроса админ выдаёт временный пароль (`reset-password`), и запрос помечается resolved.

### 7.5 Настройки сервера

- «Retention» — срок автоматического удаления сообщений.
- «Max group members» — лимит участников группы.

### 7.6 Мониторинг

- Подраздел «Система»: CPU %, RAM used/total, Disk used/total (через `gopsutil`).
- Snapshot — `GET /api/admin/system/stats`, real-time — `GET /api/admin/system/stream` (SSE). UI рисует графики через `recharts`.

### 7.7 Боты

- Создание бота: имя + owner → сервер возвращает токен (единственный раз).
- Webhook URL бота должен быть localhost или RFC-1918 (защита от SSRF). Запросы подписываются HMAC-SHA256, retry 1s→2s→4s, timeout 5s.
- Приём сообщений ботом — через bot-token middleware.

### 7.8 Downloads / релизы

- «Релизы» отображает артефакты из `DOWNLOADS_DIR`: `.dmg`, `.deb`, `.msi`, `.apk`, — доступные клиентам через `/api/downloads/manifest`.

---

## 8. FAQ и troubleshooting

### Веб-клиент спрашивает passphrase каждый раз — это нормально?

Да. Passphrase не сохраняется на диск. Если хотите автоматическую разблокировку, поставьте native-приложение с биометрикой.

### После рестарта сервера не приходят push-уведомления

Вы не сохранили VAPID-ключи. Задайте `VAPID_PUBLIC_KEY` и `VAPID_PRIVATE_KEY` в `.env` (скрипт `install-server.sh` делает это автоматически). Существующие подписки, созданные под старыми ключами, придётся переоформить.

### Звонок не соединяется за корпоративным файрволом

Нужен TURN. Поднимите coturn, задайте `TURN_URL` и `TURN_SECRET`. Креды клиентам выдаются автоматически через `/api/calls/ice-servers`.

### В групповом звонке видео «сыпется» у всех

Превышен практический потолок SFU (~10–15 активных участников в одной комнате). Выделенный SFU-сервис (LiveKit) в текущей архитектуре не поддержан.

### Сообщения не расшифровываются на новом устройстве

Это ожидаемо: ключи Double Ratchet у старых устройств. История восстановится только после первого обмена ключами с активными собеседниками. Для переноса без истории используйте «Привязать устройство» (§5.7).

### «Не удалось подключиться к серверу»

1. Проверьте URL на `ServerSetupPage` — он должен отвечать `GET /api/server/info`.
2. Убедитесь, что `ALLOWED_ORIGIN` включает домен клиента.
3. При reverse proxy проверьте, что `BEHIND_PROXY=true` и proxy пропускает `Upgrade: websocket`.
4. Для iOS/Android: сервер должен быть доступен по валидному TLS-сертификату (не самоподписанному).

### Забыта passphrase vault

Восстановление невозможно. Сбросьте vault — в `ProfilePage` выйти из аккаунта и очистить данные браузера для домена; затем войти заново и создать новую passphrase. Вся история и приватные ключи будут потеряны.

### Я случайно удалил пользователя — как восстановить?

Удаление пользователя полностью убирает его из БД, публичные ключи и сообщения-копии на его адрес тоже. Единственный путь — восстановление из backup'а SQLite (см. `docs/main/deployment.md`).

### iOS не предлагает обновление через `UpdateCheckerService`

На iOS прямая sideload-установка запрещена. Приложение покажет changelog и попросит обновиться через TestFlight или App Store — см. `docs/ios-update-policy.md`.

### Admin-панель не открывается

**Серверная панель (`/admin/`):** если нет ни одного администратора в БД, сервер перенаправит на `/admin/setup` — создайте первого администратора через форму. Если администратор есть, но вход не работает, убедитесь, что вводите именно `admin_username`/`admin_password` из `config.yaml`.

**React AdminPage (в клиенте):** откройте JWT — убедитесь, что `role=admin`. Для пользователя, повышенного через SQL, нужен логаут + повторный вход, чтобы токен перевыпустился с новой ролью.

### Webhook бота не срабатывает

Проверьте, что URL — localhost или RFC-1918 (10/8, 172.16/12, 192.168/16). Другие адреса отклоняются защитой от SSRF. Также смотрите логи сервера — отказы фиксируются `bots` модулем.

---

## 9. Ссылки

- `docs/main/deployment.md` — развёртывание, TLS, proxy, миграции, backup.
- `docs/main/architecture.md` — как устроены E2E, SFU, vault, native security.
- `docs/main/technical-documentation.md` — REST/WS контракты, схема БД, ENV.
- `install-server.md` — детали автоматических скриптов установки.
- `docs/privacy-screen-contract.md`, `docs/privacy-screen-desktop-limitations.md` — контракт privacy screen.
- `docs/ios-update-policy.md` — политика обновлений iOS.

---

*Документ актуален на `3c9b58d` (2026-04-27).*
