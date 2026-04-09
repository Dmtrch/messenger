import { useRef, useCallback } from 'react'
import { api } from '@/api/client'
import { useCallStore } from '@/store/callStore'
import { useWsStore } from '@/store/wsStore'

export interface WebRTCControls {
  initiateCall: (callId: string, chatId: string, targetId: string, isVideo: boolean) => Promise<void>
  acceptOffer: (callId: string, sdp: string, isVideo: boolean) => Promise<void>
  handleAnswer: (sdp: string) => Promise<void>
  addIceCandidate: (candidate: RTCIceCandidateInit) => Promise<void>
  hangUp: () => void
}

export function useWebRTC(): WebRTCControls {
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const callIdRef = useRef<string | null>(null)

  // ref для hangUp — разрывает circular dependency в createPC
  const hangUpRef = useRef<() => void>(() => undefined)

  const send = useWsStore((s) => s.send)
  const setLocalStream = useCallStore((s) => s.setLocalStream)
  const setRemoteStream = useCallStore((s) => s.setRemoteStream)
  const setActive = useCallStore((s) => s.setActive)
  const reset = useCallStore((s) => s.reset)

  const getIceServers = useCallback(async (): Promise<RTCIceServer[]> => {
    try {
      const data = await api.getIceServers()
      return data.iceServers as RTCIceServer[]
    } catch {
      return [{ urls: 'stun:stun.l.google.com:19302' }]
    }
  }, [])

  const createPC = useCallback(async (callId: string): Promise<RTCPeerConnection> => {
    const iceServers = await getIceServers()
    const pc = new RTCPeerConnection({ iceServers })
    callIdRef.current = callId
    pcRef.current = pc

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && callIdRef.current) {
        send?.({
          type: 'ice_candidate',
          callId: callIdRef.current,
          candidate: candidate.toJSON() as RTCIceCandidateInit,
        })
      }
    }

    pc.ontrack = (event) => {
      const stream = event.streams[0]
      if (stream) setRemoteStream(stream)
    }

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      if (state === 'failed' || state === 'closed') {
        // используем ref, чтобы не создавать circular dependency
        hangUpRef.current()
      }
    }

    return pc
  }, [getIceServers, send, setRemoteStream])

  const getLocalStream = useCallback(async (isVideo: boolean): Promise<MediaStream> => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo })
    setLocalStream(stream)
    return stream
  }, [setLocalStream])

  const initiateCall = useCallback(async (
    callId: string,
    chatId: string,
    targetId: string,
    isVideo: boolean,
  ) => {
    const pc = await createPC(callId)
    const stream = await getLocalStream(isVideo)
    stream.getTracks().forEach((track) => pc.addTrack(track, stream))

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    send?.({
      type: 'call_offer',
      callId,
      chatId,
      targetId,
      sdp: offer.sdp!,
      isVideo,
    })
  }, [createPC, getLocalStream, send])

  const acceptOffer = useCallback(async (callId: string, sdp: string, isVideo: boolean) => {
    const pc = await createPC(callId)
    const stream = await getLocalStream(isVideo)
    stream.getTracks().forEach((track) => pc.addTrack(track, stream))

    await pc.setRemoteDescription({ type: 'offer', sdp })
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    setActive()

    send?.({
      type: 'call_answer',
      callId,
      sdp: answer.sdp!,
    })
  }, [createPC, getLocalStream, send, setActive])

  const handleAnswer = useCallback(async (sdp: string) => {
    if (!pcRef.current) return
    await pcRef.current.setRemoteDescription({ type: 'answer', sdp })
    setActive()
  }, [setActive])

  const addIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    if (!pcRef.current) return
    try {
      await pcRef.current.addIceCandidate(candidate)
    } catch {
      // ICE candidate может прийти до setRemoteDescription — игнорируем
    }
  }, [])

  const hangUp = useCallback(() => {
    const callId = callIdRef.current
    if (callId) {
      send?.({ type: 'call_end', callId })
    }
    pcRef.current?.close()
    pcRef.current = null
    callIdRef.current = null
    reset()
  }, [send, reset])

  // обновляем ref при каждом ре-рендере, чтобы createPC.onconnectionstatechange
  // всегда вызывал актуальную версию hangUp
  hangUpRef.current = hangUp

  return { initiateCall, acceptOffer, handleAnswer, addIceCandidate, hangUp }
}
