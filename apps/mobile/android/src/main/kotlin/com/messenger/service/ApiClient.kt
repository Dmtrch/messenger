// apps/mobile/android/src/main/kotlin/com/messenger/service/ApiClient.kt
package com.messenger.service

import io.ktor.client.*
import io.ktor.client.call.body
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.auth.*
import io.ktor.client.plugins.auth.providers.*
import io.ktor.client.plugins.contentnegotiation.*
import io.ktor.client.plugins.websocket.*
import io.ktor.client.request.*
import io.ktor.http.*
import io.ktor.serialization.kotlinx.json.*
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
    private val tokenStore: TokenStoreInterface,
) {
    private val jsonConfig = Json { ignoreUnknownKeys = true }

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

    fun wsUrl(token: String): String {
        val wsBase = when {
            baseUrl.startsWith("https://") -> baseUrl.replaceFirst("https://", "wss://")
            baseUrl.startsWith("http://") -> baseUrl.replaceFirst("http://", "ws://")
            else -> baseUrl
        }
        return "$wsBase/ws?token=$token"
    }
}
