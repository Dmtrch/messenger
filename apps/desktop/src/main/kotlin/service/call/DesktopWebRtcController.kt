package service.call

import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import dev.onvoid.webrtc.*
import dev.onvoid.webrtc.media.MediaDevices
import dev.onvoid.webrtc.media.MediaStream
import dev.onvoid.webrtc.media.audio.AudioOptions
import dev.onvoid.webrtc.media.audio.AudioTrack
import dev.onvoid.webrtc.media.audio.AudioTrackSource
import dev.onvoid.webrtc.media.video.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import service.IceServerDto
import java.awt.image.BufferedImage
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

class DesktopWebRtcController(
    private val onIceCandidate: (IceCandidateSignal) -> Unit = {},
    private val onLocalVideoReady: (callId: String) -> Unit = {},
    private val onRemoteVideoReady: (callId: String) -> Unit = {},
) : WebRtcController {

    private val factory  = PeerConnectionFactory()
    private val sessions = ConcurrentHashMap<String, DesktopCallSession>()

    private val _localFrame  = MutableStateFlow<ImageBitmap?>(null)
    private val _remoteFrame = MutableStateFlow<ImageBitmap?>(null)
    val localFrame:  StateFlow<ImageBitmap?> = _localFrame.asStateFlow()
    val remoteFrame: StateFlow<ImageBitmap?> = _remoteFrame.asStateFlow()

    // ── WebRtcController ──────────────────────────────────────────────────────

    override suspend fun startOutgoing(
        callId: String,
        isVideo: Boolean,
        iceServers: List<IceServerDto>,
    ): String {
        val session = createSession(callId, isVideo, iceServers)
        val offer   = session.peerConnection.createOfferAwait()
        session.peerConnection.setLocalDescriptionAwait(offer)
        return offer.sdp
    }

    override suspend fun acceptIncoming(
        callId: String,
        offerSdp: String,
        isVideo: Boolean,
        iceServers: List<IceServerDto>,
    ): String {
        val session = createSession(callId, isVideo, iceServers)
        session.peerConnection.setRemoteDescriptionAwait(
            RTCSessionDescription(RTCSdpType.OFFER, offerSdp),
        )
        val answer = session.peerConnection.createAnswerAwait()
        session.peerConnection.setLocalDescriptionAwait(answer)
        return answer.sdp
    }

    override fun applyAnswer(callId: String, answerSdp: String) {
        val session = sessions[callId] ?: return
        session.peerConnection.setRemoteDescription(
            RTCSessionDescription(RTCSdpType.ANSWER, answerSdp),
            noopSetObserver(),
        )
    }

    override fun addRemoteIceCandidate(signal: IceCandidateSignal) {
        sessions[signal.callId]?.peerConnection?.addIceCandidate(
            RTCIceCandidate(signal.sdpMid, signal.sdpMLineIndex, signal.candidate),
        )
    }

    override fun endCall(callId: String) {
        sessions.remove(callId)?.close()
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    private fun createSession(
        callId: String,
        isVideo: Boolean,
        iceServers: List<IceServerDto>,
    ): DesktopCallSession {
        sessions.remove(callId)?.close()

        val config = RTCConfiguration().apply {
            this.iceServers = iceServers.map { dto ->
                RTCIceServer().apply {
                    urls     = listOf(dto.urls)
                    username = dto.username   ?: ""
                    password = dto.credential ?: ""
                }
            }
        }

        val localVideoSink  = makeVideoSink(_localFrame)
        val remoteVideoSink = makeVideoSink(_remoteFrame)

        val peerConnection = factory.createPeerConnection(
            config,
            object : PeerConnectionObserver {
                override fun onIceCandidate(candidate: RTCIceCandidate) {
                    onIceCandidate(
                        IceCandidateSignal(
                            callId        = callId,
                            sdpMid        = candidate.sdpMid.orEmpty(),
                            sdpMLineIndex = candidate.sdpMLineIndex,
                            candidate     = candidate.sdp,
                        ),
                    )
                }

                override fun onTrack(transceiver: RTCRtpTransceiver) {
                    val track = transceiver.getReceiver()?.getTrack() ?: return
                    if (track is VideoTrack) {
                        sessions[callId]?.remoteVideoTrack = track
                        track.addSink(remoteVideoSink)
                        onRemoteVideoReady(callId)
                    }
                }
            },
        )

        val audioSource = factory.createAudioSource(AudioOptions())
        val audioTrack  = factory.createAudioTrack("audio-$callId", audioSource)
        peerConnection.addTrack(audioTrack, listOf("stream-$callId"))

        var videoSource: VideoDeviceSource? = null
        var localVideoTrack: VideoTrack?    = null
        if (isVideo) {
            videoSource     = VideoDeviceSource()
            tryStartCamera(videoSource)
            localVideoTrack = factory.createVideoTrack("video-$callId", videoSource)
            peerConnection.addTrack(localVideoTrack, listOf("stream-$callId"))
            localVideoTrack.addSink(localVideoSink)
            onLocalVideoReady(callId)
        }

        return DesktopCallSession(
            peerConnection  = peerConnection,
            audioSource     = audioSource,
            audioTrack      = audioTrack,
            videoSource     = videoSource,
            localVideoTrack = localVideoTrack,
            localVideoSink  = localVideoSink,
            remoteVideoSink = remoteVideoSink,
        ).also { sessions[callId] = it }
    }

    /** Попытка запустить первую доступную камеру; молча пропускаем если нет устройств. */
    private fun tryStartCamera(source: VideoDeviceSource) {
        try {
            val devices = MediaDevices.getVideoCaptureDevices()
            if (devices.isNotEmpty()) {
                source.setVideoCaptureDevice(devices.first())
                source.start()
            }
        } catch (_: Exception) { /* Камера недоступна — звонок продолжится без видео */ }
    }

    /** VideoTrackSink, конвертирующий I420 → ImageBitmap с троттлингом ≤15 fps. */
    private fun makeVideoSink(target: MutableStateFlow<ImageBitmap?>): VideoTrackSink {
        var lastMs = 0L
        return object : VideoTrackSink {
            override fun onVideoFrame(frame: VideoFrame) {
                val now = System.currentTimeMillis()
                if (now - lastMs < 66L) return
                lastMs = now
                target.value = frame.toImageBitmap()
            }
        }
    }

    private fun noopSetObserver() = object : SetSessionDescriptionObserver {
        override fun onSuccess()               = Unit
        override fun onFailure(error: String?) = Unit
    }
}

// ── Session holder ────────────────────────────────────────────────────────────

private class DesktopCallSession(
    val peerConnection:  RTCPeerConnection,
    val audioSource:     AudioTrackSource,
    val audioTrack:      AudioTrack,
    val videoSource:     VideoDeviceSource?,
    val localVideoTrack: VideoTrack?,
    val localVideoSink:  VideoTrackSink,
    val remoteVideoSink: VideoTrackSink,
) {
    var remoteVideoTrack: VideoTrack? = null

    fun close() {
        localVideoTrack?.removeSink(localVideoSink)
        remoteVideoTrack?.removeSink(remoteVideoSink)
        videoSource?.stop()
        videoSource?.dispose()
        localVideoTrack?.dispose()
        remoteVideoTrack?.dispose()
        audioTrack.dispose()
        peerConnection.close()
    }
}

// ── I420 → ImageBitmap ────────────────────────────────────────────────────────

private fun VideoFrame.toImageBitmap(): ImageBitmap? {
    val i420 = buffer.toI420() ?: return null
    return try {
        val w   = i420.getWidth()
        val h   = i420.getHeight()
        val img = BufferedImage(w, h, BufferedImage.TYPE_INT_RGB)
        val dY  = i420.getDataY()
        val dU  = i420.getDataU()
        val dV  = i420.getDataV()
        val sY  = i420.getStrideY()
        val sU  = i420.getStrideU()
        val sV  = i420.getStrideV()
        for (y in 0 until h) {
            for (x in 0 until w) {
                val Y = (dY.get(y * sY + x).toInt() and 0xFF)
                val U = (dU.get((y shr 1) * sU + (x shr 1)).toInt() and 0xFF) - 128
                val V = (dV.get((y shr 1) * sV + (x shr 1)).toInt() and 0xFF) - 128
                val r = (Y + 1.370705f * V).toInt().coerceIn(0, 255)
                val g = (Y - 0.337633f * U - 0.698001f * V).toInt().coerceIn(0, 255)
                val b = (Y + 1.732446f * U).toInt().coerceIn(0, 255)
                img.setRGB(x, y, (r shl 16) or (g shl 8) or b)
            }
        }
        img.toComposeImageBitmap()
    } finally {
        i420.release()
    }
}

// ── Coroutine helpers ─────────────────────────────────────────────────────────

private suspend fun RTCPeerConnection.createOfferAwait(): RTCSessionDescription =
    suspendCancellableCoroutine { cont ->
        createOffer(RTCOfferOptions(), object : CreateSessionDescriptionObserver {
            override fun onSuccess(sdp: RTCSessionDescription) { cont.resume(sdp) }
            override fun onFailure(error: String?) {
                cont.resumeWithException(IllegalStateException("createOffer failed: $error"))
            }
        })
    }

private suspend fun RTCPeerConnection.createAnswerAwait(): RTCSessionDescription =
    suspendCancellableCoroutine { cont ->
        createAnswer(RTCAnswerOptions(), object : CreateSessionDescriptionObserver {
            override fun onSuccess(sdp: RTCSessionDescription) { cont.resume(sdp) }
            override fun onFailure(error: String?) {
                cont.resumeWithException(IllegalStateException("createAnswer failed: $error"))
            }
        })
    }

private suspend fun RTCPeerConnection.setLocalDescriptionAwait(sdp: RTCSessionDescription) =
    suspendCancellableCoroutine<Unit> { cont ->
        setLocalDescription(sdp, object : SetSessionDescriptionObserver {
            override fun onSuccess()               { cont.resume(Unit) }
            override fun onFailure(error: String?) {
                cont.resumeWithException(IllegalStateException("setLocalDescription failed: $error"))
            }
        })
    }

private suspend fun RTCPeerConnection.setRemoteDescriptionAwait(sdp: RTCSessionDescription) =
    suspendCancellableCoroutine<Unit> { cont ->
        setRemoteDescription(sdp, object : SetSessionDescriptionObserver {
            override fun onSuccess()               { cont.resume(Unit) }
            override fun onFailure(error: String?) {
                cont.resumeWithException(IllegalStateException("setRemoteDescription failed: $error"))
            }
        })
    }
