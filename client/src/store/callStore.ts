import { create } from 'zustand'
import type { CallSessionState } from '../../../shared/native-core/calls/call-session'
import { createInitialCallSession } from '../../../shared/native-core/calls/call-session'

export type CallStatus = CallSessionState['status']
export type IncomingOffer = NonNullable<CallSessionState['incomingOffer']>

interface CallControlActions {
  toggleMute(): void
  toggleCamera(): void
}

interface CallState {
  session: CallSessionState
  status: CallStatus
  callId: string | null
  chatId: string | null
  peerId: string | null
  isVideo: boolean
  isMuted: boolean
  isCameraOff: boolean
  incomingOffer: IncomingOffer | null
  notification: string | null
  localStream: MediaStream | null
  remoteStream: MediaStream | null

  applySession: (session: CallSessionState) => void
  setLocalStream: (stream: MediaStream | null) => void
  setRemoteStream: (stream: MediaStream | null) => void
  clearMedia: () => void
  toggleMute: () => void
  toggleCamera: () => void

  _callControls: CallControlActions | null
  setCallControls: (controls: CallControlActions | null) => void
}

function syncSessionFields(session: CallSessionState) {
  return {
    session,
    status: session.status,
    callId: session.callId,
    chatId: session.chatId,
    peerId: session.peerId,
    isVideo: session.isVideo,
    isMuted: session.isMuted,
    isCameraOff: session.isCameraOff,
    incomingOffer: session.incomingOffer,
    notification: session.notification,
  }
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop())
}

export const useCallStore = create<CallState>((set, get) => ({
  ...syncSessionFields(createInitialCallSession()),
  localStream: null,
  remoteStream: null,

  applySession: (session) => set(syncSessionFields(session)),

  setLocalStream: (stream) => set({ localStream: stream }),

  setRemoteStream: (stream) => set({ remoteStream: stream }),

  clearMedia: () => set((state) => {
    stopStream(state.localStream)
    stopStream(state.remoteStream)
    return {
      localStream: null,
      remoteStream: null,
    }
  }),

  toggleMute: () => {
    get()._callControls?.toggleMute()
    const isMuted = get().isMuted
    get().localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !isMuted
    })
  },

  toggleCamera: () => {
    get()._callControls?.toggleCamera()
    const isCameraOff = get().isCameraOff
    get().localStream?.getVideoTracks().forEach((track) => {
      track.enabled = !isCameraOff
    })
  },

  _callControls: null,
  setCallControls: (controls) => set({ _callControls: controls }),
}))
