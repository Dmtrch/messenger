# Установка сервера Messenger на Windows 11

## Что в итоге получите

- Сервер Messenger работает как **Windows-сервис** (запускается автоматически при старте ОС)
- Доступ к Admin-панели через браузер
- Все данные хранятся в `C:\ProgramData\Messenger\`

---

## Вариант А — Нативный установщик (без Docker) ✅ Рекомендуется

### Шаг 1. Установите необходимые программы

| Программа | Версия | Ссылка |
|-----------|--------|--------|
| Go | 1.23+ | https://go.dev/dl/ |
| Node.js | 18+ | https://nodejs.org/ |
| Inno Setup | 6+ | https://jrsoftware.org/isdl.php |
| Git | любая | https://git-scm.com/ |

После установки откройте **новый** терминал PowerShell и проверьте:

```powershell
go version      # go version go1.23.x windows/amd64
node --version  # v18.x.x или выше
git --version   # git version 2.x.x
```

Inno Setup устанавливается стандартным мастером — проверять в терминале не нужно.

---

### Шаг 2. Скачайте исходный код

```powershell
git clone <URL_репозитория> messenger
cd messenger
```

---

### Шаг 3. Соберите установщик

Запустите в PowerShell **из корневой папки репозитория**:

```powershell
.\scripts\build-windows-installer.ps1
```

Скрипт выполнит:
1. Сборку React-клиента (`npm run build`)
2. Компиляцию Go-бинарника для Windows
3. Создание `.exe`-установщика через Inno Setup

Результат: `scripts\dist\messenger-server-setup.exe`

Если клиент уже собран ранее, можно ускорить сборку:

```powershell
.\scripts\build-windows-installer.ps1 -SkipClient
```

---

### Шаг 4. Запустите установщик

1. Найдите файл `scripts\dist\messenger-server-setup.exe`
2. **Правая кнопка мыши → «Запуск от имени администратора»**
3. Пройдите мастер установки:

**Экран «Настройка сервера»:**
- **Имя сервера** — название, которое видят пользователи (например: `Мой Messenger`)
- **Описание** — краткое описание сервера
- **Порт** — оставьте `8080` если не занят
- **Публичный URL** — заполните только если сервер будет доступен извне  
  (например: `https://chat.example.com`). Если только локально — оставьте пустым.

**Экран «Учётная запись администратора»:**
- Придумайте логин и пароль администратора
- Пароль должен быть не менее 8 символов

**Экран «Режим регистрации»:**
- **Открытый** — любой может создать аккаунт (для внутреннего использования)
- **По приглашению** — только с инвайт-кодом от администратора
- **С одобрения** — администратор одобряет каждую заявку

**Выбор папки установки:** можно оставить по умолчанию `C:\Program Files\Messenger\`

4. Нажмите **«Установить»** и дождитесь окончания.  
   Установка занимает ~30 секунд (из них ~15 сек — генерация VAPID-ключей).

---

### Шаг 5. Проверьте работу сервера

После завершения установки:

1. Откроется файл `server-main.txt` с данными администратора — **сохраните его**.

2. Проверьте статус сервиса в PowerShell:

```powershell
sc query Messenger
```

Должно быть `STATE: RUNNING`.

3. Откройте в браузере:

```
http://localhost:8080
```

Должна открыться страница входа в Messenger.

4. Откройте Admin-панель:

```
http://localhost:8080/admin/
```

Войдите с логином и паролем администратора, которые указали при установке.

---

### Управление сервисом

```powershell
# Запустить
sc start Messenger

# Остановить
sc stop Messenger

# Статус
sc query Messenger

# Перезапустить
sc stop Messenger; Start-Sleep 3; sc start Messenger
```

Или через меню «Пуск» → ярлык **«Управление сервисом»**.

Также можно управлять через `services.msc` — найдите службу **Messenger Server**.

---

### Файлы и папки

| Путь | Назначение |
|------|-----------|
| `C:\Program Files\Messenger\messenger.exe` | Бинарник сервера |
| `C:\ProgramData\Messenger\config.yaml` | Конфигурация |
| `C:\ProgramData\Messenger\data\messenger.db` | База данных |
| `C:\ProgramData\Messenger\data\media\` | Медиафайлы |
| `C:\ProgramData\Messenger\logs\` | Логи сервера |
| `C:\Program Files\Messenger\server-main.txt` | Данные администратора |

---

### Ручное редактирование конфигурации

Конфигурация хранится в `C:\ProgramData\Messenger\config.yaml`.  
После изменения — перезапустите сервис:

```powershell
sc stop Messenger; Start-Sleep 3; sc start Messenger
```

Пример добавления TURN-сервера:

```yaml
turn_url: "turn:turn.example.com:3478"
turn_secret: "ваш_секрет"
```

---

### Резервное копирование

```powershell
# Остановить сервис
sc stop Messenger

# Скопировать данные
Copy-Item "C:\ProgramData\Messenger\data\messenger.db" "D:\backup\messenger-$(Get-Date -Format 'yyyyMMdd').db"

# Запустить сервис
sc start Messenger
```

---

### Обновление сервера

1. Обновите исходный код: `git pull`
2. Пересоберите установщик: `.\scripts\build-windows-installer.ps1`
3. Запустите новый `messenger-server-setup.exe` — установщик обновит бинарник  
   и перезапустит сервис. Данные и конфигурация сохранятся.

---

### Удаление

«Пуск» → «Установка и удаление программ» → найдите **Messenger Server** → Удалить.

Или через меню Пуск → группа Messenger Server → «Удалить Messenger Server».

> **Данные** в `C:\ProgramData\Messenger\` при удалении **не удаляются** — сделайте резервную копию или удалите вручную.

---

## Вариант Б — Docker (если Go/Node.js не хотите устанавливать)

### Шаг 1. Установите Docker Desktop

Скачайте с https://www.docker.com/products/docker-desktop/ и установите.  
Запустите Docker Desktop и дождитесь значка в трее.

### Шаг 2. Скачайте репозиторий

```powershell
git clone <URL_репозитория> messenger
cd messenger
```

### Шаг 3. Запустите установку

Правая кнопка мыши на `install-server.bat` → **«Запуск от имени администратора»**.

Следуйте мастеру. Сервер запустится в Docker-контейнере.

### Управление (Docker)

```powershell
docker compose start    # запуск
docker compose stop     # остановка
docker compose restart  # перезапуск
docker compose logs -f  # просмотр логов
```

---

## Устранение типичных проблем

### Порт 8080 занят

Измените порт в конфигурации или при установке укажите другой (например, 8081).  
Не забудьте обновить правило брандмауэра:

```powershell
netsh advfirewall firewall delete rule name="Messenger Server"
netsh advfirewall firewall add rule name="Messenger Server" dir=in action=allow protocol=TCP localport=8081
```

### Сервис не запускается

Проверьте логи:

```powershell
Get-Content "C:\ProgramData\Messenger\logs\errors.log" -Tail 50
```

### Admin-панель не открывается

Убедитесь, что сервис запущен (`sc query Messenger`) и брандмауэр разрешает подключение.

### Ошибка «Access Denied» при установке

Обязательно запускайте установщик от имени администратора (правая кнопка мыши).
