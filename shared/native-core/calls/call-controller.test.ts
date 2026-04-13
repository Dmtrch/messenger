import { describe, expect, it, vi } from 'vitest'

import type { CallWSFrame } from './web/call-ws-types'

const {
  createCallController,
} = await import('./call-controller')

describe('call controller', () => {
  it('incoming offer обновляет snapshot в ringing и accept переводит в active', async () => {
    const acceptOffer = vi.fn().mockResolvedValue(undefined)
    const snapshots: string[] = []

    const controller = createCallController({
      createCallId: vi.fn(() => 'generated-call'),
      send: vi.fn(),
      schedule: vi.fn(),
      webRTC: {
        initiateCall: vi.fn(),
        acceptOffer,
        handleAnswer: vi.fn(),
        addIceCandidate: vi.fn(),
        hangUp: vi.fn(),
        closeOnly: vi.fn(),
      },
    })

    controller.subscribe((state) => {
      snapshots.push(state.status)
    })

    await controller.onFrame({
      type: 'call_offer',
      callId: 'call-1',
      chatId: 'chat-1',
      callerId: 'alice',
      sdp: 'offer-sdp',
      isVideo: true,
    } satisfies CallWSFrame)

    expect(controller.getState().status).toBe('ringing')
    expect(controller.getState().incomingOffer?.callerId).toBe('alice')

    await controller.acceptCall()

    expect(acceptOffer).toHaveBeenCalledWith('call-1', 'offer-sdp', true)
    expect(controller.getState().status).toBe('active')
    expect(snapshots).toEqual(['ringing', 'active'])
  })

  it('initiateCall публикует calling snapshot и remote answer переводит в active', async () => {
    const initiateCall = vi.fn().mockResolvedValue(undefined)
    const handleAnswer = vi.fn().mockResolvedValue(undefined)

    const controller = createCallController({
      createCallId: vi.fn(() => 'call-2'),
      send: vi.fn(),
      schedule: vi.fn(),
      webRTC: {
        initiateCall,
        acceptOffer: vi.fn(),
        handleAnswer,
        addIceCandidate: vi.fn(),
        hangUp: vi.fn(),
        closeOnly: vi.fn(),
      },
    })

    await controller.initiateCall('chat-2', 'bob', false)

    expect(controller.getState()).toEqual(expect.objectContaining({
      status: 'calling',
      callId: 'call-2',
      chatId: 'chat-2',
      peerId: 'bob',
      isVideo: false,
    }))
    expect(initiateCall).toHaveBeenCalledWith('call-2', 'chat-2', 'bob', false)

    await controller.onFrame({
      type: 'call_answer',
      callId: 'call-2',
      sdp: 'answer-sdp',
    } satisfies CallWSFrame)

    expect(handleAnswer).toHaveBeenCalledWith('answer-sdp')
    expect(controller.getState().status).toBe('active')
  })

  it('reject/busy/end сценарии завершают звонок и выставляют notification через state machine', async () => {
    const closeOnly = vi.fn()

    const controller = createCallController({
      createCallId: vi.fn(() => 'call-3'),
      send: vi.fn().mockReturnValue(true),
      schedule: vi.fn(),
      webRTC: {
        initiateCall: vi.fn(),
        acceptOffer: vi.fn(),
        handleAnswer: vi.fn(),
        addIceCandidate: vi.fn(),
        hangUp: vi.fn(),
        closeOnly,
      },
    })

    await controller.initiateCall('chat-3', 'carol', true)
    await controller.onFrame({
      type: 'call_busy',
      callId: 'call-3',
    } satisfies CallWSFrame)

    expect(closeOnly).toHaveBeenCalled()
    expect(controller.getState().status).toBe('idle')
    expect(controller.getState().notification).toBe('Абонент занят')

    controller.clearNotification()
    expect(controller.getState().notification).toBeNull()

    await controller.initiateCall('chat-3', 'carol', true)
    await controller.onFrame({
      type: 'call_end',
      callId: 'call-3',
    } satisfies CallWSFrame)

    expect(controller.getState().status).toBe('idle')
    expect(controller.getState().callId).toBeNull()
  })

  it('toggle mute/camera меняют только shared snapshot', async () => {
    const controller = createCallController({
      createCallId: vi.fn(() => 'call-4'),
      send: vi.fn(),
      schedule: vi.fn(),
      webRTC: {
        initiateCall: vi.fn(),
        acceptOffer: vi.fn(),
        handleAnswer: vi.fn(),
        addIceCandidate: vi.fn(),
        hangUp: vi.fn(),
        closeOnly: vi.fn(),
      },
    })

    await controller.initiateCall('chat-4', 'dave', true)

    controller.toggleMute()
    controller.toggleCamera()

    expect(controller.getState()).toEqual(expect.objectContaining({
      isMuted: true,
      isCameraOff: true,
      status: 'calling',
    }))
  })

  it('планирует автоматический сброс notification через scheduler', async () => {
    const scheduled: Array<() => void> = []

    const controller = createCallController({
      createCallId: vi.fn(() => 'call-5'),
      send: vi.fn(),
      schedule: vi.fn((delayMs: number, run: () => void) => {
        expect(delayMs).toBe(3000)
        scheduled.push(run)
        return scheduled.length
      }),
      webRTC: {
        initiateCall: vi.fn(),
        acceptOffer: vi.fn(),
        handleAnswer: vi.fn(),
        addIceCandidate: vi.fn(),
        hangUp: vi.fn(),
        closeOnly: vi.fn(),
      },
    })

    await controller.initiateCall('chat-5', 'erin', true)
    await controller.onFrame({
      type: 'call_reject',
      callId: 'call-5',
    } satisfies CallWSFrame)

    expect(controller.getState().notification).toBe('Звонок отклонён')
    expect(scheduled).toHaveLength(1)

    scheduled[0]?.()
    expect(controller.getState().notification).toBeNull()
  })
})
