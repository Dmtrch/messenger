# Android WebRTC Step B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести Android звонки со stub SDP на реальный WebRTC media path с локальным превью, remote video и обменом ICE кандидатами по текущему WebSocket signaling.

**Architecture:** Android-specific WebRTC lifecycle живёт в отдельном `AndroidWebRtcController`, а `AppViewModel` остаётся orchestration-layer для store и signaling payloads. `WSOrchestrator` расширяется до обработки `call_offer`, `call_answer` и `ice_candidate`, а `CallOverlay` получает минимальную интеграцию `SurfaceViewRenderer` без дополнительных call controls.

**Tech Stack:** Kotlin, Android ViewModel, Jetpack Compose, `org.webrtc:google-webrtc`, Ktor WebSocket, JUnit 5, Gradle.

---

## File Map

- Modify: `apps/mobile/android/build.gradle.kts`
  Add dependency `org.webrtc:google-webrtc` and keep existing Android test/runtime setup unchanged.
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/store/AppState.kt`
  Extend `CallState` with top-level UI flags for local preview / remote video and optional error text.
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/store/ChatStore.kt`
  Add minimal store helpers for new call flags and incoming SDP/ICE-related transitions if needed.
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/service/WSOrchestrator.kt`
  Parse `sdp` and `ice_candidate` payloads and route them into a call signaling bridge.
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/AppViewModel.kt`
  Replace `stub-sdp` flow with controller-driven offer/answer/ICE and tie lifecycle cleanup to hangup/reject/end.
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/ui/App.kt`
  Pass WebRTC renderer/controller bindings from `AppViewModel` into `CallOverlay`.
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/ui/screens/CallOverlay.kt`
  Render remote video and local preview using Android `SurfaceViewRenderer`.
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/service/call/CallSignalingModels.kt`
  Shared Android signaling payload models for offer/answer/ICE.
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/service/call/AndroidWebRtcController.kt`
  Android-only WebRTC controller for peer connection, tracks, ICE and renderer lifecycle.
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/service/call/AndroidVideoRendererBinding.kt`
  Small holder around `SurfaceViewRenderer` / `EglBase` bindings for Compose interop.
- Create: `apps/mobile/android/src/test/kotlin/com/messenger/service/WSOrchestratorCallSignalingTest.kt`
  Contract tests for incoming offer/answer/ICE parsing.
- Create: `apps/mobile/android/src/test/kotlin/com/messenger/viewmodel/AppViewModelCallSignalingTest.kt`
  Contract tests for outgoing offer/answer/ICE payload generation without real WebRTC runtime.

### Task 1: Lock signaling contracts with failing tests

**Files:**
- Create: `apps/mobile/android/src/test/kotlin/com/messenger/service/WSOrchestratorCallSignalingTest.kt`
- Create: `apps/mobile/android/src/test/kotlin/com/messenger/viewmodel/AppViewModelCallSignalingTest.kt`
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/service/WSOrchestrator.kt`
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/AppViewModel.kt`
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/service/call/CallSignalingModels.kt`

- [ ] **Step 1: Write the failing `WSOrchestrator` contract test**

```kotlin
package com.messenger.service

import com.messenger.store.ChatStore
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals

class WSOrchestratorCallSignalingTest {
    @Test
    fun `call offer forwards sdp and video flag into signaling bridge`() {
        val events = mutableListOf<String>()
        val orchestrator = WSOrchestrator(
            ratchet = FakeRatchet(),
            senderKey = FakeSenderKey(),
            chatStore = ChatStore(),
            db = FakeMessengerDatabase(),
            currentUserId = "alice",
            onCallOffer = { offer -> events += "offer:${offer.callId}:${offer.sdp}:${offer.isVideo}" },
            onCallAnswer = { answer -> events += "answer:${answer.callId}:${answer.sdp}" },
            onIceCandidate = { ice -> events += "ice:${ice.callId}:${ice.sdpMid}:${ice.sdpMLineIndex}" },
        )

        orchestrator.onFrame(Json.parseToJsonElement("""
            {"type":"call_offer","callId":"c1","chatId":"chat-1","senderId":"bob","sdp":"offer-sdp","isVideo":true}
        """.trimIndent()))

        assertEquals(listOf("offer:c1:offer-sdp:true"), events)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile/android && ./gradlew test --tests com.messenger.service.WSOrchestratorCallSignalingTest`

Expected: FAIL because `WSOrchestrator` does not yet accept signaling callbacks or parse `sdp` / `isVideo`.

- [ ] **Step 3: Write the failing `AppViewModel` signaling payload test**

```kotlin
package com.messenger.viewmodel

import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals

class AppViewModelCallSignalingTest {
    @Test
    fun `initiate call sends call offer with controller sdp instead of stub`() {
        val sentFrames = mutableListOf<String>()
        val vm = buildTestViewModel(
            wsSend = { sentFrames += it },
            webRtcController = FakeWebRtcController(
                offerSdp = "real-offer-sdp"
            ),
        )

        vm.initiateCall(chatId = "chat-1", targetId = "bob", isVideo = true)

        val payload = Json.parseToJsonElement(sentFrames.single()).jsonObject
        assertEquals("call_offer", payload["type"]?.jsonPrimitive?.content)
        assertEquals("real-offer-sdp", payload["sdp"]?.jsonPrimitive?.content)
    }
}
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/mobile/android && ./gradlew test --tests com.messenger.viewmodel.AppViewModelCallSignalingTest`

Expected: FAIL because `AppViewModel` still emits `stub-sdp` and has no controller seam for tests.

- [ ] **Step 5: Add minimal signaling models and seams**

```kotlin
package com.messenger.service.call

data class CallOfferSignal(
    val callId: String,
    val chatId: String,
    val fromUserId: String,
    val sdp: String,
    val isVideo: Boolean,
)

data class CallAnswerSignal(
    val callId: String,
    val sdp: String,
)

data class IceCandidateSignal(
    val callId: String,
    val sdpMid: String,
    val sdpMLineIndex: Int,
    val candidate: String,
)
```

- [ ] **Step 6: Make tests pass with minimal routing changes**

```kotlin
class WSOrchestrator(
    // existing args...
    private val onCallOffer: (CallOfferSignal) -> Unit = {},
    private val onCallAnswer: (CallAnswerSignal) -> Unit = {},
    private val onIceCandidate: (IceCandidateSignal) -> Unit = {},
)
```

```kotlin
private fun handleCallOffer(obj: JsonObject) {
    val signal = CallOfferSignal(
        callId = obj["callId"]!!.jsonPrimitive.content,
        chatId = obj["chatId"]!!.jsonPrimitive.content,
        fromUserId = obj["senderDeviceId"]?.jsonPrimitive?.content
            ?: obj["senderId"]!!.jsonPrimitive.content,
        sdp = obj["sdp"]?.jsonPrimitive?.content.orEmpty(),
        isVideo = obj["isVideo"]?.jsonPrimitive?.booleanOrNull ?: false,
    )
    chatStore.onCallOffer(signal.callId, signal.chatId, signal.fromUserId, signal.isVideo)
    onCallOffer(signal)
}
```

- [ ] **Step 7: Run both tests to verify they pass**

Run: `cd apps/mobile/android && ./gradlew test --tests com.messenger.service.WSOrchestratorCallSignalingTest --tests com.messenger.viewmodel.AppViewModelCallSignalingTest`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/android/src/test/kotlin/com/messenger/service/WSOrchestratorCallSignalingTest.kt \
  apps/mobile/android/src/test/kotlin/com/messenger/viewmodel/AppViewModelCallSignalingTest.kt \
  apps/mobile/android/src/main/kotlin/com/messenger/service/WSOrchestrator.kt \
  apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/AppViewModel.kt \
  apps/mobile/android/src/main/kotlin/com/messenger/service/call/CallSignalingModels.kt \
  apps/mobile/android/src/main/kotlin/com/messenger/store/ChatStore.kt
git commit -m "test: lock android call signaling contracts"
```

### Task 2: Add Android WebRTC controller and real offer/answer/ICE flow

**Files:**
- Modify: `apps/mobile/android/build.gradle.kts`
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/service/call/AndroidWebRtcController.kt`
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/AppViewModel.kt`
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/service/ApiClient.kt`

- [ ] **Step 1: Write the failing controller-facing test seam**

```kotlin
@Test
fun `accept call sends answer from controller and notifies active state`() {
    val sentFrames = mutableListOf<String>()
    val vm = buildTestViewModel(
        wsSend = { sentFrames += it },
        webRtcController = FakeWebRtcController(answerSdp = "real-answer-sdp")
    )
    vm.chatStore.onCallOffer("c1", "chat-1", "bob", true)

    vm.acceptCall()

    val payload = Json.parseToJsonElement(sentFrames.single()).jsonObject
    assertEquals("call_answer", payload["type"]?.jsonPrimitive?.content)
    assertEquals("real-answer-sdp", payload["sdp"]?.jsonPrimitive?.content)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile/android && ./gradlew test --tests com.messenger.viewmodel.AppViewModelCallSignalingTest`

Expected: FAIL because `acceptCall()` still sends hard-coded `stub-sdp`.

- [ ] **Step 3: Add WebRTC dependency**

```kotlin
dependencies {
    implementation("org.webrtc:google-webrtc:1.0.+")
}
```

- [ ] **Step 4: Create minimal controller contract and implementation**

```kotlin
package com.messenger.service.call

interface WebRtcController {
    suspend fun startOutgoing(callId: String, isVideo: Boolean, iceServers: List<IceServerDto>): String
    suspend fun acceptIncoming(callId: String, offerSdp: String, isVideo: Boolean, iceServers: List<IceServerDto>): String
    fun applyAnswer(callId: String, answerSdp: String)
    fun addRemoteIceCandidate(signal: IceCandidateSignal)
    fun endCall(callId: String)
}
```

```kotlin
class AndroidWebRtcController(
    private val appContext: Context,
    private val onIceCandidate: (IceCandidateSignal) -> Unit,
    private val onRemoteTrack: () -> Unit,
) : WebRtcController {
    override suspend fun startOutgoing(callId: String, isVideo: Boolean, iceServers: List<IceServerDto>): String {
        ensurePeerConnection(callId, isVideo, iceServers)
        startLocalMedia(isVideo = isVideo)
        return createOfferSdp()
    }
}
```

- [ ] **Step 5: Wire `AppViewModel` to controller**

```kotlin
suspend fun initiateCall(chatId: String, targetId: String, isVideo: Boolean) {
    val callId = UUID.randomUUID().toString()
    chatStore.setOutgoingCall(callId, chatId, targetId, isVideo)
    val iceServers = apiClient?.getIceServers()?.iceServers.orEmpty()
    val offerSdp = webRtcController.startOutgoing(callId, isVideo, iceServers)
    sendCallFrame(buildJsonObject {
        put("type", "call_offer")
        put("callId", callId)
        put("chatId", chatId)
        put("targetId", targetId)
        put("sdp", offerSdp)
        put("isVideo", isVideo)
    }.toString())
}
```

- [ ] **Step 6: Emit local ICE through existing WS channel**

```kotlin
private fun sendIceCandidate(signal: IceCandidateSignal) {
    sendCallFrame(buildJsonObject {
        put("type", "ice_candidate")
        put("callId", signal.callId)
        put("sdpMid", signal.sdpMid)
        put("sdpMLineIndex", signal.sdpMLineIndex)
        put("candidate", signal.candidate)
    }.toString())
}
```

- [ ] **Step 7: Run tests to verify controller orchestration passes**

Run: `cd apps/mobile/android && ./gradlew test --tests com.messenger.viewmodel.AppViewModelCallSignalingTest`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/android/build.gradle.kts \
  apps/mobile/android/src/main/kotlin/com/messenger/service/call/AndroidWebRtcController.kt \
  apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/AppViewModel.kt \
  apps/mobile/android/src/main/kotlin/com/messenger/service/ApiClient.kt
git commit -m "feat: add android webrtc controller"
```

### Task 3: Connect incoming signaling, state flags and renderer bindings

**Files:**
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/store/AppState.kt`
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/store/ChatStore.kt`
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/service/WSOrchestrator.kt`
- Create: `apps/mobile/android/src/main/kotlin/com/messenger/service/call/AndroidVideoRendererBinding.kt`
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/AppViewModel.kt`

- [ ] **Step 1: Write the failing store/state test**

```kotlin
@Test
fun `incoming video offer marks preview flags false until tracks attach`() {
    val store = ChatStore()

    store.onCallOffer(callId = "c1", chatId = "chat-1", fromUserId = "bob", isVideo = true)

    assertEquals(CallStatus.RINGING_IN, store.call.value.status)
    assertEquals(false, store.call.value.hasLocalVideo)
    assertEquals(false, store.call.value.hasRemoteVideo)
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/mobile/android && ./gradlew test --tests com.messenger.store.ChatStoreCallStateTest`

Expected: FAIL because `CallState` does not yet expose preview flags.

- [ ] **Step 3: Extend call state and store helpers**

```kotlin
data class CallState(
    val status: CallStatus = CallStatus.IDLE,
    val callId: String = "",
    val chatId: String = "",
    val remoteUserId: String = "",
    val isVideo: Boolean = false,
    val hasLocalVideo: Boolean = false,
    val hasRemoteVideo: Boolean = false,
    val errorText: String? = null,
)
```

```kotlin
fun markLocalVideoReady(callId: String) {
    if (_call.value.callId == callId) _call.value = _call.value.copy(hasLocalVideo = true)
}
```

- [ ] **Step 4: Route incoming answer and ICE into controller**

```kotlin
private fun handleCallAnswer(obj: JsonObject) {
    val signal = CallAnswerSignal(
        callId = obj["callId"]!!.jsonPrimitive.content,
        sdp = obj["sdp"]!!.jsonPrimitive.content,
    )
    chatStore.onCallAnswer(signal.callId)
    onCallAnswer(signal)
}

private fun handleIceCandidate(obj: JsonObject) {
    onIceCandidate(
        IceCandidateSignal(
            callId = obj["callId"]!!.jsonPrimitive.content,
            sdpMid = obj["sdpMid"]!!.jsonPrimitive.content,
            sdpMLineIndex = obj["sdpMLineIndex"]!!.jsonPrimitive.int,
            candidate = obj["candidate"]!!.jsonPrimitive.content,
        )
    )
}
```

- [ ] **Step 5: Add renderer binding holder**

```kotlin
class AndroidVideoRendererBinding(
    val eglBase: EglBase = EglBase.create(),
) {
    var localRenderer: SurfaceViewRenderer? = null
    var remoteRenderer: SurfaceViewRenderer? = null
}
```

- [ ] **Step 6: Run signaling and store tests**

Run: `cd apps/mobile/android && ./gradlew test --tests com.messenger.service.WSOrchestratorCallSignalingTest --tests com.messenger.store.ChatStoreCallStateTest`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/android/src/main/kotlin/com/messenger/store/AppState.kt \
  apps/mobile/android/src/main/kotlin/com/messenger/store/ChatStore.kt \
  apps/mobile/android/src/main/kotlin/com/messenger/service/WSOrchestrator.kt \
  apps/mobile/android/src/main/kotlin/com/messenger/service/call/AndroidVideoRendererBinding.kt \
  apps/mobile/android/src/main/kotlin/com/messenger/viewmodel/AppViewModel.kt
git commit -m "feat: wire android call state and signaling"
```

### Task 4: Render local and remote video in Compose overlay and verify build

**Files:**
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/ui/App.kt`
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/ui/screens/CallOverlay.kt`
- Modify: `apps/mobile/android/src/main/kotlin/com/messenger/service/call/AndroidWebRtcController.kt`

- [ ] **Step 1: Write the failing UI smoke test or compile target**

```kotlin
@Test
fun `active video call shows renderer placeholders instead of step a stub text`() {
    val callState = CallState(
        status = CallStatus.ACTIVE,
        callId = "c1",
        remoteUserId = "bob",
        isVideo = true,
        hasLocalVideo = true,
        hasRemoteVideo = false,
    )

    composeRule.setContent {
        CallOverlay(
            callState = callState,
            rendererBinding = AndroidVideoRendererBinding(),
            onAccept = {},
            onReject = {},
            onHangUp = {},
        )
    }

    composeRule.onNodeWithText("Медиа недоступно (заглушка Step A)").assertDoesNotExist()
}
```

- [ ] **Step 2: Run verification to confirm current implementation fails expectation**

Run: `cd apps/mobile/android && ./gradlew test --tests com.messenger.ui.CallOverlayTest`

Expected: FAIL because overlay still renders Step A stub text and has no renderer binding.

- [ ] **Step 3: Replace stub UI with AndroidView-backed renderers**

```kotlin
if (callState.isVideo) {
    Box(Modifier.fillMaxSize()) {
        AndroidView(factory = { context ->
            SurfaceViewRenderer(context).also { renderer ->
                renderer.init(rendererBinding.eglBase.eglBaseContext, null)
                rendererBinding.remoteRenderer = renderer
            }
        }, modifier = Modifier.fillMaxSize())

        AndroidView(factory = { context ->
            SurfaceViewRenderer(context).also { renderer ->
                renderer.init(rendererBinding.eglBase.eglBaseContext, null)
                renderer.setMirror(true)
                rendererBinding.localRenderer = renderer
            }
        }, modifier = Modifier
            .align(Alignment.TopEnd)
            .padding(16.dp)
            .size(width = 120.dp, height = 180.dp))
    }
}
```

- [ ] **Step 4: Ensure controller attaches tracks and cleans up**

```kotlin
fun bindRenderers(binding: AndroidVideoRendererBinding) {
    localVideoTrack?.addSink(binding.localRenderer)
    remoteVideoTrack?.addSink(binding.remoteRenderer)
}

fun endCall(callId: String) {
    peerConnection?.close()
    cameraCapturer?.stopCapture()
    localVideoTrack = null
    remoteVideoTrack = null
}
```

- [ ] **Step 5: Run Android verification suite**

Run: `cd apps/mobile/android && ./gradlew test`
Expected: PASS

Run: `cd apps/mobile/android && ./gradlew assembleDebug`
Expected: BUILD SUCCESSFUL

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/android/src/main/kotlin/com/messenger/ui/App.kt \
  apps/mobile/android/src/main/kotlin/com/messenger/ui/screens/CallOverlay.kt \
  apps/mobile/android/src/main/kotlin/com/messenger/service/call/AndroidWebRtcController.kt
git commit -m "feat: render android webrtc video overlay"
```

## Final Verification

- [ ] Run: `cd apps/mobile/android && ./gradlew test`
  Expected: PASS.
- [ ] Run: `cd apps/mobile/android && ./gradlew assembleDebug`
  Expected: BUILD SUCCESSFUL.
- [ ] Run: `cd apps/desktop && ./gradlew build`
  Expected: BUILD SUCCESSFUL with Desktop still on stub media behavior.
- [ ] Manual check: Android to Android video call shows local preview immediately after start/accept.
- [ ] Manual check: Remote video appears after answer + ICE exchange.
- [ ] Manual check: `hangUp()` and remote `call_end` both release camera and dismiss overlay.

## Self-Review

- Spec coverage: plan covers dependency setup, controller extraction, real SDP/ICE flow, Compose renderer integration, cleanup and verification. iOS/Desktop media remains explicitly out of scope.
- Placeholder scan: removed generic TODO language; every task has exact files, commands and code skeletons.
- Type consistency: plan uses `CallOfferSignal`, `CallAnswerSignal`, `IceCandidateSignal`, `WebRtcController`, `AndroidVideoRendererBinding` consistently across tasks.
