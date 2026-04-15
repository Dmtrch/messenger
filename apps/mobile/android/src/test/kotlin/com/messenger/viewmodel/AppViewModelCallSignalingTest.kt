package com.messenger.viewmodel

import android.app.Application
import android.content.SharedPreferences
import com.messenger.service.IceServerDto
import com.messenger.service.call.CallAnswerSignal
import com.messenger.service.call.CallOfferSignal
import com.messenger.service.call.IceCandidateSignal
import com.messenger.service.call.WebRtcController
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.util.concurrent.ConcurrentHashMap

@OptIn(ExperimentalCoroutinesApi::class)
class AppViewModelCallSignalingTest {
    private val dispatcher = StandardTestDispatcher()

    @BeforeEach
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @AfterEach
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `initiate call fetches ice servers and sends controller offer`() = runTest {
        val sentFrames = mutableListOf<String>()
        val controller = FakeWebRtcController(offerSdp = "real-offer-sdp")
        val vm = AppViewModel(TestApplication()).apply {
            callSignalingTestHooks = CallSignalingTestHooks(
                webRtcController = controller,
                iceServersProvider = {
                    listOf(IceServerDto(urls = "stun:stun.example.org"))
                },
                frameSink = { frame -> sentFrames += frame },
            )
        }

        vm.initiateCall(chatId = "chat-1", targetId = "bob", isVideo = true)
        advanceUntilIdle()

        val payload = Json.parseToJsonElement(sentFrames.single()).jsonObject
        assertEquals("call_offer", payload["type"]?.jsonPrimitive?.content)
        assertEquals("real-offer-sdp", payload["sdp"]?.jsonPrimitive?.content)
        assertEquals("true", payload["isVideo"]?.jsonPrimitive?.content)
        assertEquals(1, controller.outgoingRequests.size)
        assertEquals("stun:stun.example.org", controller.outgoingRequests.single().iceServers.single().urls)
    }

    @Test
    fun `accept call uses pending incoming offer and sends controller answer`() = runTest {
        val sentFrames = mutableListOf<String>()
        val controller = FakeWebRtcController(answerSdp = "real-answer-sdp")
        val vm = AppViewModel(TestApplication()).apply {
            callSignalingTestHooks = CallSignalingTestHooks(
                webRtcController = controller,
                iceServersProvider = {
                    listOf(IceServerDto(urls = "turn:turn.example.org", username = "u", credential = "c"))
                },
                frameSink = { frame -> sentFrames += frame },
            )
            chatStore.onCallOffer(callId = "call-1", chatId = "chat-1", fromUserId = "bob", isVideo = true)
        }
        vm.onIncomingCallOffer(
            CallOfferSignal(
                callId = "call-1",
                chatId = "chat-1",
                fromUserId = "bob",
                sdp = "incoming-offer-sdp",
                isVideo = true,
            ),
        )

        vm.acceptCall()
        advanceUntilIdle()

        val payload = Json.parseToJsonElement(sentFrames.single()).jsonObject
        assertEquals("call_answer", payload["type"]?.jsonPrimitive?.content)
        assertEquals("real-answer-sdp", payload["sdp"]?.jsonPrimitive?.content)
        assertEquals(1, controller.incomingRequests.size)
        assertEquals("incoming-offer-sdp", controller.incomingRequests.single().offerSdp)
    }

    @Test
    fun `incoming answer is applied to controller`() {
        val controller = FakeWebRtcController()
        val vm = AppViewModel(TestApplication()).apply {
            callSignalingTestHooks = CallSignalingTestHooks(webRtcController = controller)
        }

        vm.onIncomingCallAnswer(CallAnswerSignal(callId = "call-1", sdp = "remote-answer-sdp"))

        assertEquals(listOf("call-1" to "remote-answer-sdp"), controller.appliedAnswers)
    }

    @Test
    fun `incoming ice candidate is forwarded to controller`() {
        val controller = FakeWebRtcController()
        val signal = IceCandidateSignal(
            callId = "call-1",
            sdpMid = "video",
            sdpMLineIndex = 1,
            candidate = "candidate-1",
        )
        val vm = AppViewModel(TestApplication()).apply {
            callSignalingTestHooks = CallSignalingTestHooks(webRtcController = controller)
        }

        vm.onIncomingIceCandidate(signal)

        assertEquals(listOf(signal), controller.remoteIceCandidates)
    }

    @Test
    fun `incoming call end closes configured controller session`() {
        val controller = FakeWebRtcController()
        val vm = AppViewModel(TestApplication()).apply {
            callSignalingTestHooks = CallSignalingTestHooks(webRtcController = controller)
        }

        vm.onIncomingCallEnd("call-1")

        assertEquals(listOf("call-1"), controller.endedCalls)
    }

    @Test
    fun `reject call does not send frame when call is idle`() = runTest {
        val sentFrames = mutableListOf<String>()
        val vm = AppViewModel(TestApplication()).apply {
            callSignalingTestHooks = CallSignalingTestHooks(frameSink = { frame -> sentFrames += frame })
        }

        vm.rejectCall()
        advanceUntilIdle()

        assertEquals(emptyList<String>(), sentFrames)
    }

    @Test
    fun `hang up does not send frame when call is idle`() = runTest {
        val sentFrames = mutableListOf<String>()
        val vm = AppViewModel(TestApplication()).apply {
            callSignalingTestHooks = CallSignalingTestHooks(frameSink = { frame -> sentFrames += frame })
        }

        vm.hangUp()
        advanceUntilIdle()

        assertEquals(emptyList<String>(), sentFrames)
    }

    @Test
    fun `initiate call without transport rolls back outgoing call`() = runTest {
        val controller = FakeWebRtcController(offerSdp = "offer")
        val vm = AppViewModel(TestApplication())
        vm.callSignalingTestHooks = CallSignalingTestHooks(
            webRtcController = controller,
            iceServersProvider = { emptyList() },
        )

        vm.initiateCall(chatId = "chat-1", targetId = "bob", isVideo = true)
        advanceUntilIdle()

        assertEquals("IDLE", vm.chatStore.call.value.status.name)
        assertEquals("", vm.chatStore.call.value.callId)
        assertEquals(listOf(controller.outgoingRequests.single().callId), controller.endedCalls)
    }

    @Test
    fun `accept call without transport does not activate call`() = runTest {
        val controller = FakeWebRtcController(answerSdp = "answer")
        val vm = AppViewModel(TestApplication()).apply {
            callSignalingTestHooks = CallSignalingTestHooks(
                webRtcController = controller,
                iceServersProvider = { emptyList() },
            )
            chatStore.onCallOffer(callId = "call-1", chatId = "chat-1", fromUserId = "bob", isVideo = true)
        }
        vm.onIncomingCallOffer(
            CallOfferSignal(
                callId = "call-1",
                chatId = "chat-1",
                fromUserId = "bob",
                sdp = "offer-sdp",
                isVideo = true,
            ),
        )

        vm.acceptCall()
        advanceUntilIdle()

        assertNotEquals("ACTIVE", vm.chatStore.call.value.status.name)
        assertEquals("RINGING_IN", vm.chatStore.call.value.status.name)
        assertEquals(listOf("call-1"), controller.endedCalls)
    }
}

private class FakeWebRtcController(
    private val offerSdp: String = "",
    private val answerSdp: String = "",
) : WebRtcController {
    val outgoingRequests = mutableListOf<OutgoingRequest>()
    val incomingRequests = mutableListOf<IncomingRequest>()
    val appliedAnswers = mutableListOf<Pair<String, String>>()
    val remoteIceCandidates = mutableListOf<IceCandidateSignal>()
    val endedCalls = mutableListOf<String>()

    override suspend fun startOutgoing(
        callId: String,
        isVideo: Boolean,
        iceServers: List<IceServerDto>,
    ): String {
        outgoingRequests += OutgoingRequest(callId, isVideo, iceServers)
        return offerSdp
    }

    override suspend fun acceptIncoming(
        callId: String,
        offerSdp: String,
        isVideo: Boolean,
        iceServers: List<IceServerDto>,
    ): String {
        incomingRequests += IncomingRequest(callId, offerSdp, isVideo, iceServers)
        return answerSdp
    }

    override fun applyAnswer(callId: String, answerSdp: String) {
        appliedAnswers += callId to answerSdp
    }

    override fun addRemoteIceCandidate(signal: IceCandidateSignal) {
        remoteIceCandidates += signal
    }

    override fun endCall(callId: String) {
        endedCalls += callId
    }
}

private data class OutgoingRequest(
    val callId: String,
    val isVideo: Boolean,
    val iceServers: List<IceServerDto>,
)

private data class IncomingRequest(
    val callId: String,
    val offerSdp: String,
    val isVideo: Boolean,
    val iceServers: List<IceServerDto>,
)

private class TestApplication : Application() {
    private val prefs = InMemorySharedPreferences()

    override fun getSharedPreferences(name: String?, mode: Int): SharedPreferences = prefs
}

private class InMemorySharedPreferences : SharedPreferences {
    private val data = ConcurrentHashMap<String, Any?>()

    override fun getAll(): MutableMap<String, *> = data.toMutableMap()
    override fun getString(key: String?, defValue: String?): String? = data[key] as? String ?: defValue
    override fun getStringSet(key: String?, defValues: MutableSet<String>?): MutableSet<String>? =
        @Suppress("UNCHECKED_CAST")
        (data[key] as? MutableSet<String>) ?: defValues
    override fun getInt(key: String?, defValue: Int): Int = data[key] as? Int ?: defValue
    override fun getLong(key: String?, defValue: Long): Long = data[key] as? Long ?: defValue
    override fun getFloat(key: String?, defValue: Float): Float = data[key] as? Float ?: defValue
    override fun getBoolean(key: String?, defValue: Boolean): Boolean = data[key] as? Boolean ?: defValue
    override fun contains(key: String?): Boolean = data.containsKey(key)

    override fun edit(): SharedPreferences.Editor = EditorImpl()

    override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit
    override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit

    private inner class EditorImpl : SharedPreferences.Editor {
        private val staged = mutableMapOf<String, Any?>()
        private var clearRequested = false

        override fun putString(key: String?, value: String?): SharedPreferences.Editor = apply { if (key != null) staged[key] = value }
        override fun putStringSet(key: String?, values: MutableSet<String>?): SharedPreferences.Editor = apply { if (key != null) staged[key] = values?.toMutableSet() }
        override fun putInt(key: String?, value: Int): SharedPreferences.Editor = apply { if (key != null) staged[key] = value }
        override fun putLong(key: String?, value: Long): SharedPreferences.Editor = apply { if (key != null) staged[key] = value }
        override fun putFloat(key: String?, value: Float): SharedPreferences.Editor = apply { if (key != null) staged[key] = value }
        override fun putBoolean(key: String?, value: Boolean): SharedPreferences.Editor = apply { if (key != null) staged[key] = value }
        override fun remove(key: String?): SharedPreferences.Editor = apply { if (key != null) staged[key] = null }
        override fun clear(): SharedPreferences.Editor = apply { clearRequested = true }
        override fun commit(): Boolean {
            apply()
            return true
        }
        override fun apply() {
            if (clearRequested) {
                data.clear()
                clearRequested = false
            }
            for ((key, value) in staged) {
                if (value == null) data.remove(key) else data[key] = value
            }
            staged.clear()
        }
    }
}
