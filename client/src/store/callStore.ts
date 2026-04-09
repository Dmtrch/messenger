import { create } from 'zustand'
import type { WSFrame } from '@/types'

export type CallStatus = 'idle' | 'ringing' | 'calling' | 'active'

type CallWSFrame = Extract<WSFrame, {
  type: 'call_offer' | 'call_answer' | 'call_end' | 'call_reject' | 'call_busy' | 'ice_candidate'
}>

interface IncomingOffer {
  callId: string
  chatId: string
  callerId: string
  sdp: string
  isVideo: boolean
}

interface CallState {
  status: CallStatus
  callId: string | null
  chatId: string | null
  peerId: string | null
  isVideo: boolean
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  isMuted: boolean
  isCameraOff: boolean
  /** Pending offer от входящего звонка — используется при accept */
  incomingOffer: IncomingOffer | null
  /** Уведомление для UI (busy / rejected) */
  notification: string | null

  // Actions
  startOutgoing: (callId: string, chatId: string, peerId: string, isVideo: boolean) => void
  setIncoming: (offer: IncomingOffer) => void
  setActive: () => void
  setLocalStream: (stream: MediaStream) => void
  setRemoteStream: (stream: MediaStream) => void
  toggleMute: () => void
  toggleCamera: () => void
  setNotification: (msg: string | null) => void
  reset: () => void

  /**
   * Устанавливается useCallHandler при монтировании.
   * useMessengerWS вызывает этот обработчик для routing call-фреймов.
   */
  _callFrameHandler: ((frame: CallWSFrame) => void) | null
  setCallFrameHandler: (fn: ((frame: CallWSFrame) => void) | null) => void
}

const emptyState = {
  status: 'idle' as CallStatus,
  callId: null,
  chatId: null,
  peerId: null,
  isVideo: false,
  localStream: null,
  remoteStream: null,
  isMuted: false,
  isCameraOff: false,
  incomingOffer: null,
  notification: null,
}

export const useCallStore = create<CallState>((set) => ({
  ...emptyState,
  _callFrameHandler: null,

  startOutgoing: (callId, chatId, peerId, isVideo) =>
    set({ status: 'calling', callId, chatId, peerId, isVideo }),

  setIncoming: (offer) =>
    set({ status: 'ringing', callId: offer.callId, chatId: offer.chatId, peerId: offer.callerId, isVideo: offer.isVideo, incomingOffer: offer }),

  setActive: () => set({ status: 'active', incomingOffer: null }),

  setLocalStream: (stream) => set({ localStream: stream }),

  setRemoteStream: (stream) => set({ remoteStream: stream }),

  toggleMute: () => set((s) => {
    s.localStream?.getAudioTracks().forEach((t) => { t.enabled = s.isMuted })
    return { isMuted: !s.isMuted }
  }),

  toggleCamera: () => set((s) => {
    s.localStream?.getVideoTracks().forEach((t) => { t.enabled = s.isCameraOff })
    return { isCameraOff: !s.isCameraOff }
  }),

  setNotification: (msg) => set({ notification: msg }),

  reset: () => set((s) => {
    s.localStream?.getTracks().forEach((t) => t.stop())
    s.remoteStream?.getTracks().forEach((t) => t.stop())
    return { ...emptyState }
  }),

  setCallFrameHandler: (fn) => set({ _callFrameHandler: fn }),
}))
