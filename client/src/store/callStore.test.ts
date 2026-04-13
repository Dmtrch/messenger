import { afterEach, describe, expect, it, vi } from 'vitest'

import { createInitialCallSession, setOutgoingCall } from '../../../shared/native-core/calls/call-session'
import { useCallStore } from './callStore'

function createTrack(kind: 'audio' | 'video') {
  return {
    kind,
    enabled: true,
    stop: vi.fn(),
  }
}

function createStream() {
  const audioTrack = createTrack('audio')
  const videoTrack = createTrack('video')
  const tracks = [audioTrack, videoTrack]
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
    getVideoTracks: () => tracks.filter((track) => track.kind === 'video'),
  } as unknown as MediaStream
}

describe('callStore adapter', () => {
  afterEach(() => {
    useCallStore.getState().applySession(createInitialCallSession())
    useCallStore.getState().clearMedia()
    useCallStore.getState().setCallControls(null)
  })

  it('применяет shared session snapshot и зеркалит поля для UI', () => {
    const nextSession = setOutgoingCall(createInitialCallSession(), {
      callId: 'call-1',
      chatId: 'chat-1',
      peerId: 'alice',
      isVideo: true,
    })

    useCallStore.getState().applySession(nextSession)

    const state = useCallStore.getState()
    expect(state.session).toEqual(nextSession)
    expect(state.status).toBe('calling')
    expect(state.peerId).toBe('alice')
    expect(state.isVideo).toBe(true)
  })

  it('toggleMute и toggleCamera используют shared bridge и применяют effect к track', () => {
    const stream = createStream()
    const toggleMute = vi.fn(() => {
      useCallStore.getState().applySession({
        ...useCallStore.getState().session,
        isMuted: true,
      })
    })
    const toggleCamera = vi.fn(() => {
      useCallStore.getState().applySession({
        ...useCallStore.getState().session,
        isCameraOff: true,
      })
    })

    useCallStore.getState().setLocalStream(stream)
    useCallStore.getState().setCallControls({ toggleMute, toggleCamera })

    useCallStore.getState().toggleMute()
    useCallStore.getState().toggleCamera()

    expect(toggleMute).toHaveBeenCalled()
    expect(toggleCamera).toHaveBeenCalled()
    expect(useCallStore.getState().isMuted).toBe(true)
    expect(useCallStore.getState().isCameraOff).toBe(true)
    expect(stream.getAudioTracks()[0]?.enabled).toBe(false)
    expect(stream.getVideoTracks()[0]?.enabled).toBe(false)
  })

  it('не хранит legacy runtime callbacks в zustand store', () => {
    const state = useCallStore.getState() as Record<string, unknown>

    expect('_callFrameHandler' in state).toBe(false)
    expect('setCallFrameHandler' in state).toBe(false)
    expect('_initiateCall' in state).toBe(false)
    expect('setInitiateCall' in state).toBe(false)
  })
})
