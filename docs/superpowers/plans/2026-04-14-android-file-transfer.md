# Android File Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add E2E-encrypted file transfer to the Android client: images show inline, all other files show a download card.

**Architecture:** Client-side encryption via lazysodium (XSalsa20-Poly1305, matching PWA), uploaded to existing `/api/media/upload`, metadata persisted in SQLite. Coil with a custom `EncryptedMediaFetcher` handles inline image display.

**Tech Stack:** Kotlin, Jetpack Compose, lazysodium-android, Ktor multipart, SQLDelight 2.x, Coil 2.x

---

## File Map

| File | Action |
|------|--------|
| `apps/mobile/android/build.gradle.kts` | Modify — add `coil-compose:2.6.0`, set `schemaVersion = 2` |
| `apps/mobile/android/src/main/sqldelight/migrations/1.sqm` | Create — ALTER TABLE statements |
| `apps/mobile/android/src/main/sqldelight/com/messenger/db/messenger.sq` | Modify — add 4 media columns to `message` table + `insertMessage` |
| `apps/mobile/android/src/main/kotlin/com/messenger/store/AppState.kt` | Modify — add 4 nullable media fields to `MessageItem` |
| `apps/mobile/android/src/main/kotlin/com/messenger/service/ApiClient.kt` | Modify — add `sodium` param, `MediaUploadResult`, `uploadEncryptedMedia`, `fetchDecryptedMedia` |
| `apps/mobile/android/src/test/kotlin/com/messenger/service/ApiClientMediaTest.kt` | Create — unit tests for encrypt/upload/fetch |
| `apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/AppViewModel.kt` | Modify — pass `sodium` to ApiClient, update `insertMessage` call (null media args) |
| `apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/ChatWindowViewModel.kt` | Modify — add `apiClient` param, `sendFile()`, `fetchMediaBytes()`, media cache; update DB row mapping |
| `apps/mobile/android/src/main/kotlin/com/messenger/ui/coil/EncryptedMediaFetcher.kt` | Create — Coil Fetcher for encrypted images |
| `apps/mobile/android/src/main/kotlin/com/messenger/ui/screens/ChatWindowScreen.kt` | Modify — add 📎 button, `onSendFile` param, `imageLoader` param |
| `apps/mobile/android/src/main/kotlin/com/messenger/ui/components/MessageBubble.kt` | Modify — image inline, file card, download to MediaStore |
| `apps/mobile/android/src/main/kotlin/com/messenger/ui/App.kt` | Modify — create `ImageLoader`, pass `onSendFile` / `imageLoader` to `ChatWindowScreen` |

---

## Task 1: DB Schema Migration

**Files:**
- Create: `apps/mobile/android/src/main/sqldelight/migrations/1.sqm`
- Modify: `apps/mobile/android/src/main/sqldelight/com/messenger/db/messenger.sq`
- Modify: `apps/mobile/android/build.gradle.kts`

- [ ] **Step 1: Create migration file**

Create `apps/mobile/android/src/main/sqldelight/migrations/1.sqm` with content:

```sql
ALTER TABLE message ADD COLUMN media_id TEXT;
ALTER TABLE message ADD COLUMN media_key TEXT;
ALTER TABLE message ADD COLUMN original_name TEXT;
ALTER TABLE message ADD COLUMN content_type TEXT;
```

- [ ] **Step 2: Update messenger.sq — message table and insertMessage query**

In `apps/mobile/android/src/main/sqldelight/com/messenger/db/messenger.sq`, replace the `CREATE TABLE IF NOT EXISTS message` block and `insertMessage` query:

```sql
CREATE TABLE IF NOT EXISTS message (
    id TEXT NOT NULL PRIMARY KEY,
    client_msg_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    plaintext TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent',
    is_deleted INTEGER NOT NULL DEFAULT 0,
    media_id TEXT,
    media_key TEXT,
    original_name TEXT,
    content_type TEXT
);

insertMessage:
INSERT OR REPLACE INTO message(
    id, client_msg_id, chat_id, sender_id, plaintext,
    timestamp, status, is_deleted,
    media_id, media_key, original_name, content_type
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
```

- [ ] **Step 3: Set schemaVersion = 2 in build.gradle.kts**

In `apps/mobile/android/build.gradle.kts`, update the `sqldelight` block:

```kotlin
sqldelight {
    databases {
        create("MessengerDatabase") {
            packageName.set("com.messenger.db")
            srcDirs("src/main/sqldelight")
            schemaVersion = 2
            verifyMigrations = true
        }
    }
}
```

- [ ] **Step 4: Verify SQLDelight code generation**

```bash
cd apps/mobile/android && ./gradlew generateDebugSqlDelightInterface 2>&1 | tail -5
```

Expected: `BUILD SUCCESSFUL`

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/android/src/main/sqldelight/ apps/mobile/android/build.gradle.kts
git commit -m "feat: DB schema v2 — add media columns to message table (migration 1.sqm)"
```

---

## Task 2: MessageItem + DB Row Mapping

**Files:**
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/store/AppState.kt`
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/ChatWindowViewModel.kt`
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/AppViewModel.kt`

- [ ] **Step 1: Add media fields to MessageItem**

In `apps/mobile/android/src/main/kotlin/com/messenger/store/AppState.kt`, replace `data class MessageItem`:

```kotlin
data class MessageItem(
    val id: String,
    val clientMsgId: String,
    val chatId: String,
    val senderId: String,
    val plaintext: String,
    val timestamp: Long,
    val status: String,
    val isDeleted: Boolean,
    val mediaId: String? = null,
    val mediaKey: String? = null,
    val originalName: String? = null,
    val contentType: String? = null,
)
```

- [ ] **Step 2: Update DB row → MessageItem mapping in ChatWindowViewModel**

In `apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/ChatWindowViewModel.kt`, replace the `rows.map { row -> MessageItem(...) }` block inside the `init` coroutine:

```kotlin
val dbMessages = rows.map { row ->
    MessageItem(
        id = row.id,
        clientMsgId = row.client_msg_id,
        chatId = row.chat_id,
        senderId = row.sender_id,
        plaintext = row.plaintext,
        timestamp = row.timestamp,
        status = row.status,
        isDeleted = row.is_deleted != 0L,
        mediaId = row.media_id,
        mediaKey = row.media_key,
        originalName = row.original_name,
        contentType = row.content_type,
    )
}
```

- [ ] **Step 3: Update insertMessage call in AppViewModel.sendMessage()**

In `apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/AppViewModel.kt`, update the `insertMessage` call in `sendMessage()` to include the 4 new null media args:

```kotlin
db.messengerQueries.insertMessage(
    id = clientMsgId,
    client_msg_id = clientMsgId,
    chat_id = chatId,
    sender_id = userId,
    plaintext = plaintext,
    timestamp = timestamp,
    status = "sending",
    is_deleted = 0L,
    media_id = null,
    media_key = null,
    original_name = null,
    content_type = null,
)
```

- [ ] **Step 4: Verify compilation**

```bash
cd apps/mobile/android && ./gradlew compileDebugKotlin 2>&1 | tail -5
```

Expected: `BUILD SUCCESSFUL`

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/android/src/main/kotlin/com/messenger/store/AppState.kt \
        apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/ChatWindowViewModel.kt \
        apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/AppViewModel.kt
git commit -m "feat: add media fields to MessageItem and update DB row mapping"
```

---

## Task 3: ApiClient — Encryption + Upload/Fetch

**Files:**
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/service/ApiClient.kt`
- Create: `apps/mobile/android/src/test/kotlin/com/messenger/service/ApiClientMediaTest.kt`

- [ ] **Step 1: Write failing tests**

Create `apps/mobile/android/src/test/kotlin/com/messenger/service/ApiClientMediaTest.kt`:

```kotlin
package com.messenger.service

import com.goterl.lazysodium.LazySodiumJava
import com.goterl.lazysodium.SodiumJava
import io.ktor.client.engine.mock.*
import io.ktor.http.*
import io.ktor.utils.io.*
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.util.Base64

class ApiClientMediaTest {
    private val sodium = LazySodiumJava(SodiumJava())
    private val b64 = Base64.getDecoder()

    private fun makeClient(handler: MockRequestHandler): ApiClient {
        val engine = MockEngine(handler)
        val tokenStore = object : TokenStoreInterface {
            override val accessToken = "test-token"
            override val refreshToken = ""
            override fun save(access: String, refresh: String) {}
            override fun clear() {}
        }
        return ApiClient(
            baseUrl = "http://localhost",
            engine = engine,
            tokenStore = tokenStore,
            sodium = sodium,
        )
    }

    @Test
    fun `uploadEncryptedMedia sends multipart POST and returns mediaId and mediaKey`() = runBlocking {
        var capturedPath = ""
        val client = makeClient { request ->
            capturedPath = request.url.encodedPath
            respond(
                content = ByteReadChannel("""{"mediaId":"abc123"}"""),
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }

        val result = client.uploadEncryptedMedia(
            bytes = "hello".toByteArray(),
            filename = "test.txt",
            contentType = "text/plain",
            chatId = "chat1",
            msgId = "msg1",
        )

        assertEquals("/api/media/upload", capturedPath)
        assertEquals("abc123", result.mediaId)
        // mediaKey должен быть base64-строкой из 32 байт (44 символа с padding)
        val keyBytes = b64.decode(result.mediaKey)
        assertEquals(32, keyBytes.size)
    }

    @Test
    fun `fetchDecryptedMedia decrypts content uploaded by uploadEncryptedMedia`() = runBlocking {
        val plaintext = "secret content".toByteArray()
        var uploadedBytes: ByteArray? = null
        var capturedMediaKey = ""

        // Шаг 1: загружаем зашифрованный файл, перехватываем байты
        val uploadClient = makeClient { request ->
            val body = request.body.toByteArray()
            // Извлекаем encrypted blob из multipart — ищем бинарные данные после boundary
            // Для теста сохраняем всё тело, затем ищем encrypted payload
            uploadedBytes = body
            respond(
                content = ByteReadChannel("""{"mediaId":"test-media"}"""),
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val uploadResult = uploadClient.uploadEncryptedMedia(
            bytes = plaintext,
            filename = "secret.txt",
            contentType = "text/plain",
            chatId = "chat1",
            msgId = "msg1",
        )
        capturedMediaKey = uploadResult.mediaKey

        // Шаг 2: шифруем напрямую теми же данными для проверки round-trip
        val keyBytes = b64.decode(capturedMediaKey)
        val nonceSize = 24
        val macSize = 16
        val nonce = ByteArray(nonceSize)
        val cipher = ByteArray(plaintext.size + macSize)
        sodium.cryptoSecretBoxEasy(cipher, plaintext, plaintext.size.toLong(), nonce, keyBytes)
        val combined = nonce + cipher

        val fetchClient = makeClient {
            respond(
                content = ByteReadChannel(combined),
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/octet-stream"),
            )
        }
        val decrypted = fetchClient.fetchDecryptedMedia("test-media", capturedMediaKey)
        assertArrayEquals(plaintext, decrypted)
    }

    @Test
    fun `uploadEncryptedMedia enforces 10 MB limit`() = runBlocking {
        val client = makeClient { respond("", HttpStatusCode.OK) }
        val tooBig = ByteArray(10 * 1024 * 1024 + 1)
        val ex = runCatching {
            client.uploadEncryptedMedia(tooBig, "big.bin", "application/octet-stream", "c", "m")
        }.exceptionOrNull()
        assertNotNull(ex)
        assertTrue(ex!!.message!!.contains("10"))
    }
}
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd apps/mobile/android && ./gradlew test --tests "com.messenger.service.ApiClientMediaTest" 2>&1 | tail -15
```

Expected: compilation error — `uploadEncryptedMedia` not defined

- [ ] **Step 3: Implement new ApiClient methods**

Replace the entire content of `apps/mobile/android/src/main/kotlin/com/messenger/service/ApiClient.kt`:

```kotlin
// apps/mobile/android/src/main/kotlin/com/messenger/service/ApiClient.kt
package com.messenger.service

import com.goterl.lazysodium.LazySodium
import com.goterl.lazysodium.interfaces.SecretBox
import io.ktor.client.*
import io.ktor.client.call.body
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.auth.*
import io.ktor.client.plugins.auth.providers.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.plugins.websocket.*
import io.ktor.client.request.*
import io.ktor.client.request.forms.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.util.Base64

@Serializable data class LoginRequest(val username: String, val password: String)
@Serializable data class LoginResponse(val accessToken: String, val refreshToken: String)
@Serializable data class RefreshResponse(val accessToken: String, val refreshToken: String)
@Serializable data class ChatSummaryDto(
    val id: String,
    val name: String,
    val isGroup: Boolean,
    val updatedAt: Long,
)
@Serializable data class SendMessageRequest(
    val chatId: String,
    val clientMsgId: String,
    val senderKeyId: Int,
    val recipients: List<RecipientDto>,
)
@Serializable data class RecipientDto(val userId: String, val deviceId: String?, val ciphertext: String)
@Serializable data class RegisterKeysRequest(
    val identityKey: String,
    val signedPreKey: String,
    val signedPreKeySignature: String,
    val oneTimePreKeys: List<String>,
)
@Serializable data class MediaUploadResponse(val mediaId: String)
data class MediaUploadResult(val mediaId: String, val mediaKey: String)

private val applicationJson = ContentType.Application.Json.toString()
private const val MAX_UPLOAD_BYTES = 10 * 1024 * 1024  // 10 МБ

class ApiClient(
    val baseUrl: String,
    engine: HttpClientEngine? = null,
    private val tokenStore: TokenStoreInterface,
    private val sodium: LazySodium,
) {
    private val jsonConfig = Json { ignoreUnknownKeys = true }
    private val b64enc = Base64.getEncoder()
    private val b64dec = Base64.getDecoder()

    val http: HttpClient = run {
        val cfg: HttpClientConfig<*>.() -> Unit = {
            install(ContentNegotiation) { json(jsonConfig) }
            install(WebSockets)
            install(Auth) {
                bearer {
                    loadTokens {
                        val acc = tokenStore.accessToken
                        val ref = tokenStore.refreshToken
                        if (acc.isNotEmpty()) BearerTokens(acc, ref) else null
                    }
                    refreshTokens {
                        val resp: RefreshResponse = client.post("$baseUrl/api/auth/refresh") {
                            markAsRefreshTokenRequest()
                            headers { append(HttpHeaders.ContentType, applicationJson) }
                            setBody(mapOf("refreshToken" to tokenStore.refreshToken))
                        }.body()
                        tokenStore.save(resp.accessToken, resp.refreshToken)
                        BearerTokens(resp.accessToken, resp.refreshToken)
                    }
                }
            }
        }
        if (engine != null) HttpClient(engine).config(cfg)
        else HttpClient(OkHttp, cfg)
    }

    suspend fun login(username: String, password: String): LoginResponse {
        val resp = http.post("$baseUrl/api/auth/login") {
            headers { append(HttpHeaders.ContentType, applicationJson) }
            setBody(LoginRequest(username, password))
        }
        if (!resp.status.isSuccess()) error("Login failed: ${resp.status}")
        val body: LoginResponse = resp.body()
        tokenStore.save(body.accessToken, body.refreshToken)
        return body
    }

    suspend fun logout() {
        http.post("$baseUrl/api/auth/logout")
        tokenStore.clear()
    }

    suspend fun getChats(): List<ChatSummaryDto> =
        http.get("$baseUrl/api/chats").body()

    suspend fun registerKeys(req: RegisterKeysRequest) {
        val resp = http.post("$baseUrl/api/keys/register") {
            headers { append(HttpHeaders.ContentType, applicationJson) }
            setBody(req)
        }
        if (!resp.status.isSuccess()) error("registerKeys failed: ${resp.status}")
    }

    /**
     * Шифрует bytes на клиенте (XSalsa20-Poly1305) и загружает на сервер.
     * Возвращает mediaId и base64-кодированный mediaKey.
     */
    suspend fun uploadEncryptedMedia(
        bytes: ByteArray,
        filename: String,
        contentType: String,
        chatId: String,
        msgId: String,
    ): MediaUploadResult {
        if (bytes.size > MAX_UPLOAD_BYTES) error("Файл слишком большой (макс. 10 МБ)")

        val key = sodium.randomBytesBuf(SecretBox.KEYBYTES)
        val nonce = sodium.randomBytesBuf(SecretBox.NONCEBYTES)
        val cipher = ByteArray(bytes.size + SecretBox.MACBYTES)
        check(sodium.cryptoSecretBoxEasy(cipher, bytes, bytes.size.toLong(), nonce, key)) {
            "Ошибка шифрования"
        }
        val combined: ByteArray = nonce + cipher

        val response: MediaUploadResponse = http.post("$baseUrl/api/media/upload") {
            setBody(MultiPartFormDataContent(formData {
                append("chat_id", chatId)
                append("msg_id", msgId)
                append("file", combined, Headers.build {
                    append(HttpHeaders.ContentType, "application/octet-stream")
                    append(HttpHeaders.ContentDisposition, "filename=encrypted")
                })
            }))
        }.body()

        return MediaUploadResult(
            mediaId = response.mediaId,
            mediaKey = b64enc.encodeToString(key),
        )
    }

    /**
     * Скачивает зашифрованный blob и расшифровывает его.
     * Формат сервера: nonce(24 байта) + ciphertext.
     */
    suspend fun fetchDecryptedMedia(mediaId: String, mediaKeyBase64: String): ByteArray {
        val key = b64dec.decode(mediaKeyBase64)
        val combined: ByteArray = http.get("$baseUrl/api/media/$mediaId").body()
        val nonceSize = SecretBox.NONCEBYTES
        check(combined.size > nonceSize) { "Слишком короткий ответ сервера" }
        val nonce = combined.copyOfRange(0, nonceSize)
        val cipher = combined.copyOfRange(nonceSize, combined.size)
        val plain = ByteArray(cipher.size - SecretBox.MACBYTES)
        check(sodium.cryptoSecretBoxOpenEasy(plain, cipher, cipher.size.toLong(), nonce, key)) {
            "Ошибка расшифровки медиа"
        }
        return plain
    }

    fun wsUrl(token: String): String {
        val wsBase = when {
            baseUrl.startsWith("https://") -> baseUrl.replaceFirst("https://", "wss://")
            baseUrl.startsWith("http://") -> baseUrl.replaceFirst("http://", "ws://")
            else -> baseUrl
        }
        return "$wsBase/ws?token=$token"
    }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd apps/mobile/android && ./gradlew test --tests "com.messenger.service.ApiClientMediaTest" 2>&1 | tail -15
```

Expected: `BUILD SUCCESSFUL`, 3 tests passed

- [ ] **Step 5: Run all tests**

```bash
cd apps/mobile/android && ./gradlew test 2>&1 | tail -10
```

Expected: `BUILD SUCCESSFUL`, все тесты зелёные

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/android/src/main/kotlin/com/messenger/service/ApiClient.kt \
        apps/mobile/android/src/test/kotlin/com/messenger/service/ApiClientMediaTest.kt
git commit -m "feat: ApiClient — uploadEncryptedMedia + fetchDecryptedMedia (XSalsa20-Poly1305)"
```

---

## Task 4: AppViewModel — Pass sodium to ApiClient

**Files:**
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/AppViewModel.kt`

- [ ] **Step 1: Update setServerUrl to pass sodium**

In `AppViewModel.setServerUrl()`, replace the ApiClient constructor call:

```kotlin
fun setServerUrl(url: String) {
    ServerConfig.serverUrl = url
    apiClient = ApiClient(baseUrl = url, tokenStore = tokenStore, sodium = sodium)
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd apps/mobile/android && ./gradlew compileDebugKotlin 2>&1 | tail -5
```

Expected: `BUILD SUCCESSFUL`

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/AppViewModel.kt
git commit -m "feat: pass LazySodiumAndroid to ApiClient in AppViewModel"
```

---

## Task 5: ChatWindowViewModel — sendFile + fetchMediaBytes

**Files:**
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/ChatWindowViewModel.kt`

- [ ] **Step 1: Replace ChatWindowViewModel with updated version**

Replace the entire file `apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/ChatWindowViewModel.kt`:

```kotlin
// src/main/kotlin/com/messenger/viewmodel/ChatWindowViewModel.kt
package com.messenger.viewmodel

import android.app.Application
import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.messenger.db.MessengerDatabase
import com.messenger.service.ApiClient
import com.messenger.store.ChatStore
import com.messenger.store.MessageItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

class ChatWindowViewModel(
    application: Application,
    val chatId: String,
    private val chatStore: ChatStore,
    private val db: MessengerDatabase,
    private val currentUserId: String,
    val apiClient: ApiClient,
) : AndroidViewModel(application) {

    private val _messages = MutableStateFlow<List<MessageItem>>(emptyList())
    val messages: StateFlow<List<MessageItem>> = _messages.asStateFlow()

    private val _typingUsers = MutableStateFlow<Set<String>>(emptySet())
    val typingUsers: StateFlow<Set<String>> = _typingUsers.asStateFlow()

    private val mediaCache = HashMap<String, ByteArray>()

    init {
        viewModelScope.launch(Dispatchers.IO) {
            val rows = db.messengerQueries.getMessagesForChat(chatId).executeAsList()
            val dbMessages = rows.map { row ->
                MessageItem(
                    id = row.id,
                    clientMsgId = row.client_msg_id,
                    chatId = row.chat_id,
                    senderId = row.sender_id,
                    plaintext = row.plaintext,
                    timestamp = row.timestamp,
                    status = row.status,
                    isDeleted = row.is_deleted != 0L,
                    mediaId = row.media_id,
                    mediaKey = row.media_key,
                    originalName = row.original_name,
                    contentType = row.content_type,
                )
            }
            val existing = chatStore.messages.value[chatId] ?: emptyList()
            val dbIds = dbMessages.map { it.clientMsgId }.toSet()
            val merged = (dbMessages + existing.filter { it.clientMsgId !in dbIds })
                .sortedBy { it.timestamp }
            chatStore.setMessages(chatId, merged)
        }
        viewModelScope.launch {
            chatStore.messages.collect { allMessages ->
                _messages.value = allMessages[chatId] ?: emptyList()
            }
        }
        viewModelScope.launch {
            chatStore.typing.collect { typingMap ->
                _typingUsers.value = typingMap[chatId] ?: emptySet()
            }
        }
    }

    fun sendFile(uri: Uri, context: Context) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val bytes = context.contentResolver.openInputStream(uri)?.readBytes()
                    ?: error("Не удалось прочитать файл")
                val contentType = context.contentResolver.getType(uri)
                    ?: "application/octet-stream"
                val originalName = DocumentFile.fromSingleUri(context, uri)?.name ?: "file"
                val clientMsgId = UUID.randomUUID().toString()
                val timestamp = System.currentTimeMillis()

                val result = apiClient.uploadEncryptedMedia(
                    bytes = bytes,
                    filename = originalName,
                    contentType = contentType,
                    chatId = chatId,
                    msgId = clientMsgId,
                )

                db.messengerQueries.insertMessage(
                    id = clientMsgId,
                    client_msg_id = clientMsgId,
                    chat_id = chatId,
                    sender_id = currentUserId,
                    plaintext = "",
                    timestamp = timestamp,
                    status = "sent",
                    is_deleted = 0L,
                    media_id = result.mediaId,
                    media_key = result.mediaKey,
                    original_name = originalName,
                    content_type = contentType,
                )

                val item = MessageItem(
                    id = clientMsgId,
                    clientMsgId = clientMsgId,
                    chatId = chatId,
                    senderId = currentUserId,
                    plaintext = "",
                    timestamp = timestamp,
                    status = "sent",
                    isDeleted = false,
                    mediaId = result.mediaId,
                    mediaKey = result.mediaKey,
                    originalName = originalName,
                    contentType = contentType,
                )
                chatStore.addMessage(chatId, item)
            } catch (e: Exception) {
                // Ошибка — уведомление через _uploadError (добавим ниже)
                _uploadError.value = e.message ?: "Ошибка загрузки файла"
            }
        }
    }

    private val _uploadError = MutableStateFlow<String?>(null)
    val uploadError: StateFlow<String?> = _uploadError.asStateFlow()

    fun clearUploadError() { _uploadError.value = null }

    suspend fun fetchMediaBytes(mediaId: String, mediaKey: String): ByteArray =
        withContext(Dispatchers.IO) {
            mediaCache.getOrPut(mediaId) {
                apiClient.fetchDecryptedMedia(mediaId, mediaKey)
            }
        }
}
```

- [ ] **Step 2: Add addMessage to ChatStore**

In `apps/mobile/android/src/main/kotlin/com/messenger/store/ChatStore.kt`, check if `addMessage` method exists. If not, add it. Read the file first:

```bash
cat apps/mobile/android/src/main/kotlin/com/messenger/store/ChatStore.kt
```

If `addMessage` is missing, add this method to `ChatStore`:

```kotlin
fun addMessage(chatId: String, item: MessageItem) {
    val current = _messages.value.toMutableMap()
    val list = (current[chatId] ?: emptyList()) + item
    current[chatId] = list.sortedBy { it.timestamp }
    _messages.value = current
}
```

- [ ] **Step 3: Verify compilation**

```bash
cd apps/mobile/android && ./gradlew compileDebugKotlin 2>&1 | tail -5
```

Expected: `BUILD SUCCESSFUL`

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/ChatWindowViewModel.kt \
        apps/mobile/android/src/main/kotlin/com/messenger/store/ChatStore.kt
git commit -m "feat: ChatWindowViewModel — sendFile, fetchMediaBytes, upload error state"
```

---

## Task 6: Coil EncryptedMediaFetcher + build.gradle dependency

**Files:**
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/ui/coil/EncryptedMediaFetcher.kt`
- Modify: `apps/mobile/android/build.gradle.kts`

- [ ] **Step 1: Add Coil dependency**

In `apps/mobile/android/build.gradle.kts`, add to the `dependencies {}` block:

```kotlin
implementation("io.coil-kt:coil-compose:2.6.0")
```

- [ ] **Step 2: Create EncryptedMediaFetcher**

Create `apps/mobile/android/src/main/kotlin/com/messenger/ui/coil/EncryptedMediaFetcher.kt`:

```kotlin
// src/main/kotlin/com/messenger/ui/coil/EncryptedMediaFetcher.kt
package com.messenger.ui.coil

import coil.ImageLoader
import coil.decode.DataSource
import coil.decode.ImageSource
import coil.fetch.FetchResult
import coil.fetch.Fetcher
import coil.fetch.SourceResult
import coil.request.Options
import com.messenger.service.ApiClient
import okio.Buffer

data class EncryptedMediaRequest(val mediaId: String, val mediaKey: String)

class EncryptedMediaFetcher(
    private val data: EncryptedMediaRequest,
    private val apiClient: ApiClient,
    private val options: Options,
) : Fetcher {

    override suspend fun fetch(): FetchResult {
        val bytes = apiClient.fetchDecryptedMedia(data.mediaId, data.mediaKey)
        val source = Buffer().write(bytes)
        return SourceResult(
            source = ImageSource(source, options.context),
            mimeType = null,
            dataSource = DataSource.NETWORK,
        )
    }

    class Factory(private val apiClient: ApiClient) : Fetcher.Factory<EncryptedMediaRequest> {
        override fun create(
            data: EncryptedMediaRequest,
            options: Options,
            imageLoader: ImageLoader,
        ): Fetcher = EncryptedMediaFetcher(data, apiClient, options)
    }
}
```

- [ ] **Step 3: Verify compilation**

```bash
cd apps/mobile/android && ./gradlew compileDebugKotlin 2>&1 | tail -5
```

Expected: `BUILD SUCCESSFUL`

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/android/src/main/kotlin/com/messenger/ui/coil/ \
        apps/mobile/android/build.gradle.kts
git commit -m "feat: Coil EncryptedMediaFetcher for decrypted image display"
```

---

## Task 7: UI — ChatWindowScreen + MessageBubble + App.kt wiring

**Files:**
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/ui/screens/ChatWindowScreen.kt`
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/ui/components/MessageBubble.kt`
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/ui/App.kt`

- [ ] **Step 1: Update ChatWindowScreen — add file picker and new params**

Replace the entire `apps/mobile/android/src/main/kotlin/com/messenger/ui/screens/ChatWindowScreen.kt`:

```kotlin
// src/main/kotlin/com/messenger/ui/screens/ChatWindowScreen.kt
package com.messenger.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import coil.ImageLoader
import com.messenger.store.MessageItem
import com.messenger.ui.components.MessageBubble
import com.messenger.ui.components.TypingIndicator

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatWindowScreen(
    chatName: String,
    messages: List<MessageItem>,
    typingUsers: Set<String>,
    currentUserId: String,
    uploadError: String?,
    imageLoader: ImageLoader,
    onBack: () -> Unit,
    onSend: (String) -> Unit,
    onSendFile: (Uri) -> Unit,
    onClearUploadError: () -> Unit,
    onDownloadFile: suspend (mediaId: String, mediaKey: String, originalName: String) -> Unit = { _, _, _ -> },
) {
    var text by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    val fileLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri -> uri?.let { onSendFile(it) } }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
    }

    uploadError?.let { msg ->
        LaunchedEffect(msg) {
            // Snackbar через SnackbarHostState при необходимости; пока Toast-like через отдельный хост
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(chatName) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад")
                    }
                },
            )
        },
        snackbarHost = {
            if (uploadError != null) {
                Snackbar(
                    action = {
                        TextButton(onClick = onClearUploadError) { Text("OK") }
                    }
                ) { Text(uploadError) }
            }
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            LazyColumn(
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
                state = listState,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                items(messages, key = { it.clientMsgId }) { msg ->
                    MessageBubble(
                        message = msg,
                        isOwn = msg.senderId == currentUserId,
                        imageLoader = imageLoader,
                        onDownloadFile = onDownloadFile,
                    )
                }
            }
            TypingIndicator(typingUsers)
            Row(
                modifier = Modifier.fillMaxWidth().padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { fileLauncher.launch("*/*") }) {
                    Icon(Icons.Default.AttachFile, "Прикрепить файл")
                }
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Сообщение...") },
                    maxLines = 4,
                )
                Spacer(Modifier.width(8.dp))
                IconButton(
                    onClick = { if (text.isNotBlank()) { onSend(text.trim()); text = "" } },
                ) {
                    Icon(Icons.AutoMirrored.Filled.Send, "Отправить")
                }
            }
        }
    }
}
```

- [ ] **Step 2: Update MessageBubble — image inline + file download card**

Replace the entire `apps/mobile/android/src/main/kotlin/com/messenger/ui/components/MessageBubble.kt`:

```kotlin
// src/main/kotlin/com/messenger/ui/components/MessageBubble.kt
package com.messenger.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil.ImageLoader
import coil.compose.AsyncImage
import com.messenger.store.MessageItem
import com.messenger.ui.coil.EncryptedMediaRequest
import kotlinx.coroutines.launch

@Composable
fun MessageBubble(
    message: MessageItem,
    isOwn: Boolean,
    imageLoader: ImageLoader,
    onDownloadFile: suspend (mediaId: String, mediaKey: String, originalName: String) -> Unit = { _, _, _ -> },
) {
    val alignment = if (isOwn) Alignment.End else Alignment.Start
    val bubbleColor = if (isOwn) MaterialTheme.colorScheme.primaryContainer
                      else MaterialTheme.colorScheme.surfaceVariant

    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp),
        horizontalAlignment = alignment,
    ) {
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = bubbleColor,
            modifier = Modifier.widthIn(max = 280.dp),
        ) {
            Box(modifier = Modifier.padding(8.dp)) {
                when {
                    message.isDeleted -> Text(
                        "Сообщение удалено",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
                    )

                    message.mediaId != null &&
                    message.contentType?.startsWith("image/") == true ->
                        AsyncImage(
                            model = EncryptedMediaRequest(message.mediaId, message.mediaKey!!),
                            imageLoader = imageLoader,
                            contentDescription = message.originalName,
                            contentScale = ContentScale.FillWidth,
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(max = 240.dp)
                                .clip(RoundedCornerShape(8.dp)),
                        )

                    message.mediaId != null ->
                        FileCard(
                            originalName = message.originalName ?: "файл",
                            onDownload = {
                                onDownloadFile(
                                    message.mediaId,
                                    message.mediaKey!!,
                                    message.originalName ?: "file",
                                )
                            },
                        )

                    else -> Text(
                        message.plaintext,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}

@Composable
private fun FileCard(originalName: String, onDownload: suspend () -> Unit) {
    var downloading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.padding(4.dp),
    ) {
        Icon(Icons.Default.InsertDriveFile, contentDescription = null, modifier = Modifier.size(32.dp))
        Spacer(Modifier.width(8.dp))
        Text(originalName, modifier = Modifier.weight(1f), maxLines = 2,
             style = MaterialTheme.typography.bodyMedium)
        if (downloading) {
            CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
        } else {
            TextButton(onClick = {
                downloading = true
                scope.launch {
                    try { onDownload() } finally { downloading = false }
                }
            }) { Text("Скачать") }
        }
    }
}
```

- [ ] **Step 4: Add saveToDownloads helper in ChatWindowViewModel**

In `ChatWindowViewModel.kt`, add the download helper:

```kotlin
suspend fun saveToDownloads(
    context: Context,
    mediaId: String,
    mediaKey: String,
    originalName: String,
) = withContext(Dispatchers.IO) {
    val bytes = fetchMediaBytes(mediaId, mediaKey)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, originalName)
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: error("Не удалось создать файл в Downloads")
        resolver.openOutputStream(uri)?.use { it.write(bytes) }
        values.clear()
        values.put(MediaStore.Downloads.IS_PENDING, 0)
        resolver.update(uri, values, null, null)
    } else {
        @Suppress("DEPRECATION")
        val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
        dir.mkdirs()
        File(dir, originalName).writeBytes(bytes)
    }
}
```

Add the required imports to `ChatWindowViewModel.kt`:
```kotlin
import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
```

- [ ] **Step 5: Wire everything in App.kt**

Replace the `is Screen.ChatWindow` branch in `apps/mobile/android/src/main/kotlin/com/messenger/ui/App.kt`:

```kotlin
is Screen.ChatWindow -> {
    val chatId = s.chatId
    val chatName = chats.find { it.id == chatId }?.name ?: chatId
    val client = vm.apiClient!!
    val imageLoader = remember(client) {
        coil.ImageLoader.Builder(application)
            .components {
                add(com.messenger.ui.coil.EncryptedMediaFetcher.Factory(client))
            }
            .build()
    }
    val cwVm = remember(chatId) {
        ChatWindowViewModel(
            application = application,
            chatId = chatId,
            chatStore = vm.chatStore,
            db = vm.dbProvider.database,
            currentUserId = authState.userId,
            apiClient = client,
        )
    }
    val messages by cwVm.messages.collectAsState()
    val typingUsers by cwVm.typingUsers.collectAsState()
    val uploadError by cwVm.uploadError.collectAsState()
    ChatWindowScreen(
        chatName = chatName,
        messages = messages,
        typingUsers = typingUsers,
        currentUserId = authState.userId,
        uploadError = uploadError,
        imageLoader = imageLoader,
        onBack = { screen = Screen.ChatList },
        onSend = { text -> vm.sendMessage(chatId, text) },
        onSendFile = { uri -> cwVm.sendFile(uri, application) },
        onClearUploadError = { cwVm.clearUploadError() },
        onDownloadFile = { mediaId, mediaKey, name ->
            cwVm.saveToDownloads(application, mediaId, mediaKey, name)
        },
    )
}
```

Add import to App.kt:
```kotlin
import com.messenger.viewmodel.ChatWindowViewModel
```

- [ ] **Step 6: Add WRITE_EXTERNAL_STORAGE + READ_MEDIA permissions**

In `apps/mobile/android/src/main/AndroidManifest.xml`, add before `<application`:

```xml
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"
    android:maxSdkVersion="32" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"
    android:maxSdkVersion="29" />
<uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
<uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
<uses-permission android:name="android.permission.READ_MEDIA_AUDIO" />
```

- [ ] **Step 7: Verify full build**

```bash
cd apps/mobile/android && ./gradlew assembleDebug 2>&1 | tail -10
```

Expected: `BUILD SUCCESSFUL`

- [ ] **Step 8: Run all tests**

```bash
cd apps/mobile/android && ./gradlew test 2>&1 | tail -10
```

Expected: `BUILD SUCCESSFUL`, все тесты зелёные

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/android/src/main/kotlin/com/messenger/ui/ \
        apps/mobile/android/src/main/AndroidManifest.xml
git commit -m "feat: file transfer UI — file picker, inline images (Coil), file download card"
```

---

## Task 8: Final integration commit

- [ ] **Step 1: Verify all tests pass**

```bash
cd apps/mobile/android && ./gradlew test 2>&1 | tail -10
```

Expected: `BUILD SUCCESSFUL`

- [ ] **Step 2: Verify APK builds**

```bash
cd apps/mobile/android && ./gradlew assembleDebug 2>&1 | tail -5
```

Expected: `BUILD SUCCESSFUL`

- [ ] **Step 3: Update next-session.md**

В `docs/next-session.md`, добавить под `### Приоритет 3`:

```markdown
- ✅ MEDIA-8: передача файлов Android — E2E-шифрование (lazysodium), Coil inline-изображения, карточка скачивания
```

- [ ] **Step 4: Final commit**

```bash
git add docs/next-session.md
git commit -m "docs: отметить MEDIA-8 (Android file transfer) завершённым"
```

---

## Testing Checklist (Manual)

1. Выбрать JPG → изображение отображается инлайн в пузыре
2. Выбрать PDF → показывается карточка с именем файла и кнопкой "Скачать"
3. Нажать "Скачать" → файл появляется в папке Downloads
4. Перезапустить приложение → медиа-сообщения загружаются из DB и отображаются корректно
5. Попытаться отправить файл > 10 МБ → Snackbar "Файл слишком большой (макс. 10 МБ)"
6. Обычные текстовые сообщения продолжают работать без изменений
