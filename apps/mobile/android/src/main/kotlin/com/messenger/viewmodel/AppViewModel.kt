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
import com.messenger.crypto.SessionManager
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
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
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
    private val sodium by lazy { sodiumProvider() }

    private val tokenStore = TokenStore(application)
    val keyStorage = KeyStorage(application)
    val dbProvider = DatabaseProvider(application)
    private val sessionManager by lazy { SessionManager(sodium, keyStorage, dbProvider.database) }

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
            authStore.login(userId = resp.userId, username = resp.username, accessToken = resp.accessToken)
            startWS(resp.accessToken)
            loadChats()
            registerKeysIfNeeded(client)
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

    /**
     * Активирует QR/токен привязки нового устройства. Генерирует свежие X3DH-ключи,
     * отправляет их вместе с токеном на /api/auth/device-link-activate. После успеха
     * открывается сессия как при обычном login (WS + chats + FCM).
     */
    suspend fun activateDeviceLink(token: String, deviceName: String): Result<Unit> {
        val client = apiClient ?: return Result.failure(IllegalStateException("Server URL not set"))
        return try {
            val b64Flag = android.util.Base64.NO_WRAP

            val ikPub = ByteArray(com.goterl.lazysodium.interfaces.Sign.PUBLICKEYBYTES)
            val ikSec = ByteArray(com.goterl.lazysodium.interfaces.Sign.SECRETKEYBYTES)
            (sodium as com.goterl.lazysodium.interfaces.Sign.Native).cryptoSignKeypair(ikPub, ikSec)

            val spkPub = ByteArray(com.goterl.lazysodium.interfaces.Box.PUBLICKEYBYTES)
            val spkSec = ByteArray(com.goterl.lazysodium.interfaces.Box.SECRETKEYBYTES)
            (sodium as com.goterl.lazysodium.interfaces.Box.Native).cryptoBoxKeypair(spkPub, spkSec)
            val spkSig = ByteArray(com.goterl.lazysodium.interfaces.Sign.BYTES)
            (sodium as com.goterl.lazysodium.interfaces.Sign.Native)
                .cryptoSignDetached(spkSig, spkPub, spkPub.size.toLong(), ikSec)

            val opkSecrets = mutableListOf<ByteArray>()
            val opkDtos = (1..10).map { idx ->
                val pub = ByteArray(com.goterl.lazysodium.interfaces.Box.PUBLICKEYBYTES)
                val sec = ByteArray(com.goterl.lazysodium.interfaces.Box.SECRETKEYBYTES)
                (sodium as com.goterl.lazysodium.interfaces.Box.Native).cryptoBoxKeypair(pub, sec)
                opkSecrets.add(sec)
                com.messenger.service.OpkPublicDto(
                    id = idx,
                    key = android.util.Base64.encodeToString(pub, b64Flag),
                )
            }

            val spkId = keyStorage.getOrCreateSpkId()
            val req = com.messenger.service.DeviceLinkActivateRequest(
                token        = token,
                deviceName   = deviceName,
                ikPublic     = android.util.Base64.encodeToString(ikPub, b64Flag),
                spkId        = spkId,
                spkPublic    = android.util.Base64.encodeToString(spkPub, b64Flag),
                spkSignature = android.util.Base64.encodeToString(spkSig, b64Flag),
                opkPublics   = opkDtos,
            )
            val resp = client.activateDeviceLink(req)

            keyStorage.saveKey("ik_pub", ikPub)
            keyStorage.saveKey("ik_sec", ikSec)
            keyStorage.saveKey("spk_pub", spkPub)
            keyStorage.saveKey("spk_sec", spkSec)
            keyStorage.saveKey("spk_sig", spkSig)
            opkDtos.zip(opkSecrets).forEach { (dto, sec) ->
                keyStorage.saveKey("opk_${dto.id}", sec)
            }
            keyStorage.saveKey("device_id", resp.deviceId.toByteArray())

            authStore.login(userId = resp.userId, username = resp.username, accessToken = resp.accessToken)
            startWS(resp.accessToken)
            loadChats()
            registerFcmTokenIfAvailable(client)
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    private fun startWS(token: String) {
        val client = apiClient ?: return
        val db = dbProvider.database
        val orchestrator = WSOrchestrator(
            sessionManager = sessionManager,
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

        viewModelScope.launch {
            val members = chatStore.chats.value.find { it.id == chatId }?.members ?: emptyList()
            val isGroup = chatStore.isGroup(chatId)
            val client = apiClient

            val recipients = buildJsonArray {
                if (isGroup) {
                    val cipher = runCatching { sessionManager.encryptGroupMessage(chatId, plaintext) }.getOrNull() ?: return@launch
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

    private suspend fun registerKeysIfNeeded(client: ApiClient) {
        val sodium = sodiumProvider()
        val b64 = android.util.Base64.NO_WRAP

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
            android.util.Base64.encodeToString(pub, b64)
        }

        val deviceId = android.provider.Settings.Secure.getString(
            getApplication<android.app.Application>().contentResolver,
            android.provider.Settings.Secure.ANDROID_ID) ?: "android"

        val req = com.messenger.service.RegisterKeysRequest(
            deviceName   = deviceId,
            ikPublic     = android.util.Base64.encodeToString(ikPub, b64),
            spkId        = spkId,
            spkPublic    = android.util.Base64.encodeToString(spkPub, b64),
            spkSignature = android.util.Base64.encodeToString(spkSig, b64),
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
