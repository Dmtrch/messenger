import type { CallIceCandidate, CallWSSendFrame } from './call-ws-types'

export interface BrowserWebRTCPeerConnection {
  remoteDescription: Pick<RTCSessionDescriptionInit, 'type' | 'sdp'> | null
  localDescription: Pick<RTCSessionDescriptionInit, 'type' | 'sdp'> | null
  connectionState: RTCPeerConnectionState
  onicecandidate: ((event: { candidate: { toJSON(): CallIceCandidate } | null }) => void) | null
  ontrack: ((event: { streams: MediaStream[] }) => void) | null
  onconnectionstatechange: (() => void) | null
  addTrack(track: MediaStreamTrack, stream: MediaStream): void
  addIceCandidate(candidate: CallIceCandidate): Promise<void>
  createOffer(): Promise<{ type: 'offer'; sdp: string }>
  createAnswer(): Promise<{ type: 'answer'; sdp: string }>
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>
  close(): void
}

export interface BrowserWebRTCRuntimeDeps {
  getIceServers(): Promise<RTCIceServer[]>
  createPeerConnection(config: RTCConfiguration): BrowserWebRTCPeerConnection
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>
  send(frame: CallWSSendFrame): boolean | undefined
  setLocalStream(stream: MediaStream): void
  setRemoteStream(stream: MediaStream): void
  setActive(): void
  reset(): void
}

export interface BrowserWebRTCControls {
  initiateCall(callId: string, chatId: string, targetId: string, isVideo: boolean): Promise<void>
  acceptOffer(callId: string, sdp: string, isVideo: boolean): Promise<void>
  handleAnswer(sdp: string): Promise<void>
  addIceCandidate(candidate: CallIceCandidate): Promise<void>
  hangUp(): void
  closeOnly(): void
}

export function createBrowserWebRTCRuntime(deps: BrowserWebRTCRuntimeDeps): BrowserWebRTCControls {
  let peerConnection: BrowserWebRTCPeerConnection | null = null
  let callId: string | null = null
  let pendingCandidates: CallIceCandidate[] = []

  const flushPendingCandidates = async (connection: BrowserWebRTCPeerConnection): Promise<void> => {
    const candidates = pendingCandidates
    pendingCandidates = []
    for (const candidate of candidates) {
      try {
        await connection.addIceCandidate(candidate)
      } catch {
        // Устаревший кандидат после установки remote description игнорируем.
      }
    }
  }

  const closeConnection = (): void => {
    peerConnection?.close()
    peerConnection = null
    callId = null
    pendingCandidates = []
    deps.reset()
  }

  const createConnection = async (nextCallId: string): Promise<BrowserWebRTCPeerConnection> => {
    const iceServers = await deps.getIceServers()
    const connection = deps.createPeerConnection({ iceServers })
    callId = nextCallId
    peerConnection = connection
    pendingCandidates = []

    connection.onicecandidate = ({ candidate }) => {
      if (!candidate || !callId) return
      deps.send({
        type: 'ice_candidate',
        callId,
        candidate: candidate.toJSON(),
      })
    }

    connection.ontrack = (event) => {
      const stream = event.streams[0]
      if (stream) deps.setRemoteStream(stream)
    }

    connection.onconnectionstatechange = () => {
      const state = connection.connectionState
      if (state === 'failed' || state === 'closed') {
        api.hangUp()
      }
    }

    return connection
  }

  const getLocalStream = async (isVideo: boolean): Promise<MediaStream> => {
    const stream = await deps.getUserMedia({ audio: true, video: isVideo })
    deps.setLocalStream(stream)
    return stream
  }

  const api: BrowserWebRTCControls = {
    async initiateCall(nextCallId, chatId, targetId, isVideo) {
      const connection = await createConnection(nextCallId)
      const stream = await getLocalStream(isVideo)
      stream.getTracks().forEach((track) => connection.addTrack(track, stream))

      const offer = await connection.createOffer()
      await connection.setLocalDescription(offer)

      deps.send({
        type: 'call_offer',
        callId: nextCallId,
        chatId,
        targetId,
        sdp: offer.sdp,
        isVideo,
      })
    },

    async acceptOffer(nextCallId, sdp, isVideo) {
      const connection = await createConnection(nextCallId)
      const stream = await getLocalStream(isVideo)
      stream.getTracks().forEach((track) => connection.addTrack(track, stream))

      await connection.setRemoteDescription({ type: 'offer', sdp })
      await flushPendingCandidates(connection)

      const answer = await connection.createAnswer()
      await connection.setLocalDescription(answer)
      deps.setActive()

      deps.send({
        type: 'call_answer',
        callId: nextCallId,
        sdp: answer.sdp,
      })
    },

    async handleAnswer(sdp) {
      if (!peerConnection) return
      await peerConnection.setRemoteDescription({ type: 'answer', sdp })
      await flushPendingCandidates(peerConnection)
      deps.setActive()
    },

    async addIceCandidate(candidate) {
      if (!peerConnection || peerConnection.remoteDescription === null) {
        pendingCandidates.push(candidate)
        return
      }
      try {
        await peerConnection.addIceCandidate(candidate)
      } catch {
        // Устаревший кандидат после установки remote description игнорируем.
      }
    },

    hangUp() {
      if (callId) {
        deps.send({ type: 'call_end', callId })
      }
      closeConnection()
    },

    closeOnly() {
      closeConnection()
    },
  }

  return api
}
