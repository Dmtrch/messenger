# Руководство пользователя и разработчика Messenger

Этот документ содержит полную инструкцию по развертыванию, настройке и использованию Messenger.

---

## 1. Быстрая установка сервера (рекомендуется)

Для автоматической установки используйте скрипты `install-server.sh` (macOS/Linux) или `install-server.bat` (Windows). Они требуют только **Docker** и выполняют все шаги самостоятельно.

### Требования

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (включает Docker Compose)
- Доступ в интернет (для загрузки образов)

### macOS / Linux

```bash
# Клонируйте репозиторий
git clone <repo-url> messenger
cd messenger

# Сделайте скрипт исполняемым и запустите
chmod +x install-server.sh
./install-server.sh
```

### Windows

```
1. Клонируйте репозиторий: git clone <repo-url> messenger
2. Откройте папку messenger в Проводнике
3. Правая кнопка мыши на install-server.bat → "Запуск от имени администратора"
```

### Что делает скрипт

1. Проверяет наличие Docker и Docker Compose
2. Задаёт интерактивные вопросы: имя сервера, URL, порт, режим регистрации, логин и пароль администратора
3. Генерирует `JWT_SECRET` криптографически безопасным методом
4. Создаёт файл `.env` с полной конфигурацией
5. Собирает и запускает Docker-контейнер
6. Автоматически извлекает VAPID-ключи из логов первого запуска и сохраняет их в `.env`
7. Перезапускает сервер с постоянными ключами
8. Проверяет доступность сервера по HTTP
9. Записывает файл **`server-main.txt`** — все данные администратора

### Файл server-main.txt

После установки в корне проекта появится `server-main.txt`. В нём содержится:

- URL сервера и порт
- Логин и пароль администратора
- `JWT_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- Параметры WebRTC (STUN/TURN)
- Команды управления сервером (запуск, остановка, логи, резервное копирование, обновление)

> **ВНИМАНИЕ**: `server-main.txt` и `.env` содержат секреты. Сохраните их в защищённом месте и не публикуйте в репозитории.

---

## 2. Ручная установка (для разработчиков)

Если вы не используете Docker, установите инструменты вручную и запустите сервер напрямую.

### Установка инструментов

#### Windows
1. **Git**: [git-scm.com](https://git-scm.com/download/win)
2. **Go 1.22+**: [go.dev](https://go.dev/doc/install) — установщик MSI
3. **Node.js 20 LTS**: через [nvm-windows](https://github.com/coreybutler/nvm-windows)
4. **JDK 17**: [Adoptium](https://adoptium.net/) или [Microsoft Build of OpenJDK](https://learn.microsoft.com/en-us/java/openjdk/download)
5. **C++ Build Tools**: "Desktop development with C++" в Visual Studio Installer (нужно для некоторых зависимостей `node-gyp`)

#### macOS
```bash
# Установка Homebrew (если нет)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Установка инструментов
brew install git go node@20 openjdk@17
```

#### Linux (Ubuntu/Debian)
```bash
sudo apt update
sudo apt install git golang-go nodejs npm openjdk-17-jdk
# Для Node.js рекомендуется nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install 20
```

### Компиляция и запуск сервера

```bash
# Сборка клиента (статика встраивается в бинарник сервера)
cd client
npm install
npm run build
cp -R dist/* ../server/cmd/server/static/

# Компиляция и запуск сервера
cd ../server
go build -o messenger ./cmd/server
JWT_SECRET=<ваш_секрет> ./messenger
```

При первом запуске сервер создаст файл БД и папку `media/`. Если в конфигурации указаны `ADMIN_USERNAME` и `ADMIN_PASSWORD`, будет создан первый администратор.

---

## 3. Конфигурация сервера

Сервер использует иерархическую систему конфигурации: **ENV > `config.yaml` > значения по умолчанию**.

### Переменные окружения

| Переменная | Описание | По умолчанию |
| :--- | :--- | :--- |
| `JWT_SECRET` | **Обязательно.** Секрет для подписи JWT-токенов (мин. 32 символа). | — |
| `PORT` | Порт сервера. | `8080` |
| `DB_PATH` | Путь к файлу SQLite. | `./messenger.db` |
| `MEDIA_DIR` | Папка для медиафайлов. | `./media` |
| `SERVER_NAME` | Отображаемое имя сервера. | `Messenger` |
| `SERVER_DESCRIPTION` | Описание сервера. | — |
| `REGISTRATION_MODE` | `open` — свободная, `invite` — по коду, `approval` — по одобрению. | `open` |
| `ADMIN_USERNAME` | Логин администратора (создаётся при первом запуске). | — |
| `ADMIN_PASSWORD` | Пароль администратора. | — |
| `ALLOWED_ORIGIN` | CORS-фильтр для WebSocket и API (например, `https://chat.example.com`). | пусто (всё) |
| `BEHIND_PROXY` | `true`, если сервер за reverse proxy (Cloudflare Tunnel, nginx). | `false` |
| `STUN_URL` | STUN-сервер для WebRTC-звонков. | `stun:stun.l.google.com:19302` |
| `TURN_URL` | TURN-сервер (нужен при строгом NAT/Firewall). | пусто |
| `TURN_SECRET` | Секрет для генерации временных учётных данных TURN. | пусто |
| `TURN_CREDENTIAL_TTL` | TTL учётных данных TURN в секундах. | `86400` |
| `VAPID_PUBLIC_KEY` | Публичный ключ Web Push. | авто-генерация |
| `VAPID_PRIVATE_KEY` | Приватный ключ Web Push. | авто-генерация |
| `TLS_CERT` | Путь к TLS-сертификату (при прямом TLS без proxy). | пусто |
| `TLS_KEY` | Путь к приватному ключу TLS. | пусто |

### Сохранение конфигурации через config.yaml

Создайте файл `server/cmd/server/config.yaml` для постоянного хранения настроек:

```yaml
port: "8080"
db_path: "./messenger.db"
jwt_secret: "ваш_очень_длинный_секрет"
vapid_public_key: "извлеките_из_логов_первого_запуска"
vapid_private_key: "извлеките_из_логов_первого_запуска"
registration_mode: "approval"
server_name: "Мой мессенджер"
stun_url: "stun:stun.l.google.com:19302"
turn_url: "turn:my-turn-server.com:3478"
turn_secret: "my_shared_secret"
```

### VAPID-ключи (Web Push)

При первом запуске сервер автоматически генерирует VAPID-ключи и выводит их в лог:

```
VAPID_PRIVATE_KEY=<значение>
VAPID_PUBLIC_KEY=<значение>
```

Сохраните эти значения в `.env` или `config.yaml`. Если ключи не сохранены, при перезапуске сервера существующие Push-подписки перестанут работать.

> Скрипт `install-server.sh` / `install-server.bat` делает это автоматически.

---

## 4. Управление сервером (Docker)

```bash
# Запуск
docker compose up -d

# Остановка
docker compose stop

# Перезапуск
docker compose restart

# Просмотр логов
docker compose logs -f

# Статус контейнеров
docker compose ps
```

### Резервное копирование

```bash
docker compose stop
docker cp messenger:/data/messenger.db ./backup-$(date +%Y%m%d-%H%M).db
docker cp messenger:/data/media ./backup-media-$(date +%Y%m%d)   # опционально
docker compose start
```

### Обновление сервера

```bash
git pull
docker compose build
docker compose up -d
```

Миграции базы данных выполняются автоматически при запуске.

---

## 5. Настройка звонков (WebRTC)

### STUN и TURN

- **STUN** (по умолчанию): позволяет устройствам узнать публичный IP. Работает в 70–80% случаев. По умолчанию используется бесплатный сервер Google.
- **TURN** (рекомендуется для продакшена): необходим при строгих корпоративных Firewall и симметричных NAT. Трафик звонка проходит через ваш TURN-сервер.

### Настройка Coturn (пример)

1. Установите `coturn` на ваш сервер.
2. В `turnserver.conf` укажите `use-auth-secret` и `static-auth-secret=ВАШ_СЕКРЕТ`.
3. В конфигурации Messenger задайте:
   - `TURN_URL`: `turn:your-domain.com:3478` (или `turns:` для TLS)
   - `TURN_SECRET`: тот же секрет, что и в `static-auth-secret`
4. Клиент автоматически получает временные учётные данные через `/api/calls/ice-servers` при начале звонка.

---

## 6. Сборка для продакшена (без Docker)

В режиме продакшена сервер раздаёт статические файлы клиента встроенными в бинарник — один файл содержит и бэкенд, и фронтенд.

```bash
# 1. Сборка клиента
cd client
npm install
npm run build

# 2. Копирование статики в сервер
rm -rf ../server/cmd/server/static/*
cp -R dist/* ../server/cmd/server/static/

# 3. Компиляция автономного бинарника
cd ../server
go build -o messenger_prod ./cmd/server
```

Запуск: `./messenger_prod` (Windows: `messenger_prod.exe`)

---

## 7. Настольные приложения (Desktop)

Настольное приложение использует **Compose Multiplatform** (Kotlin) и собирается под каждую платформу.

### Команды сборки (из папки `apps/desktop`)

```bash
./gradlew run          # Запуск в режиме разработки
./gradlew clean build  # Сборка
```

### Сборка инсталляторов

- **Windows**: `./gradlew packageMsi` → `build/compose/binaries/main/msi`
- **macOS**: `./gradlew packageDmg` → `build/compose/binaries/main/dmg`
- **Linux**: `./gradlew packageDeb` → `build/compose/binaries/main/deb`

### Первый запуск

1. Запустите инсталлятор и установите приложение.
2. При первом запуске появится экран **"Настройка сервера"**.
3. Введите URL вашего сервера (например, `https://messenger.mycompany.com`).
4. Приложение сохранит адрес локально. После этого будет доступен экран входа/регистрации.

---

## 8. Использование системы

### Возможности

- **E2E-шифрование**: все сообщения шифруются на клиенте (X3DH + Double Ratchet). Сервер хранит только зашифрованные данные.
- **Групповые чаты**: защищённые групповые переписки.
- **Медиафайлы**: передача изображений и файлов.
- **Звонки**: аудио и видео через WebRTC.
- **Push-уведомления**: работают в PWA и нативных приложениях.

### Где хранятся данные

**Сервер** (`messenger.db` и `media/`):
- Хеши паролей, список пользователей, публичные ключи устройств (PreKeys)
- Зашифрованные сообщения и метаданные чатов
- Бинарные медиафайлы
- Данные хранятся бессрочно, пока не удалены пользователем или администратором

**Клиент** (браузер/Desktop):
- **Приватные ключи шифрования** — хранятся в зашифрованном виде в IndexedDB (браузер) или защищённом хранилище ОС (Desktop). На сервер **никогда не передаются**.
- **Кэш сообщений** — хранится локально для быстрого доступа.

### Регистрация и вход

- **Новый пользователь**: нажмите "Зарегистрироваться", введите логин/пароль. Клиент генерирует криптографические ключи и отправляет только их публичные части на сервер.
- **Существующий пользователь на новом устройстве**:
  1. Войдите со своим логином и паролем.
  2. Сервер зарегистрирует новое устройство.
  3. История сообщений изначально будет недоступна — ключи хранятся на старых устройствах. Новые сообщения станут расшифровываться автоматически после первого обмена ключами с другими участниками.

### Восстановление пароля

Если пароль забыт, можно запросить сброс у администратора через экран входа (если разрешено в конфигурации).

> **Внимание**: потеря приватных ключей (например, удаление данных браузера) делает старые сообщения нерасшифруемыми. Используйте функцию "Экспорт ключей" для резервного копирования (в разработке).
