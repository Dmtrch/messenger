import { useEffect, useCallback } from 'react'
import { useCallStore } from '@/store/callStore'
import { useWebRTC } from '@/hooks/useWebRTC'
import { useWsStore } from '@/store/wsStore'
import type { WSFrame } from '@/types'

// Тип для call-фреймов, приходящих с сервера
type CallWSFrame = Extract<WSFrame, {
  type: 'call_offer' | 'call_answer' | 'call_end' | 'call_reject' | 'call_busy' | 'ice_candidate'
}>

export interface CallActions {
  initiateCall: (chatId: string, targetId: string, isVideo: boolean) => void
  acceptCall: () => void
  rejectCall: () => void
  hangUp: () => void
}

export function useCallHandler(): CallActions {
  const webRTC = useWebRTC()
  const setCallFrameHandler = useCallStore((s) => s.setCallFrameHandler)
  const setInitiateCall = useCallStore((s) => s.setInitiateCall)
  const setIncoming = useCallStore((s) => s.setIncoming)
  const setNotification = useCallStore((s) => s.setNotification)
  const send = useWsStore((s) => s.send)

  // Обработчик call-фреймов, вызывается из useMessengerWS
  const handleCallFrame = useCallback((frame: CallWSFrame) => {
    switch (frame.type) {
      case 'call_offer':
        setIncoming({
          callId: frame.callId,
          chatId: frame.chatId,
          callerId: frame.callerId,
          sdp: frame.sdp,
          isVideo: frame.isVideo,
        })
        break

      case 'call_answer':
        webRTC.handleAnswer(frame.sdp).catch((e) =>
          console.error('handleAnswer failed', e)
        )
        break

      case 'ice_candidate':
        webRTC.addIceCandidate(frame.candidate).catch((e) =>
          console.error('addIceCandidate failed', e)
        )
        break

      case 'call_end':
        // closeOnly закрывает PC без повторной отправки call_end серверу
        webRTC.closeOnly()
        break

      case 'call_reject':
        webRTC.closeOnly()
        setNotification('Звонок отклонён')
        setTimeout(() => setNotification(null), 3000)
        break

      case 'call_busy':
        webRTC.closeOnly()
        setNotification('Абонент занят')
        setTimeout(() => setNotification(null), 3000)
        break
    }
  }, [webRTC, setIncoming, setNotification])

  // Регистрируем обработчик в callStore, чтобы useMessengerWS мог его вызывать
  useEffect(() => {
    setCallFrameHandler(handleCallFrame)
    return () => setCallFrameHandler(null)
  }, [handleCallFrame, setCallFrameHandler])

  // === Публичные action-функции ===

  const initiateCall = useCallback((chatId: string, targetId: string, isVideo: boolean) => {
    const callId = crypto.randomUUID()
    useCallStore.getState().startOutgoing(callId, chatId, targetId, isVideo)
    webRTC.initiateCall(callId, chatId, targetId, isVideo).catch((e) => {
      console.error('initiateCall failed', e)
      useCallStore.getState().reset()
    })
  }, [webRTC])

  // Регистрируем initiateCall в store, чтобы AppRoutes мог получить его без дублирования хука
  useEffect(() => {
    setInitiateCall(initiateCall)
    return () => setInitiateCall(null)
  }, [initiateCall, setInitiateCall])

  const acceptCall = useCallback(() => {
    const { incomingOffer } = useCallStore.getState()
    if (!incomingOffer) return
    webRTC.acceptOffer(incomingOffer.callId, incomingOffer.sdp, incomingOffer.isVideo).catch((e) => {
      console.error('acceptOffer failed', e)
      useCallStore.getState().reset()
    })
  }, [webRTC])

  const rejectCall = useCallback(() => {
    const { callId } = useCallStore.getState()
    if (callId) {
      send?.({ type: 'call_reject', callId })
    }
    useCallStore.getState().reset()
  }, [send])

  const hangUp = useCallback(() => {
    webRTC.hangUp()
  }, [webRTC])

  return { initiateCall, acceptCall, rejectCall, hangUp }
}
