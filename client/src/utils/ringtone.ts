/**
 * Ringtone на Web Audio API — пульсирующий тональный сигнал без внешних файлов.
 * Возвращает функцию остановки.
 */
export function startRingtone(): () => void {
  let active = true
  let currentCtx: AudioContext | null = null

  function beep(): void {
    if (!active) return
    try {
      const ctx = new AudioContext()
      currentCtx = ctx
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.type = 'sine'
      osc.frequency.value = 440

      gain.gain.setValueAtTime(0.15, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7)

      osc.start()
      osc.stop(ctx.currentTime + 0.7)
      osc.onended = () => {
        ctx.close()
        currentCtx = null
        if (active) setTimeout(beep, 600)
      }
    } catch {
      // AudioContext может быть недоступен в некоторых окружениях
    }
  }

  beep()

  return () => {
    active = false
    currentCtx?.close()
    currentCtx = null
  }
}
