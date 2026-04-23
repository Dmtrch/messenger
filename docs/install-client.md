# Установка клиентов Messenger

> Единый справочник по сборке, установке, запуску и настройке клиентов
> Messenger на разных операционных системах.

Поддерживаются четыре клиента:

| Клиент | Папка в репозитории | Где собирается | Где запускается |
|---|---|---|---|
| Web PWA | `client/` | Windows · macOS · Linux | Любой современный браузер + установка как PWA |
| Desktop (Kotlin Compose) | `apps/desktop/` | Windows · macOS · Linux | Windows · macOS · Linux |
| Mobile Android | `apps/mobile/android/` | Windows · macOS · Linux | Android 8.0+ (API 26+) |
| Mobile iOS | `apps/mobile/ios/` | **только macOS** | iOS 16+ |

> **Примечание.** Web PWA остаётся рекомендуемым дефолтным клиентом
> (наибольшее покрытие фич и самый быстрый цикл обновлений).
> Нативные клиенты — Desktop, Android, iOS — поддерживают полный набор
> сценариев мессенджера и распространяются через CI-сборки / `/downloads`.

---

## Содержание

- [1. Web PWA](#1-web-pwa)
  - [1.1. Windows 10/11](#11-windows-1011)
  - [1.2. macOS](#12-macos)
  - [1.3. Linux — Ubuntu / Debian](#13-linux--ubuntu--debian)
  - [1.4. Linux — Fedora / RHEL / CentOS](#14-linux--fedora--rhel--centos)
  - [1.5. Подключение к серверу](#15-подключение-к-серверу)
  - [1.6. Установка PWA на устройство](#16-установка-pwa-на-устройство)
  - [1.7. Production-развёртывание (nginx / Caddy)](#17-production-развёртывание-nginx--caddy)
- [2. Desktop (Kotlin Compose)](#2-desktop-kotlin-compose)
  - [2.1. Windows 10/11](#21-windows-1011)
  - [2.2. macOS](#22-macos)
  - [2.3. Linux](#23-linux)
  - [2.4. Конфигурация URL сервера](#24-конфигурация-url-сервера)
- [3. Mobile Android](#3-mobile-android)
  - [3.1. Windows 10/11](#31-windows-1011)
  - [3.2. macOS](#32-macos)
  - [3.3. Linux](#33-linux)
  - [3.4. Установка APK на устройство](#34-установка-apk-на-устройство)
  - [3.5. Push-уведомления (FCM)](#35-push-уведомления-fcm)
- [4. Mobile iOS (только macOS)](#4-mobile-ios-только-macos)
- [5. Устранение типичных проблем](#5-устранение-типичных-проблем)

---

## 1. Web PWA

Основной пользовательский клиент. Исходники: `client/`.

**Стек:** React 18 · Vite 8 · TypeScript 5.5 · Zustand · libsodium-wrappers · vite-plugin-pwa.

**Системные требования:**
- Node.js **18 LTS** или **20 LTS** (рекомендуется 20).
- npm 9+ (идёт с Node.js).
- Git.
- ~500 МБ свободного места для `node_modules` и артефактов сборки.
- Любой современный браузер (Chrome/Edge/Firefox/Safari) для тестирования.

**Режимы запуска:**
- **Dev-режим** — `npm run dev`, подходит для разработки, horizontal reload, прокси на `http://localhost:8080`.
- **Production-билд** — `npm run build`, результат в `client/dist/`. Статика раздаётся либо через встроенный Go-сервер (`server/cmd/server/static/`), либо через nginx/Caddy/любой статик-хостинг.

---

### 1.1. Windows 10/11

**Шаг 1. Установить Node.js и Git.**

Вариант A — установщики:
1. Скачать и установить Node.js LTS: <https://nodejs.org/en/download>
2. Скачать и установить Git: <https://git-scm.com/download/win>

Вариант B — через winget (PowerShell от имени администратора):
```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Проверить:
```powershell
node --version   # >= v18
npm --version    # >= 9
git --version
```

**Шаг 2. Клонировать репозиторий.**
```powershell
cd C:\Users\<USER>\source
git clone <URL-репозитория> messenger
cd messenger\client
```

**Шаг 3. Установить зависимости.**
```powershell
npm install
```
Результат — папка `client\node_modules\`.

**Шаг 4. Запустить в dev-режиме.**
```powershell
npm run dev
```
Откроется <http://localhost:3000>. Vite проксирует `/api`, `/ws`, `/media` на `http://localhost:8080` (настройка в `client/vite.config.ts`).

**Шаг 5. Собрать production-билд.**
```powershell
npm run build
```
Результат — статический сайт в `client\dist\`.

Для локальной проверки production-сборки:
```powershell
npm run preview
```

**Шаг 6. (опционально) Линт / проверки.**
```powershell
npm run type-check
npm run lint
npm run test
```

---

### 1.2. macOS

**Шаг 1. Установить Node.js и Git.**

Рекомендуется Homebrew:
```bash
# Если Homebrew не установлен:
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install node@20 git
brew link --overwrite node@20
```

Проверить:
```bash
node --version     # >= v18
npm --version
git --version
```

Альтернатива — nvm (если нужно несколько версий Node.js):
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.zshrc
nvm install 20
nvm use 20
```

**Шаг 2. Клонировать репозиторий.**
```bash
cd ~/projects
git clone <URL-репозитория> messenger
cd messenger/client
```

**Шаг 3. Установить зависимости и запустить dev-сервер.**
```bash
npm install
npm run dev
```
Откроется <http://localhost:3000>.

**Шаг 4. Production-сборка.**
```bash
npm run build     # артефакты в client/dist/
npm run preview   # локальный предпросмотр
```

---

### 1.3. Linux — Ubuntu / Debian

**Шаг 1. Установить Node.js 20 и Git.**
```bash
# Node.js 20 из официального NodeSource репозитория
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

node --version
npm --version
```

> Не используйте `apt install nodejs` без NodeSource — в стандартных репо
> Ubuntu 20.04/22.04 слишком старая версия Node.js.

**Шаг 2. Клонировать и собрать.**
```bash
cd ~/projects
git clone <URL-репозитория> messenger
cd messenger/client

npm install
npm run dev       # разработка: http://localhost:3000
# или
npm run build     # production: client/dist/
```

---

### 1.4. Linux — Fedora / RHEL / CentOS

**Шаг 1. Установить Node.js 20 и Git.**
```bash
# Fedora 38+
sudo dnf module install nodejs:20/common
sudo dnf install git

# RHEL/CentOS 9 / Rocky / Alma:
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo -E bash -
sudo dnf install -y nodejs git
```

Проверить:
```bash
node --version
npm --version
```

**Шаг 2. Собрать клиент.**
```bash
cd ~/projects
git clone <URL-репозитория> messenger
cd messenger/client

npm install
npm run build
```
Артефакты — `client/dist/`.

---

### 1.5. Подключение к серверу

Web-клиент определяет URL сервера в следующем порядке:

1. **Сохранённый URL** из localStorage (после первичной настройки через экран `/setup`).
2. **`window.location.origin`** по умолчанию (если клиент раздаётся встроенным Go-сервером — совпадает с адресом сервера автоматически).

**Как настроить сервер вручную:**

1. Открыть клиент в браузере (dev-режим: <http://localhost:3000>, production:
   адрес вашего развёртывания).
2. При первом запуске или в настройках выбрать «Подключиться к серверу» и
   ввести URL вида `https://chat.example.com` или `http://192.168.1.10:8080`.
3. URL сохраняется в localStorage; смена сервера доступна в разделе
   «Настройки → Сервер».

**Dev-режим с удалённым сервером.** По умолчанию Vite проксирует
`/api`, `/ws`, `/media` на `http://localhost:8080`. Если ваш сервер работает
на другом адресе, отредактируйте `client/vite.config.ts`:

```ts
server: {
  port: 3000,
  proxy: {
    '/api':   { target: 'https://chat.example.com', changeOrigin: true },
    '/ws':    { target: 'wss://chat.example.com',   ws: true, changeOrigin: true },
    '/media': { target: 'https://chat.example.com', changeOrigin: true }
  }
}
```

**Встроенный бандл.** Go-сервер умеет раздавать production-бандл
клиента как статику. При сборке Docker-образа (`Dockerfile` в корне репозитория)
Vite-билд копируется в `server/cmd/server/static/` и попадает в бинарь через
`go:embed`. В этом случае клиент всегда «знает» адрес сервера — он совпадает с
текущим origin.

---

### 1.6. Установка PWA на устройство

После того как клиент открыт в браузере, его можно установить как нативное
приложение. Работает для всех настольных ОС и Android; на iOS — через
«Добавить на экран “Домой”».

**Chrome / Edge (Windows · macOS · Linux · Android):**
- В адресной строке — значок «Установить приложение» (справа).
- Или меню → «Установить Messenger».
- Приложение появится в меню «Пуск» / Launchpad / drawer.

**Safari (macOS 14+):**
- Меню «Файл» → «Добавить в Dock».

**Safari (iOS / iPadOS):**
- Кнопка «Поделиться» → «На экран “Домой”».

**Firefox:**
- Поддерживает PWA-установку только через расширения; рекомендуется
  Chrome/Edge.

PWA кэширует статику и медиа (правила в `client/vite.config.ts` →
`workbox.runtimeCaching`), работает офлайн и получает Web Push через VAPID
ключ сервера.

---

### 1.7. Production-развёртывание (nginx / Caddy)

Если клиент раздаётся отдельно от Go-сервера (например, с CDN или статик-хоста).

**Собрать бандл на любой ОС:**
```bash
cd client
npm ci
npm run build
# Артефакт: client/dist/
```

**nginx (минимальный конфиг):**
```nginx
server {
    listen 443 ssl http2;
    server_name chat.example.com;

    ssl_certificate     /etc/letsencrypt/live/chat.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;

    root /var/www/messenger-client;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Прокси на Go-сервер
    location /api/   { proxy_pass http://127.0.0.1:8080; }
    location /media/ { proxy_pass http://127.0.0.1:8080; }
    location /ws     {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

Скопировать статику:
```bash
sudo cp -r client/dist/* /var/www/messenger-client/
```

**Caddy (автоматический TLS):**
```caddyfile
chat.example.com {
    root * /var/www/messenger-client
    try_files {path} /index.html
    file_server

    handle /api/*   { reverse_proxy 127.0.0.1:8080 }
    handle /media/* { reverse_proxy 127.0.0.1:8080 }
    handle /ws      { reverse_proxy 127.0.0.1:8080 }
}
```

> **Важно.** Если клиент и сервер на разных доменах — задайте
> `ALLOWED_ORIGIN=https://chat.example.com` в `.env` сервера, иначе
> WebSocket будет отклонён.

---

## 2. Desktop (Kotlin Compose)

Нативное настольное приложение на Kotlin + Compose Multiplatform. Исходники:
`apps/desktop/`.

**Стек:** Kotlin (JVM toolchain 17) · Compose Desktop · Ktor client · SQLDelight · Lazysodium · webrtc-java.

**Системные требования:**
- **JDK 17** (рекомендуется Temurin/Adoptium или Zulu).
- **Gradle 8.13** — поставляется в комплекте через Gradle Wrapper (`gradlew`/`gradlew.bat`), отдельная установка не нужна.
- Git.
- ~2 ГБ свободного места для Gradle-кеша и артефактов.

**Важные файлы:**
- `apps/desktop/build.gradle.kts` — конфигурация сборки и форматы дистрибутивов.
- `apps/desktop/gradle/wrapper/gradle-wrapper.properties` — версия Gradle.
- `apps/desktop/src/main/kotlin/Main.kt` — точка входа.

**Форматы дистрибутивов (`compose.desktop.application.nativeDistributions`):**
- `Dmg` — macOS
- `Msi` — Windows
- `Deb` — Debian/Ubuntu

---

### 2.1. Windows 10/11

**Шаг 1. Установить JDK 17 и Git.**

```powershell
winget install EclipseAdoptium.Temurin.17.JDK
winget install Git.Git
```

После установки перезапустить PowerShell и проверить:
```powershell
java -version   # openjdk version "17..."
javac -version
```

Если `JAVA_HOME` не установлен — установите:
```powershell
[System.Environment]::SetEnvironmentVariable(
  'JAVA_HOME',
  'C:\Program Files\Eclipse Adoptium\jdk-17.0.x-hotspot',
  'User'
)
```

**Шаг 2. Клонировать и собрать.**
```powershell
cd C:\Users\<USER>\source
git clone <URL-репозитория> messenger
cd messenger\apps\desktop

# Запуск из исходников
.\gradlew.bat run

# Сборка дистрибутива MSI
.\gradlew.bat packageMsi
```

Результат:
- `apps\desktop\build\compose\binaries\main\msi\Messenger-1.0.0.msi`

**Шаг 3. Установка.** Двойной клик по `Messenger-*.msi` → UAC → установка.
После установки ярлык появится в меню «Пуск» → «Messenger».

---

### 2.2. macOS

**Шаг 1. Установить JDK 17.**
```bash
brew install --cask temurin@17
# или Zulu:
# brew install --cask zulu@17
```

Проверить:
```bash
/usr/libexec/java_home -v 17
java -version
```

Добавить в `~/.zshrc` (если не установлено):
```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
export PATH="$JAVA_HOME/bin:$PATH"
```

**Шаг 2. Клонировать и собрать.**
```bash
cd ~/projects
git clone <URL-репозитория> messenger
cd messenger/apps/desktop

# Запуск из исходников
./gradlew run

# Сборка DMG
./gradlew packageDmg
```

Результат:
- `apps/desktop/build/compose/binaries/main/dmg/Messenger-1.0.0.dmg`

**Шаг 3. Установка.** Открыть DMG → перетащить «Messenger» в «Программы».
Первый запуск — правая кнопка → «Открыть» (приложение не подписано).

> Для подписания и нотаризации под Apple Developer ID настраивается блок
> `nativeDistributions { macOS { signing { ... } } }` в
> `apps/desktop/build.gradle.kts`.

---

### 2.3. Linux

Поддерживаемые дистрибутивы: Ubuntu/Debian (нативно через DEB), Fedora/RHEL
(через установку `.deb` в контейнере или самостоятельную упаковку).

**Шаг 1. Установить JDK 17 и Git.**

Ubuntu / Debian:
```bash
sudo apt update
sudo apt install -y openjdk-17-jdk git
```

Fedora / RHEL / CentOS 9+:
```bash
sudo dnf install -y java-17-openjdk-devel git
```

Проверить:
```bash
java -version
javac -version
```

**Шаг 2. Клонировать и собрать.**
```bash
cd ~/projects
git clone <URL-репозитория> messenger
cd messenger/apps/desktop

# Запуск из исходников
./gradlew run

# Сборка DEB (только на Linux)
./gradlew packageDeb
```

Результат:
- `apps/desktop/build/compose/binaries/main/deb/messenger_1.0.0-1_amd64.deb`

**Шаг 3. Установка на Ubuntu/Debian.**
```bash
sudo dpkg -i apps/desktop/build/compose/binaries/main/deb/messenger_*.deb
sudo apt-get install -f   # дотянуть зависимости, если нужно
messenger                 # запуск
```

**Шаг 4. Ярлык приложения.** После установки `.deb` создаётся
`.desktop`-файл в `/opt/messenger/lib/messenger-Messenger.desktop` →
приложение появится в Activities / App Menu.

**Fedora/RHEL без .deb.** Можно собрать «распакованный» формат:
```bash
./gradlew createDistributable
# Артефакт: apps/desktop/build/compose/binaries/main/app/Messenger/
./apps/desktop/build/compose/binaries/main/app/Messenger/bin/Messenger
```

---

### 2.4. Конфигурация URL сервера

Desktop-клиент принимает URL сервера двумя способами:

**Способ A — зашить при сборке (удобно для корпоративных дистрибутивов).**
Перед сборкой задать переменную `SERVER_URL`:

Windows PowerShell:
```powershell
$env:SERVER_URL = "https://chat.example.com"
.\gradlew.bat packageMsi
```

macOS / Linux:
```bash
SERVER_URL=https://chat.example.com ./gradlew packageDmg
```

Значение попадает в `BuildConfig.DEFAULT_SERVER_URL` (генерируется задачей
`generateBuildConfig` в `apps/desktop/build.gradle.kts:16-27`).

**Способ B — ввести при первом запуске.** Если `SERVER_URL` не задан при
сборке (по умолчанию пустой), приложение при старте покажет экран настройки с
полем для URL и проверкой доступности сервера.

URL сохраняется в локальной базе SQLDelight в стандартном каталоге:
- Windows: `%APPDATA%\Messenger\`
- macOS: `~/Library/Application Support/Messenger/`
- Linux: `~/.local/share/Messenger/`

---

## 3. Mobile Android

Android-клиент на Kotlin + Jetpack Compose. Исходники:
`apps/mobile/android/`.

**Стек:** Kotlin · Compose · Ktor client · SQLDelight · Lazysodium-Android · org.webrtc:google-webrtc · FCM (опционально).

**Системные требования:**
- JDK 17.
- Android SDK (API 35, min API 26).
- Gradle 8.13 через wrapper.
- Android Studio (рекомендуется **Hedgehog** или новее) **или** чистый `sdkmanager` + командная строка.
- Android-устройство (Android 8.0+) или эмулятор.

**Ключевые параметры сборки (`apps/mobile/android/build.gradle.kts`):**
- `compileSdk = 35`
- `minSdk = 26`  (Android 8.0)
- `targetSdk = 35`
- `applicationId = "com.messenger"`

**Выходные артефакты:**
- Debug APK: `apps/mobile/android/build/outputs/apk/debug/app-debug.apk`
- Release APK: `apps/mobile/android/build/outputs/apk/release/app-release.apk`

---

### 3.1. Windows 10/11

**Шаг 1. Установить JDK 17.**
```powershell
winget install EclipseAdoptium.Temurin.17.JDK
```

**Шаг 2. Установить Android Studio** (рекомендуется — включает SDK и эмулятор).
<https://developer.android.com/studio> → Next → Next → Finish.

При первом запуске Android Studio:
- SDK Manager → установить **Android 15.0 (API 35)**, **Android SDK Build-Tools 35.0.0**, **Android SDK Platform-Tools**, **Android Emulator** (если нужен).

SDK по умолчанию: `C:\Users\<USER>\AppData\Local\Android\Sdk`.

**Шаг 3. Настроить переменные окружения.**
```powershell
[System.Environment]::SetEnvironmentVariable('ANDROID_HOME', "$env:LOCALAPPDATA\Android\Sdk", 'User')
[System.Environment]::SetEnvironmentVariable('ANDROID_SDK_ROOT', "$env:LOCALAPPDATA\Android\Sdk", 'User')
```
Перезапустить PowerShell.

**Шаг 4. Сборка через командную строку.**
```powershell
cd C:\Users\<USER>\source\messenger\apps\mobile\android
.\gradlew.bat assembleDebug
```

Артефакт: `apps\mobile\android\build\outputs\apk\debug\app-debug.apk`.

**Шаг 5. Сборка release APK** (предварительно нужен keystore):
```powershell
.\gradlew.bat assembleRelease
```

---

### 3.2. macOS

**Шаг 1. Установить JDK 17.**
```bash
brew install --cask temurin@17
```

**Шаг 2. Установить Android Studio.**
```bash
brew install --cask android-studio
```

**Шаг 3. Настроить переменные окружения.** В `~/.zshrc`:
```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```
Применить: `source ~/.zshrc`.

**Шаг 4. Сборка.**
```bash
cd ~/projects/messenger/apps/mobile/android
./gradlew assembleDebug
```

Артефакт: `apps/mobile/android/build/outputs/apk/debug/app-debug.apk`.

---

### 3.3. Linux

**Шаг 1. Установить JDK 17 и unzip.**
```bash
# Ubuntu/Debian
sudo apt install -y openjdk-17-jdk unzip wget

# Fedora/RHEL
sudo dnf install -y java-17-openjdk-devel unzip wget
```

**Шаг 2. Установить Android command-line tools** (без Android Studio).
```bash
mkdir -p ~/Android/Sdk/cmdline-tools
cd ~/Android/Sdk/cmdline-tools
wget https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip -O tools.zip
unzip tools.zip
mv cmdline-tools latest
rm tools.zip

export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
echo 'export ANDROID_HOME="$HOME/Android/Sdk"'                                       >> ~/.bashrc
echo 'export ANDROID_SDK_ROOT="$ANDROID_HOME"'                                       >> ~/.bashrc
echo 'export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"' >> ~/.bashrc
```

**Шаг 3. Установить SDK-пакеты и принять лицензии.**
```bash
yes | sdkmanager --licenses
sdkmanager "platforms;android-35" "build-tools;35.0.0" "platform-tools"
```

**Шаг 4. Сборка.**
```bash
cd ~/projects/messenger/apps/mobile/android
./gradlew assembleDebug
```

Артефакт: `apps/mobile/android/build/outputs/apk/debug/app-debug.apk`.

---

### 3.4. Установка APK на устройство

**Через adb (все ОС).**

1. Включить на устройстве «Режим разработчика» и «Отладку по USB»
   (Настройки → О телефоне → 7 раз тапнуть по «Номер сборки» → Настройки →
   Для разработчиков → «Отладка по USB»).
2. Подключить устройство USB-кабелем.
3. Установить APK:
```bash
adb devices                                      # убедиться, что устройство видно
adb install -r apps/mobile/android/build/outputs/apk/debug/app-debug.apk
```

**Вручную.** Скопировать `app-debug.apk` на устройство (email/облако/USB-storage) и
открыть его в файловом менеджере — Android предложит установить. Потребуется
разрешение «Установка из неизвестных источников» для файлового менеджера.

**URL сервера.** Аналогично Desktop:
- При сборке: `SERVER_URL=https://chat.example.com ./gradlew assembleDebug`
  → значение попадает в `BuildConfig.SERVER_URL`
  (`apps/mobile/android/build.gradle.kts:20`).
- Если не задан — приложение покажет экран настройки при первом запуске.

---

### 3.5. Push-уведомления (FCM)

Push работают через Firebase Cloud Messaging. Они **опциональны**: без
`google-services.json` приложение собирается и работает, но push приходят
только когда клиент открыт (через WebSocket).

**Чтобы включить FCM:**
1. Создать проект Firebase: <https://console.firebase.google.com>.
2. Добавить Android-приложение с `applicationId = com.messenger`.
3. Скачать `google-services.json`.
4. Положить файл в `apps/mobile/android/google-services.json`.
5. Пересобрать APK.

На стороне сервера нужен FCM Server Key в `.env` (`FCM_LEGACY_KEY=...`).

---

## 4. Mobile iOS (только macOS)

Нативное приложение на SwiftUI. Исходники: `apps/mobile/ios/`.

**Стек:** Swift · SwiftUI · GRDB.swift · swift-sodium · WebRTC · Swift Package Manager.

**Системные требования (строго):**
- **macOS 14 (Sonoma) или новее.**
- **Xcode 15+** из App Store (или Xcode Command Line Tools для SPM-сборки).
- Apple ID (для свободной подписи на своё устройство) или Apple Developer Program ($99/год для распространения).
- iPhone / iPad с iOS 16+ для установки на устройство.

**Шаг 1. Установить Xcode.**
```bash
# Вариант 1 — App Store (рекомендуется).
# Вариант 2 — только Command Line Tools (для CI, SPM):
xcode-select --install
```

**Шаг 2. Клонировать репозиторий.**
```bash
cd ~/projects
git clone <URL-репозитория> messenger
cd messenger/apps/mobile/ios
```

**Шаг 3. Открыть проект в Xcode.**
```bash
open Messenger.xcodeproj
# или, если используется workspace:
# open Messenger.xcworkspace
```
Xcode автоматически подтянет Swift-пакеты (GRDB.swift, swift-sodium) в `.build/`.

**Шаг 4. Настроить signing.**
В Xcode:
- Выбрать таргет `Messenger` → **Signing & Capabilities**.
- **Team** — выбрать свою команду (личная Apple ID допустима для запуска на
  личном устройстве).
- **Bundle Identifier** — при необходимости изменить на уникальный (например,
  `com.yourname.messenger`), если запускаете на личный Apple ID.

**Шаг 5. Запуск на симуляторе.**
- В тулбаре Xcode выбрать схему `Messenger` → симулятор (например,
  «iPhone 15 Pro»).
- Нажать **Cmd+R** (Run).

**Шаг 6. Запуск на физическом устройстве.**
1. Подключить iPhone/iPad USB-кабелем.
2. Доверить компьютеру (на устройстве).
3. В Xcode выбрать подключённое устройство как destination.
4. **Cmd+R**.
5. На устройстве: Настройки → Основные → Управление VPN и устройствами →
   доверять профилю разработчика.

**Шаг 7. Сборка из командной строки (для CI).**
```bash
cd apps/mobile/ios
xcodebuild \
  -scheme Messenger \
  -destination 'generic/platform=iOS' \
  -configuration Release \
  archive -archivePath build/Messenger.xcarchive

xcodebuild \
  -exportArchive \
  -archivePath build/Messenger.xcarchive \
  -exportPath build/ipa \
  -exportOptionsPlist ExportOptions.plist
```
Результат: `apps/mobile/ios/build/ipa/Messenger.ipa`.

**URL сервера.** Как и на Android — либо задаётся в коде до сборки,
либо вводится на экране настройки при первом запуске (проверьте текущую
реализацию в `apps/mobile/ios/Messenger/Views/SetupView.swift`).

---

## 5. Устранение типичных проблем

### Web-клиент

**`EACCES`/`EPERM` при `npm install` на Linux.** Не запускайте `npm` под
`sudo`. Используйте nvm или переназначьте права:
```bash
sudo chown -R $(id -u):$(id -g) ~/.npm ~/projects/messenger/client/node_modules
```

**Ошибка `Cannot find module 'libsodium-wrappers'` при `npm run dev`.**
`libsodium-wrappers` ESM-билд содержит сломанный импорт — Vite перенаправляет
его на CJS через плагин в `vite.config.ts` (`libsodiumCjsPlugin`). Если после
обновления зависимостей ошибка вернулась — переустановите с чистым кешем:
```bash
rm -rf node_modules package-lock.json
npm install
```

**WebSocket не подключается в dev-режиме.** Проверьте, что сервер работает на
`http://localhost:8080` и что в `vite.config.ts` прокси `/ws` направлен на
`ws://localhost:8080`. Для удалённого сервера используйте `wss://…` и задайте
`ALLOWED_ORIGIN` на сервере.

**PWA не обновляется после редеплоя.** Vite-PWA стратегия `autoUpdate`
скачивает обновлённый `sw.js` в фоне; применится при следующем холодном старте.
Форсировать: DevTools → Application → Service Workers → «Unregister».

---

### Desktop

**`Could not find or load main class MainKt`.** Скорее всего JDK < 17 или
`JAVA_HOME` указывает не на JDK 17. Проверьте:
```bash
./gradlew --version
# JVM: 17.0.x — правильно
```

**На macOS: «Приложение повреждено, невозможно открыть».** Приложение не
подписано. Разблокируйте:
```bash
xattr -dr com.apple.quarantine "/Applications/Messenger.app"
```

**`packageDmg` на Linux / `packageDeb` на macOS.** Compose Desktop умеет
паковать только под текущую ОС. Собирайте DMG на macOS, MSI на Windows, DEB
на Linux. Для кросс-сборки используйте CI с matrix-джобами.

**WebRTC: `UnsatisfiedLinkError` при запуске.** `webrtc-java` подбирает
нативную библиотеку по `os.name`/`os.arch` в `build.gradle.kts:56-70`.
На экзотической архитектуре (например, FreeBSD) сборка потребует
ручной правки `nativeClassifier`.

---

### Android

**`SDK location not found`.** Не установлен `ANDROID_HOME` или нет файла
`apps/mobile/android/local.properties`. Создайте его:
```properties
sdk.dir=/home/user/Android/Sdk
```

**`Failed to find Build Tools revision 35.0.0`.** Установите через
`sdkmanager "build-tools;35.0.0"`.

**`Execution failed for task ':processDebugGoogleServices'`.** Отсутствует
`google-services.json`. Либо добавьте файл, либо временно отключите FCM — в
текущей конфигурации `com.google.gms.google-services` плагин инициализируется
«gracefully» (не падает). Если всё-таки падает — закомментируйте его в
`build.gradle.kts`.

**APK не ставится: «App not installed as package appears to be invalid».**
Проверьте подпись: debug-APK подписан дебаг-ключом автоматически; release-APK
требует явный keystore (`signingConfig release { ... }`).

---

### iOS

**«No account for team XXXX».** Добавьте Apple ID в Xcode → Settings →
Accounts, затем выберите команду в Signing & Capabilities.

**«Untrusted Developer» на устройстве.** Настройки → Основные → Управление
VPN и устройствами → доверять сертификату разработчика.

**`xcodebuild: error: Could not locate device`.** Проверьте, что устройство
разблокировано и в Xcode → Window → Devices and Simulators помечено как
готовое.

**Swift Packages не резолвятся.** Xcode → File → Packages → Reset Package
Caches.

---

## Дополнительные ссылки

- [`README.md`](../README.md) — быстрый старт всего проекта.
- [`install-server.md`](../install-server.md) — установка сервера вручную.
- [`install-server.sh`](../install-server.sh) / [`install-server.bat`](../install-server.bat) —
  автоматические установщики сервера под Docker.
- [`docs/api-reference.md`](api-reference.md) — REST/WS API.
- [`apps/desktop/README.md`](../apps/desktop/README.md) — доп. заметки по Desktop.
- [`apps/mobile/android/README.md`](../apps/mobile/android/README.md) — доп. заметки по Android.
