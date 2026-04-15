// iOSWebRtcController.swift — WebRTC контроллер для iOS.
// Зеркало AndroidWebRtcController.kt.
//
// Требует WebRTC.xcframework в Xcode App target:
//   File → Add Package Dependencies → https://github.com/stasel/WebRTC
//   Выбрать "WebRTC" product, добавить в App target (не в MessengerCrypto).
//
// Компилируется только при наличии WebRTC.framework;
// #if canImport(WebRTC) сохраняет работоспособность `swift test` на macOS.

#if canImport(WebRTC)
import WebRTC
import Foundation

final class iOSWebRtcController: NSObject {

    // MARK: - Callbacks (вызываются на главном потоке)

    /// callId, sdp — локальный SDP готов к отправке через WS
    var onLocalSdpReady:     ((String, String) -> Void)?
    /// callId, candidate, sdpMid, sdpMLineIndex — локальный ICE-кандидат
    var onIceCandidateReady: ((String, String, String, Int32) -> Void)?
    /// локальная камера захвачена и готова к отображению
    var onLocalVideoReady:   (() -> Void)?
    /// получен первый видеофрейм от удалённого пира
    var onRemoteVideoReady:  (() -> Void)?
    var onError:             ((String) -> Void)?

    // MARK: - Состояние

    private var callId   = ""
    private var isVideo  = false
    private let factory: RTCPeerConnectionFactory
    private var pc:      RTCPeerConnection?
    private var localVideoTrack: RTCVideoTrack?
    private var capturer: RTCCameraVideoCapturer?
    private var pendingCandidates: [RTCIceCandidate] = []
    private var remoteRenderer: RTCVideoRenderer?

    // MARK: - Init / deinit

    override init() {
        RTCInitializeSSL()
        factory = RTCPeerConnectionFactory(
            encoderFactory: RTCDefaultVideoEncoderFactory(),
            decoderFactory: RTCDefaultVideoDecoderFactory()
        )
        super.init()
    }

    deinit { release() }

    // MARK: - Caller side: создать offer

    func startCall(callId: String, iceServers: [RTCIceServer], isVideo: Bool) {
        self.callId  = callId
        self.isVideo = isVideo
        buildPC(iceServers: iceServers)
        if isVideo { addLocalVideo() }
        pc?.offer(for: sdpConstraints(isVideo: isVideo)) { [weak self] sdp, _ in
            guard let self, let sdp else { return }
            self.pc?.setLocalDescription(sdp) { _ in
                DispatchQueue.main.async { self.onLocalSdpReady?(self.callId, sdp.sdp) }
            }
        }
    }

    // MARK: - Callee side: принять offer, создать answer

    func answerCall(callId: String, remoteSdp: String,
                    iceServers: [RTCIceServer], isVideo: Bool) {
        self.callId  = callId
        self.isVideo = isVideo
        buildPC(iceServers: iceServers)
        if isVideo { addLocalVideo() }
        let remote = RTCSessionDescription(type: .offer, sdp: remoteSdp)
        pc?.setRemoteDescription(remote) { [weak self] error in
            guard let self, error == nil else { return }
            self.drainCandidates()
            self.pc?.answer(for: self.sdpConstraints(isVideo: isVideo)) { sdp, _ in
                guard let sdp else { return }
                self.pc?.setLocalDescription(sdp) { _ in
                    DispatchQueue.main.async { self.onLocalSdpReady?(self.callId, sdp.sdp) }
                }
            }
        }
    }

    // MARK: - Caller получил answer от callee

    func setRemoteAnswer(sdp: String) {
        let desc = RTCSessionDescription(type: .answer, sdp: sdp)
        pc?.setRemoteDescription(desc) { [weak self] error in
            if error == nil { self?.drainCandidates() }
        }
    }

    // MARK: - ICE-кандидаты от удалённого пира

    func addRemoteIceCandidate(candidate: String, sdpMid: String, sdpMLineIndex: Int32) {
        let ice = RTCIceCandidate(sdp: candidate, sdpMLineIndex: sdpMLineIndex, sdpMid: sdpMid)
        if pc?.remoteDescription != nil {
            pc?.add(ice) { _ in }
        } else {
            pendingCandidates.append(ice)
        }
    }

    // MARK: - Привязка рендереров (вызвать как только CallOverlay создал views)

    func bindRenderers(local: RTCVideoRenderer, remote: RTCVideoRenderer) {
        localVideoTrack?.add(local)
        remoteRenderer = remote
    }

    // MARK: - Завершение звонка

    func release() {
        capturer?.stopCapture()
        capturer = nil
        localVideoTrack = nil
        pc?.close()
        pc = nil
        pendingCandidates.removeAll()
        remoteRenderer = nil
    }

    // MARK: - Private

    private func buildPC(iceServers: [RTCIceServer]) {
        let cfg = RTCConfiguration()
        cfg.iceServers   = iceServers
        cfg.sdpSemantics = .unifiedPlan
        let constraints  = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        pc = factory.peerConnection(with: cfg, constraints: constraints, delegate: self)
    }

    private func addLocalVideo() {
        let source = factory.videoSource()
        let track  = factory.videoTrack(with: source, trackId: "v0")
        localVideoTrack = track
        pc?.add(track, streamIds: ["s0"])

        let cap = RTCCameraVideoCapturer(delegate: source)
        capturer = cap

        let devices = RTCCameraVideoCapturer.captureDevices()
        let device  = devices.first { $0.position == .front } ?? devices.first
        guard let dev = device, let fmt = dev.formats.last else { return }
        let fps = fmt.videoSupportedFrameRateRanges.map { $0.maxFrameRate }.max() ?? 30
        cap.startCapture(with: dev, format: fmt, fps: Int(fps))
        DispatchQueue.main.async { [weak self] in self?.onLocalVideoReady?() }
    }

    private func sdpConstraints(isVideo: Bool) -> RTCMediaConstraints {
        var mandatory: [String: String] = [
            kRTCMediaConstraintsOfferToReceiveAudio: kRTCMediaConstraintsValueTrue,
        ]
        if isVideo {
            mandatory[kRTCMediaConstraintsOfferToReceiveVideo] = kRTCMediaConstraintsValueTrue
        }
        return RTCMediaConstraints(mandatoryConstraints: mandatory, optionalConstraints: nil)
    }

    private func drainCandidates() {
        let q = pendingCandidates
        pendingCandidates.removeAll()
        for c in q { pc?.add(c) { _ in } }
    }
}

// MARK: - RTCPeerConnectionDelegate

extension iOSWebRtcController: RTCPeerConnectionDelegate {

    func peerConnection(_ pc: RTCPeerConnection, didChange state: RTCSignalingState) {}
    func peerConnectionShouldNegotiate(_ pc: RTCPeerConnection) {}
    func peerConnection(_ pc: RTCPeerConnection, didChange state: RTCIceGatheringState) {}
    func peerConnection(_ pc: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ pc: RTCPeerConnection, didOpen channel: RTCDataChannel) {}
    func peerConnection(_ pc: RTCPeerConnection, didRemove stream: RTCMediaStream) {}

    func peerConnection(_ pc: RTCPeerConnection, didAdd stream: RTCMediaStream) {
        guard let vTrack = stream.videoTracks.first else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if let renderer = self.remoteRenderer { vTrack.add(renderer) }
            self.onRemoteVideoReady?()
        }
    }

    func peerConnection(_ pc: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.onIceCandidateReady?(
                self.callId,
                candidate.sdp,
                candidate.sdpMid ?? "",
                candidate.sdpMLineIndex
            )
        }
    }

    func peerConnection(_ pc: RTCPeerConnection, didChange state: RTCIceConnectionState) {
        if state == .failed {
            DispatchQueue.main.async { [weak self] in self?.onError?("ICE connection failed") }
        }
    }
}
#endif
