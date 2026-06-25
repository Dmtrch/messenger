# Публикация Messenger Server через Cloudflare Tunnel

Инструкция для домашнего сервера: даёт **валидный HTTPS-адрес** (`https://chat.example.com`),
работает **дома и вне дома**, **не требует «белого» IP** и проброса портов, скрывает
домашний IP. Подходит для iPhone/iPad (Safari требует HTTPS для установки PWA, push и звонков).

Схема работы:

```
[Телефон/ПК семьи]  →  https://chat.example.com  →  [Cloudflare]  ⇄ туннель ⇄  [cloudflared на сервере]  →  http://localhost:8080  →  Messenger Server
```

Cloudflare терминирует HTTPS снаружи; внутри туннель ходит к серверу по обычному `http://localhost:8080`,
поэтому **TLS-сертификаты на самом сервере не нужны**.

---

## 0. Предусловия

1. **Messenger Server запущен** и отвечает на `http://localhost:8080`
   (проверка: `http://localhost:8080/api/server/info` возвращает JSON).
2. **Свой домен**, добавленный в Cloudflare:
   - заведите аккаунт на <https://dash.cloudflare.com>;
   - купите домен (можно дешёвый, ~1–2 $/год у любого регистратора) и добавьте его в Cloudflare
     (Add a site), либо купите прямо в Cloudflare (Registrar);
   - смените NS-серверы домена на те, что выдаст Cloudflare (делается у регистратора, один раз);
   - дождитесь статуса домена **Active** в Cloudflare.
3. Бесплатного тарифа Cloudflare достаточно.

> Без своего домена постоянного адреса не получить — у Cloudflare есть только временные
> адреса `*.trycloudflare.com`, которые меняются при каждом запуске и для семьи не годятся.

---

## Выбор метода

- **Метод A — через дашборд (рекомендуется).** Туннель управляется из веб-панели Cloudflare,
  на сервер передаётся один токен. Проще всего, особенно для работы в виде службы на Windows.
- **Метод B — через CLI (`config.yml`).** Всё настраивается локально файлами конфигурации.
  Подходит тем, кто хочет хранить конфиг в репозитории/под контролем.

Ниже сначала установка `cloudflared` под каждую ОС, затем общие методы A/B.

---

## 1. Установка cloudflared

### Windows

Вариант 1 — через winget (PowerShell):

```powershell
winget install --id Cloudflare.cloudflared
```

Вариант 2 — вручную: скачать `cloudflared-windows-amd64.msi` со страницы релизов
<https://github.com/cloudflare/cloudflared/releases/latest> и установить.

Проверка (новое окно терминала, чтобы подхватился PATH):

```powershell
cloudflared --version
```

### Ubuntu

```bash
# Репозиторий Cloudflare
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list

sudo apt-get update
sudo apt-get install -y cloudflared

cloudflared --version
```

---

## 2. Метод A — настройка через дашборд (рекомендуется)

1. Откройте <https://one.dash.cloudflare.com> → **Networks → Tunnels → Create a tunnel**.
2. Тип коннектора: **Cloudflared** → задайте имя, например `messenger` → **Save**.
3. На шаге **Install connector** выберите свою ОС — Cloudflare покажет команду с токеном.
   Скопируйте **только токен** (длинная строка после `--token`) и выполните на сервере:

   **Windows (PowerShell от администратора):**
   ```powershell
   cloudflared.exe service install <ВАШ_ТОКЕН>
   ```

   **Ubuntu:**
   ```bash
   sudo cloudflared service install <ВАШ_ТОКЕН>
   ```

   Это установит и запустит `cloudflared` как **системную службу** (автозапуск при загрузке).

4. Вернитесь в дашборд → вкладка **Public Hostnames** → **Add a public hostname**:
   - **Subdomain:** `chat`
   - **Domain:** выберите ваш домен → итог: `chat.example.com`
   - **Type:** `HTTP`
   - **URL:** `localhost:8080`
   - **Save hostname**.

5. Через ~1 минуту откройте `https://chat.example.com` — должен открыться мессенджер.

DNS-запись `chat` создаётся автоматически. Чтобы добавить второй адрес (например, для админки) —
добавьте ещё один Public Hostname.

---

## 3. Метод B — настройка через CLI (`config.yml`)

Выполняется на сервере, где установлен `cloudflared`.

### 3.1. Авторизация

```bash
cloudflared tunnel login
```
Откроется браузер — выберите свой домен и подтвердите. Будет сохранён сертификат
(`~/.cloudflared/cert.pem`, на Windows — `%USERPROFILE%\.cloudflared\cert.pem`).

### 3.2. Создание туннеля

```bash
cloudflared tunnel create messenger
```
Команда выведет **Tunnel ID** (UUID) и создаст файл `<UUID>.json` с учётными данными
в каталоге `.cloudflared`.

### 3.3. Файл конфигурации

Создайте `config.yml` в каталоге `.cloudflared`:
- **Ubuntu:** `~/.cloudflared/config.yml` (для службы см. примечание ниже)
- **Windows:** `%USERPROFILE%\.cloudflared\config.yml`

```yaml
tunnel: messenger
credentials-file: /home/USER/.cloudflared/<UUID>.json   # Windows: C:\Users\USER\.cloudflared\<UUID>.json

ingress:
  - hostname: chat.example.com
    service: http://localhost:8080
  - service: http_status:404
```

### 3.4. Привязка DNS

```bash
cloudflared tunnel route dns messenger chat.example.com
```

### 3.5. Запуск как службы

**Ubuntu:**
```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```
> Примечание: служба на Ubuntu по умолчанию ищет конфиг в `/etc/cloudflared/config.yml`.
> Скопируйте туда ваш `config.yml` и `<UUID>.json`:
> ```bash
> sudo mkdir -p /etc/cloudflared
> sudo cp ~/.cloudflared/config.yml ~/.cloudflared/<UUID>.json /etc/cloudflared/
> sudo systemctl restart cloudflared
> ```

**Windows (PowerShell от администратора):**
```powershell
cloudflared.exe service install
```
> Примечание: служба Windows запускается от имени SYSTEM и ищет конфиг в
> `C:\Windows\System32\config\systemprofile\.cloudflared\`.
> Скопируйте туда `config.yml`, `<UUID>.json` и `cert.pem`:
> ```powershell
> $dst = "C:\Windows\System32\config\systemprofile\.cloudflared"
> New-Item -ItemType Directory -Force $dst | Out-Null
> Copy-Item "$env:USERPROFILE\.cloudflared\*" $dst -Force
> Restart-Service cloudflared
> ```

Проверка без службы (отладка, в переднем плане):
```bash
cloudflared tunnel run messenger
```

---

## 4. Настройка Messenger Server под внешний адрес

Чтобы инвайт-ссылки/QR, push и CORS использовали правильный внешний адрес, пропишите его
в `config.yaml` сервера.

- **Windows-установка:** `C:\ProgramData\Messenger\config.yaml`
- **Ручной запуск:** `config.yaml` рядом с бинарником.

Добавьте/измените:

```yaml
allowed_origin: "https://chat.example.com"
behind_proxy: true
```

- `allowed_origin` — внешний публичный адрес. Используется для CORS и для построения
  ссылок в QR-приглашениях (`https://chat.example.com/register?invite=КОД`).
- `behind_proxy: true` — сервер за обратным прокси (Cloudflare), доверять заголовкам
  `X-Forwarded-Proto`/`X-Forwarded-Host` при определении схемы и хоста.

После правки перезапустите сервер:

```powershell
# Windows (служба)
sc stop Messenger && sc start Messenger
```
```bash
# Ubuntu (если как systemd-служба)
sudo systemctl restart messenger
```

---

## 5. Проверка

1. С телефона (мобильный интернет, **не** домашний Wi-Fi) открыть `https://chat.example.com`
   — должна открыться PWA по HTTPS с замком.
2. iPhone: Safari → **Поделиться → На экран Домой** — устанавливается как приложение.
3. Android: появляется баннер/кнопка «Установить приложение».
4. Admin-панель: `https://chat.example.com/admin/login` → вкладка «Приглашения» →
   создать инвайт → QR ведёт на `https://chat.example.com/register?invite=КОД`.

---

## 6. Частые проблемы

| Симптом | Причина / решение |
|---|---|
| `502 Bad Gateway` от Cloudflare | Сервер не отвечает на `localhost:8080`. Проверьте, что служба Messenger запущена. |
| Служба `cloudflared` стартует, но сайт не открывается (Метод B) | Конфиг не там, где ищет служба. См. примечания в п. 3.5 (скопировать `config.yml`/`<UUID>.json`/`cert.pem`). |
| QR ведёт на `localhost` или внутренний IP | Не задан `allowed_origin` в `config.yaml`. См. п. 4. |
| На iPhone не ставится PWA / нет звонков | Открыто не по HTTPS, либо адрес не совпадает с `allowed_origin`. Проверьте, что заходите по `https://chat.example.com`. |
| Домен «не Active» в Cloudflare | NS-серверы домена ещё не переключены на Cloudflare (может занять до суток). |
| Нужно временно проверить без домена | `cloudflared tunnel --url http://localhost:8080` — выдаст временный `*.trycloudflare.com` (только для теста). |

---

## Полезные команды

```bash
cloudflared tunnel list                 # список туннелей
cloudflared tunnel info messenger       # состояние коннекторов
# Логи службы:
#   Ubuntu:  journalctl -u cloudflared -f
#   Windows: Просмотр событий → Журналы Windows → Приложение (источник cloudflared)
```
