// src/main/kotlin/com/messenger/viewmodel/AppViewModel.kt
package com.messenger.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.goterl.lazysodium.LazySodiumAndroid
import com.goterl.lazysodium.SodiumAndroid
import com.messenger.config.ServerConfig
import com.messenger.crypto.KeyStorage
import com.messenger.crypto.Ratchet
import com.messenger.crypto.SenderKey
import com.messenger.db.DatabaseProvider
import com.messenger.service.ApiClient
import com.messenger.service.MessengerWS
import com.messenger.service.WSOrchestrator
import com.messenger.service.TokenStore
import com.messenger.store.AuthState
import com.messenger.store.AuthStore
import com.messenger.store.ChatItem
import com.messenger.store.ChatStore
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class AppViewModel(application: Application) : AndroidViewModel(application) {
    val authStore = AuthStore()
    val chatStore = ChatStore()
    val authState: StateFlow<AuthState> = authStore.state

    private val sodium = LazySodiumAndroid(SodiumAndroid())
    private val ratchet = Ratchet(sodium)
    private val senderKey = SenderKey(sodium)

    private val tokenStore = TokenStore(application)
    val keyStorage = KeyStorage(application)
    val dbProvider = DatabaseProvider(application)

    var apiClient: ApiClient? = null
    private var ws: MessengerWS? = null
    @Volatile private var wsSend: ((String) -> Unit)? = null

    fun setServerUrl(url: String) {
        ServerConfig.serverUrl = url
        apiClient = ApiClient(baseUrl = url, tokenStore = tokenStore)
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
        val db = dbProvider.database
        val orchestrator = WSOrchestrator(
            ratchet = ratchet,
            senderKey = senderKey,
            chatStore = chatStore,
            db = db,
            currentUserId = authStore.state.value.userId,
        )
        val wsInstance = MessengerWS(
            http = client.http,
            onFrame = { frame -> orchestrator.onFrame(frame) },
            onConnect = { send ->
                wsSend = send
                viewModelScope.launch {
                    db.messengerQueries.getAllOutbox().executeAsList().forEach { item ->
                        send(item.plaintext)
                        db.messengerQueries.deleteOutbox(item.client_msg_id)
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
        val db = dbProvider.database

        db.messengerQueries.insertMessage(
            id = clientMsgId, client_msg_id = clientMsgId, chat_id = chatId,
            sender_id = userId, plaintext = plaintext, timestamp = timestamp,
            status = "sending", is_deleted = 0L,
        )
        chatStore.onMessageReceived(chatId, clientMsgId, plaintext, userId, timestamp)

        val frame = kotlinx.serialization.json.buildJsonObject {
            put("type", kotlinx.serialization.json.JsonPrimitive("message"))
            put("chatId", kotlinx.serialization.json.JsonPrimitive(chatId))
            put("clientMsgId", kotlinx.serialization.json.JsonPrimitive(clientMsgId))
            put("plaintext", kotlinx.serialization.json.JsonPrimitive(plaintext))
        }.toString()

        val send = wsSend
        if (send != null) {
            send(frame)
        } else {
            db.messengerQueries.insertOutbox(
                client_msg_id = clientMsgId, chat_id = chatId,
                plaintext = frame, created_at = timestamp,
            )
        }
    }

    private suspend fun loadChats() {
        val client = apiClient ?: return
        try {
            val dtos = client.getChats()
            chatStore.setChats(dtos.map { dto ->
                ChatItem(id = dto.id, name = dto.name, isGroup = dto.isGroup,
                    lastMessage = null, updatedAt = dto.updatedAt)
            })
        } catch (_: Exception) { }
    }
}
