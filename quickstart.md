# Быстрый старт

Минимальные команды для запуска сервера Messenger. Подробное руководство —
в `Установка-сервера.md`.

## Запуск через server-ctl (без Docker)

**Windows:**
```bat
server-ctl.bat build    :: собрать бинарник
server-ctl.bat start    :: запустить сервер
server-ctl.bat status   :: проверить статус
server-ctl.bat logs     :: смотреть логи
```

**Linux / macOS:**
```bash
chmod +x server-ctl.sh
./server-ctl.sh build
./server-ctl.sh start
```

После запуска: `http://localhost:8080/admin/` → первый вход создаёт аккаунт администратора.

## Запуск через Docker

```bash
# Обычная сборка (под свою платформу)
docker build -t messenger .

# Мультиплатформенная сборка через buildx
docker buildx build --platform linux/amd64,linux/arm64 -t messenger --push .

# ARM64 (Apple Silicon, Raspberry Pi)
docker buildx build --platform linux/arm64 -t messenger .
```

`docker-compose.yml` передаёт `BUILDPLATFORM` / `TARGETOS` / `TARGETARCH` как build args —
Docker buildx подставляет их автоматически.

## Сборка под Windows

На Windows Docker Desktop запускает Linux-контейнеры через WSL2, поэтому команды те же:

```bash
# Обычная сборка и запуск
docker compose up --build

# Явная сборка под linux/amd64 (стандарт для серверов)
docker build --platform linux/amd64 -t messenger .
```

Что нужно на Windows:
1. Docker Desktop for Windows — включить WSL2 backend (рекомендуется).
2. WSL2 включается через PowerShell (если не включён):
   ```powershell
   wsl --install
   ```

Мультиплатформенная сборка с buildx на Windows — нужна регистрация эмуляторов:
```bash
docker run --privileged --rm tonistiigi/binfmt --install all
docker buildx create --use --name multibuilder
docker buildx build --platform linux/amd64,linux/arm64 -t messenger --push .
```

Файл `.env` создайте в корне проекта `messenger/.env`:
```ini
JWT_SECRET=ваш_секрет_минимум_32_символа
PORT=8080
```

Затем:
```bash
docker compose up -d
```

Всё остальное идентично macOS/Linux — Docker Desktop абстрагирует платформу.
