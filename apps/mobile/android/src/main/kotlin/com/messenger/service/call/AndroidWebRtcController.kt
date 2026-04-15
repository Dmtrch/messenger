package com.messenger.service.call

import android.content.Context
import com.messenger.service.IceServerDto
import kotlinx.coroutines.suspendCancellableCoroutine
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

interface WebRtcController {
    suspend fun startOutgoing(callId: String, isVideo: Boolean, iceServers: List<IceServerDto>): String
    suspend fun acceptIncoming(callId: String, offerSdp: String, isVideo: Boolean, iceServers: List<IceServerDto>): String
    fun applyAnswer(callId: String, answerSdp: String)
    fun addRemoteIceCandidate(signal: IceCandidateSignal)
    fun endCall(callId: String)
}

class AndroidWebRtcController(
    appContext: Context,
    private val onIceCandidate: (IceCandidateSignal) -> Unit = {},
    private val onLocalVideoReady: (callId: String) -> Unit = {},
    private val onRemoteVideoReady: (callId: String) -> Unit = {},
) : WebRtcController {
    private val context = appContext.applicationContext
    private val eglBase = EglBase.create()
    private val factory = createPeerConnectionFactory(context, eglBase)
    private val sessions = ConcurrentHashMap<String, CallPeerSession>()

    override suspend fun startOutgoing(
        callId: String,
        isVideo: Boolean,
        iceServers: List<IceServerDto>,
    ): String {
        val session = createSession(callId, isVideo, iceServers)
        val offer = session.peerConnection.createOfferAwait()
        session.peerConnection.setLocalDescriptionAwait(offer)
        return offer.description
    }

    override suspend fun acceptIncoming(
        callId: String,
        offerSdp: String,
        isVideo: Boolean,
        iceServers: List<IceServerDto>,
    ): String {
        val session = createSession(callId, isVideo, iceServers)
        session.peerConnection.setRemoteDescriptionAwait(
            SessionDescription(SessionDescription.Type.OFFER, offerSdp),
        )
        val answer = session.peerConnection.createAnswerAwait()
        session.peerConnection.setLocalDescriptionAwait(answer)
        return answer.description
    }

    override fun applyAnswer(callId: String, answerSdp: String) {
        val session = sessions[callId] ?: return
        session.peerConnection.setRemoteDescription(
            LoggingSdpObserver(),
            SessionDescription(SessionDescription.Type.ANSWER, answerSdp),
        )
    }

    override fun addRemoteIceCandidate(signal: IceCandidateSignal) {
        sessions[signal.callId]?.peerConnection?.addIceCandidate(
            IceCandidate(signal.sdpMid, signal.sdpMLineIndex, signal.candidate),
        )
    }

    override fun endCall(callId: String) {
        sessions.remove(callId)?.close()
    }

    fun bindRenderers(callId: String, binding: AndroidVideoRendererBinding) {
        val session = sessions[callId] ?: return
        binding.localRenderer?.let { session.localVideoTrack?.addSink(it) }
        binding.remoteRenderer?.let { session.remoteVideoTrack?.addSink(it) }
    }

    private fun createSession(
        callId: String,
        isVideo: Boolean,
        iceServers: List<IceServerDto>,
    ): CallPeerSession {
        sessions.remove(callId)?.close()
        val rtcConfig = PeerConnection.RTCConfiguration(iceServers.map(::toPeerIceServer)).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }
        val peerConnection = factory.createPeerConnection(
            rtcConfig,
            object : PeerConnection.Observer {
                override fun onIceCandidate(candidate: IceCandidate?) {
                    val localCandidate = candidate ?: return
                    onIceCandidate(
                        IceCandidateSignal(
                            callId = callId,
                            sdpMid = localCandidate.sdpMid.orEmpty(),
                            sdpMLineIndex = localCandidate.sdpMLineIndex,
                            candidate = localCandidate.sdp,
                        ),
                    )
                }

                override fun onAddStream(stream: org.webrtc.MediaStream?) = Unit
                override fun onSignalingChange(state: PeerConnection.SignalingState?) = Unit
                override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) = Unit
                override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
                override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) = Unit
                override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) = Unit
                override fun onRemoveStream(stream: org.webrtc.MediaStream?) = Unit
                override fun onDataChannel(channel: org.webrtc.DataChannel?) = Unit
                override fun onRenegotiationNeeded() = Unit
                override fun onAddTrack(receiver: RtpReceiver?, mediaStreams: Array<out org.webrtc.MediaStream>?) = Unit
                override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) = Unit
                override fun onStandardizedIceConnectionChange(newState: PeerConnection.IceConnectionState?) = Unit
                override fun onSelectedCandidatePairChanged(event: org.webrtc.CandidatePairChangeEvent?) = Unit
                override fun onTrack(transceiver: org.webrtc.RtpTransceiver?) {
                    val track = transceiver?.receiver?.track() ?: return
                    if (track is VideoTrack) {
                        sessions[callId]?.remoteVideoTrack = track
                        onRemoteVideoReady(callId)
                    }
                }
            },
        ) ?: error("Failed to create PeerConnection for call $callId")

        val audioSource = factory.createAudioSource(MediaConstraints())
        val audioTrack = factory.createAudioTrack("audio-$callId", audioSource)
        peerConnection.addTrack(audioTrack, listOf("stream-$callId"))

        var videoSource: VideoSource? = null
        var videoTrack: VideoTrack? = null
        if (isVideo) {
            videoSource = factory.createVideoSource(false)
            videoTrack = factory.createVideoTrack("video-$callId", videoSource)
            peerConnection.addTrack(videoTrack, listOf("stream-$callId"))
            onLocalVideoReady(callId)
        }

        return CallPeerSession(
            peerConnection = peerConnection,
            audioSource = audioSource,
            audioTrack = audioTrack,
            videoSource = videoSource,
            localVideoTrack = videoTrack,
        ).also { sessions[callId] = it }
    }

    private fun toPeerIceServer(dto: IceServerDto): PeerConnection.IceServer {
        val builder = PeerConnection.IceServer.builder(dto.urls)
        dto.username?.let(builder::setUsername)
        dto.credential?.let(builder::setPassword)
        return builder.createIceServer()
    }

    companion object {
        @Volatile
        private var initialized = false

        private fun createPeerConnectionFactory(
            context: Context,
            eglBase: EglBase,
        ): PeerConnectionFactory {
            ensureInitialized(context)
            return PeerConnectionFactory
                .builder()
                .setVideoEncoderFactory(
                    DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true),
                )
                .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
                .createPeerConnectionFactory()
        }

        private fun ensureInitialized(context: Context) {
            if (initialized) return
            synchronized(this) {
                if (initialized) return
                PeerConnectionFactory.initialize(
                    PeerConnectionFactory.InitializationOptions
                        .builder(context)
                        .createInitializationOptions(),
                )
                initialized = true
            }
        }
    }
}

private class CallPeerSession(
    val peerConnection: PeerConnection,
    val audioSource: AudioSource,
    val audioTrack: AudioTrack,
    val videoSource: VideoSource?,
    val localVideoTrack: VideoTrack?,
) {
    var remoteVideoTrack: VideoTrack? = null

    fun close() {
        remoteVideoTrack?.dispose()
        localVideoTrack?.dispose()
        videoSource?.dispose()
        audioTrack.dispose()
        audioSource.dispose()
        peerConnection.dispose()
    }
}

private class LoggingSdpObserver : SdpObserver {
    override fun onCreateSuccess(sdp: SessionDescription?) = Unit
    override fun onSetSuccess() = Unit
    override fun onCreateFailure(error: String?) = Unit
    override fun onSetFailure(error: String?) = Unit
}

private suspend fun PeerConnection.createOfferAwait(): SessionDescription =
    suspendCancellableCoroutine { continuation ->
        createOffer(
            object : SdpObserver {
                override fun onCreateSuccess(sdp: SessionDescription?) {
                    if (sdp == null) {
                        continuation.resumeWithException(IllegalStateException("createOffer returned null SDP"))
                        return
                    }
                    continuation.resume(sdp)
                }

                override fun onCreateFailure(error: String?) {
                    continuation.resumeWithException(
                        IllegalStateException(error ?: "createOffer failed"),
                    )
                }

                override fun onSetSuccess() = Unit
                override fun onSetFailure(error: String?) = Unit
            },
            MediaConstraints(),
        )
    }

private suspend fun PeerConnection.createAnswerAwait(): SessionDescription =
    suspendCancellableCoroutine { continuation ->
        createAnswer(
            object : SdpObserver {
                override fun onCreateSuccess(sdp: SessionDescription?) {
                    if (sdp == null) {
                        continuation.resumeWithException(IllegalStateException("createAnswer returned null SDP"))
                        return
                    }
                    continuation.resume(sdp)
                }

                override fun onCreateFailure(error: String?) {
                    continuation.resumeWithException(
                        IllegalStateException(error ?: "createAnswer failed"),
                    )
                }

                override fun onSetSuccess() = Unit
                override fun onSetFailure(error: String?) = Unit
            },
            MediaConstraints(),
        )
    }

private suspend fun PeerConnection.setLocalDescriptionAwait(sdp: SessionDescription) {
    suspendCancellableCoroutine<Unit> { continuation ->
        setLocalDescription(
            object : SdpObserver {
                override fun onSetSuccess() {
                    continuation.resume(Unit)
                }

                override fun onSetFailure(error: String?) {
                    continuation.resumeWithException(
                        IllegalStateException(error ?: "setLocalDescription failed"),
                    )
                }

                override fun onCreateSuccess(sdp: SessionDescription?) = Unit
                override fun onCreateFailure(error: String?) = Unit
            },
            sdp,
        )
    }
}

private suspend fun PeerConnection.setRemoteDescriptionAwait(sdp: SessionDescription) {
    suspendCancellableCoroutine<Unit> { continuation ->
        setRemoteDescription(
            object : SdpObserver {
                override fun onSetSuccess() {
                    continuation.resume(Unit)
                }

                override fun onSetFailure(error: String?) {
                    continuation.resumeWithException(
                        IllegalStateException(error ?: "setRemoteDescription failed"),
                    )
                }

                override fun onCreateSuccess(sdp: SessionDescription?) = Unit
                override fun onCreateFailure(error: String?) = Unit
            },
            sdp,
        )
    }
}
