import React, { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/api/client'
import s from './VoiceMessage.module.css'

interface VoiceMessageProps {
  mediaId: string
  mediaKey?: string
  duration?: number  // ms
  className?: string
}

/** Генерирует детерминированный массив высот баров по строке-seed */
function generateBars(seed: string, count: number): number[] {
  const bars: number[] = []
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0
  }
  for (let i = 0; i < count; i++) {
    hash = ((hash * 1664525) + 1013904223) | 0
    bars.push(0.2 + 0.8 * ((hash >>> 0) / 0xffffffff))
  }
  return bars
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

const BAR_COUNT = 40

export default function VoiceMessage({ mediaId, mediaKey, duration, className }: VoiceMessageProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)  // 0–1
  const [currentTime, setCurrentTime] = useState(0)  // ms
  const [totalTime, setTotalTime] = useState(duration ?? 0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const bars = generateBars(mediaId, BAR_COUNT)

  useEffect(() => {
    let cancelled = false
    const load = mediaKey
      ? api.fetchEncryptedMediaBlobUrl(mediaId, mediaKey, 'audio/webm')
      : api.fetchMediaBlobUrl(mediaId)

    load.then((url) => {
      if (!cancelled) setBlobUrl(url)
    }).catch(() => {})

    return () => { cancelled = true }
  }, [mediaId, mediaKey])

  const handleToggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !blobUrl) return
    if (playing) {
      audio.pause()
    } else {
      audio.play().catch(() => {})
    }
  }, [playing, blobUrl])

  const handleTimeUpdate = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    const cur = audio.currentTime * 1000
    const dur = audio.duration * 1000 || totalTime || 1
    setCurrentTime(cur)
    setProgress(cur / dur)
  }, [totalTime])

  const handleLoadedMetadata = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    const dur = audio.duration * 1000
    if (dur && isFinite(dur)) setTotalTime(dur)
  }, [])

  const handleEnded = useCallback(() => {
    setPlaying(false)
    setProgress(0)
    setCurrentTime(0)
    if (audioRef.current) audioRef.current.currentTime = 0
  }, [])

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current
    if (!audio) return
    const val = parseFloat(e.target.value)
    const dur = audio.duration || 0
    audio.currentTime = val * dur
    setProgress(val)
    setCurrentTime(val * dur * 1000)
  }, [])

  const displayTotal = totalTime > 0 ? totalTime : (duration ?? 0)
  const displayCurrent = currentTime

  return (
    <div className={`${s.voiceMessage} ${className ?? ''}`}>
      {blobUrl && (
        <audio
          ref={audioRef}
          src={blobUrl}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
          preload="metadata"
        />
      )}
      <button
        className={s.playBtn}
        onClick={handleToggle}
        disabled={!blobUrl}
        aria-label={playing ? 'Пауза' : 'Воспроизвести'}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <div className={s.waveWrap}>
        <div className={s.waveform} aria-hidden="true">
          {bars.map((h, i) => (
            <div
              key={i}
              className={`${s.bar} ${i / BAR_COUNT < progress ? s.barPlayed : ''}`}
              style={{ height: `${Math.round(h * 100)}%` }}
            />
          ))}
        </div>
        <input
          type="range"
          className={s.seekBar}
          min={0}
          max={1}
          step={0.001}
          value={progress}
          onChange={handleSeek}
          aria-label="Позиция воспроизведения"
        />
      </div>
      <span className={s.timeLabel}>
        {playing || progress > 0
          ? formatTime(displayCurrent)
          : formatTime(displayTotal)}
      </span>
    </div>
  )
}
