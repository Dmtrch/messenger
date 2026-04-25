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
import io.ktor.client.plugins.cookies.AcceptAllCookiesStorage
import io.ktor.client.plugins.cookies.HttpCookies
import io.ktor.client.plugins.websocket.WebSockets
import com.goterl.lazysodium.LazySodiumJava
import com.goterl.lazysodium.SodiumJava
import com.goterl.lazysodium.interfaces.SecretBox
import io.ktor.client.request.forms.MultiPartFormDataContent
import io.ktor.client.request.forms.formData
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.headers
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.put
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
@Serializable data class LoginResponse(
    val accessToken: String,
    val userId: String,
    val username: String,
    val displayName: String? = null,
    val role: String? = null,
)
@Serializable data class RefreshResponse(val accessToken: String)
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
    val deviceName: String,
    val ikPublic: String,
    val spkId: Int,
    val spkPublic: String,
    val spkSignature: String,
    val opkPublics: List<String>,
)
@Serializable data class RegisterKeysResponse(
    val deviceId: String = "",
    val opkIds: List<Long> = emptyList(),
)
@Serializable data class OpkPublicDto(val id: Int, val key: String)
@Serializable data class DeviceLinkActivateRequest(
    val token: String,
    val deviceName: String,
    val ikPublic: String,
    val spkId: Int,
    val spkPublic: String,
    val spkSignature: String,
    val opkPublics: List<OpkPublicDto>,
)
@Serializable data class DeviceLinkActivateResponse(
    val accessToken: String,
    val userId: String,
    val username: String,
    val displayName: String? = null,
    val role: String? = null,
    val deviceId: String = "",
)
@Serializable data class MediaUploadResponse(val mediaId: String)
data class MediaUploadResult(val mediaId: String, val mediaKey: String)
@Serializable data class DeviceBundle(
    val deviceId: String = "",
    val ikPublic: String,
    val spkPublic: String,
    val spkId: Int = 0,
    val spkSignature: String = "",
    val opkPublic: String? = null,
    val opkId: Int? = null,
)
@Serializable data class PreKeyBundleResponse(val devices: List<DeviceBundle>)
@Serializable data class UserResultDto(val id: String, val username: String, val displayName: String)
@Serializable data class SearchUsersResponse(val users: List<UserResultDto>)
@Serializable data class CreateChatRequest(val type: String, val memberIds: List<String>, val name: String? = null)
@Serializable data class CreateChatResponse(val chat: ChatSummaryDto)

@Serializable data class DownloadArtifactDto(
    val platform: String = "",
    val arch: String = "",
    val format: String = "",
    val filename: String,
    val url: String,
    val sha256: String = "",
    @kotlinx.serialization.SerialName("size_bytes") val sizeBytes: Long = 0,
)
@Serializable data class DownloadsManifestDto(
    val version: String = "",
    val minClientVersion: String = "",
    val changelog: String = "",
    val artifacts: List<DownloadArtifactDto> = emptyList(),
)

@Serializable data class AdminUserDto(
    val id: String,
    val username: String,
    @kotlinx.serialization.SerialName("display_name") val displayName: String = "",
    val role: String = "user",
    val status: String = "active",
    val quotaBytes: Long? = null,
    val usedBytes: Long? = null,
)
@Serializable data class AdminUsersResponse(val users: List<AdminUserDto> = emptyList())

@Serializable data class AdminRegRequestDto(
    val id: String,
    val username: String,
    @kotlinx.serialization.SerialName("display_name") val displayName: String = "",
    val status: String = "pending",
    @kotlinx.serialization.SerialName("created_at") val createdAt: Long = 0,
)
@Serializable data class AdminRegRequestsResponse(val requests: List<AdminRegRequestDto> = emptyList())

@Serializable data class AdminResetRequestDto(
    val id: String,
    @kotlinx.serialization.SerialName("user_id") val userId: String = "",
    val username: String = "",
    val status: String = "pending",
    @kotlinx.serialization.SerialName("created_at") val createdAt: Long = 0,
)
@Serializable data class AdminResetRequestsResponse(val requests: List<AdminResetRequestDto> = emptyList())

@Serializable data class AdminInviteCodeDto(
    val code: String,
    val createdBy: String = "",
    val usedBy: String = "",
    val usedAt: Long = 0,
    val expiresAt: Long = 0,
    val revokedAt: Long = 0,
    val createdAt: Long = 0,
)
@Serializable data class AdminInviteCodesResponse(val codes: List<AdminInviteCodeDto> = emptyList())
@Serializable data class AdminInviteCreatedDto(val code: String = "")

@Serializable data class AdminRetentionDto(val retentionDays: Int = 0)
@Serializable data class AdminMaxMembersDto(val maxMembers: Int = 0)

@Serializable data class AdminSystemStatsDto(
    val cpuPercent: Double = 0.0,
    val ramUsed: Long = 0,
    val ramTotal: Long = 0,
    val diskUsed: Long = 0,
    val diskTotal: Long = 0,
)

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
        install(HttpCookies) { storage = AcceptAllCookiesStorage() }
        install(Auth) {
            bearer {
                loadTokens {
                    val acc = tokenStore.accessToken
                    if (acc.isNotEmpty()) BearerTokens(acc, "") else null
                }
                refreshTokens {
                    val resp: RefreshResponse = client.post("$baseUrl/api/auth/refresh") {
                        markAsRefreshTokenRequest()
                    }.body()
                    tokenStore.save(resp.accessToken)
                    BearerTokens(resp.accessToken, "")
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
        tokenStore.save(body.accessToken)
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

    suspend fun activateDeviceLink(req: DeviceLinkActivateRequest): DeviceLinkActivateResponse {
        val resp = http.post("$baseUrl/api/auth/device-link-activate") {
            headers { append(HttpHeaders.ContentType, applicationJson) }
            setBody(req)
        }
        if (!resp.status.isSuccess()) error("device-link-activate failed: ${resp.status}")
        val body: DeviceLinkActivateResponse = resp.body()
        tokenStore.save(body.accessToken)
        return body
    }

    suspend fun registerKeys(req: RegisterKeysRequest): RegisterKeysResponse {
        val resp = http.post("$baseUrl/api/keys/register") {
            headers { append(HttpHeaders.ContentType, applicationJson) }
            setBody(req)
        }
        if (!resp.status.isSuccess()) error("registerKeys failed: ${resp.status}")
        return resp.body()
    }

    suspend fun getKeyBundle(userId: String): PreKeyBundleResponse =
        http.get("$baseUrl/api/keys/$userId").body()

    suspend fun searchUsers(query: String): SearchUsersResponse =
        http.get("$baseUrl/api/users/search") {
            parameter("q", query)
        }.body()

    suspend fun createChat(type: String, memberIds: List<String>, name: String? = null): CreateChatResponse =
        http.post("$baseUrl/api/chats") {
            headers { append(HttpHeaders.ContentType, applicationJson) }
            setBody(CreateChatRequest(type, memberIds, name))
        }.body()

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

    /** Возвращает манифест доступных для скачивания артефактов. */
    suspend fun getDownloadsManifest(): DownloadsManifestDto =
        http.get("$baseUrl/api/downloads/manifest").body()

    /**
     * Скачивает артефакт на локальный диск.
     * @return абсолютный путь к сохранённому файлу.
     */
    suspend fun downloadArtifact(filename: String, targetDir: java.nio.file.Path): java.nio.file.Path {
        val resp = http.get("$baseUrl/api/downloads/$filename")
        if (!resp.status.isSuccess()) error("download failed: ${resp.status}")
        val bytes: ByteArray = resp.body()
        java.nio.file.Files.createDirectories(targetDir)
        val dest = targetDir.resolve(filename)
        java.nio.file.Files.write(dest, bytes)
        return dest
    }

    // ----------------- Admin API -----------------

    suspend fun adminListUsers(): List<AdminUserDto> =
        http.get("$baseUrl/api/admin/users").body<AdminUsersResponse>().users

    suspend fun adminSuspendUser(id: String)          = adminPostEmpty("/api/admin/users/$id/suspend")
    suspend fun adminUnsuspendUser(id: String)        = adminPostEmpty("/api/admin/users/$id/unsuspend")
    suspend fun adminBanUser(id: String)              = adminPostEmpty("/api/admin/users/$id/ban")
    suspend fun adminRevokeSessions(id: String)       = adminPostEmpty("/api/admin/users/$id/revoke-sessions")
    suspend fun adminRemoteWipe(id: String)           = adminPostEmpty("/api/admin/users/$id/remote-wipe")

    suspend fun adminSetUserRole(id: String, role: String) {
        val resp = http.put("$baseUrl/api/admin/users/$id/role") {
            headers { append(HttpHeaders.ContentType, applicationJson) }
            setBody(kotlinx.serialization.json.buildJsonObject { put("role", kotlinx.serialization.json.JsonPrimitive(role)) })
        }
        if (!resp.status.isSuccess()) error("setRole failed: ${resp.status}")
    }

    suspend fun adminResetUserPassword(id: String, newPassword: String) {
        val resp = http.post("$baseUrl/api/admin/users/$id/reset-password") {
            headers { append(HttpHeaders.ContentType, applicationJson) }
            setBody(kotlinx.serialization.json.buildJsonObject { put("newPassword", kotlinx.serialization.json.JsonPrimitive(newPassword)) })
        }
        if (!resp.status.isSuccess()) error("resetPassword failed: ${resp.status}")
    }

    suspend fun adminListRegistrationRequests(): List<AdminRegRequestDto> =
        http.get("$baseUrl/api/admin/registration-requests") { parameter("status", "pending") }
            .body<AdminRegRequestsResponse>().requests

    suspend fun adminApproveRegistration(id: String)  = adminPostEmpty("/api/admin/registration-requests/$id/approve")
    suspend fun adminRejectRegistration(id: String)   = adminPostEmpty("/api/admin/registration-requests/$id/reject")

    suspend fun adminListResetRequests(): List<AdminResetRequestDto> =
        http.get("$baseUrl/api/admin/password-reset-requests") { parameter("status", "pending") }
            .body<AdminResetRequestsResponse>().requests

    suspend fun adminResolveReset(id: String, tempPassword: String) {
        val resp = http.post("$baseUrl/api/admin/password-reset-requests/$id/resolve") {
            headers { append(HttpHeaders.ContentType, applicationJson) }
            setBody(kotlinx.serialization.json.buildJsonObject {
                put("tempPassword", kotlinx.serialization.json.JsonPrimitive(tempPassword))
            })
        }
        if (!resp.status.isSuccess()) error("resolveReset failed: ${resp.status}")
    }

    private suspend fun adminPostEmpty(path: String) {
        val resp = http.post("$baseUrl$path") {
            headers { append(HttpHeaders.ContentType, applicationJson) }
            setBody("{}")
        }
        if (!resp.status.isSuccess()) error("POST $path failed: ${resp.status}")
    }

    // ----------------- Invite codes -----------------

    suspend fun adminListInviteCodes(): List<AdminInviteCodeDto> =
        http.get("$baseUrl/api/admin/invite-codes").body<AdminInviteCodesResponse>().codes

    suspend fun adminCreateInviteCode(): AdminInviteCodeDto {
        val resp = http.post("$baseUrl/api/admin/invite-codes") {
            headers { append(HttpHeaders.ContentType, applicationJson) }
            setBody("{}")
        }
        if (!resp.status.isSuccess()) error("createInvite failed: ${resp.status}")
        return resp.body()
    }

    suspend fun adminRevokeInviteCode(code: String) {
        val resp = http.delete("$baseUrl/api/admin/invite-codes/${java.net.URLEncoder.encode(code, "UTF-8")}")
        if (!resp.status.isSuccess()) error("revokeInvite failed: ${resp.status}")
    }

    // ----------------- Settings -----------------

    suspend fun adminGetRetention(): Int =
        http.get("$baseUrl/api/admin/settings/retention").body<AdminRetentionDto>().retentionDays

    suspend fun adminSetRetention(days: Int) {
        val resp = http.put("$baseUrl/api/admin/settings/retention") {
            headers { append(HttpHeaders.ContentType, applicationJson) }
            setBody(kotlinx.serialization.json.buildJsonObject {
                put("retentionDays", kotlinx.serialization.json.JsonPrimitive(days))
            })
        }
        if (!resp.status.isSuccess()) error("setRetention failed: ${resp.status}")
    }

    suspend fun adminGetMaxGroupMembers(): Int = runCatching {
        http.get("$baseUrl/api/admin/settings/max-group-members").body<AdminMaxMembersDto>().maxMembers
    }.getOrDefault(0)

    suspend fun adminSetMaxGroupMembers(value: Int) {
        val resp = http.put("$baseUrl/api/admin/settings/max-group-members") {
            headers { append(HttpHeaders.ContentType, applicationJson) }
            setBody(kotlinx.serialization.json.buildJsonObject {
                put("maxMembers", kotlinx.serialization.json.JsonPrimitive(value))
            })
        }
        if (!resp.status.isSuccess()) error("setMaxMembers failed: ${resp.status}")
    }

    // ----------------- System stats -----------------

    suspend fun adminGetSystemStats(): AdminSystemStatsDto =
        http.get("$baseUrl/api/admin/system/stats").body()

    fun wsUrl(token: String): String {
        val wsBase = when {
            baseUrl.startsWith("https://") -> baseUrl.replaceFirst("https://", "wss://")
            baseUrl.startsWith("http://") -> baseUrl.replaceFirst("http://", "ws://")
            else -> baseUrl
        }
        return "$wsBase/ws?token=$token"
    }
}
