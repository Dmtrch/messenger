# План на следующую сессию

Актуально на: 2026-04-15
Ветка: `main`

## Текущий статус

Priority 3 — **ЗАВЕРШЕНО** (CALLS-B: все 4 задачи выполнены, `assembleDebug` + `testDebugUnitTest` зелёные).

**В текущей сессии выполнено:**
- ✅ MEDIA-8: E2E передача файлов Android — XSalsa20 через lazysodium, Coil EncryptedMediaFetcher, inline изображения, карточка скачивания, DB schema v2
  - `./gradlew test` → BUILD SUCCESSFUL (7 тестов)
  - `./gradlew assembleDebug` → BUILD SUCCESSFUL
- ✅ MEDIA-9: E2E передача файлов Desktop — XSalsa20 через lazysodium-java, AWT FileDialog, inline image (SkiaImage), FileCard + download dialog, DB миграция v1→v2
  - `./gradlew build` → BUILD SUCCESSFUL
- ✅ CALLS-A: WebRTC Step A (Signaling + UI) — Desktop + Android
  - WS-сигнализация: `call_offer`, `call_answer`, `call_end`, `call_reject` (stub SDP)
  - `CallOverlay.kt` (Desktop + Android): IncomingCall / OutgoingCall / ActiveCall
  - Кнопка 📞 в TopAppBar, `CallState` machine (`IDLE→RINGING_IN/OUT→ACTIVE→IDLE`)
  - `GET /api/calls/ice-servers` в `ApiClient.kt`
  - `./gradlew assembleDebug` → BUILD SUCCESSFUL (Android)
- ✅ CALLS-B / Task 1: Android signaling contracts зафиксированы
- ✅ CALLS-B / Task 2: AndroidWebRtcController + real SDP/ICE wiring
- ✅ CALLS-B / Task 3: CallState flags (hasLocalVideo/hasRemoteVideo) + AndroidVideoRendererBinding
- ✅ CALLS-B / Task 4: Video UI — SurfaceViewRenderer в CallOverlay (remote fullscreen + local inset)
  - Android переведён на flat WS contract для `call_offer`, `call_answer`, `ice_candidate`
  - `WSOrchestrator` парсит `sdp`, `isVideo`, ICE-поля через типизированные signaling models
  - `AppViewModel` больше не держит `stub-sdp` в контрактных test paths; исходящий `call_offer` включает `isVideo`
  - Добавлены guards против фантомного call state без транспорта
  - Локальная проверка: `cd apps/mobile/android && ./gradlew testDebugUnitTest --tests com.messenger.viewmodel.AppViewModelCallSignalingTest --tests com.messenger.service.WSOrchestratorCallSignalingTest` → BUILD SUCCESSFUL

**Ранее завершено:**
- ✅ MSG-9: Reply (DB migration #15, WS, REST, shared/native-core, UI)
- ✅ E2E-7: Предупреждение при смене IK
- ✅ E2E-6: Safety Number
- ✅ MEDIA-7: файл удаляется при удалении сообщения
- ✅ MSG-6: presence broadcast

## Приоритеты выполнения

### Приоритет 3 — Нативные приложения (Desktop + Android)

**Передача файлов Android** ✅ ЗАВЕРШЕНО

**Передача файлов Desktop** ✅ ЗАВЕРШЕНО
- Кнопка 📎 (AWT FileDialog), XSalsa20 через lazysodium-java, multipart upload, inline image + FileCard + download dialog
- DB миграция schema v1→v2 (4 media-колонки), `PRAGMA user_version` в DatabaseProvider

**Звонки WebRTC Step A** ✅ ЗАВЕРШЕНО (Desktop + Android)
- WS-сигнализация, `CallOverlay`, кнопка вызова, stub SDP
- Desktop: `CallOverlay.kt`, `App.kt`, `ChatWindowScreen.kt`, `AppViewModel.kt`, `WSOrchestrator.kt`
- Android: аналогичный набор файлов

**Звонки WebRTC Step B** — **в работе**

**Task 1: signaling contracts** ✅ ЗАВЕРШЕНО
- Flat WS contract для Android (`call_offer`, `call_answer`, `ice_candidate`)
- Типизированные signaling models + callbacks в `WSOrchestrator`
- Контрактные Android unit tests на offer/answer/isVideo/ICE и guard'ы без транспорта

**Task 2: real Android WebRTC controller + SDP/ICE wiring** ✅ ЗАВЕРШЕНО
- `AndroidWebRtcController.kt` — `PeerConnectionFactory`, `createOffer/Answer`, ICE
- `AppViewModel` — `pendingIncomingOffers`, controller bridge, signaling callbacks
- `WSOrchestrator` — `onCallOffer/Answer/IceCandidate` callbacks
- `build.gradle.kts` — `org.webrtc:google-webrtc:1.0.32006`

**Task 3: state flags + renderer binding** ✅ ЗАВЕРШЕНО
- `CallState` — `hasLocalVideo`, `hasRemoteVideo`, `errorText`
- `ChatStore` — `markLocalVideoReady()`, `markRemoteVideoReady()`
- `AndroidVideoRendererBinding.kt` — holder `EglBase + renderer refs + release()`
- `AndroidWebRtcController` — `onLocalVideoReady`/`onRemoteVideoReady` callbacks, `bindRenderers()`
- `AppViewModel` — передаёт callbacks в controller
- `ChatStoreCallStateTest.kt` — 5 тестов, зелёные

**Task 4: video UI (`SurfaceViewRenderer`)** ✅ ЗАВЕРШЕНО
- `CallOverlay.kt` — `AndroidView(SurfaceViewRenderer)` remote fullscreen + local inset 120×180dp
- `App.kt` — `remember { AndroidVideoRendererBinding() }`, передаётся при `isVideo`
- `AppViewModel.bindVideoRenderers()` — вызывается из overlay после первого фрейма
- `assembleDebug` + `testDebugUnitTest` → BUILD SUCCESSFUL

---

### Приоритет 4 — iOS ✅ MVP Закрыт

**Выполнено в текущей сессии:**
- Package.swift (swift-sodium 0.9.1, GRDB.swift 6.27.0, Clibsodium)
- `crypto/`: X3DH.swift, Ratchet.swift, SenderKey.swift, KeyStorage.swift + CryptoTests
- `db/DatabaseManager.swift` — GRDB schema v2 (4 media-колонки), versioned DatabaseMigrator
- `service/`: ApiClient.swift (URLSession actor, auto-refresh), WSOrchestrator.swift (WebSocket + backoff), TokenStore.swift
- `store/ChatStore.swift` — @MainActor ObservableObject, полный набор методов
- `viewmodel/AppViewModel.swift` — связывает все слои, call signaling, outbox fallback
- `ui/screens/`: ServerSetupScreen, AuthScreen, ChatListScreen, ChatWindowScreen (MessageBubble, FileCard, TypingIndicator), ProfileScreen
- `App.swift` — NavigationStack, CallOverlay, AppRoute

**Структура:** 20 файлов в `apps/mobile/ios/Sources/Messenger/` + тест

**Для запуска:**
```bash
# Открыть в Xcode: File → Open → apps/mobile/ios/
# Создать iOS App target → добавить Sources/Messenger/ → добавить @main к MessengerApp
# swift test  — тестирует крипто без Xcode
```

**Реализовано в этой сессии:**
- ✅ Полный E2E crypto flow (`SessionManager.swift` — Double Ratchet + X3DH web-compatible)
- ✅ Push notifications (APNs) — сервер + iOS AppDelegate + token registration
- ✅ Push notifications (FCM) — сервер + Android `MessengerFirebaseService` + token registration
- ✅ `swift test` — все 6 crypto тестов зелёные

**Реализовано в текущей сессии:**
- ✅ WebRTC/видеозвонки на iOS — `iOSWebRtcController`, real SDP/ICE, `RTCMTLVideoView`

## Что уже завершено и не трогать повторно

- `apps/mobile/android/` — полный MVP + file transfer + call signaling (Step A+B) + FCM push, `assembleDebug` + `testDebugUnitTest` зелёные
- `apps/desktop/` — полный MVP + file transfer + call signaling (Step A), `./gradlew build` зелёный
- `apps/mobile/ios/` — MVP + APNs push + WebRTC CALLS-B завершён: полный E2E crypto, REST/WS, GRDB v2, все экраны, APNs push, `iOSWebRtcController` + RTCMTLVideoView; `swift test` 8/8 зелёных
- `shared/native-core/` — runtime modules, web adapters, call stack
- `client/` web PWA — все фичи до этапа 12 включительно
- `server/` Go backend — все миграции #1–16 (включая `native_push_tokens`)

## Ключевые решения Android (справка)

- `lazysodium-android:5.1.0` (production, JNI) + `lazysodium-java:5.1.4` (тесты JVM, JNA)
- Crypto-классы принимают `LazySodium` (abstract superclass) — тестируемы без Android runtime
- `security-crypto` (EncryptedSharedPreferences) недоступен из Google Maven в dev-среде → plain SharedPreferences + TODO comment
- `ChatListViewModel` / `ChatWindowViewModel` инстанциируются через `remember {}` (не `viewModel()`)
- DB schema v2: 4 nullable media-колонки в `message`, миграция `1.sqm`
- Coil `EncryptedMediaFetcher` — кастомный fetcher, расшифровывает медиа на лету через `ApiClient.fetchDecryptedMedia`
- CALLS-B Task 1: Android call signaling канонизирован как flat WS payload, синхронизирован с Desktop/server
- Для Task 2 pending incoming `offerSdp` хранить вне `CallState`, не смешивать UI state и signaling payload

## Ключевые решения Desktop (справка)

- `lazysodium-java:5.1.4` (JNA) — тот же API, что на Android; `LazySodiumJava(SodiumJava())` внутри `ApiClient`
- DB миграция через `PRAGMA user_version`: 0 → create schema + v2; 1 → ALTER TABLE x4 + v2; ≥2 → ничего
- Нет Coil: изображения грузятся через `LaunchedEffect` + `SkiaImage.makeFromEncoded(bytes).toComposeImageBitmap()`
- File picker: `java.awt.FileDialog` на `Dispatchers.Main` (AWT EDT)
- `onFetchMedia` и `onSendFile` пробрасываются через `App.kt → ChatWindowScreen → MessageBubble/FileCard`
- `Icons.Default.AttachFile` нет в базовом наборе — используется `Icons.Default.Add`

## Ключевые документы

- `docs/superpowers/specs/native-client-architecture.md`
- `docs/superpowers/specs/native-client-compatibility-matrix.md`
- `docs/superpowers/specs/2026-04-14-android-file-transfer-design.md`
- `docs/superpowers/specs/2026-04-15-android-webrtc-step-b-design.md`
- `docs/superpowers/plans/2026-04-15-android-webrtc-step-b.md`
- `docs/architecture.md`
- `docs/technical-documentation.md`

---

### Приоритет 5 — Логирование ошибок

**Задача: централизованное логирование ошибок с сохранением в директорию для последующего анализа и фиксации багов**

Охват: сервер (Go), веб-клиент (PWA), нативные приложения (Desktop, Android, iOS).

#### Сервер (Go)

- Структурированные JSON-логи ошибок через `slog` (stdlib Go 1.21+) или `zap`
- Сохранение в файл `logs/errors.log` с ротацией (по размеру/дате) — через `lumberjack`
- Каждая запись: timestamp, level, request_id, user_id (если авторизован), endpoint, error, stack trace
- Middleware для перехвата паник в chi-роутере → запись в лог + HTTP 500
- Отдельный файл `logs/access.log` для HTTP-запросов (метод, путь, статус, latency)

#### Веб-клиент (PWA)

- Глобальный обработчик `window.onerror` + `window.onunhandledrejection` → запись в IndexedDB (`error_log`)
- Утилита `logger.ts`: уровни `error/warn/info`, автоматически добавляет timestamp, user_id из Zustand store, текущий route
- Хранение последних N записей в IndexedDB, периодическая отправка на `POST /api/client-errors` (батчами)
- Новый серверный endpoint `/api/client-errors` — принимает, валидирует и записывает в `logs/client-errors.log`

#### Desktop (Kotlin / Compose Multiplatform)

- Логирование через `java.util.logging` или `kotlin-logging` + `logback`
- Файл: `~/.messenger/logs/errors.log` (macOS/Linux) / `%APPDATA%\Messenger\logs\errors.log` (Windows), ротация `lumberjack`-аналогом (`SizeAndTimeBasedRollingPolicy`)
- Перехват необработанных исключений через `Thread.setDefaultUncaughtExceptionHandler`
- Структура: timestamp, platform=desktop, os, version, user_id, message, stacktrace

#### Android

- Логирование через `android.util.Log` обёрнутый в `ErrorLogger.kt` синглтон
- Файл в `context.filesDir/logs/errors.log`, ротация вручную при превышении 5 МБ
- Перехват крашей через `Thread.setDefaultUncaughtExceptionHandler` (пишет в файл перед завершением)
- При следующем старте приложения — отправка накопленных логов на `/api/client-errors`

#### iOS (SwiftUI)

- `Logger` из `OSLog` (apple unified logging) + дублирование в файл `Documents/logs/errors.log`
- `AppErrorLogger.swift` — синглтон, обёртка над `os.Logger` + `FileHandle`
- Перехват `NSSetUncaughtExceptionHandler` и `signal(SIGABRT/SIGILL/SIGSEGV, ...)` → запись перед крашем
- При старте: отправка накопленных логов на `/api/client-errors`

#### Общее

- Новая DB-миграция: таблица `client_error_logs` (id, timestamp, platform, user_id, message, meta JSON)
- Новый endpoint `GET /api/admin/error-logs` — для просмотра клиентских ошибок из панели администратора
- Директория `logs/` добавляется в `.gitignore`

---

## Обязательная проверка после следующего шага

1. `cd apps/desktop && ./gradlew build`
2. `cd apps/mobile/android && ./gradlew test`
3. `cd apps/mobile/android && ./gradlew assembleDebug`
4. `cd client && npm run type-check`
5. `cd client && npm run lint`
6. При изменениях в crypto — сверка с `shared/test-vectors/*.json`
