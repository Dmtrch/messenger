import { describe, expect, it } from 'vitest'

const {
  acceptIncomingCall,
  clearCallNotification,
  createInitialCallSession,
  endCallByRemote,
  markCallAcceptedByRemote,
  receiveIncomingCall,
  rejectIncomingCall,
  resetCallSession,
  setOutgoingCall,
  setRemoteBusy,
  setRemoteRejected,
  toggleCallCamera,
  toggleCallMute,
} = await import('./call-session')

describe('call session', () => {
  it('проходит путь idle -> ringing -> active -> idle', () => {
    const ringing = receiveIncomingCall(createInitialCallSession(), {
      callId: 'call-1',
      chatId: 'chat-1',
      callerId: 'alice',
      sdp: 'offer-sdp',
      isVideo: true,
    })

    expect(ringing.status).toBe('ringing')
    expect(ringing.incomingOffer?.callerId).toBe('alice')

    const active = acceptIncomingCall(ringing)
    expect(active.status).toBe('active')
    expect(active.incomingOffer).toBeNull()

    const idle = endCallByRemote(active)
    expect(idle).toEqual(createInitialCallSession())
  })

  it('проходит путь idle -> calling -> active -> idle', () => {
    const calling = setOutgoingCall(createInitialCallSession(), {
      callId: 'call-2',
      chatId: 'chat-2',
      peerId: 'bob',
      isVideo: false,
    })

    expect(calling.status).toBe('calling')
    expect(calling.peerId).toBe('bob')

    const active = markCallAcceptedByRemote(calling)
    expect(active.status).toBe('active')

    const idle = resetCallSession(active)
    expect(idle).toEqual(createInitialCallSession())
  })

  it('call_reject создаёт notification и не оставляет активный звонок', () => {
    const calling = setOutgoingCall(createInitialCallSession(), {
      callId: 'call-3',
      chatId: 'chat-3',
      peerId: 'carol',
      isVideo: true,
    })

    const rejected = setRemoteRejected(calling)

    expect(rejected.status).toBe('idle')
    expect(rejected.notification).toBe('Звонок отклонён')
    expect(rejected.callId).toBeNull()
    expect(rejected.incomingOffer).toBeNull()
  })

  it('call_busy создаёт notification и не оставляет активный звонок', () => {
    const calling = setOutgoingCall(createInitialCallSession(), {
      callId: 'call-4',
      chatId: 'chat-4',
      peerId: 'dave',
      isVideo: true,
    })

    const busy = setRemoteBusy(calling)

    expect(busy.status).toBe('idle')
    expect(busy.notification).toBe('Абонент занят')
    expect(busy.callId).toBeNull()
    expect(busy.peerId).toBeNull()
  })

  it('toggleMute и toggleCamera меняют только domain flags', () => {
    const initial = setOutgoingCall(createInitialCallSession(), {
      callId: 'call-5',
      chatId: 'chat-5',
      peerId: 'erin',
      isVideo: true,
    })

    const muted = toggleCallMute(initial)
    const cameraOff = toggleCallCamera(muted)

    expect(muted.isMuted).toBe(true)
    expect(muted.status).toBe('calling')
    expect(cameraOff.isCameraOff).toBe(true)
    expect(cameraOff.peerId).toBe('erin')
  })

  it('reset очищает incomingOffer, callId, peerId и notification', () => {
    const ringing = receiveIncomingCall(createInitialCallSession(), {
      callId: 'call-6',
      chatId: 'chat-6',
      callerId: 'frank',
      sdp: 'offer',
      isVideo: false,
    })
    const withNotification = clearCallNotification(setRemoteRejected(ringing))
    const reset = resetCallSession({
      ...withNotification,
      notification: 'temp',
    })

    expect(reset).toEqual(createInitialCallSession())
  })
})
