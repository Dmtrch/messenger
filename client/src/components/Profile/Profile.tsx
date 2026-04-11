import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { api, setAccessToken } from '@/api/client'
import { clearServerUrl } from '@/config/serverConfig'
import s from './Profile.module.css'

interface Props { onBack: () => void }

export default function Profile({ onBack }: Props) {
  const user = useAuthStore((st) => st.currentUser)
  const logout = useAuthStore((st) => st.logout)
  const role = useAuthStore((s) => s.role)
  const navigate = useNavigate()

  const handleChangeServer = async () => {
    try { await api.logout() } catch { /* игнорируем */ }
    setAccessToken(null)
    logout()
    clearServerUrl()
    navigate('/setup', { replace: true })
  }

  if (!user) return null

  return (
    <div className={s.root}>
      <header className={s.header}>
        <button className={s.backBtn} onClick={onBack} aria-label="Назад">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
        </button>
        <h1 className={s.title}>Профиль</h1>
      </header>

      <div className={s.hero}>
        <div className={s.avatar}>
          {user.avatarPath
            ? <img src={user.avatarPath} alt={user.displayName} />
            : <span>{user.displayName.charAt(0).toUpperCase()}</span>}
        </div>
        <h2 className={s.displayName}>{user.displayName}</h2>
        <p className={s.username}>@{user.username}</p>
      </div>

      <section className={s.section}>
        <Field label="Имя" value={user.displayName} />
        <Field label="Логин" value={`@${user.username}`} />
        <div className={s.field}>
          <span className={s.label}>Публичный ключ (Ed25519)</span>
          <span className={s.mono} title={user.identityKeyPublic}>
            {user.identityKeyPublic.slice(0, 32)}…
          </span>
        </div>
      </section>

      <ChangePasswordForm onSuccess={logout} />

      <section className={s.section}>
        <button className={s.dangerBtn} onClick={logout}>Выйти</button>
        {role === 'admin' && (
          <button className={s.adminLink} onClick={() => navigate('/admin')}>
            Панель администратора
          </button>
        )}
        <button className={s.changeServer} onClick={handleChangeServer}>
          Сменить сервер
        </button>
      </section>
    </div>
  )
}

function ChangePasswordForm({ onSuccess }: { onSuccess: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (next !== confirm) { setError('Новые пароли не совпадают'); return }
    if (next.length < 8) { setError('Минимум 8 символов'); return }
    setLoading(true)
    try {
      await api.changePassword(current, next)
      // После смены пароля все остальные сессии инвалидированы — выходим
      onSuccess()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка'
      setError(msg.includes('403') ? 'Неверный текущий пароль' : 'Ошибка сервера')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className={s.section}>
      <h3 className={s.sectionTitle}>Сменить пароль</h3>
      <form onSubmit={handleSubmit} className={s.form}>
        <input
          className={s.input}
          type="password"
          placeholder="Текущий пароль"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
        />
        <input
          className={s.input}
          type="password"
          placeholder="Новый пароль"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          required
        />
        <input
          className={s.input}
          type="password"
          placeholder="Повторите новый пароль"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
        {error && <p className={s.error}>{error}</p>}
        <button className={s.submitBtn} type="submit" disabled={loading}>
          {loading ? 'Сохранение…' : 'Сменить пароль'}
        </button>
      </form>
    </section>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.field}>
      <span className={s.label}>{label}</span>
      <span className={s.value}>{value}</span>
    </div>
  )
}
