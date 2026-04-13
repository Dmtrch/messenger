import {
  acceptIncomingCall,
  clearCallNotification,
  createInitialCallSession,
  endCallByRemote,
  markCallAcceptedByRemote,
  receiveIncomingCall,
  resetCallSession,
  setOutgoingCall,
  setRemoteBusy,
  setRemoteRejected,
  toggleCallCamera,
  toggleCallMute,
  type CallSessionState,
} from './call-session'
import type { CallHandlerWebRTCControls } from './web/call-handler-orchestrator'
import type { CallWSFrame, CallWSSendFrame } from './web/call-ws-types'

export interface CallControllerDeps {
  createCallId(): string
  send(frame: CallWSSendFrame): boolean | undefined
  schedule(delayMs: number, run: () => void): unknown
  webRTC: CallHandlerWebRTCControls
}

export type CallSessionListener = (state: CallSessionState) => void

export interface CallController {
  getState(): CallSessionState
  subscribe(listener: CallSessionListener): () => void
  onFrame(frame: CallWSFrame): Promise<void>
  initiateCall(chatId: string, targetId: string, isVideo: boolean): Promise<void>
  acceptCall(): Promise<void>
  rejectCall(): void
  hangUp(): void
  toggleMute(): void
  toggleCamera(): void
  clearNotification(): void
  reset(): void
}

export function createCallController(deps: CallControllerDeps): CallController {
  let state = createInitialCallSession()
  const listeners = new Set<CallSessionListener>()

  const emit = (): void => {
    listeners.forEach((listener) => listener(state))
  }

  const setState = (nextState: CallSessionState): void => {
    state = nextState
    emit()
  }

  const scheduleNotificationCleanup = (): void => {
    if (!state.notification) return
    deps.schedule(3000, () => {
      setState(clearCallNotification(state))
    })
  }

  return {
    getState() {
      return state
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    async onFrame(frame) {
      switch (frame.type) {
        case 'call_offer':
          setState(receiveIncomingCall(state, {
            callId: frame.callId,
            chatId: frame.chatId,
            callerId: frame.callerId,
            sdp: frame.sdp,
            isVideo: frame.isVideo,
          }))
          break

        case 'call_answer':
          await deps.webRTC.handleAnswer(frame.sdp)
          setState(markCallAcceptedByRemote(state))
          break

        case 'ice_candidate':
          await deps.webRTC.addIceCandidate(frame.candidate)
          break

        case 'call_end':
          deps.webRTC.closeOnly()
          setState(endCallByRemote(state))
          break

        case 'call_reject':
          deps.webRTC.closeOnly()
          setState(setRemoteRejected(state))
          scheduleNotificationCleanup()
          break

        case 'call_busy':
          deps.webRTC.closeOnly()
          setState(setRemoteBusy(state))
          scheduleNotificationCleanup()
          break
      }
    },

    async initiateCall(chatId, targetId, isVideo) {
      const nextCallId = deps.createCallId()
      setState(setOutgoingCall(state, {
        callId: nextCallId,
        chatId,
        peerId: targetId,
        isVideo,
      }))
      await deps.webRTC.initiateCall(nextCallId, chatId, targetId, isVideo)
    },

    async acceptCall() {
      const offer = state.incomingOffer
      if (!offer) return
      await deps.webRTC.acceptOffer(offer.callId, offer.sdp, offer.isVideo)
      setState(acceptIncomingCall(state))
    },

    rejectCall() {
      if (state.callId) {
        deps.send({ type: 'call_reject', callId: state.callId })
      }
      setState(resetCallSession(state))
    },

    hangUp() {
      deps.webRTC.hangUp()
      setState(resetCallSession(state))
    },

    toggleMute() {
      setState(toggleCallMute(state))
    },

    toggleCamera() {
      setState(toggleCallCamera(state))
    },

    clearNotification() {
      setState(clearCallNotification(state))
    },

    reset() {
      setState(resetCallSession(state))
    },
  }
}
