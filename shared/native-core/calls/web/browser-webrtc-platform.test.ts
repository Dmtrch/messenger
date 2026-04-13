import { describe, expect, it, vi } from 'vitest'

const {
  createBrowserPeerConnectionAdapter,
  createBrowserUserMediaGetter,
} = await import('./browser-webrtc-platform')

class FakePeerConnection {
  remoteDescription: { type: 'offer' | 'answer'; sdp: string } | null = null
  localDescription: { type: 'offer' | 'answer'; sdp: string } | null = null
  connectionState: RTCPeerConnectionState = 'new'
  onicecandidate: ((event: { candidate: { toJSON(): RTCIceCandidateInit } | null }) => void) | null = null
  ontrack: ((event: { streams: MediaStream[] }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  addTrack = vi.fn()
  addIceCandidate = vi.fn(async (_candidate: RTCIceCandidateInit) => undefined)
  createOffer = vi.fn(async () => ({ type: 'offer' as const, sdp: 'offer-sdp' }))
  createAnswer = vi.fn(async () => ({ type: 'answer' as const, sdp: 'answer-sdp' }))
  setLocalDescription = vi.fn(async (description: { type: 'offer' | 'answer'; sdp: string }) => {
    this.localDescription = description
  })
  setRemoteDescription = vi.fn(async (description: { type: 'offer' | 'answer'; sdp: string }) => {
    this.remoteDescription = description
  })
  close = vi.fn()
}

describe('browser webrtc platform', () => {
  it('createBrowserPeerConnectionAdapter адаптирует browser peer connection к shared contract', async () => {
    const raw = new FakePeerConnection()
    const adapter = createBrowserPeerConnectionAdapter(raw as unknown as RTCPeerConnection)
    const onTrack = vi.fn()

    adapter.ontrack = onTrack
    raw.ontrack?.({ streams: ['stream-1'] as unknown as MediaStream[] })

    await adapter.setRemoteDescription({ type: 'offer', sdp: 'offer-sdp' })
    await adapter.setLocalDescription({ type: 'answer', sdp: 'answer-sdp' })

    expect(onTrack).toHaveBeenCalledWith({ streams: ['stream-1'] })
    expect(raw.setRemoteDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'offer-sdp' })
    expect(raw.setLocalDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'answer-sdp' })
  })

  it('createBrowserUserMediaGetter вызывает navigator.mediaDevices.getUserMedia', async () => {
    const getUserMedia = vi.fn(async () => 'stream-1' as unknown as MediaStream)
    const loadUserMedia = createBrowserUserMediaGetter({
      mediaDevices: { getUserMedia },
    } as unknown as Navigator)

    const result = await loadUserMedia({ audio: true, video: false })

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false })
    expect(result).toBe('stream-1')
  })
})
