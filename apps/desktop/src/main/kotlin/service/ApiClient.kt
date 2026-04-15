// apps/desktop/src/main/kotlin/service/ApiClient.kt
package service

import io.ktor.client.HttpClient
import io.ktor.client.HttpClientConfig
import io.ktor.client.call.body
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.auth.Auth
import io.ktor.client.plugins.auth.providers.BearerTokens
import io.ktor.client.plugins.auth.providers.bearer
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.websocket.WebSockets
import com.goterl.lazysodium.LazySodiumJava
import com.goterl.lazysodium.SodiumJava
import com.goterl.lazysodium.interfaces.SecretBox
import io.ktor.client.request.forms.MultiPartFormDataContent
import io.ktor.client.request.forms.formData
import io.ktor.client.request.get
import io.ktor.client.request.headers
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
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
    val members: List<String> = emptyList(),
)
@Serializable data class IceServerDto(
    val urls: String,
    val username: String? = null,
    val credential: String? = null,
)
@Serializable data class IceServersResponse(val iceServers: List<IceServerDto>)
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
    private val tokenStore: TokenStoreInterface = TokenStore(),
) {
    private val jsonConfig = Json { ignoreUnknownKeys = true }
    private val sodium = LazySodiumJava(SodiumJava())
    private val b64enc: Base64.Encoder = Base64.getEncoder()
    private val b64dec: Base64.Decoder = Base64.getDecoder()

    private fun buildConfig(): HttpClientConfig<*>.() -> Unit = {
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
        expectSuccess = false
    }

    val http: HttpClient = if (engine != null) {
        HttpClient(engine, buildConfig())
    } else {
        HttpClient(CIO, buildConfig())
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

    suspend fun getIceServers(): IceServersResponse =
        http.get("$baseUrl/api/calls/ice-servers").body()

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
     * Формат: nonce(24 байта) + ciphertext.
     */
    suspend fun fetchDecryptedMedia(mediaId: String, mediaKeyBase64: String): ByteArray {
        val key = b64dec.decode(mediaKeyBase64)
        val combined: ByteArray = http.get("$baseUrl/api/media/$mediaId").body()
        check(combined.size > SecretBox.NONCEBYTES) { "Слишком короткий ответ сервера" }
        val nonce = combined.copyOfRange(0, SecretBox.NONCEBYTES)
        val cipher = combined.copyOfRange(SecretBox.NONCEBYTES, combined.size)
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
