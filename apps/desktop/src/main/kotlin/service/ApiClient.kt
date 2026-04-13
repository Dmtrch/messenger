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
import io.ktor.client.request.get
import io.ktor.client.request.headers
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

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

private val applicationJson = ContentType.Application.Json.toString()

class ApiClient(
    val baseUrl: String,
    engine: HttpClientEngine? = null,
    private val tokenStore: TokenStoreInterface = TokenStore(),
) {
    private val jsonConfig = Json { ignoreUnknownKeys = true }

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

    suspend fun registerKeys(req: RegisterKeysRequest) {
        val resp = http.post("$baseUrl/api/keys/register") {
            headers { append(HttpHeaders.ContentType, applicationJson) }
            setBody(req)
        }
        if (!resp.status.isSuccess()) error("registerKeys failed: ${resp.status}")
    }

    fun wsUrl(token: String): String =
        baseUrl.replace("https://", "wss://").replace("http://", "ws://") + "/ws?token=$token"
}
