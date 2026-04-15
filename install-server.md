# Установка сервера Messenger

> **Как использовать этот файл.**
> Положи его в папку с репозиторием Messenger на сервере.
> Открой Claude Code (`claude`) и скажи:
> `прочитай install-server.md и выполни все инструкции`

---

## Задача для Claude Code

Ты устанавливаешь и настраиваешь backend-сервер мессенджера Messenger.
Рабочая папка — текущий каталог, в котором находится этот файл.
В папке `server/` лежит Go-исходник сервера.

Выполни все шаги по порядку. После каждого шага убедись, что он завершился успешно, прежде чем переходить к следующему.
Не спрашивай подтверждения между шагами — выполни весь процесс автономно от начала до конца.
В конце выведи итоговую сводку с URL сервера и учётными данными администратора.

---

## Шаг 1. Определить окружение

Выясни:
- Операционную систему и дистрибутив (`uname -a`, `lsb_release -a` или `/etc/os-release`)
- Архитектуру процессора (`uname -m`)
- Имя текущего пользователя и домашнюю папку
- Путь к текущей рабочей папке (`pwd`)

Запомни эти значения — они понадобятся в следующих шагах.

---

## Шаг 2. Проверить и установить Go 1.22+

Проверь: `go version`

Если Go не установлен или версия ниже 1.22, установи актуальную версию:

**Linux (x86_64):**
```bash
GO_VERSION=1.22.5
curl -OL https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz
sudo rm -rf /usr/local/go
sudo tar -C /usr/local -xzf go${GO_VERSION}.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
export PATH=$PATH:/usr/local/go/bin
```

**Linux (arm64):**
```bash
GO_VERSION=1.22.5
curl -OL https://go.dev/dl/go${GO_VERSION}.linux-arm64.tar.gz
sudo rm -rf /usr/local/go
sudo tar -C /usr/local -xzf go${GO_VERSION}.linux-arm64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
export PATH=$PATH:/usr/local/go/bin
```

**macOS:**
```bash
brew install go
```

После установки убедись: `go version` показывает 1.22+.

---

## Шаг 3. Определить публичный IP-адрес

Выполни по очереди — используй первый успешный результат:
```bash
curl -s https://ifconfig.me
curl -s https://api.ipify.org
curl -s https://icanhazip.com
```

Также определи локальный IP (нужен для systemd):
```bash
hostname -I | awk '{print $1}'
```

Запомни публичный IP — он войдёт в `allowed_origin` и итоговый URL.

---

## Шаг 4. Выбрать порт

По умолчанию используй порт **8080**.

Проверь, свободен ли он:
```bash
ss -tlnp | grep ':8080' || echo "порт свободен"
```

Если порт занят, попробуй 8443, 3000, 9000 — первый свободный.

---

## Шаг 5. Открыть порт в firewall

**Ubuntu/Debian (ufw):**
```bash
sudo ufw allow <ПОРТ>/tcp
sudo ufw status
```

**CentOS/RHEL (firewalld):**
```bash
sudo firewall-cmd --permanent --add-port=<ПОРТ>/tcp
sudo firewall-cmd --reload
```

**iptables (если нет ufw/firewalld):**
```bash
sudo iptables -A INPUT -p tcp --dport <ПОРТ> -j ACCEPT
```

---

## Шаг 6. Сгенерировать секреты

**JWT_SECRET** (минимум 32 символа):
```bash
openssl rand -hex 32
```

**VAPID-ключи** для Web Push уведомлений.
Сервер может сгенерировать их сам при первом запуске, если они не указаны в config.
Оставь поля `vapid_public_key` и `vapid_private_key` пустыми — сервер сам создаст их и выведет в лог.

**Пароль администратора** — придумай надёжный пароль (минимум 12 символов).
Запомни его — он потребуется для входа в панель администратора.

---

## Шаг 7. Создать config.yaml

Создай файл `server/config.yaml` со следующим содержимым.
Подставь реальные значения вместо плейсхолдеров:

```yaml
port: "<ПОРТ>"
db_path: "./messenger.db"
media_dir: "./media"
jwt_secret: "<JWT_SECRET из шага 6>"
allowed_origin: "http://<ПУБЛИЧНЫЙ_IP>:<ПОРТ>"
behind_proxy: false
stun_url: "stun:stun.l.google.com:19302"
turn_url: ""
turn_secret: ""
server_name: "Messenger"
server_description: "Самохостируемый мессенджер"
registration_mode: "open"
admin_username: "admin"
admin_password: "<ПАРОЛЬ_АДМИНИСТРАТОРА>"
vapid_public_key: ""
vapid_private_key: ""
```

Примечания:
- `registration_mode`: `open` — регистрация открыта; `invite` — только по инвайт-коду; `request` — с одобрения администратора.
- `behind_proxy`: установи `true`, если сервер работает за Cloudflare или nginx.
- Поля FCM/APNs оставь пустыми — нужны только для мобильных push-уведомлений.

---

## Шаг 8. Создать директории

```bash
mkdir -p server/media
```

---

## Шаг 9. Собрать бинарник

```bash
cd server
go mod download
go build -o bin/server ./cmd/server
cd ..
```

Убедись, что файл `server/bin/server` создан и имеет права на выполнение.

---

## Шаг 10. Настроить автозапуск

### Linux — systemd (рекомендуется)

Создай файл `/etc/systemd/system/messenger.service`:

```ini
[Unit]
Description=Messenger Server
After=network.target

[Service]
Type=simple
User=<ТЕКУЩИЙ_ПОЛЬЗОВАТЕЛЬ>
WorkingDirectory=<ПОЛНЫЙ_ПУТЬ_К_ПАПКЕ>/server
ExecStart=<ПОЛНЫЙ_ПУТЬ_К_ПАПКЕ>/server/bin/server
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=HOME=<ДОМАШНЯЯ_ПАПКА>

[Install]
WantedBy=multi-user.target
```

Подставь реальные пути из шага 1. Затем:
```bash
sudo systemctl daemon-reload
sudo systemctl enable messenger
sudo systemctl start messenger
```

### macOS — launchd

Создай файл `~/Library/LaunchAgents/com.messenger.server.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.messenger.server</string>
  <key>ProgramArguments</key>
  <array>
    <string><ПОЛНЫЙ_ПУТЬ>/server/bin/server</string>
  </array>
  <key>WorkingDirectory</key>
  <string><ПОЛНЫЙ_ПУТЬ>/server</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/messenger.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/messenger-error.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.messenger.server.plist
```

---

## Шаг 11. Проверить запуск

**Linux:**
```bash
sudo systemctl status messenger
journalctl -u messenger -n 50
```

**macOS:**
```bash
cat /tmp/messenger.log
```

Убедись, что в логе нет `FATAL` и есть строка вида:
```
listening on :8080
```

---

## Шаг 12. Проверить доступность сервера

Проверь изнутри:
```bash
curl -s http://localhost:<ПОРТ>/api/server/info | head -c 200
```

Ожидаемый ответ — JSON с `server_name`, `registration_mode`.

Проверь снаружи:
```bash
curl -s http://<ПУБЛИЧНЫЙ_IP>:<ПОРТ>/api/server/info | head -c 200
```

Если внешний запрос не проходит — проверь firewall (шаг 5) и убедись, что хостинг-провайдер не блокирует порт.

---

## Шаг 13. Вывести итоговую сводку

После успешной проверки выведи пользователю сводку в следующем формате:

```
╔══════════════════════════════════════════════════╗
║           СЕРВЕР MESSENGER ЗАПУЩЕН               ║
╠══════════════════════════════════════════════════╣
║ URL сервера:  http://<IP>:<ПОРТ>                 ║
║ Панель admin: http://<IP>:<ПОРТ>  (роль admin)   ║
╠══════════════════════════════════════════════════╣
║ Логин администратора:  admin                     ║
║ Пароль администратора: <ПАРОЛЬ>                  ║
╠══════════════════════════════════════════════════╣
║ Режим регистрации:  open                         ║
║ Путь к БД:          server/messenger.db          ║
║ Медиафайлы:         server/media/                ║
║ Конфигурация:       server/config.yaml           ║
╠══════════════════════════════════════════════════╣
║ Для просмотра логов:                             ║
║   sudo journalctl -u messenger -f                ║
║ Для перезапуска:                                 ║
║   sudo systemctl restart messenger               ║
╚══════════════════════════════════════════════════╝

Как подключиться из приложения:
  1. Открой Messenger (web, desktop или mobile)
  2. На экране настройки сервера введи: http://<IP>:<ПОРТ>
  3. Зарегистрируйся или войди под учётными данными admin
```

---

## Устранение типичных проблем

**`JWT_SECRET is required`** — config.yaml не найден или поле пустое. Проверь путь и содержимое файла.

**`address already in use`** — порт занят. Смени `port` в config.yaml и повтори шаги 5, 10.

**`permission denied` при bind на порт < 1024** — используй порт >= 1024 или добавь capability:
```bash
sudo setcap cap_net_bind_service=+ep server/bin/server
```

**Внешний запрос не проходит, внутренний работает** — проверь firewall (шаг 5) и правила безопасности у хостинг-провайдера (Security Groups, Network ACL).

**Сервер не стартует после перезагрузки** — убедись, что `systemctl enable messenger` выполнен.
