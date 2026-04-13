import type { BrowserWebRTCPeerConnection } from './browser-webrtc-runtime'

export function createBrowserPeerConnectionAdapter(
  connection: RTCPeerConnection,
): BrowserWebRTCPeerConnection {
  const adapter: BrowserWebRTCPeerConnection = {
    get remoteDescription() {
      return connection.remoteDescription
    },
    get localDescription() {
      return connection.localDescription
    },
    get connectionState() {
      return connection.connectionState
    },
    onicecandidate: null,
    ontrack: null,
    onconnectionstatechange: null,
    addTrack(track: MediaStreamTrack, stream: MediaStream) {
      connection.addTrack(track, stream)
    },
    addIceCandidate(candidate) {
      return connection.addIceCandidate(candidate)
    },
    createOffer() {
      return connection.createOffer() as Promise<{ type: 'offer'; sdp: string }>
    },
    createAnswer() {
      return connection.createAnswer() as Promise<{ type: 'answer'; sdp: string }>
    },
    setLocalDescription(description) {
      return connection.setLocalDescription(description)
    },
    setRemoteDescription(description) {
      return connection.setRemoteDescription(description)
    },
    close() {
      connection.close()
    },
  }

  connection.onicecandidate = (event) => {
    adapter.onicecandidate?.({ candidate: event.candidate ? { toJSON: () => event.candidate!.toJSON() } : null })
  }
  connection.ontrack = (event) => {
    adapter.ontrack?.({ streams: Array.from(event.streams) })
  }
  connection.onconnectionstatechange = () => {
    adapter.onconnectionstatechange?.()
  }

  return adapter
}

export function createBrowserUserMediaGetter(navigatorLike: Pick<Navigator, 'mediaDevices'>) {
  return function getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
    return navigatorLike.mediaDevices.getUserMedia(constraints)
  }
}
