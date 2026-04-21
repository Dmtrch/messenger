import { useEffect, useState, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { api } from '@/api/client'
import css from './LinkDeviceModal.module.css'

interface Props {
  onClose(): void
}

interface LinkToken {
  token: string
  expiresAt: number
}

export function LinkDeviceModal({ onClose }: Props) {
  const [linkToken, setLinkToken] = useState<LinkToken | null>(null)
  const [timeLeft, setTimeLeft] = useState(0)
  const [error, setError] = useState('')

  const requestToken = useCallback(async () => {
    setError('')
    setLinkToken(null)
    try {
      const res = await api.requestDeviceLink()
      setLinkToken(res)
      setTimeLeft(Math.max(0, Math.floor((res.expiresAt - Date.now()) / 1000)))
    } catch {
      setError('Не удалось создать токен')
    }
  }, [api])

  useEffect(() => {
    void requestToken()
  }, [requestToken])

  useEffect(() => {
    if (!linkToken) return
    const id = setInterval(() => {
      const left = Math.max(0, Math.floor((linkToken.expiresAt - Date.now()) / 1000))
      setTimeLeft(left)
    }, 1000)
    return () => clearInterval(id)
  }, [linkToken])

  const expired = timeLeft === 0 && linkToken !== null
  const serverUrl = window.location.origin
  const qrPayload = linkToken ? JSON.stringify({ serverUrl, token: linkToken.token }) : ''

  const mm = String(Math.floor(timeLeft / 60)).padStart(2, '0')
  const ss = String(timeLeft % 60).padStart(2, '0')

  return (
    <div className={css.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={css.modal}>
        <h2 className={css.title}>Добавить устройство</h2>

        {linkToken && !expired && (
          <>
            <div className={css.qrWrap}>
              <QRCodeSVG value={qrPayload} size={200} level="M" />
            </div>
            <p className={css.timer}>{mm}:{ss}</p>
            <p className={css.hint}>
              Отсканируйте QR на новом устройстве или передайте ссылку<br />
              <code style={{ fontSize: '0.7rem', wordBreak: 'break-all' }}>{qrPayload}</code>
            </p>
          </>
        )}

        {expired && (
          <p className={css.timerExpired}>Токен истёк. Создайте новый.</p>
        )}

        {error && <p className={css.timerExpired}>{error}</p>}

        <div className={css.actions}>
          <button className={css.btnRefresh} onClick={() => void requestToken()}>
            {expired ? 'Новый QR' : 'Обновить'}
          </button>
          <button className={css.btnClose} onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  )
}
