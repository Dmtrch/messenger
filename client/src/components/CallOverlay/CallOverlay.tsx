import { useEffect, useRef, useState } from 'react'
import { useCallStore } from '@/store/callStore'
import { startRingtone } from '@/utils/ringtone'
import GroupCallView from '../GroupCallView/GroupCallView'
import s from './CallOverlay.module.css'

interface Props {
  onAccept: () => void
  onReject: () => void
  onHangUp: () => void
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const sec = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}

export default function CallOverlay({ onAccept, onReject, onHangUp }: Props) {
  const session        = useCallStore((s) => s.session)
  const localStream    = useCallStore((s) => s.localStream)
  const remoteStream   = useCallStore((s) => s.remoteStream)
  const toggleMute     = useCallStore((s) => s.toggleMute)
  const toggleCamera   = useCallStore((s) => s.toggleCamera)
  const roomId         = useCallStore((s) => s.roomId)
  const clearGroupRoom = useCallStore((s) => s.clearGroupRoom)
  const isGroupCall    = roomId !== null
  const {
    status,
    peerId,
    isVideo,
    isMuted,
    isCameraOff,
    notification,
  } = session

  const [elapsed, setElapsed] = useState(0)
  const localVideoRef  = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)

  // Таймер длительности активного звонка
  useEffect(() => {
    if (status !== 'active') { setElapsed(0); return }
    const id = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(id)
  }, [status])

  // Ringtone при входящем звонке
  useEffect(() => {
    if (status !== 'ringing') return
    const stop = startRingtone()
    return () => stop?.()
  }, [status])

  // Привязка потоков к video-элементам (зависим от status, чтобы поймать момент монтирования элементов)
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream
    }
  }, [localStream, status])

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream
    }
  }, [remoteStream, status])

  if (status === 'idle' && !notification) return null

  // Уведомление (busy / rejected) без overlay
  if (status === 'idle' && notification) {
    return <div className={s.notification}>{notification}</div>
  }

  const peerLabel = peerId ?? 'Неизвестный'

  if (isGroupCall && status === 'active') {
    return (
      <div className={s.overlay}>
        <div className={s.timer}>{formatDuration(elapsed)}</div>
        <div className={s.groupLayout}>
          <GroupCallView />
        </div>
        <div className={s.controls}>
          <button
            className={`${s.btn} ${isMuted ? s.btnMuted : s.btnMute}`}
            onClick={toggleMute}
            aria-label={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
          >
            {isMuted ? '🔇' : '🎤'}
          </button>
          <button
            className={`${s.btn} ${isCameraOff ? s.btnCamOff : s.btnCamera}`}
            onClick={toggleCamera}
            aria-label={isCameraOff ? 'Включить камеру' : 'Выключить камеру'}
          >
            {isCameraOff ? '📷' : '📹'}
          </button>
          <button
            className={`${s.btn} ${s.btnHangup}`}
            onClick={() => { onHangUp(); clearGroupRoom() }}
            aria-label="Завершить"
          >
            📵
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={s.overlay}>
      {status === 'active' && isVideo && (
        <>
          <video
            ref={remoteVideoRef}
            className={s.remoteVideo}
            autoPlay
            playsInline
          />
          <video
            ref={localVideoRef}
            className={s.localVideo}
            autoPlay
            playsInline
            muted
          />
        </>
      )}

      {(status === 'ringing' || status === 'calling' || (status === 'active' && !isVideo)) && (
        <>
          <div className={s.avatar}>
            {peerLabel.charAt(0).toUpperCase()}
          </div>
          <div className={s.peerName}>{peerLabel}</div>
          <div className={s.statusText}>
            {status === 'ringing' && (isVideo ? 'Входящий видеозвонок' : 'Входящий аудиозвонок')}
            {status === 'calling' && 'Вызов...'}
            {status === 'active'  && formatDuration(elapsed)}
          </div>
        </>
      )}

      {status === 'active' && isVideo && (
        <div className={s.timer}>{formatDuration(elapsed)}</div>
      )}

      <div className={s.controls}>
        {status === 'ringing' && (
          <>
            <button className={`${s.btn} ${s.btnReject}`} onClick={onReject} aria-label="Отклонить">
              📵
            </button>
            <button className={`${s.btn} ${s.btnAccept}`} onClick={onAccept} aria-label="Принять">
              📞
            </button>
          </>
        )}

        {status === 'calling' && (
          <button className={`${s.btn} ${s.btnReject}`} onClick={onHangUp} aria-label="Отмена">
            📵
          </button>
        )}

        {status === 'active' && (
          <>
            <button
              className={`${s.btn} ${isMuted ? s.btnMuted : s.btnMute}`}
              onClick={toggleMute}
              aria-label={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
            >
              {isMuted ? '🔇' : '🎤'}
            </button>
            {isVideo && (
              <button
                className={`${s.btn} ${isCameraOff ? s.btnCamOff : s.btnCamera}`}
                onClick={toggleCamera}
                aria-label={isCameraOff ? 'Включить камеру' : 'Выключить камеру'}
              >
                {isCameraOff ? '📷' : '📹'}
              </button>
            )}
            <button className={`${s.btn} ${s.btnHangup}`} onClick={onHangUp} aria-label="Завершить">
              📵
            </button>
          </>
        )}
      </div>
    </div>
  )
}
