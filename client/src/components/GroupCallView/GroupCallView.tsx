import { useEffect, useRef } from 'react'
import { useCallStore } from '@/store/callStore'
import type { ParticipantState } from '@/store/callStore'
import styles from './GroupCallView.module.css'

function getGridClass(count: number): string {
  if (count <= 1) return styles.grid1
  if (count === 2) return styles.grid2
  if (count <= 4) return styles.grid4
  return styles.gridN
}

type ParticipantTileProps = {
  participant: ParticipantState
  pinned: boolean
  onPin: () => void
  onUnpin: () => void
  setParticipantSpeaking: (userId: string, speaking: boolean) => void
}

function ParticipantTile({ participant, pinned, onPin, onUnpin, setParticipantSpeaking }: ParticipantTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { userId, stream, isMuted, isCameraOff, isSpeaking, networkQuality } = participant

  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    el.srcObject = stream
  }, [stream])

  useEffect(() => {
    if (!stream) return

    let audioCtx: AudioContext | null = null
    let source: MediaStreamAudioSourceNode | null = null
    let analyser: AnalyserNode | null = null
    let intervalId: ReturnType<typeof setInterval> | null = null

    try {
      audioCtx = new AudioContext()
      analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source = audioCtx.createMediaStreamSource(stream)
      source.connect(analyser)

      const buffer = new Uint8Array(analyser.fftSize)

      intervalId = setInterval(() => {
        if (!analyser) return
        analyser.getByteTimeDomainData(buffer)
        let sumSq = 0
        for (let i = 0; i < buffer.length; i++) {
          const val = buffer[i] - 128
          sumSq += val * val
        }
        const rms = Math.sqrt(sumSq / buffer.length)
        setParticipantSpeaking(userId, rms > 5)
      }, 100)
    } catch {
    }

    return () => {
      if (intervalId !== null) clearInterval(intervalId)
      if (audioCtx) audioCtx.close()
    }
  }, [stream, userId, setParticipantSpeaking])

  const showVideo = stream && !isCameraOff

  const tileClass = [
    styles.tile,
    isSpeaking ? styles.tileSpeaking : '',
    pinned ? styles.pinned : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={tileClass}>
      {showVideo ? (
        <video
          ref={videoRef}
          className={styles.video}
          autoPlay
          playsInline
          muted
        />
      ) : (
        <div className={styles.avatar}>{userId.charAt(0).toUpperCase()}</div>
      )}

      <div className={styles.overlay}>
        {isMuted && <span className={styles.icon}>🔇</span>}
        {isCameraOff && <span className={styles.icon}>📷</span>}
      </div>

      <button
        className={styles.pinBtn}
        onClick={pinned ? onUnpin : onPin}
        title={pinned ? 'Unpin' : 'Pin'}
      >
        📌
      </button>

      {networkQuality === 'fair' && (
        <div className={`${styles.qualityDot} ${styles.qualityFair}`} />
      )}
      {networkQuality === 'poor' && (
        <div className={`${styles.qualityDot} ${styles.qualityPoor}`} />
      )}
    </div>
  )
}

export default function GroupCallView() {
  const participants = useCallStore((s) => s.participants)
  const pinnedUserId = useCallStore((s) => s.pinnedUserId)
  const setPinnedUser = useCallStore((s) => s.setPinnedUser)
  const setParticipantSpeaking = useCallStore((s) => s.setParticipantSpeaking)

  const list = Object.values(participants)
  const count = list.length

  const containerClass = `${styles.container} ${getGridClass(count)}`

  return (
    <div className={containerClass}>
      {list.map((p) => (
        <ParticipantTile
          key={p.userId}
          participant={p}
          pinned={pinnedUserId === p.userId}
          onPin={() => setPinnedUser(p.userId)}
          onUnpin={() => setPinnedUser(null)}
          setParticipantSpeaking={setParticipantSpeaking}
        />
      ))}
    </div>
  )
}
