export type CallStatus = 'idle' | 'ringing' | 'calling' | 'active'

export interface IncomingCallOffer {
  callId: string
  chatId: string
  callerId: string
  sdp: string
  isVideo: boolean
}

export interface OutgoingCallTarget {
  callId: string
  chatId: string
  peerId: string
  isVideo: boolean
}

export interface CallSessionState {
  status: CallStatus
  callId: string | null
  chatId: string | null
  peerId: string | null
  isVideo: boolean
  incomingOffer: IncomingCallOffer | null
  notification: string | null
  isMuted: boolean
  isCameraOff: boolean
}

const INITIAL_CALL_SESSION_STATE: CallSessionState = {
  status: 'idle',
  callId: null,
  chatId: null,
  peerId: null,
  isVideo: false,
  incomingOffer: null,
  notification: null,
  isMuted: false,
  isCameraOff: false,
}

export function createInitialCallSession(): CallSessionState {
  return { ...INITIAL_CALL_SESSION_STATE }
}

export function setOutgoingCall(
  _state: CallSessionState,
  payload: OutgoingCallTarget,
): CallSessionState {
  return {
    ...createInitialCallSession(),
    status: 'calling',
    callId: payload.callId,
    chatId: payload.chatId,
    peerId: payload.peerId,
    isVideo: payload.isVideo,
  }
}

export function receiveIncomingCall(
  _state: CallSessionState,
  offer: IncomingCallOffer,
): CallSessionState {
  return {
    ...createInitialCallSession(),
    status: 'ringing',
    callId: offer.callId,
    chatId: offer.chatId,
    peerId: offer.callerId,
    isVideo: offer.isVideo,
    incomingOffer: offer,
  }
}

export function acceptIncomingCall(state: CallSessionState): CallSessionState {
  if (state.status !== 'ringing') return state
  return {
    ...state,
    status: 'active',
    incomingOffer: null,
    notification: null,
  }
}

export function rejectIncomingCall(_state: CallSessionState): CallSessionState {
  return createInitialCallSession()
}

export function markCallAcceptedByRemote(state: CallSessionState): CallSessionState {
  if (state.status !== 'calling') return state
  return {
    ...state,
    status: 'active',
    incomingOffer: null,
    notification: null,
  }
}

export function setRemoteRejected(_state: CallSessionState): CallSessionState {
  return {
    ...createInitialCallSession(),
    notification: 'Звонок отклонён',
  }
}

export function setRemoteBusy(_state: CallSessionState): CallSessionState {
  return {
    ...createInitialCallSession(),
    notification: 'Абонент занят',
  }
}

export function endCallByRemote(_state: CallSessionState): CallSessionState {
  return createInitialCallSession()
}

export function resetCallSession(_state: CallSessionState): CallSessionState {
  return createInitialCallSession()
}

export function toggleCallMute(state: CallSessionState): CallSessionState {
  return {
    ...state,
    isMuted: !state.isMuted,
  }
}

export function toggleCallCamera(state: CallSessionState): CallSessionState {
  return {
    ...state,
    isCameraOff: !state.isCameraOff,
  }
}

export function clearCallNotification(state: CallSessionState): CallSessionState {
  if (state.notification === null) return state
  return {
    ...state,
    notification: null,
  }
}
