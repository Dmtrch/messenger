import { useEffect, useState } from 'react'
import css from './InstallPwaBanner.module.css'

// Событие beforeinstallprompt не типизировано в стандартном lib.dom — объявляем локально.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

/** Уже запущено как установленное приложение (standalone)? */
function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

/**
 * Баннер установки PWA на форме приглашения.
 * - Android/Chrome: кнопка «Установить приложение» через beforeinstallprompt.
 * - iOS/Safari: инструкция «Поделиться → На экран Домой» (нативного prompt нет).
 * - Если уже установлено (standalone) — баннер не отображается.
 */
export default function InstallPwaBanner() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault() // не показываем браузерный мини-баннер, управляем сами
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setInstalled(true)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  // Не показываем, если уже установлено или скрыто пользователем.
  if (installed || dismissed || isStandalone()) return null

  const handleInstall = async () => {
    if (!deferred) return
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    setDeferred(null)
    if (outcome === 'accepted') setInstalled(true)
  }

  // iOS: нативного prompt нет — показываем инструкцию.
  if (isIOS()) {
    return (
      <div className={css.banner}>
        <p className={css.title}>Установить приложение</p>
        <p className={css.text}>
          Нажмите <span className={css.share}>Поделиться</span> в Safari, затем
          выберите <b>«На экран Домой»</b> — мессенджер откроется как приложение.
        </p>
      </div>
    )
  }

  // Android/Chrome: есть отложенный prompt — показываем кнопку.
  if (deferred) {
    return (
      <div className={css.banner}>
        <p className={css.title}>Установить приложение</p>
        <p className={css.text}>Добавьте мессенджер на устройство для быстрого доступа.</p>
        <div className={css.actions}>
          <button type="button" className={css.btnInstall} onClick={() => void handleInstall()}>
            Установить
          </button>
          <button type="button" className={css.btnDismiss} onClick={() => setDismissed(true)}>
            Позже
          </button>
        </div>
      </div>
    )
  }

  // Прочие случаи (десктоп без поддержки, prompt ещё не пришёл) — баннер не нужен.
  return null
}
