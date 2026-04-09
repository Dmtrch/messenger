/**
 * Ringtone на Web Audio API — пульсирующий тональный сигнал без внешних файлов.
 * Один AudioContext переиспользуется для всех импульсов, чтобы не превысить
 * браузерный лимит (~6 контекстов на страницу).
 * Возвращает функцию остановки.
 */
export function startRingtone(): () => void {
  let active = true
  let ctx: AudioContext | null = null

  try {
    ctx = new AudioContext()
  } catch {
    // AudioContext недоступен (нет звуковой подсистемы) — ничего не делаем
    return () => undefined
  }

  function beep(): void {
    if (!active || !ctx) return
    try {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.type = 'sine'
      osc.frequency.value = 440

      const t = ctx.currentTime
      gain.gain.setValueAtTime(0.15, t)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7)

      osc.start(t)
      osc.stop(t + 0.7)
      osc.onended = () => {
        if (active) setTimeout(beep, 600)
      }
    } catch {
      // Контекст мог быть закрыт — игнорируем
    }
  }

  beep()

  return () => {
    active = false
    ctx?.close()
    ctx = null
  }
}
