# План устранения замечаний по итогам аудита (2026-04-23)

Источник: отчёт «Что осталось сделать по проекту» от 2026-04-23.
Baseline commit: `51c4762` (feat(native+docs): Admin/Downloads/LinkDevice × 3 платформы…).

---

## Карта приоритетов

| Приоритет | Блок |
|---|---|
| P0 | #1 Push-уведомления Android (FCM) |
| P0 | #2 Push-уведомления iOS (APNs) |
| P1 | #3 Финализация `docs/main/` |
| P1 | #5 Тесты native-клиентов (минимальный smoke) |
| P2 | #6 Релиз-гейты: восстановить или задокументировать отказ |
| P3 | #4 Desktop Touch ID на macOS (опционально) |

---

## #1 Push-уведомления Android (FCM) — P0

**Контекст (ревизия 2026-04-23):** первоначальный план предполагал восстановление с нуля, но при инвентаризации выяснилось, что почти вся инфраструктура уже на месте (`MessengerFirebaseService`, Manifest, `ApiClient.registerNativePushToken`, `AppViewModel.registerFcmTokenIfAvailable`). Сервер принимает `POST /api/push/native/register` (`server/internal/push/handler.go:84`).

### Подзадачи
- **1.1 Решение о стратегии** — выбрано (a) FCM с `google-services.json`. _Зафиксировать в_ `docs/main/architecture.md` раздел «Push на Android» (pending).
- **1.2 Gradle-зависимости** — ✅ `firebase-messaging:24.0.0` подключён; `com.google.gms:google-services:4.4.2` авто-активируется при наличии `google-services.json` (`build.gradle.kts`).
- **1.3 MessengerFirebaseService** — ✅ `apps/mobile/android/src/main/kotlin/com/messenger/service/MessengerFirebaseService.kt`: `onNewToken` → SharedPreferences; `onMessageReceived` → `NotificationCompat` + deep-link через `PendingIntent` в `MainActivity`.
- **1.4 Manifest** — ✅ `<service android:name=".service.MessengerFirebaseService">` с `MESSAGING_EVENT`; `<uses-permission POST_NOTIFICATIONS>`.
- **1.5 Runtime-разрешение** — ✅ `MainActivity.kt`: `registerForActivityResult(RequestPermission())` + запрос `POST_NOTIFICATIONS` в `onCreate` на API 33+.
- **1.6 Регистрация токена** — ✅ `AppViewModel.registerFcmTokenIfAvailable` вызывается после login; `MessengerApp.primeFcmToken` явно запрашивает токен на старте (покрывает случай, когда `onNewToken` не срабатывает после переустановки).
- **1.7 Smoke-тест** — ⏳ требует реального Firebase-проекта, `google-services.json` в `apps/mobile/android/` и устройства/эмулятора. Проверить: (1) доставка push в фоне; (2) клик по уведомлению открывает приложение; (3) токен зарегистрирован на сервере после login.
- **1.8 Документация** — ⏳ добавить в `docs/main/architecture.md` и `docs/main/deployment.md` инструкции: как получить `google-services.json` (Firebase Console → Project Settings → Android app → `com.messenger`).

**Файлы (обновлено):**
`apps/mobile/android/build.gradle.kts`, `apps/mobile/android/src/main/AndroidManifest.xml`, `apps/mobile/android/src/main/kotlin/com/messenger/service/MessengerFirebaseService.kt`, `.../MessengerApp.kt`, `.../MainActivity.kt`, `.../service/ApiClient.kt`, `.../viewmodel/AppViewModel.kt`.

---

## #2 Push-уведомления iOS (APNs) — P0

**Контекст (ревизия 2026-04-23):** инвентаризация показала, что весь код обработки APNs уже в `App.swift` (`AppDelegate` с `requestAuthorization`, `didRegister`, `willPresent`), `AppViewModel.onAPNsTokenReceived` и `ApiClient.registerNativePushToken` готовы. Сейчас дошито активирование AppDelegate и deep-link. Xcode-проект по-прежнему отсутствует — его создание на стороне владельца.

### Подзадачи
- **2.1 `@UIApplicationDelegateAdaptor`** — ✅ подключён в `MessengerApp`; связка `vm → appDelegate.appViewModel` сделана через `.onAppear`.
- **2.2 AppDelegate (requestAuthorization, didRegister, willPresent)** — ✅ было реализовано ранее, не трогали.
- **2.3 Deep-link (`didReceive response`)** — ✅ добавлен: читает `userInfo["chatId"]` и пишет в `AppViewModel.pendingChatId`. _Не сделано:_ RootView пока не подписан на `pendingChatId` — переход при клике не выполняется автоматически (см. 2.5).
- **2.4 `registerApnsTokenIfAvailable()`** — ✅ читает `messenger.apns.token` из UserDefaults после `login()` и повторно регистрирует на сервере (симметрия с Android).
- **2.5 RootView deep-link integration** — ⏳ подписать `navPath` на `vm.pendingChatId` (`.onChange { chatId in navPath.append(AppRoute.chat(...)); vm.pendingChatId = nil }`). Блокируется тем, что нужно резолвить имя чата (лежит в `chatStore.chats`), что может запоздать.
- **2.6 `Messenger.entitlements`** — ✅ шаблон `aps-environment=development` создан в `apps/mobile/ios/Messenger.entitlements`. Для продакшена заменить на `production`.
- **2.7 Xcode-проект и capabilities** — ⏳ выполняет владелец:
  1. Открыть `apps/mobile/ios/Package.swift` в Xcode и создать App target (имя `Messenger`, bundle `com.messenger`).
  2. Добавить `Sources/Messenger/` в новый target; `MessengerApp` пометить `@main`.
  3. Signing & Capabilities → `Push Notifications`, `Background Modes → Remote notifications`.
  4. Assign entitlements-file: `apps/mobile/ios/Messenger.entitlements`.
  5. Перейти в Apple Developer Portal → Certificates → создать APNs Authentication Key (.p8), загрузить на сервер (VAPID не применим для iOS).
- **2.8 Smoke-тест** — ⏳ отправить push через APNs sandbox (pusher.app или curl через p8-jwt), проверить: (1) доставка background; (2) foreground banner; (3) deep-link (пока вручную — pendingChatId установлен, RootView допилить).

**Файлы (обновлено):**
`apps/mobile/ios/Sources/Messenger/App.swift`, `.../viewmodel/AppViewModel.swift`, `apps/mobile/ios/Messenger.entitlements` (новый).

**Проверка компилируемости:** `Sources/Messenger/` не входит в SwiftPM-таргеты (Package.swift экспортирует только `MessengerCrypto`), поэтому `swift build` не валидирует правки. Компиляция происходит при открытии в Xcode. SourceKit-ошибки в редакторе про `AppViewModel`/`AppErrorLogger`/`Sodium` — ожидаемые артефакты отсутствия Xcode-проекта, не регрессия.

---

## #3 Финализация `docs/main/` — P1

**Контекст:** Файлы переработаны по плану `docs-main-update-plan.md`, но чеклист не отмечен выполненным. Нужна сверка.

### Подзадачи
- **3.1 Сверка `architecture.md`** — проверить слои, компонентную диаграмму, потоки данных против `server/cmd/server/main.go` и `shared/native-core/`.
- **3.2 Сверка `technical-documentation.md`** — соответствие endpoints в `server/internal/*/handler.go` и `docs/api-reference.md`.
- **3.3 Сверка `usersguid.md`** — актуальные скриншоты/экраны с учётом новых AdminScreen/DownloadsScreen/LinkDeviceScreen.
- **3.4 Сверка `deployment.md`** — ENV-переменные против `server/cmd/server/config.go`, Docker Compose, VAPID, STUN/TURN, BEHIND_PROXY.
- **3.5 Внутренние ссылки** — проверить кросс-ссылки между файлами `docs/main/*` (grep `](./` и `](../`).
- **3.6 Обновление `docs/docs-main-update-plan.md`** — отметить пункты #2/#3/#6/#7/#8 как выполненные, дописать запись в журнале сессий.

**Файлы:**
`docs/main/architecture.md`, `.../technical-documentation.md`, `.../usersguid.md`, `.../deployment.md`, `docs/docs-main-update-plan.md`.

---

## #4 Desktop Touch ID на macOS — P3 (опционально)

**Контекст:** `apps/desktop/src/main/kotlin/ui/screens/BiometricGateScreen.kt:14` — единственный оставшийся TODO в native-коде.

### Подзадачи
- **4.1 JNA-биндинг** — добавить `net.java.dev.jna:jna-platform` в `apps/desktop/build.gradle.kts`.
- **4.2 Обёртка LAContext** — `LocalAuthentication.framework` через JNA: `LAContext.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)` и `evaluatePolicy(...)` с колбэком.
- **4.3 Интеграция в `BiometricGateScreen.kt`** — на macOS вызывать обёртку; на Linux/Windows — fallback на passphrase.
- **4.4 Smoke-тест** — ручная проверка на Mac с Touch ID.

**Файлы:**
`apps/desktop/build.gradle.kts`, `.../ui/screens/BiometricGateScreen.kt`, `apps/desktop/src/main/kotlin/biometric/MacOSTouchID.kt` (новый).

---

## #5 Тесты native-клиентов (минимальный smoke) — P1

**Контекст:** Нет ни одного unit/UI-теста для Desktop/Android/iOS клиентов.

### Подзадачи
- **5.1 Desktop (Kotlin Test)** — тесты для `ApiClient` (моки Ktor через `MockEngine`), `ChatStore` (typing-timer), `AppViewModel` (login/logout state). Таргет в `apps/desktop/build.gradle.kts`.
- **5.2 Android (JUnit4 + Compose)** — `ApiClient`, `SessionManager` (проверка, что plain-base64 fallback больше не возможен), UI-smoke для `AuthScreen` / `ChatScreen`.
- **5.3 iOS (XCTest)** — тесты для `ApiClient` (URLProtocol-моки), `AppViewModel.changePassword` error propagation, декодинг DTO (`AdminUserDto`, `DownloadArtifactDto`).
- **5.4 CI** — включить запуск тестов в `.github/workflows/build-native.yml`.

**Файлы:**
`apps/desktop/src/test/kotlin/`, `apps/mobile/android/src/test/kotlin/`, `apps/mobile/ios/Tests/MessengerTests/`, `.github/workflows/build-native.yml`.

---

## #6 Релиз-гейты: восстановить или отказаться — P2

**Контекст:** В коммите `51c4762` удалены `docs/release-checklist.md`, `docs/release-tag-instructions.md`, `docs/security-audit.md`, `docs/test-plan.md`, `docs/prd-alignment-*`. Решить судьбу этих документов.

### Подзадачи
- **6.1 Решение о формате** — зафиксировать в `docs/main/deployment.md` или `CLAUDE.md`: использовать release-checklist или нет. Если да — что в него входит.
- **6.2 Новый `docs/release-checklist.md`** (при выборе «восстановить») — минимально: пройден lint+type-check+test клиента, прошли smoke-тесты backend, собраны артефакты Desktop/Android/iOS, VAPID keys persisted, BEHIND_PROXY задокументирован.
- **6.3 Новый `docs/security-audit.md`** (при выборе «восстановить») — таблица threat-model (MITM, key-exfiltration, replay, DoS), контрмеры, известные ограничения (media encryption WIP).
- **6.4 Решение по `docs/test-plan.md`** — восстановить краткую версию (golden-path сценарии для 4 клиентов) или явно указать отсутствие.
- **6.5 Решение по `docs/prd-alignment-progress.md`** — удалить окончательно с записью в CHANGELOG или восстановить как «живой» документ. Учесть, что `2026-04-22-prd-audit.txt` содержит актуальный аудит на 65%.

**Файлы:**
`docs/release-checklist.md` (новый/удалённый), `docs/security-audit.md` (новый/удалённый), `docs/test-plan.md`, `docs/main/deployment.md`, `CHANGELOG.md`.

---

## Порядок исполнения (recommended)

1. **Неделя 1:** #1 + #2 (push на обоих мобильных). Блокирует UX parity с PWA.
2. **Неделя 1 (параллельно):** #3 (финализация `docs/main/`). Низкий риск, быстрый win.
3. **Неделя 2:** #5 (smoke-тесты), одновременно #6 (решение по релиз-гейтам).
4. **Когда-нибудь:** #4 (Touch ID), строго после стабилизации остального.

---

## Критерий завершения плана

- [ ] Push-уведомления доставляются и на Android, и на iOS, токен регистрируется на сервере, клик открывает нужный чат.
- [ ] Все четыре файла `docs/main/*.md` актуальны и их чеклист в `docs-main-update-plan.md` полностью закрыт.
- [ ] В `apps/{desktop,mobile/android,mobile/ios}` есть хотя бы минимальный набор тестов, CI проходит.
- [ ] Решено и зафиксировано, нужны ли `release-checklist.md` / `security-audit.md` / `test-plan.md`; если нужны — восстановлены.
- [ ] (Опционально) `BiometricGateScreen.kt:14` TODO закрыт.
