import { useRef, useCallback } from 'react'
import { api } from '@/api/client'
import { useCallStore } from '@/store/callStore'
import { useWsStore } from '@/store/wsStore'

export interface WebRTCControls {
  initiateCall: (callId: string, chatId: string, targetId: string, isVideo: boolean) => Promise<void>
  acceptOffer: (callId: string, sdp: string, isVideo: boolean) => Promise<void>
  handleAnswer: (sdp: string) => Promise<void>
  addIceCandidate: (candidate: RTCIceCandidateInit) => Promise<void>
  /** Завершить звонок и отправить call_end серверу */
  hangUp: () => void
  /** Закрыть PeerConnection без отправки call_end (для входящих call_end/reject/busy) */
  closeOnly: () => void
}

export function useWebRTC(): WebRTCControls {
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const callIdRef = useRef<string | null>(null)
  // ICE-кандидаты могут прийти до setRemoteDescription — буферизуем
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([])

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
    pendingCandidatesRef.current = []

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

  /** Сбросить буфер ICE-кандидатов после setRemoteDescription */
  const flushPendingCandidates = useCallback(async (pc: RTCPeerConnection): Promise<void> => {
    const candidates = pendingCandidatesRef.current
    pendingCandidatesRef.current = []
    for (const c of candidates) {
      try {
        await pc.addIceCandidate(c)
      } catch {
        // Устаревший кандидат — игнорируем
      }
    }
  }, [])

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
    // Добавляем буферизованные кандидаты после установки remote description
    await flushPendingCandidates(pc)

    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    setActive()

    send?.({
      type: 'call_answer',
      callId,
      sdp: answer.sdp!,
    })
  }, [createPC, getLocalStream, send, setActive, flushPendingCandidates])

  const handleAnswer = useCallback(async (sdp: string) => {
    if (!pcRef.current) return
    await pcRef.current.setRemoteDescription({ type: 'answer', sdp })
    // Добавляем буферизованные кандидаты после установки remote description
    await flushPendingCandidates(pcRef.current)
    setActive()
  }, [setActive, flushPendingCandidates])

  const addIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    const pc = pcRef.current
    if (!pc) {
      // PC ещё не создан — буферизуем
      pendingCandidatesRef.current.push(candidate)
      return
    }
    if (pc.remoteDescription === null) {
      // Remote description ещё не установлен — буферизуем
      pendingCandidatesRef.current.push(candidate)
      return
    }
    try {
      await pc.addIceCandidate(candidate)
    } catch {
      // Устаревший кандидат после setRemoteDescription — игнорируем
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
    pendingCandidatesRef.current = []
    reset()
  }, [send, reset])

  /** Закрыть PeerConnection без отправки call_end серверу.
   *  Используется при получении call_end/call_reject/call_busy от удалённой стороны.
   */
  const closeOnly = useCallback(() => {
    pcRef.current?.close()
    pcRef.current = null
    callIdRef.current = null
    pendingCandidatesRef.current = []
    reset()
  }, [reset])

  // обновляем ref при каждом ре-рендере, чтобы createPC.onconnectionstatechange
  // всегда вызывал актуальную версию hangUp
  hangUpRef.current = hangUp

  return { initiateCall, acceptOffer, handleAnswer, addIceCandidate, hangUp, closeOnly }
}
