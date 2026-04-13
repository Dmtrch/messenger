import { useMemo } from 'react'
import { useCallStore } from '@/store/callStore'
import { useWsStore } from '@/store/wsStore'

import {
  createBrowserWebRTCRuntime,
  createBrowserPeerConnectionAdapter,
  createBrowserUserMediaGetter,
  type BrowserApiClient,
  type BrowserWebRTCControls,
} from '../../../shared/native-core'

export interface WebRTCControls extends BrowserWebRTCControls {}

export function useWebRTC(apiClient: BrowserApiClient): WebRTCControls {
  const send = useWsStore((s) => s.send)
  const setLocalStream = useCallStore((s) => s.setLocalStream)
  const setRemoteStream = useCallStore((s) => s.setRemoteStream)
  const clearMedia = useCallStore((s) => s.clearMedia)

  return useMemo(() => createBrowserWebRTCRuntime({
    async getIceServers(): Promise<RTCIceServer[]> {
      try {
        const data = await apiClient.api.getIceServers()
        return data.iceServers as RTCIceServer[]
      } catch {
        return [{ urls: 'stun:stun.l.google.com:19302' }]
      }
    },
    createPeerConnection(config: RTCConfiguration) {
      return createBrowserPeerConnectionAdapter(new RTCPeerConnection(config))
    },
    getUserMedia: createBrowserUserMediaGetter(navigator),
    send(frame) {
      return send?.(frame)
    },
    setLocalStream,
    setRemoteStream,
    setActive() {},
    reset: clearMedia,
  }), [apiClient, clearMedia, send, setLocalStream, setRemoteStream])
}
