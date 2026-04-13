import { useCallback, useEffect, useMemo } from 'react'
import { useCallStore } from '@/store/callStore'
import { useWebRTC } from '@/hooks/useWebRTC'
import { useWsStore } from '@/store/wsStore'

import {
  createCallController,
  type BrowserApiClient,
  type CallWSFrame,
} from '../../../shared/native-core'

export interface CallActions {
  initiateCall: (chatId: string, targetId: string, isVideo: boolean) => void
  acceptCall: () => void
  rejectCall: () => void
  hangUp: () => void
  handleCallFrame: (frame: CallWSFrame) => void
}

export function useCallHandler(apiClient: BrowserApiClient): CallActions {
  const webRTC = useWebRTC(apiClient)
  const applySession = useCallStore((s) => s.applySession)
  const clearMedia = useCallStore((s) => s.clearMedia)
  const setCallControls = useCallStore((s) => s.setCallControls)
  const send = useWsStore((s) => s.send)

  const controller = useMemo(() => createCallController({
    createCallId() {
      return crypto.randomUUID()
    },
    send(frame) {
      return send?.(frame)
    },
    schedule(delayMs, run) {
      return setTimeout(run, delayMs)
    },
    webRTC,
  }), [send, webRTC])

  useEffect(() => {
    applySession(controller.getState())
    const unsubscribe = controller.subscribe((session) => {
      applySession(session)
      if (session.status === 'idle') {
        clearMedia()
      }
    })
    return unsubscribe
  }, [applySession, clearMedia, controller])

  useEffect(() => {
    setCallControls({
      toggleMute() {
        controller.toggleMute()
      },
      toggleCamera() {
        controller.toggleCamera()
      },
    })
    return () => setCallControls(null)
  }, [controller, setCallControls])

  const initiateCall = useCallback((chatId: string, targetId: string, isVideo: boolean) => {
    void controller.initiateCall(chatId, targetId, isVideo).catch((error) => {
      console.error('initiateCall failed', error)
      controller.reset()
      clearMedia()
    })
  }, [clearMedia, controller])

  const acceptCall = useCallback(() => {
    void controller.acceptCall().catch((error) => {
      console.error('acceptOffer failed', error)
      controller.reset()
      clearMedia()
    })
  }, [clearMedia, controller])

  const rejectCall = useCallback(() => {
    controller.rejectCall()
  }, [controller])

  const hangUp = useCallback(() => {
    controller.hangUp()
  }, [controller])

  const handleCallFrame = useCallback((frame: CallWSFrame) => {
    void controller.onFrame(frame).catch((error) => {
      console.error('call frame handling failed', error)
    })
  }, [controller])

  return {
    initiateCall,
    acceptCall,
    rejectCall,
    hangUp,
    handleCallFrame,
  }
}
