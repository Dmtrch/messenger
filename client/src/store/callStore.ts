import { create } from 'zustand'
import type { CallSessionState } from '../../../shared/native-core/calls/call-session'
import { createInitialCallSession } from '../../../shared/native-core/calls/call-session'

export type CallStatus = CallSessionState['status']
export type IncomingOffer = NonNullable<CallSessionState['incomingOffer']>

export type ParticipantState = {
  userId: string
  deviceId?: string
  stream: MediaStream | null
  isMuted: boolean
  isCameraOff: boolean
  isSpeaking: boolean
  networkQuality: 'good' | 'fair' | 'poor'
}

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

  roomId: string | null
  groupChatId: string | null
  participants: Record<string, ParticipantState>
  pinnedUserId: string | null

  setGroupRoom: (roomId: string, chatId: string) => void
  clearGroupRoom: () => void
  upsertParticipant: (p: Omit<ParticipantState, 'stream' | 'isSpeaking'> & { stream?: MediaStream | null }) => void
  removeParticipant: (userId: string) => void
  setParticipantStream: (userId: string, stream: MediaStream | null) => void
  setParticipantSpeaking: (userId: string, speaking: boolean) => void
  setParticipantMuted: (userId: string, muted: boolean) => void
  setParticipantCameraOff: (userId: string, cameraOff: boolean) => void
  setPinnedUser: (userId: string | null) => void
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

  roomId: null,
  groupChatId: null,
  participants: {},
  pinnedUserId: null,

  setGroupRoom: (roomId, chatId) => set({ roomId, groupChatId: chatId }),

  clearGroupRoom: () => set({ roomId: null, groupChatId: null, participants: {}, pinnedUserId: null }),

  upsertParticipant: (p) => set((state) => {
    const existing = state.participants[p.userId]
    const next: ParticipantState = {
      stream: existing?.stream ?? null,
      isSpeaking: existing?.isSpeaking ?? false,
      userId: p.userId,
      deviceId: p.deviceId,
      isMuted: p.isMuted,
      isCameraOff: p.isCameraOff,
      networkQuality: p.networkQuality,
    }
    if ('stream' in p && p.stream !== undefined) {
      next.stream = p.stream ?? null
    }
    return { participants: { ...state.participants, [p.userId]: next } }
  }),

  removeParticipant: (userId) => set((state) => {
    const { [userId]: _, ...rest } = state.participants
    return { participants: rest }
  }),

  setParticipantStream: (userId, stream) => set((state) => {
    const existing = state.participants[userId]
    if (!existing) return {}
    return { participants: { ...state.participants, [userId]: { ...existing, stream } } }
  }),

  setParticipantSpeaking: (userId, speaking) => set((state) => {
    const existing = state.participants[userId]
    if (!existing) return {}
    return { participants: { ...state.participants, [userId]: { ...existing, isSpeaking: speaking } } }
  }),

  setParticipantMuted: (userId, muted) => set((state) => {
    const existing = state.participants[userId]
    if (!existing) return {}
    return { participants: { ...state.participants, [userId]: { ...existing, isMuted: muted } } }
  }),

  setParticipantCameraOff: (userId, cameraOff) => set((state) => {
    const existing = state.participants[userId]
    if (!existing) return {}
    return { participants: { ...state.participants, [userId]: { ...existing, isCameraOff: cameraOff } } }
  }),

  setPinnedUser: (userId) => set({ pinnedUserId: userId }),
}))
