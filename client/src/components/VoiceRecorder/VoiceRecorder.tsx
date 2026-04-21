import { useEffect, useRef, useState } from 'react'
import s from './VoiceRecorder.module.css'

interface VoiceRecorderProps {
  onSend: (blob: Blob, durationMs: number) => void
  onCancel: () => void
}

function getMimeType(): string {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg',
  ]
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

export default function VoiceRecorder({ onSend, onCancel }: VoiceRecorderProps) {
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const startTimeRef = useRef<number>(Date.now())
  const rafRef = useRef<number>(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mimeTypeRef = useRef<string>('')

  useEffect(() => {
    let cancelled = false

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream

        // Анализатор уровня громкости
        const ctx = new AudioContext()
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        analyserRef.current = analyser

        const buf = new Uint8Array(analyser.frequencyBinCount)
        function tick() {
          analyser.getByteFrequencyData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) sum += buf[i]
          const avg = sum / buf.length
          setLevel(Math.min(100, (avg / 128) * 100))
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)

        // MediaRecorder
        const mimeType = getMimeType()
        mimeTypeRef.current = mimeType
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
        recorderRef.current = recorder
        chunksRef.current = []

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data)
        }

        recorder.start()
        startTimeRef.current = Date.now()

        // Таймер отображения времени
        timerRef.current = setInterval(() => {
          setElapsed(Date.now() - startTimeRef.current)
        }, 500)
      } catch {
        if (!cancelled) setError('Нет доступа к микрофону')
      }
    }

    void start()

    return () => {
      cancelled = true
      if (timerRef.current) clearInterval(timerRef.current)
      cancelAnimationFrame(rafRef.current)
      recorderRef.current?.stop()
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  function handleSend() {
    const recorder = recorderRef.current
    if (!recorder) return
    const durationMs = Date.now() - startTimeRef.current
    if (timerRef.current) clearInterval(timerRef.current)
    cancelAnimationFrame(rafRef.current)

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current || 'audio/webm' })
      onSend(blob, durationMs)
    }
    recorder.stop()
    streamRef.current?.getTracks().forEach((t) => t.stop())
  }

  function handleCancel() {
    if (timerRef.current) clearInterval(timerRef.current)
    cancelAnimationFrame(rafRef.current)
    recorderRef.current?.stop()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    onCancel()
  }

  const seconds = Math.floor(elapsed / 1000)
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

  if (error) {
    return (
      <div className={s.recorder}>
        <span className={s.errorText}>{error}</span>
        <button className={s.cancelBtn} onClick={handleCancel} aria-label="Отмена">✕</button>
      </div>
    )
  }

  return (
    <div className={s.recorder}>
      <span className={s.micIcon} aria-hidden="true">🎙</span>
      <span className={s.timer}>{mm}:{ss}</span>
      <div className={s.levelBar}>
        <div className={s.levelFill} style={{ width: `${level}%` }} />
      </div>
      <button className={s.cancelBtn} onClick={handleCancel} aria-label="Отмена записи">✕</button>
      <button className={s.sendBtn} onClick={handleSend} aria-label="Отправить голосовое сообщение">✓</button>
    </div>
  )
}
