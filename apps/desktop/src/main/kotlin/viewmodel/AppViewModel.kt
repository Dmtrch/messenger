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
    @Volatile private var wsSend: ((String) -> Unit)? = null

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
                wsSend = send
                scope.launch {
                    DatabaseProvider.database.messengerQueries.getAllOutbox().executeAsList().forEach { item ->
                        send(item.plaintext)
                        DatabaseProvider.database.messengerQueries.deleteOutbox(item.client_msg_id)
                    }
                }
            },
            onDisconnect = { },
        )
        wsInstance.connect(client.wsUrl(token))
        ws = wsInstance
    }

    fun sendMessage(chatId: String, plaintext: String) {
        val userId = authStore.state.value.userId
        val clientMsgId = java.util.UUID.randomUUID().toString()
        val timestamp = System.currentTimeMillis()

        // Сохраняем сообщение в БД со статусом 'sending'
        DatabaseProvider.database.messengerQueries.insertMessage(
            id = clientMsgId,
            client_msg_id = clientMsgId,
            chat_id = chatId,
            sender_id = userId,
            plaintext = plaintext,
            timestamp = timestamp,
            status = "sending",
            is_deleted = 0L,
        )
        chatStore.onMessageReceived(chatId, clientMsgId, plaintext, userId, timestamp)

        // Строим JSON-фрейм
        val frame = kotlinx.serialization.json.buildJsonObject {
            put("type", kotlinx.serialization.json.JsonPrimitive("message"))
            put("chatId", kotlinx.serialization.json.JsonPrimitive(chatId))
            put("clientMsgId", kotlinx.serialization.json.JsonPrimitive(clientMsgId))
            put("plaintext", kotlinx.serialization.json.JsonPrimitive(plaintext))
        }.toString()

        val send = wsSend
        if (send != null) {
            // MVP: отправляем plaintext — E2E encrypt добавляется в 11C-2 (X3DH handshake)
            send(frame)
        } else {
            // Нет WS-соединения — сохраняем в outbox, отправится при reconnect
            DatabaseProvider.database.messengerQueries.insertOutbox(
                client_msg_id = clientMsgId,
                chat_id = chatId,
                plaintext = frame,
                created_at = timestamp,
            )
        }
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
