// src/main/kotlin/com/messenger/viewmodel/AppViewModel.kt
package com.messenger.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.goterl.lazysodium.LazySodium
import com.goterl.lazysodium.LazySodiumAndroid
import com.goterl.lazysodium.SodiumAndroid
import com.messenger.config.ServerConfig
import com.messenger.crypto.KeyStorage
import com.messenger.crypto.Ratchet
import com.messenger.crypto.SenderKey
import com.messenger.db.DatabaseProvider
import com.messenger.service.ApiClient
import com.messenger.service.IceServerDto
import com.messenger.service.MessengerWS
import com.messenger.service.WSOrchestrator
import com.messenger.service.call.AndroidWebRtcController
import com.messenger.service.call.CallAnswerSignal
import com.messenger.service.call.CallOfferSignal
import com.messenger.service.call.IceCandidateSignal
import com.messenger.service.call.WebRtcController
import com.messenger.service.TokenStore
import com.messenger.store.AuthState
import com.messenger.store.AuthStore
import com.messenger.store.CallStatus
import com.messenger.store.ChatItem
import com.messenger.store.ChatStore
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

internal data class CallSignalingTestHooks(
    val webRtcController: WebRtcController? = null,
    val iceServersProvider: (suspend () -> List<IceServerDto>)? = null,
    val frameSink: ((String) -> Unit)? = null,
)

class AppViewModel(application: Application) : AndroidViewModel(application) {
    val authStore = AuthStore()
    val chatStore = ChatStore()
    val authState: StateFlow<AuthState> = authStore.state

    private val sodiumProvider: () -> LazySodium = { LazySodiumAndroid(SodiumAndroid()) }
    private val ratchet by lazy { Ratchet(sodiumProvider()) }
    private val senderKey by lazy { SenderKey(sodiumProvider()) }

    private val tokenStore = TokenStore(application)
    val keyStorage = KeyStorage(application)
    val dbProvider = DatabaseProvider(application)

    var apiClient: ApiClient? = null
    internal var callSignalingTestHooks: CallSignalingTestHooks? = null
    private var androidWebRtcController: WebRtcController? = null
    private val pendingIncomingOffers = ConcurrentHashMap<String, PendingIncomingOffer>()
    private var ws: MessengerWS? = null
    @Volatile private var wsSend: ((String) -> Unit)? = null

    fun setServerUrl(url: String) {
        ServerConfig.serverUrl = url
        apiClient = ApiClient(baseUrl = url, tokenStore = tokenStore, sodium = sodiumProvider())
    }

    suspend fun login(username: String, password: String): Result<Unit> {
        val client = apiClient ?: return Result.failure(IllegalStateException("Server URL not set"))
        return try {
            val resp = client.login(username, password)
            authStore.login(userId = username, username = username, accessToken = resp.accessToken)
            startWS(resp.accessToken)
            loadChats()
            registerFcmTokenIfAvailable(client)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /** Регистрирует FCM-токен на сервере, если Firebase настроен и токен доступен. */
    private fun registerFcmTokenIfAvailable(client: ApiClient) {
        val app = getApplication<android.app.Application>()
        val prefs = app.getSharedPreferences(
            com.messenger.service.MessengerFirebaseService.PREFS, android.content.Context.MODE_PRIVATE)
        val token = prefs.getString(com.messenger.service.MessengerFirebaseService.KEY_TOKEN, null)
            ?: return  // Firebase не настроен или токен ещё не получен
        val deviceId = android.provider.Settings.Secure.getString(
            app.contentResolver, android.provider.Settings.Secure.ANDROID_ID) ?: "android"
        viewModelScope.launch {
            runCatching {
                client.registerNativePushToken(platform = "fcm", token = token, deviceId = deviceId)
            }
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
            onCallOffer = ::onIncomingCallOffer,
            onCallAnswer = ::onIncomingCallAnswer,
            onIceCandidate = ::onIncomingIceCandidate,
            onCallEnd = ::onIncomingCallEnd,
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
            media_id = null, media_key = null, original_name = null, content_type = null,
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

    fun initiateCall(chatId: String, targetId: String, isVideo: Boolean) {
        val callId = UUID.randomUUID().toString()
        chatStore.setOutgoingCall(callId, chatId, targetId, isVideo)
        viewModelScope.launch {
            val controller = getWebRtcController()
            val sent = runCatching {
                val iceServers = getIceServers()
                val sdp = controller.startOutgoing(callId, isVideo, iceServers)
                sendCallFrame(
                    buildJsonObject {
                        put("type", "call_offer")
                        put("callId", callId)
                        put("chatId", chatId)
                        put("targetId", targetId)
                        put("sdp", sdp)
                        put("isVideo", isVideo)
                    }.toString(),
                )
            }.getOrDefault(false)
            if (!sent) {
                controller.endCall(callId)
                chatStore.clearCall()
            }
        }
    }

    fun acceptCall() {
        val call = chatStore.call.value
        if (call.status != CallStatus.RINGING_IN) return
        val pendingOffer = pendingIncomingOffers[call.callId] ?: return
        viewModelScope.launch {
            val controller = getWebRtcController()
            val sent = runCatching {
                val iceServers = getIceServers()
                val sdp = controller.acceptIncoming(
                    callId = call.callId,
                    offerSdp = pendingOffer.offerSdp,
                    isVideo = call.isVideo,
                    iceServers = iceServers,
                )
                sendCallFrame(
                    buildJsonObject {
                        put("type", "call_answer")
                        put("callId", call.callId)
                        put("sdp", sdp)
                    }.toString(),
                )
            }.getOrDefault(false)
            if (sent) {
                pendingIncomingOffers.remove(call.callId)
                chatStore.onCallAnswer(call.callId)
            } else {
                controller.endCall(call.callId)
            }
        }
    }

    fun rejectCall() {
        val call = chatStore.call.value
        if (call.callId.isBlank() || call.status == CallStatus.IDLE) return
        pendingIncomingOffers.remove(call.callId)
        getConfiguredWebRtcController()?.endCall(call.callId)
        chatStore.clearCall()
        sendCallFrame(buildJsonObject {
            put("type", "call_reject")
            put("callId", call.callId)
        }.toString())
    }

    fun hangUp() {
        val call = chatStore.call.value
        if (call.callId.isBlank() || call.status == CallStatus.IDLE) return
        pendingIncomingOffers.remove(call.callId)
        getConfiguredWebRtcController()?.endCall(call.callId)
        chatStore.clearCall()
        sendCallFrame(buildJsonObject {
            put("type", "call_end")
            put("callId", call.callId)
        }.toString())
    }

    internal fun onIncomingCallOffer(signal: CallOfferSignal) {
        pendingIncomingOffers[signal.callId] = PendingIncomingOffer(signal.sdp)
    }

    internal fun onIncomingCallAnswer(signal: CallAnswerSignal) {
        getWebRtcController().applyAnswer(signal.callId, signal.sdp)
    }

    internal fun onIncomingIceCandidate(signal: IceCandidateSignal) {
        getWebRtcController().addRemoteIceCandidate(signal)
    }

    internal fun onIncomingCallEnd(callId: String) {
        pendingIncomingOffers.remove(callId)
        getConfiguredWebRtcController()?.endCall(callId)
    }

    private fun sendCallFrame(frame: String): Boolean {
        var sent = false
        callSignalingTestHooks?.frameSink?.invoke(frame).also { if (it != null) sent = true }
        if (wsSend != null) {
            wsSend?.invoke(frame)
            sent = true
        }
        return sent
    }

    private suspend fun loadChats() {
        val client = apiClient ?: return
        try {
            val dtos = client.getChats()
            chatStore.setChats(dtos.map { dto ->
                ChatItem(id = dto.id, name = dto.name, isGroup = dto.isGroup,
                    lastMessage = null, updatedAt = dto.updatedAt, members = dto.members)
            })
        } catch (_: Exception) { }
    }

    private suspend fun getIceServers(): List<IceServerDto> {
        callSignalingTestHooks?.iceServersProvider?.let { return it() }
        val client = apiClient ?: error("Server URL not set")
        return client.getIceServers().iceServers
    }

    private fun getWebRtcController(): WebRtcController =
        callSignalingTestHooks?.webRtcController
            ?: androidWebRtcController
            ?: AndroidWebRtcController(
                appContext = getApplication<Application>().applicationContext,
                onIceCandidate = ::sendLocalIceCandidate,
                onLocalVideoReady = { callId -> chatStore.markLocalVideoReady(callId) },
                onRemoteVideoReady = { callId -> chatStore.markRemoteVideoReady(callId) },
            ).also { androidWebRtcController = it }

    private fun getConfiguredWebRtcController(): WebRtcController? =
        callSignalingTestHooks?.webRtcController ?: androidWebRtcController

    fun bindVideoRenderers(binding: com.messenger.service.call.AndroidVideoRendererBinding) {
        val callId = chatStore.call.value.callId
        if (callId.isBlank()) return
        (androidWebRtcController as? AndroidWebRtcController)?.bindRenderers(callId, binding)
    }

    private fun sendLocalIceCandidate(signal: IceCandidateSignal) {
        sendCallFrame(
            buildJsonObject {
                put("type", "ice_candidate")
                put("callId", signal.callId)
                put("candidate", signal.candidate)
                put("sdpMid", signal.sdpMid)
                put("sdpMLineIndex", signal.sdpMLineIndex)
            }.toString(),
        )
    }
}

private data class PendingIncomingOffer(
    val offerSdp: String,
)
