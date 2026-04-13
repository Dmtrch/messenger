import { describe, expect, it, vi } from 'vitest'

const {
  createBrowserWebRTCRuntime,
} = await import('./browser-webrtc-runtime')

function createTrack(kind: 'audio' | 'video') {
  return {
    kind,
    enabled: true,
    stop: vi.fn(),
  }
}

function createStream(includeVideo: boolean) {
  const audioTrack = createTrack('audio')
  const videoTrack = createTrack('video')
  const tracks = includeVideo ? [audioTrack, videoTrack] : [audioTrack]
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
    getVideoTracks: () => tracks.filter((track) => track.kind === 'video'),
  } as unknown as MediaStream
}

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
  close = vi.fn(() => {
    this.connectionState = 'closed'
  })
}

describe('browser webrtc runtime', () => {
  it('инициирует исходящий звонок и отправляет call_offer + ice_candidate', async () => {
    const send = vi.fn().mockReturnValue(true)
    const setLocalStream = vi.fn()
    const pc = new FakePeerConnection()

    const runtime = createBrowserWebRTCRuntime({
      getIceServers: vi.fn().mockResolvedValue([{ urls: 'stun:test' }]),
      createPeerConnection: vi.fn().mockReturnValue(pc),
      getUserMedia: vi.fn().mockResolvedValue(createStream(true)),
      send,
      setLocalStream,
      setRemoteStream: vi.fn(),
      setActive: vi.fn(),
      reset: vi.fn(),
    })

    await runtime.initiateCall('call-1', 'chat-1', 'user-2', true)

    expect(setLocalStream).toHaveBeenCalledTimes(1)
    expect(pc.addTrack).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenNthCalledWith(1, {
      type: 'call_offer',
      callId: 'call-1',
      chatId: 'chat-1',
      targetId: 'user-2',
      sdp: 'offer-sdp',
      isVideo: true,
    })

    pc.onicecandidate?.({
      candidate: {
        toJSON: () => ({ candidate: 'ice-1' }),
      },
    })

    expect(send).toHaveBeenNthCalledWith(2, {
      type: 'ice_candidate',
      callId: 'call-1',
      candidate: { candidate: 'ice-1' },
    })
  })

  it('буферизует ice candidate до remote description и сбрасывает после answer', async () => {
    const setActive = vi.fn()
    const pc = new FakePeerConnection()

    const runtime = createBrowserWebRTCRuntime({
      getIceServers: vi.fn().mockResolvedValue([{ urls: 'stun:test' }]),
      createPeerConnection: vi.fn().mockReturnValue(pc),
      getUserMedia: vi.fn().mockResolvedValue(createStream(false)),
      send: vi.fn(),
      setLocalStream: vi.fn(),
      setRemoteStream: vi.fn(),
      setActive,
      reset: vi.fn(),
    })

    await runtime.initiateCall('call-2', 'chat-2', 'user-3', false)
    await runtime.addIceCandidate({ candidate: 'buffered-ice' })

    expect(pc.addIceCandidate).not.toHaveBeenCalled()

    await runtime.handleAnswer('remote-answer')

    expect(pc.setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'remote-answer' })
    expect(pc.addIceCandidate).toHaveBeenCalledWith({ candidate: 'buffered-ice' })
    expect(setActive).toHaveBeenCalled()
  })

  it('acceptOffer создаёт answer и отправляет call_answer', async () => {
    const send = vi.fn().mockReturnValue(true)
    const setActive = vi.fn()
    const pc = new FakePeerConnection()

    const runtime = createBrowserWebRTCRuntime({
      getIceServers: vi.fn().mockResolvedValue([{ urls: 'stun:test' }]),
      createPeerConnection: vi.fn().mockReturnValue(pc),
      getUserMedia: vi.fn().mockResolvedValue(createStream(true)),
      send,
      setLocalStream: vi.fn(),
      setRemoteStream: vi.fn(),
      setActive,
      reset: vi.fn(),
    })

    await runtime.acceptOffer('call-3', 'offer-sdp', true)

    expect(pc.setRemoteDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'offer-sdp' })
    expect(send).toHaveBeenCalledWith({
      type: 'call_answer',
      callId: 'call-3',
      sdp: 'answer-sdp',
    })
    expect(setActive).toHaveBeenCalled()
  })
})
