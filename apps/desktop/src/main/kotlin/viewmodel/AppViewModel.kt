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
import service.call.CallOfferSignal
import service.call.CallAnswerSignal
import service.call.DesktopWebRtcController
import service.call.IceCandidateSignal
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import store.AuthState
import store.AuthStore
import store.CallStatus
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

    // WebRTC — инициализируется лениво при первом звонке
    var webRtcController: DesktopWebRtcController? = null
        private set

    // SDP входящего оффера (до принятия звонка)
    private var pendingIncomingOfferSdp: String? = null

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

    private fun makeController(): DesktopWebRtcController {
        val ctrl = DesktopWebRtcController(
            onIceCandidate    = { signal -> sendIceCandidate(signal) },
            onLocalVideoReady = { callId -> chatStore.markLocalVideoReady(callId) },
            onRemoteVideoReady = { callId -> chatStore.markRemoteVideoReady(callId) },
        )
        webRtcController = ctrl
        return ctrl
    }

    private suspend fun fetchIceServers() =
        runCatching { apiClient?.getIceServers()?.iceServers ?: emptyList() }
            .getOrDefault(emptyList())

    private fun startWS(token: String) {
        val client = apiClient ?: return
        val orchestrator = WSOrchestrator(
            ratchet = ratchet,
            senderKey = senderKey,
            chatStore = chatStore,
            currentUserId = authStore.state.value.userId,
            onCallOffer  = { signal -> handleIncomingOffer(signal) },
            onCallAnswer = { signal -> handleRemoteAnswer(signal) },
            onIceCandidate = { signal ->
                webRtcController?.addRemoteIceCandidate(signal)
            },
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
            media_id = null,
            media_key = null,
            original_name = null,
            content_type = null,
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

    fun initiateCall(chatId: String, targetId: String, isVideo: Boolean) {
        val callId = java.util.UUID.randomUUID().toString()
        chatStore.setOutgoingCall(callId, chatId, targetId, isVideo)
        scope.launch {
            val iceServers = fetchIceServers()
            val ctrl = makeController()
            val sdp = runCatching {
                ctrl.startOutgoing(callId, isVideo, iceServers)
            }.getOrElse { "stub-sdp" }
            sendCallFrame(buildJsonObject {
                put("type", "call_offer")
                put("callId", callId)
                put("chatId", chatId)
                put("targetId", targetId)
                put("sdp", sdp)
                put("isVideo", isVideo)
            }.toString())
        }
    }

    fun acceptCall() {
        val call = chatStore.call.value
        if (call.status != CallStatus.RINGING_IN) return
        val offerSdp = pendingIncomingOfferSdp ?: return
        chatStore.onCallAnswer(call.callId)
        scope.launch {
            val iceServers = fetchIceServers()
            val ctrl = makeController()
            val answerSdp = runCatching {
                ctrl.acceptIncoming(call.callId, offerSdp, call.isVideo, iceServers)
            }.getOrElse { "stub-sdp" }
            pendingIncomingOfferSdp = null
            sendCallFrame(buildJsonObject {
                put("type", "call_answer")
                put("callId", call.callId)
                put("sdp", answerSdp)
            }.toString())
        }
    }

    fun rejectCall() {
        val call = chatStore.call.value
        pendingIncomingOfferSdp = null
        chatStore.clearCall()
        sendCallFrame(buildJsonObject {
            put("type", "call_reject")
            put("callId", call.callId)
        }.toString())
    }

    fun hangUp() {
        val call = chatStore.call.value
        webRtcController?.endCall(call.callId)
        chatStore.clearCall()
        sendCallFrame(buildJsonObject {
            put("type", "call_end")
            put("callId", call.callId)
        }.toString())
    }

    private fun handleIncomingOffer(signal: CallOfferSignal) {
        pendingIncomingOfferSdp = signal.sdp
    }

    private fun handleRemoteAnswer(signal: CallAnswerSignal) {
        webRtcController?.applyAnswer(signal.callId, signal.sdp)
    }

    private fun sendIceCandidate(signal: IceCandidateSignal) {
        sendCallFrame(buildJsonObject {
            put("type", "ice_candidate")
            put("callId", signal.callId)
            put("sdpMid", signal.sdpMid)
            put("sdpMLineIndex", signal.sdpMLineIndex)
            put("candidate", signal.candidate)
        }.toString())
    }

    private fun sendCallFrame(frame: String) {
        wsSend?.invoke(frame)
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
                    members = dto.members,
                )
            })
        } catch (_: Exception) { /* offline — DB покажет кэш */ }
    }
}
