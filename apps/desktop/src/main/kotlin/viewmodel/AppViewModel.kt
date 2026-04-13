package viewmodel

import config.ServerConfig
import crypto.Ratchet
import crypto.SenderKey
import com.goterl.lazysodium.LazySodiumJava
import com.goterl.lazysodium.SodiumJava
import db.DatabaseProvider
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.StateFlow
import service.ApiClient
import service.MessengerWS
import service.WSOrchestrator
import store.AuthState
import store.AuthStore
import store.ChatStore

class AppViewModel {
    val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())

    val authStore = AuthStore()
    val chatStore = ChatStore()

    val authState: StateFlow<AuthState> = authStore.state

    private val sodium = LazySodiumJava(SodiumJava())
    private val ratchet = Ratchet(sodium)
    private val senderKey = SenderKey(sodium)

    var apiClient: ApiClient? = null
    private var ws: MessengerWS? = null

    fun setServerUrl(url: String) {
        ServerConfig.serverUrl = url
        apiClient = ApiClient(baseUrl = url)
    }

    suspend fun login(username: String, password: String): Result<Unit> {
        val client = apiClient ?: return Result.failure(IllegalStateException("Server URL not set"))
        return try {
            val resp = client.login(username, password)
            authStore.login(userId = username, username = username, accessToken = resp.accessToken)
            startWS(resp.accessToken)
            loadChats()
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun logout() {
        ws?.disconnect()
        ws = null
        apiClient?.logout()
        authStore.logout()
    }

    private fun startWS(token: String) {
        val client = apiClient ?: return
        val orchestrator = WSOrchestrator(
            ratchet = ratchet,
            senderKey = senderKey,
            chatStore = chatStore,
            currentUserId = authStore.state.value.userId,
        )
        val wsInstance = MessengerWS(
            http = client.http,
            onFrame = { frame -> orchestrator.onFrame(frame) },
            onConnect = { send ->
                scope.launch {
                    DatabaseProvider.database.messengerQueries.getAllOutbox().executeAsList().forEach { item ->
                        send(item.plaintext)
                    }
                }
            },
            onDisconnect = { },
        )
        wsInstance.connect(client.wsUrl(token))
        ws = wsInstance
    }

    private suspend fun loadChats() {
        val client = apiClient ?: return
        try {
            val dtos = client.getChats()
            chatStore.setChats(dtos.map { dto ->
                store.ChatItem(
                    id = dto.id,
                    name = dto.name,
                    isGroup = dto.isGroup,
                    lastMessage = null,
                    updatedAt = dto.updatedAt,
                )
            })
        } catch (_: Exception) { /* offline — DB покажет кэш */ }
    }
}
