# Android-клиент Messenger — Спецификация дизайна

**Статус:** Approved  
**Дата:** 2026-04-13  
**Этап:** 11C-2 — Android MVP  
**Связанные документы:**
- `docs/superpowers/specs/native-client-architecture.md`
- `docs/superpowers/specs/adr-native-crypto-stack.md`
- `docs/superpowers/specs/adr-native-local-db.md`
- `docs/superpowers/specs/native-client-compatibility-matrix.md`
- `docs/next-session.md`

---

## 1. Цель

Реализовать полноценный Android-клиент мессенджера в `apps/mobile/android/` как standalone Gradle-модуль. Клиент должен быть функционально эквивалентен Desktop MVP (этап 11C-1): авторизация, список чатов, отправка/приём E2E-зашифрованных сообщений, offline outbox, cursor-based пагинация истории.

---

## 2. Архитектурный подход

**Standalone Android-модуль** — не KMP. Kotlin-логика (crypto, store, viewmodel) копируется из `apps/desktop/` и адаптируется под Android platform dependencies. Desktop не затрагивается. KMP — возможный следующий шаг, не входит в этот этап.

---

## 3. Структура модуля

```
apps/mobile/android/
├── build.gradle.kts
├── settings.gradle.kts
├── gradle/
│   └── libs.versions.toml
├── google-services.json.example    # placeholder, реальный файл не в репо
└── src/
    ├── main/
    │   ├── AndroidManifest.xml
    │   └── kotlin/com/messenger/
    │       ├── MainActivity.kt
    │       ├── crypto/
    │       │   ├── X3DH.kt
    │       │   ├── Ratchet.kt
    │       │   ├── SenderKey.kt
    │       │   └── KeyStorage.kt
    │       ├── db/
    │       │   ├── messenger.sq
    │       │   └── DatabaseProvider.kt
    │       ├── service/
    │       │   ├── ApiClient.kt
    │       │   ├── TokenStore.kt
    │       │   ├── MessengerWS.kt
    │       │   └── WSOrchestrator.kt
    │       ├── store/
    │       │   ├── AuthStore.kt
    │       │   └── ChatStore.kt
    │       ├── viewmodel/
    │       │   ├── AppViewModel.kt
    │       │   ├── ChatListViewModel.kt
    │       │   └── ChatWindowViewModel.kt
    │       ├── ui/
    │       │   ├── App.kt
    │       │   └── screens/
    │       │       ├── ServerSetupScreen.kt
    │       │       ├── AuthScreen.kt
    │       │       ├── ChatListScreen.kt
    │       │       ├── ChatWindowScreen.kt
    │       │       └── ProfileScreen.kt
    │       └── push/
    │           └── FcmService.kt
    └── test/
        └── kotlin/com/messenger/
            ├── crypto/
            │   ├── X3DHTest.kt
            │   └── RatchetTest.kt
            └── db/
                └── DatabaseProviderTest.kt
```

---

## 4. Стек технологий

| Компонент | Библиотека | Версия |
|---|---|---|
| Язык | Kotlin | 2.0.21 |
| UI | Jetpack Compose (BOM) | 2024.09.00 |
| HTTP | Ktor client + OkHttp engine | 3.1.2 |
| WebSocket | Ktor client websockets + OkHttp | 3.1.2 |
| Crypto | lazysodium-android | 5.1.4 |
| Local DB | SQLDelight + android-driver | 2.0.2 |
| Сериализация | kotlinx-serialization-json | 1.7.3 |
| Coroutines | kotlinx-coroutines-android | 1.8.1 |
| Token storage | androidx.security:crypto | 1.1.0-alpha06 |
| Push | Firebase BOM + messaging | 33.x |
| DI | нет (manual wiring в AppViewModel) | — |
| Тесты | JUnit 5 + coroutines-test | — |

**Target SDK:** compileSdk 35, minSdk 26 (Android 8.0), targetSdk 35.

---

## 5. Компоненты и адаптации

### 5.1 crypto/

**Источник:** `apps/desktop/src/main/kotlin/crypto/`  
**Изменения:** только замена импорта lazysodium — `lazysodium-android` использует JNI вместо JNA, но API (`LazySodium`, `SodiumAndroid`) идентичен.

- `X3DH.kt` — логика bootstrap X3DH без изменений
- `Ratchet.kt` — Double Ratchet без изменений
- `SenderKey.kt` — Sender Keys без изменений
- `KeyStorage.kt` — **адаптируется**: хранение ключей через Android Keystore (`KeyStore.getInstance("AndroidKeyStore")`) вместо PKCS12-файла

Crypto совместимость подтверждается тест-векторами из `shared/test-vectors/`.

### 5.2 db/

**Источник схемы:** `apps/desktop/src/main/sqldelight/com/messenger/db/messenger.sq` — копируется без изменений.

**`DatabaseProvider.kt`:**
```kotlin
class DatabaseProvider(context: Context) {
    val database: MessengerDatabase by lazy {
        MessengerDatabase(
            AndroidSqliteDriver(MessengerDatabase.Schema, context, "messenger.db")
        )
    }
}
```

Схема: 4 таблицы — `chat`, `message`, `ratchet_session`, `outbox`. Идентична Desktop.

### 5.3 service/ApiClient.kt

Ktor OkHttp engine вместо CIO:

```kotlin
HttpClient(OkHttp) {
    install(Auth) { bearer { ... } }
    install(ContentNegotiation) { json() }
    install(WebSockets)
}
```

DTO и логика endpoint'ов идентичны Desktop.

### 5.4 service/TokenStore.kt

EncryptedSharedPreferences вместо файла:

```kotlin
class TokenStore(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        context, "messenger_tokens",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )
    fun saveTokens(access: String, refresh: String) { ... }
    fun loadTokens(): Pair<String?, String?> { ... }
    fun clear() { ... }
}
```

### 5.5 service/MessengerWS.kt + WSOrchestrator.kt

Ktor OkHttp WS engine. Логика reconnect с exponential backoff и outbox-flush идентична Desktop.

### 5.6 store/

`AuthStore.kt` и `ChatStore.kt` — StateFlow-логика идентична Desktop. Никаких Android-специфичных изменений.

### 5.7 viewmodel/

`AndroidViewModel(application: Application)` вместо plain class. Coroutine scope — `viewModelScope`. Логика `sendMessage`, `loadHistory`, `logout` идентична Desktop.

### 5.8 ui/

Jetpack Compose. Экраны аналогичны Desktop (Compose API совместим):
- `ServerSetupScreen` — ввод URL сервера
- `AuthScreen` — login / register
- `ChatListScreen` — список чатов с `LazyColumn`
- `ChatWindowScreen` — история + ввод сообщения + cursor-based dogload
- `ProfileScreen` — имя пользователя, смена сервера, logout

`App.kt` — NavHost с `NavController` или простой `when(screen)` state machine (как в Desktop).

### 5.9 push/FcmService.kt

Stub FirebaseMessagingService — регистрирует FCM token, но реальный dispatch с сервера не входит в MVP:

```kotlin
class FcmService : FirebaseMessagingService() {
    override fun onNewToken(token: String) { /* TODO: send to server */ }
    override fun onMessageReceived(message: RemoteMessage) { /* TODO */ }
}
```

### 5.10 MainActivity.kt

```kotlin
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { App(application) }
    }
}
```

---

## 6. AndroidManifest.xml

Минимальные разрешения:
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

Объявления: `MainActivity`, `FcmService` с `MESSAGING_EVENT` intent-filter.

---

## 7. Тесты

| Файл | Что тестирует |
|---|---|
| `X3DHTest.kt` | X3DH handshake против `shared/test-vectors/x3dh.json` |
| `RatchetTest.kt` | encrypt/decrypt цикл против `shared/test-vectors/ratchet.json` |
| `DatabaseProviderTest.kt` | insert/query для каждой из 4 таблиц (Robolectric или in-memory) |

Запуск: `./gradlew test` (unit тесты JVM) + `./gradlew connectedAndroidTest` (на девайсе/эмуляторе).

---

## 8. Сборка и дистрибуция

```bash
cd apps/mobile/android
./gradlew assembleDebug      # → app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease    # → requires signing config
```

Release APK — за рамками MVP. Play Store — отдельный этап.

---

## 9. Ограничения MVP

- FCM push уведомления — stub, реальная интеграция с сервером не входит
- Media upload/download — не входит в MVP (только текстовые сообщения)
- Групповые чаты — UI реализован (SenderKey логика скопирована), но не является фокусом тестирования
- Release signing — не настраивается в этом этапе

---

## 10. Критерии готовности

- [ ] `./gradlew test` — зелёный
- [ ] Crypto тест-векторы совпадают с `shared/test-vectors/`
- [ ] Приложение запускается на Android 8+ эмуляторе
- [ ] Можно зарегистрироваться, войти, отправить и получить E2E-сообщение
- [ ] Offline outbox: сообщение отправляется при восстановлении соединения
- [ ] Cursor-based пагинация истории работает
