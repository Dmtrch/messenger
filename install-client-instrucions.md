# Установка клиентов Messenger

Messenger доступен на пяти платформах. Выберите нужный вариант и следуйте инструкции.

---

## Быстрый выбор

| Платформа | ОС | Скрипт |
|---|---|---|
| PWA (браузер) | любая | [install-client-pwa.sh](#pwa--web-клиент) / [.bat](#pwa--web-клиент) |
| Android | Windows/macOS/Linux | [install-client-android.sh](#android) / [.bat](#android) |
| iOS | только macOS | [install-client-ios.sh](#ios) |
| Desktop Windows | Windows | [install-client-windows.bat](#desktop-windows) |
| Desktop macOS | macOS | [install-client-macos.sh](#desktop-macos) |
| Desktop Linux | Linux | [install-client-linux.sh](#desktop-linux) |

---

## Требования

Перед установкой убедитесь, что у вас уже развёрнут сервер Messenger.
Если нет — запустите `install-server.sh` (macOS/Linux) или `install-server.bat` (Windows).

---

## PWA — Web-клиент

**Самый простой способ.** Работает в любом современном браузере без установки.

### Быстрый старт (без сборки)

Если сервер уже запущен — PWA встроен в него автоматически.
Просто откройте URL сервера в браузере:

```
http://localhost:8080     (локально)
https://chat.example.com (при наличии домена)
```

**Установка как приложение:**
- **Chrome / Edge (Windows, macOS, Linux, Android):** кнопка установки в адресной строке (значок экрана со стрелкой вверх)
- **Safari (iOS/iPadOS):** Поделиться → «Добавить на экран "Домой"»
- **Safari (macOS):** Файл → «Добавить в Dock»

### Пересборка клиента из исходников

Используйте, если вносили изменения в `client/`:

```bash
# macOS / Linux
chmod +x install-client-pwa.sh
./install-client-pwa.sh

# Windows
install-client-pwa.bat
```

**Требования:** Node.js 18+, npm

**Что делает скрипт:**
1. `npm install` — установка зависимостей
2. `npm run build` — продакшн-сборка React + Vite → `client/dist/`
3. Копирование `dist/` в `server/static/` (опционально, с резервной копией)

---

## Android

Собирает APK из исходников и устанавливает на подключённое устройство.

```bash
# macOS / Linux
chmod +x install-client-android.sh
./install-client-android.sh

# Windows
install-client-android.bat
```

**Требования:**
- JDK 17+ ([adoptium.net](https://adoptium.net/))
- Android SDK / adb (опционально, только для автоустановки)
  - Входит в [Android Studio](https://developer.android.com/studio)
  - Или установите [Command Line Tools](https://developer.android.com/tools) отдельно

**Что делает скрипт:**
1. Проверяет JDK и adb
2. Запрашивает вариант сборки (Debug / Release)
3. `./gradlew assembleDebug` — сборка APK
4. `adb install -r app-debug.apk` — установка на устройство (если доступен adb)

**APK:** `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`

**Настройка устройства для adb:**
1. Настройки → О телефоне → 7 раз нажать «Номер сборки»
2. Настройки → Для разработчиков → Отладка по USB: включить
3. Подключить USB и разрешить отладку на устройстве

---

## iOS

Собирает iOS-клиент и устанавливает на симулятор (или открывает Xcode для устройства).

```bash
# Только macOS!
chmod +x install-client-ios.sh
./install-client-ios.sh
```

**Требования:**
- macOS (iOS-приложение невозможно собрать на Windows/Linux)
- Xcode 15+ из App Store
- Apple Developer аккаунт (только для реального устройства)

**Что делает скрипт:**
1. Проверяет macOS, Xcode, Swift
2. `swift package resolve` — загружает зависимости SPM
3. Собирает `MessengerCrypto` (проверка окружения)
4. Открывает `Package.swift` в Xcode для сборки полного UI
5. Опционально: `xcodebuild` + установка на симулятор

**Установка на реальное устройство:**
- Откройте `apps/mobile/ios/Package.swift` в Xcode
- Настройте Signing (Team + Bundle ID)
- Выберите устройство → Cmd+R

> **Windows:** запустите `install-client-ios.bat` — скрипт объяснит доступные альтернативы.

---

## Desktop Windows

Собирает Compose Multiplatform приложение и запускает MSI-установщик.

```bat
install-client-windows.bat
```

**Требования:**
- JDK 17+ ([adoptium.net](https://adoptium.net/))

**Что делает скрипт:**
1. Проверяет JDK и Gradle wrapper
2. `gradlew.bat packageMsi` — создаёт MSI-установщик
3. Запрашивает запуск установщика

**Результат:** `apps/desktop/build/compose/binaries/main/*.msi`

---

## Desktop macOS

Собирает Compose Multiplatform приложение в формат DMG или .app.

```bash
chmod +x install-client-macos.sh
./install-client-macos.sh
```

**Требования:**
- macOS
- JDK 17+ (`brew install --cask temurin` или [adoptium.net](https://adoptium.net/))

**Что делает скрипт:**
1. Проверяет JDK и Gradle wrapper
2. `./gradlew packageDmg` — создаёт DMG-образ
3. Предлагает открыть DMG или скопировать .app в /Applications/

**Результат:** `apps/desktop/build/compose/binaries/main/*.dmg`

---

## Desktop Linux

Собирает Compose Multiplatform приложение в формат DEB, RPM, AppImage или JAR.

```bash
chmod +x install-client-linux.sh
./install-client-linux.sh
```

**Требования:**
- Linux (Ubuntu, Fedora, Arch и другие)
- JDK 17+
  - Ubuntu/Debian: `sudo apt install openjdk-17-jdk`
  - Fedora/RHEL: `sudo dnf install java-17-openjdk-devel`
  - Arch: `sudo pacman -S jdk17-openjdk`

**Что делает скрипт:**
1. Определяет дистрибутив Linux
2. Выбирает подходящий формат пакета (DEB → RPM → AppImage → JAR)
3. Собирает через Gradle
4. Предлагает установить через dpkg/rpm или запустить AppImage

**Результат:** `apps/desktop/build/compose/binaries/main/`

---

## Первый запуск приложения

Независимо от платформы:

1. Откройте Messenger
2. На экране настройки введите URL вашего сервера, например:
   ```
   https://chat.example.com
   ```
   или для локального тестирования:
   ```
   http://localhost:8080
   ```
3. Зарегистрируйтесь или войдите

---

## Устранение типичных проблем

### JDK не найден
Убедитесь, что JDK добавлен в `PATH`. После установки откройте новый терминал.

```bash
java -version   # должно показать 17+
```

### Gradle не загружает зависимости
Проверьте доступ в интернет. Корпоративные прокси могут блокировать Maven Central.
Добавьте прокси в `~/.gradle/gradle.properties`:
```properties
systemProp.http.proxyHost=proxy.example.com
systemProp.http.proxyPort=8080
```

### Android: устройство не видно через adb
```bash
adb kill-server
adb start-server
adb devices
```
Убедитесь, что на устройстве разрешена отладка по USB.

### iOS: Xcode не открывается
```bash
xcode-select --install        # Command Line Tools
sudo xcode-select -r          # сбросить путь к Xcode
```

### PWA не устанавливается как приложение
PWA требует HTTPS для установки (исключение — localhost).
Настройте TLS-сертификат на сервере или используйте Cloudflare Tunnel.

---

## Структура проекта (клиентские части)

```
messenger/
├── client/                  # React PWA (TypeScript + Vite)
├── apps/
│   ├── desktop/             # Kotlin Compose Multiplatform Desktop
│   └── mobile/
│       ├── android/         # Kotlin + Jetpack Compose
│       └── ios/             # SwiftUI + Swift Package Manager
└── shared/native-core/      # Общий TypeScript runtime
```
