# Stage 11C-1: Compose Desktop MVP — Design Spec

**Дата:** 2026-04-13  
**Ветка:** `feature/stage9-multi-device`  
**Статус:** Approved

---

## Цель

Создать нативный desktop-клиент (macOS / Windows / Linux) с полным feature parity относительно web-клиента. E2E-шифрование обязательно с первой версии. Архитектура — thin Kotlin-клиент (Compose Desktop), без KMP shared-core на данном этапе.

---

## Section 1: Структура проекта

```
apps/desktop/
├── build.gradle.kts
├── settings.gradle.kts
├── src/main/kotlin/
│   ├── Main.kt                          # точка входа
│   ├── ui/
│   │   ├── screens/
│   │   │   ├── ServerSetupScreen.kt
│   │   │   ├── AuthScreen.kt
│   │   │   ├── ChatListScreen.kt
│   │   │   ├── ChatWindowScreen.kt
│   │   │   └── ProfileScreen.kt
│   │   └── components/
│   │       ├── MessageBubble.kt
│   │       ├── TypingIndicator.kt
│   │       └── CallOverlay.kt
│   ├── viewmodel/
│   │   ├── AppViewModel.kt              # auth-state + WS lifecycle
│   │   ├── ChatListViewModel.kt
│   │   └── ChatWindowViewModel.kt
│   ├── service/
│   │   ├── ApiClient.kt                 # Ktor HTTP
│   │   ├── MessengerWS.kt               # Ktor WS + reconnect
│   │   └── WSOrchestrator.kt            # декрипт + dispatch в store
│   ├── crypto/
│   │   ├── X3DH.kt
│   │   ├── Ratchet.kt
│   │   ├── SenderKey.kt
│   │   └── KeyStorage.kt                # PKCS12 keystore
│   ├── db/
│   │   ├── messenger.sq                 # SQLDelight schema
│   │   └── DatabaseProvider.kt
│   └── config/
│       └── ServerConfig.kt              # хранит URL сервера (prefs)
└── src/test/kotlin/
    ├── crypto/
    │   ├── X3DHTest.kt
    │   ├── RatchetTest.kt
    │   └── SenderKeyTest.kt
    └── service/
        └── ApiClientTest.kt
```

**4 слоя:**
- **UI** — Compose Desktop, экраны и компоненты
- **ViewModel** — StateFlow, бизнес-логика экранов
- **Service** — сетевой слой (REST + WS), оркестратор
- **Platform** — crypto, DB, config

---

## Section 2: Tech Stack

| Компонент | Библиотека | Версия |
|-----------|-----------|--------|
| UI | Compose Multiplatform Desktop | 1.7.x |
| HTTP/WS | Ktor Client (CIO engine) | 3.x |
| Сериализация | kotlinx.serialization | 1.7.x |
| Crypto | lazysodium-java | 5.1.x |
| БД | SQLDelight (SQLite JDBC) | 2.x |
| Ключи | Java PKCS12 Keystore | JDK built-in |
| Тесты | JUnit 5 + kotlinx-coroutines-test | — |
| Упаковка | Gradle compose.desktop plugin | — |

**Почему lazysodium-java:** те же libsodium-примитивы что в TypeScript `libsodium-wrappers` — прямое соответствие API, упрощает порт крипто-кода и верификацию через test-vectors.

---

## Section 3: E2E Шифрование

### Маппинг примитивов TypeScript → Kotlin

| TypeScript (libsodium-wrappers) | Kotlin (lazysodium-java) |
|---------------------------------|--------------------------|
| `crypto_secretbox_easy` | `cryptoSecretBoxEasy()` |
| `crypto_secretbox_open_easy` | `cryptoSecretBoxOpenEasy()` |
| `crypto_sign_keypair` | `cryptoSignKeypair()` |
| `crypto_sign_ed25519_pk_to_curve25519` | `convertPublicKeyEd25519ToCurve25519()` |
| `crypto_scalarmult` | `cryptoScalarMult()` |
| `crypto_kdf_derive_from_key` | `cryptoKdfDeriveFromKey()` |
| `randombytes_buf` | `randombytesBuf()` |

### Порядок реализации

1. `X3DH.kt` — установка сессии (initiator + responder)
2. `Ratchet.kt` — Double Ratchet, сериализация состояния в BLOB
3. `SenderKey.kt` — групповые сообщения
4. `KeyStorage.kt` — PKCS12 (`~/.messenger/keystore.p12`)

### Кросс-клиентная верификация

`shared/test-vectors/*.json` — JSON-файлы, сгенерированные web-клиентом:

```json
{
  "aliceIdentityKeyPair": { "publicKey": "...", "privateKey": "..." },
  "bobPreKeyBundle": { ... },
  "expectedSharedSecret": "..."
}
```

Kotlin-тест читает вектор и сверяет результат:

```kotlin
@Test fun `x3dh matches web test vector`() {
    val vector = loadTestVector("x3dh.json")
    val result = X3DH.initiate(vector.aliceKeys, vector.bobBundle)
    assertEquals(vector.expectedSharedSecret, result.sharedSecret.toBase64())
}
```

**Multi-device**: desktop регистрирует ключи через `POST /api/keys/register` — тот же endpoint что и web. Ключ сессии формат `sessionKey(peerId, deviceId)` совместим с web-клиентом.

---

## Section 4: WebSocket + API Клиент

### REST (`ApiClient.kt`)

```kotlin
class ApiClient(val baseUrl: String) {
    val http = HttpClient(CIO) {
        install(ContentNegotiation) { json() }
        install(Auth) {
            bearer {
                loadTokens { BearerTokens(tokenStore.accessToken, tokenStore.refreshToken) }
                refreshTokens {
                    val resp = client.post("$baseUrl/api/auth/refresh") { ... }
                    tokenStore.save(resp.accessToken, resp.refreshToken)
                    BearerTokens(resp.accessToken, resp.refreshToken)
                }
            }
        }
    }
    val api = ApiRoutes(http, baseUrl)  // типизированные методы: getChats, sendMessage и т.д.
}
```

Ktor `Auth` plugin перехватывает `401` и вызывает `refreshTokens` автоматически — аналог fetch-interceptor в `api/client.ts`.

### WS (`MessengerWS.kt`)

```kotlin
class MessengerWS(
    private val baseUrl: String,
    private val onFrame: (WSFrame) -> Unit,
    private val onConnect: (send: (WSFrame) -> Unit) -> Unit,
    private val onDisconnect: () -> Unit,
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    fun connect(token: String) {
        scope.launch {
            reconnectLoop(token)
        }
    }

    private suspend fun reconnectLoop(token: String) {
        var attempt = 0
        while (true) {
            try {
                http.webSocket("${baseUrl.replace("http", "ws")}/ws?token=$token") {
                    attempt = 0
                    onConnect { frame -> launch { send(Json.encodeToString(frame)) } }
                    for (msg in incoming) {
                        val frame = Json.decodeFromString<WSFrame>((msg as Frame.Text).readText())
                        onFrame(frame)
                    }
                }
            } catch (e: Exception) { /* log */ }
            onDisconnect()
            delay(exponentialBackoff(attempt++))  // max 60 сек
        }
    }

    fun disconnect() { scope.cancel() }
}
```

### WSOrchestrator (`WSOrchestrator.kt`)

Принимает `WSFrame`, декриптует через `Ratchet`/`SenderKey`, вызывает методы ViewModel — зеркало `messenger-ws-orchestrator.ts`.

---

## Section 5: Локальное Хранилище

### SQLDelight схема (`messenger.sq`)

```sql
CREATE TABLE chat (
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    is_group INTEGER NOT NULL DEFAULT 0,
    last_message TEXT,
    updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE message (
    id TEXT NOT NULL PRIMARY KEY,
    client_msg_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    plaintext TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent',
    is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE ratchet_session (
    session_key TEXT NOT NULL PRIMARY KEY,
    state BLOB NOT NULL
);

CREATE TABLE outbox (
    client_msg_id TEXT NOT NULL PRIMARY KEY,
    chat_id TEXT NOT NULL,
    plaintext TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
```

- `ratchet_session.state` — сериализованное состояние рачет-сессии (BLOB)
- Криптоключи хранятся в PKCS12, не в SQLite
- `outbox` — исходящие в offline, `SyncWorker` отправляет при восстановлении WS

### Пагинация

`getForChat(chatId, beforeTimestamp, limit)` — cursor-based, аналог `messageDb.ts` в web-клиенте.

---

## Section 6: Навигация и State Management

### Экраны

`ServerSetup → Auth → ChatList → ChatWindow → Profile`

Compose Navigation (`NavController`) — аналог React Router v6.

### StateFlow вместо Zustand

```kotlin
class AppViewModel : ViewModel() {
    val isAuthenticated: StateFlow<Boolean> = authStore.isAuthenticated
    // стартует WS при логине, останавливает при logout
}

class ChatListViewModel(private val repo: ChatRepository) : ViewModel() {
    val chats: StateFlow<List<Chat>> = repo.chatsFlow()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(), emptyList())
}

class ChatWindowViewModel(
    private val chatId: String,
    private val repo: ChatRepository,
) : ViewModel() {
    val messages: StateFlow<List<Message>> = repo.messagesFlow(chatId)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(), emptyList())
}
```

### WS Lifecycle

`AppViewModel.init {}` запускает `MessengerWS.connect()` после логина. `AppViewModel.onCleared()` вызывает `MessengerWS.disconnect()`. Аналог `useMessengerWS` внутри `AppRoutes`.

---

## Section 7: Тестирование

### Кросс-клиентные test-vectors (приоритет №1)

```
shared/test-vectors/
├── x3dh.json
├── ratchet.json
└── sender-key.json
```

Web-клиент генерирует векторы через `npm run generate-test-vectors`. Kotlin-тесты верифицируют совместимость.

### Unit-тесты

- `X3DHTest.kt` — initiator + responder, кросс-клиентный вектор
- `RatchetTest.kt` — шифрование/расшифровка, out-of-order сообщения
- `SenderKeyTest.kt` — групповое шифрование
- `ApiClientTest.kt` — MockEngine: auto-refresh, 401/403

### Integration-тесты

`ApiClient` + Ktor `MockEngine` — без реального сервера.

### UI-тесты

`ComposeTestRule` для критичных путей: Auth (логин/логаут), ChatList (отображение чатов).

---

## Section 8: Упаковка

```kotlin
// build.gradle.kts
compose.desktop {
    application {
        mainClass = "MainKt"
        nativeDistributions {
            targetFormats(TargetFormat.Dmg, TargetFormat.Msi, TargetFormat.Deb)
            packageName = "Messenger"
            packageVersion = "1.0.0"
            macOS { bundleID = "com.messenger.desktop" }
            windows { menuGroup = "Messenger" }
            linux { packageName = "messenger" }
        }
    }
}
```

**Команды:**

```sh
./gradlew run             # dev-режим
./gradlew packageDmg      # macOS
./gradlew packageMsi      # Windows
./gradlew packageDeb      # Linux
```

Размер бинарника: ~80 МБ (JVM bundled) — приемлемо для desktop.

---

## Декомпозиция этапов

| Этап | Содержание |
|------|-----------|
| **11C-1** | Auth + ChatList + ChatWindow + E2E crypto (X3DH + Ratchet) |
| 11C-2 | Media, read receipts, offline/outbox |
| 11C-3 | Admin panel, push notifications |
| 11C-4 | WebRTC звонки |

Данный спек покрывает **11C-1**.

---

## Инварианты совместимости

- Формат `client_msg_id` — UUID, совпадает с web
- Формат `sessionKey(peerId, deviceId)` — идентичен web
- WS frame types — те же что в `shared/native-core/websocket/ws-model-types.ts`
- Crypto primitives — верифицируются через `shared/test-vectors/`

---

## Что НЕ входит в 11C-1

- WebRTC звонки (11C-4)
- Push notifications (11C-3)
- Media upload/download (11C-2)
- Admin panel (11C-3)
