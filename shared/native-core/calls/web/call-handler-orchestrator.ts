import type { CallIceCandidate, CallWSFrame, CallWSSendFrame } from './call-ws-types'

export interface IncomingOffer {
  callId: string
  chatId: string
  callerId: string
  sdp: string
  isVideo: boolean
}

export interface CallHandlerWebRTCControls {
  initiateCall(callId: string, chatId: string, targetId: string, isVideo: boolean): Promise<void>
  acceptOffer(callId: string, sdp: string, isVideo: boolean): Promise<void>
  handleAnswer(sdp: string): Promise<void>
  addIceCandidate(candidate: CallIceCandidate): Promise<void>
  hangUp(): void
  closeOnly(): void
}

export interface CallHandlerOrchestratorDeps {
  createCallId(): string
  getCurrentState(): { callId: string | null; incomingOffer: IncomingOffer | null }
  startOutgoing(callId: string, chatId: string, peerId: string, isVideo: boolean): void
  setIncoming(offer: IncomingOffer): void
  setNotification(message: string | null): void
  reset(): void
  send(frame: CallWSSendFrame): boolean | undefined
  schedule(delayMs: number, run: () => void): unknown
  webRTC: CallHandlerWebRTCControls
}

function notifyTemporarily(
  deps: Pick<CallHandlerOrchestratorDeps, 'setNotification' | 'schedule'>,
  message: string,
): void {
  deps.setNotification(message)
  deps.schedule(3000, () => deps.setNotification(null))
}

export function createCallHandlerOrchestrator(deps: CallHandlerOrchestratorDeps) {
  return {
    async onFrame(frame: CallWSFrame): Promise<void> {
      switch (frame.type) {
        case 'call_offer':
          deps.setIncoming({
            callId: frame.callId,
            chatId: frame.chatId,
            callerId: frame.callerId,
            sdp: frame.sdp,
            isVideo: frame.isVideo,
          })
          break

        case 'call_answer':
          await deps.webRTC.handleAnswer(frame.sdp)
          break

        case 'ice_candidate':
          await deps.webRTC.addIceCandidate(frame.candidate)
          break

        case 'call_end':
          deps.webRTC.closeOnly()
          break

        case 'call_reject':
          deps.webRTC.closeOnly()
          notifyTemporarily(deps, 'Звонок отклонён')
          break

        case 'call_busy':
          deps.webRTC.closeOnly()
          notifyTemporarily(deps, 'Абонент занят')
          break
      }
    },

    async initiateCall(chatId: string, targetId: string, isVideo: boolean): Promise<void> {
      const nextCallId = deps.createCallId()
      deps.startOutgoing(nextCallId, chatId, targetId, isVideo)
      await deps.webRTC.initiateCall(nextCallId, chatId, targetId, isVideo)
    },

    async acceptCall(): Promise<void> {
      const { incomingOffer } = deps.getCurrentState()
      if (!incomingOffer) return
      await deps.webRTC.acceptOffer(incomingOffer.callId, incomingOffer.sdp, incomingOffer.isVideo)
    },

    rejectCall(): void {
      const { callId } = deps.getCurrentState()
      if (callId) {
        deps.send({ type: 'call_reject', callId })
      }
      deps.reset()
    },

    hangUp(): void {
      deps.webRTC.hangUp()
    },
  }
}
