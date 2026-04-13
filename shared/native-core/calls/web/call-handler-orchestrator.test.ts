import { describe, expect, it, vi } from 'vitest'

import type { CallWSFrame, CallWSSendFrame } from './call-ws-types'

const {
  createCallHandlerOrchestrator,
} = await import('./call-handler-orchestrator')

describe('call handler orchestrator', () => {
  it('обрабатывает call_offer и call_reject через store + notification', async () => {
    const setIncoming = vi.fn()
    const setNotification = vi.fn()
    const closeOnly = vi.fn()
    const scheduled: Array<() => void> = []

    const orchestrator = createCallHandlerOrchestrator({
      createCallId: vi.fn(() => 'call-1'),
      getCurrentState: vi.fn(() => ({ callId: 'call-1', incomingOffer: null })),
      startOutgoing: vi.fn(),
      setIncoming,
      setNotification,
      reset: vi.fn(),
      send: vi.fn(),
      schedule(delayMs, run) {
        expect(delayMs).toBe(3000)
        scheduled.push(run)
        return scheduled.length
      },
      webRTC: {
        initiateCall: vi.fn(),
        acceptOffer: vi.fn(),
        handleAnswer: vi.fn(),
        addIceCandidate: vi.fn(),
        hangUp: vi.fn(),
        closeOnly,
      },
    })

    await orchestrator.onFrame({
      type: 'call_offer',
      callId: 'call-in',
      chatId: 'chat-1',
      callerId: 'alice',
      sdp: 'sdp-offer',
      isVideo: true,
    } satisfies CallWSFrame)

    expect(setIncoming).toHaveBeenCalledWith({
      callId: 'call-in',
      chatId: 'chat-1',
      callerId: 'alice',
      sdp: 'sdp-offer',
      isVideo: true,
    })

    await orchestrator.onFrame({
      type: 'call_reject',
      callId: 'call-in',
    } satisfies CallWSFrame)

    expect(closeOnly).toHaveBeenCalled()
    expect(setNotification).toHaveBeenCalledWith('Звонок отклонён')

    scheduled[0]?.()
    expect(setNotification).toHaveBeenLastCalledWith(null)
  })

  it('initiateCall создаёт callId, обновляет store и делегирует в webRTC', async () => {
    const startOutgoing = vi.fn()
    const initiateCall = vi.fn().mockResolvedValue(undefined)

    const orchestrator = createCallHandlerOrchestrator({
      createCallId: vi.fn(() => 'generated-call'),
      getCurrentState: vi.fn(() => ({ callId: null, incomingOffer: null })),
      startOutgoing,
      setIncoming: vi.fn(),
      setNotification: vi.fn(),
      reset: vi.fn(),
      send: vi.fn(),
      schedule: vi.fn(),
      webRTC: {
        initiateCall,
        acceptOffer: vi.fn(),
        handleAnswer: vi.fn(),
        addIceCandidate: vi.fn(),
        hangUp: vi.fn(),
        closeOnly: vi.fn(),
      },
    })

    await orchestrator.initiateCall('chat-2', 'bob', false)

    expect(startOutgoing).toHaveBeenCalledWith('generated-call', 'chat-2', 'bob', false)
    expect(initiateCall).toHaveBeenCalledWith('generated-call', 'chat-2', 'bob', false)
  })

  it('accept/reject/hangUp используют текущее состояние звонка', async () => {
    const send = vi.fn<(_: CallWSSendFrame) => boolean>().mockReturnValue(true)
    const reset = vi.fn()
    const acceptOffer = vi.fn().mockResolvedValue(undefined)
    const hangUp = vi.fn()

    const orchestrator = createCallHandlerOrchestrator({
      createCallId: vi.fn(),
      getCurrentState: vi.fn(() => ({
        callId: 'call-3',
        incomingOffer: {
          callId: 'call-3',
          chatId: 'chat-3',
          callerId: 'carol',
          sdp: 'offer-sdp',
          isVideo: true,
        },
      })),
      startOutgoing: vi.fn(),
      setIncoming: vi.fn(),
      setNotification: vi.fn(),
      reset,
      send,
      schedule: vi.fn(),
      webRTC: {
        initiateCall: vi.fn(),
        acceptOffer,
        handleAnswer: vi.fn(),
        addIceCandidate: vi.fn(),
        hangUp,
        closeOnly: vi.fn(),
      },
    })

    await orchestrator.acceptCall()
    expect(acceptOffer).toHaveBeenCalledWith('call-3', 'offer-sdp', true)

    orchestrator.rejectCall()
    expect(send).toHaveBeenCalledWith({ type: 'call_reject', callId: 'call-3' })
    expect(reset).toHaveBeenCalled()

    orchestrator.hangUp()
    expect(hangUp).toHaveBeenCalled()
  })
})
