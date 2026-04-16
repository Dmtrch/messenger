package viewmodel

import config.ServerConfig
import crypto.KeyStorage
import crypto.SessionManager
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
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
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
    private val keyStorage = KeyStorage()
    private val sessionManager by lazy { SessionManager(sodium, keyStorage, DatabaseProvider.database) }

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
            authStore.login(userId = resp.userId, username = resp.username, accessToken = resp.accessToken)
            startWS(resp.accessToken)
            loadChats()
            registerKeysIfNeeded(client)
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
        val db = DatabaseProvider.database
        val orchestrator = WSOrchestrator(
            sessionManager = sessionManager,
            chatStore = chatStore,
            db = db,
            currentUserId = authStore.state.value.userId,
            onCallOffer    = { signal -> handleIncomingOffer(signal) },
            onCallAnswer   = { signal -> handleRemoteAnswer(signal) },
            onIceCandidate = { signal -> webRtcController?.addRemoteIceCandidate(signal) },
            onCallEnd      = { chatStore.onCallEnd(it) },
        )
        val wsInstance = MessengerWS(
            http = client.http,
            onFrame = { frame -> orchestrator.onFrame(frame) },
            onConnect = { send ->
                wsSend = send
                scope.launch {
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

        scope.launch {
            val db = DatabaseProvider.database
            val members = chatStore.chats.value.find { it.id == chatId }?.members ?: emptyList()
            val isGroup = chatStore.isGroup(chatId)
            val client = apiClient

            val recipients = buildJsonArray {
                if (isGroup) {
                    val cipher = runCatching { sessionManager.encryptGroupMessage(chatId, plaintext) }.getOrNull()
                        ?: return@launch
                    members.filter { it != userId }.forEach { memberId ->
                        add(buildJsonObject {
                            put("userId", memberId)
                            put("deviceId", "")
                            put("ciphertext", cipher)
                        })
                    }
                } else {
                    members.filter { it != userId }.forEach { memberId ->
                        runCatching {
                            val resp = client?.getKeyBundle(memberId)
                            resp?.devices?.forEach { device ->
                                val cipher = sessionManager.encryptForDevice(memberId, device.deviceId, device, plaintext)
                                add(buildJsonObject {
                                    put("userId", memberId)
                                    put("deviceId", device.deviceId)
                                    put("ciphertext", cipher)
                                })
                            }
                        }
                    }
                }
            }

            val frame = buildJsonObject {
                put("type", "message")
                put("chatId", chatId)
                put("clientMsgId", clientMsgId)
                put("senderKeyId", 0)
                put("recipients", recipients)
            }.toString()

            val send = wsSend
            if (send != null) send(frame)
            else db.messengerQueries.insertOutbox(
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

    private suspend fun registerKeysIfNeeded(client: service.ApiClient) {
        val b64 = java.util.Base64.getEncoder()

        val ikPub = keyStorage.loadKey("ik_pub") ?: run {
            val pub = ByteArray(com.goterl.lazysodium.interfaces.Sign.PUBLICKEYBYTES)
            val sec = ByteArray(com.goterl.lazysodium.interfaces.Sign.SECRETKEYBYTES)
            (sodium as com.goterl.lazysodium.interfaces.Sign.Native).cryptoSignKeypair(pub, sec)
            keyStorage.saveKey("ik_pub", pub); keyStorage.saveKey("ik_sec", sec); pub
        }
        val ikSec = keyStorage.loadKey("ik_sec") ?: return

        val spkPub = keyStorage.loadKey("spk_pub") ?: run {
            val pub = ByteArray(com.goterl.lazysodium.interfaces.Box.PUBLICKEYBYTES)
            val sec = ByteArray(com.goterl.lazysodium.interfaces.Box.SECRETKEYBYTES)
            (sodium as com.goterl.lazysodium.interfaces.Box.Native).cryptoBoxKeypair(pub, sec)
            keyStorage.saveKey("spk_pub", pub); keyStorage.saveKey("spk_sec", sec); pub
        }
        val spkSig = keyStorage.loadKey("spk_sig") ?: run {
            val sig = ByteArray(com.goterl.lazysodium.interfaces.Sign.BYTES)
            (sodium as com.goterl.lazysodium.interfaces.Sign.Native)
                .cryptoSignDetached(sig, spkPub, spkPub.size.toLong(), ikSec)
            keyStorage.saveKey("spk_sig", sig); sig
        }
        val spkId = keyStorage.getOrCreateSpkId()

        val opkSecrets = mutableListOf<ByteArray>()
        val opkPublics = (1..10).map {
            val pub = ByteArray(com.goterl.lazysodium.interfaces.Box.PUBLICKEYBYTES)
            val sec = ByteArray(com.goterl.lazysodium.interfaces.Box.SECRETKEYBYTES)
            (sodium as com.goterl.lazysodium.interfaces.Box.Native).cryptoBoxKeypair(pub, sec)
            opkSecrets.add(sec)
            b64.encodeToString(pub)
        }

        val deviceName = System.getProperty("user.name") ?: "desktop"

        val req = service.RegisterKeysRequest(
            deviceName   = deviceName,
            ikPublic     = b64.encodeToString(ikPub),
            spkId        = spkId,
            spkPublic    = b64.encodeToString(spkPub),
            spkSignature = b64.encodeToString(spkSig),
            opkPublics   = opkPublics,
        )
        val regResp = runCatching { client.registerKeys(req) }.getOrNull() ?: return
        // Сохраняем OPK private keys под server-assigned IDs для X3DH responder
        regResp.opkIds.zip(opkSecrets).forEach { (id, sec) ->
            keyStorage.saveKey("opk_$id", sec)
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
                    members = dto.members,
                )
            })
        } catch (_: Exception) { /* offline — DB покажет кэш */ }
    }
}
