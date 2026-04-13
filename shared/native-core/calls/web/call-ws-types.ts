export const CALL_WS_SIGNAL_TYPES = [
  'call_offer',
  'call_answer',
  'call_end',
  'call_reject',
  'call_busy',
  'ice_candidate',
] as const

export interface CallIceCandidate {
  candidate?: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

export type CallOfferFrame = {
  type: 'call_offer'
  callId: string
  chatId: string
  callerId: string
  sdp: string
  isVideo: boolean
}

export type CallAnswerFrame = {
  type: 'call_answer'
  callId: string
  sdp: string
}

export type CallEndFrame = {
  type: 'call_end'
  callId: string
  reason?: 'timeout' | 'rejected' | 'hangup'
}

export type CallRejectFrame = {
  type: 'call_reject'
  callId: string
}

export type CallBusyFrame = {
  type: 'call_busy'
  callId: string
}

export type CallIceCandidateFrame = {
  type: 'ice_candidate'
  callId: string
  candidate: CallIceCandidate
}

export type CallWSFrame =
  | CallOfferFrame
  | CallAnswerFrame
  | CallEndFrame
  | CallRejectFrame
  | CallBusyFrame
  | CallIceCandidateFrame

export type CallOfferSendFrame = {
  type: 'call_offer'
  callId: string
  chatId: string
  targetId: string
  sdp: string
  isVideo: boolean
}

export type CallAnswerSendFrame = {
  type: 'call_answer'
  callId: string
  sdp: string
}

export type CallEndSendFrame = {
  type: 'call_end'
  callId: string
}

export type CallRejectSendFrame = {
  type: 'call_reject'
  callId: string
}

export type CallIceCandidateSendFrame = {
  type: 'ice_candidate'
  callId: string
  candidate: CallIceCandidate
}

export type CallWSSendFrame =
  | CallOfferSendFrame
  | CallAnswerSendFrame
  | CallEndSendFrame
  | CallRejectSendFrame
  | CallIceCandidateSendFrame
