import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { setServerUrl } from '@/config/serverConfig'
import type { ServerInfo } from '@/types'
import s from './pages.module.css'

export default function ServerSetupPage() {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState<ServerInfo | null>(null)

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) { setError('Введите адрес сервера'); return }
    setLoading(true)
    setError('')
    setInfo(null)
    try {
      const normalized = url.trim().replace(/\/$/, '')
      const res = await fetch(`${normalized}/api/server/info`)
      if (!res.ok) throw new Error('Сервер не отвечает')
      const data = await res.json() as ServerInfo
      setInfo(data)
      setServerUrl(normalized)
    } catch {
      setError('Не удалось подключиться. Проверьте адрес сервера.')
    } finally {
      setLoading(false)
    }
  }

  const handleProceed = () => {
    navigate('/auth', { replace: true })
  }

  return (
    <div className={s.authPage}>
      <div className={s.card}>
        <h1 className={s.logo}>Messenger</h1>
        <p className={s.sub}>Введите адрес вашего сервера</p>

        <form onSubmit={handleConnect} className={s.form}>
          <input
            className={s.input}
            type="url"
            placeholder="https://myserver.com или http://192.168.1.10:8080"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoComplete="url"
          />
          {error && <p className={s.error} role="alert">{error}</p>}
          <button type="submit" className={s.btn} disabled={loading}>
            {loading ? 'Подключение…' : 'Подключиться'}
          </button>
        </form>

        {info && (
          <div className={s.serverCard}>
            <div className={s.serverName}>{info.name}</div>
            {info.description && <div className={s.serverDesc}>{info.description}</div>}
            <div className={s.serverMode}>
              Регистрация: {info.registrationMode === 'open' ? 'открытая' :
                            info.registrationMode === 'invite' ? 'по приглашению' : 'по заявке'}
            </div>
            <button className={s.btn} onClick={handleProceed}>
              Войти / Зарегистрироваться
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
