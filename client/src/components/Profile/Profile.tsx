import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useChatStore } from '@/store/chatStore'
import { useWsStore } from '@/store/wsStore'
import { api, setAccessToken } from '@/api/client'
import { clearServerUrl } from '@/config/serverConfig'
import { LinkDeviceModal } from '@/components/LinkDevice/LinkDeviceModal'
import { changeVaultPassphrase } from '@/store/vaultStore'
import s from './Profile.module.css'

interface Props { onBack: () => void }

export default function Profile({ onBack }: Props) {
  const user = useAuthStore((st) => st.currentUser)
  const logout = useAuthStore((st) => st.logout)
  const role = useAuthStore((s) => s.role)
  const currentDeviceId = useAuthStore((s) => s.deviceId)
  const navigate = useNavigate()

  const handleChangeServer = async () => {
    try { await api.logout() } catch { /* игнорируем */ }
    setAccessToken(null)
    logout()
    useChatStore.getState().reset()
    useWsStore.getState().setSend(null)
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

      <DevicesSection currentDeviceId={currentDeviceId} />

      <VaultPasswordSection />

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

function VaultPasswordSection() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess(false)
    if (next !== confirm) { setError('Новые пароли не совпадают'); return }
    if (next.length < 8) { setError('Минимум 8 символов'); return }
    setLoading(true)
    try {
      await changeVaultPassphrase(current, next)
      setSuccess(true)
      setCurrent(''); setNext(''); setConfirm('')
    } catch {
      setError('Неверный текущий пароль или ошибка хранилища')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className={s.section}>
      <h3 className={s.sectionTitle}>Пароль хранилища</h3>
      <form onSubmit={handleSubmit} className={s.form}>
        <input className={s.input} type="password" placeholder="Текущий пароль хранилища"
          value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        <input className={s.input} type="password" placeholder="Новый пароль хранилища"
          value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
        <input className={s.input} type="password" placeholder="Повторите новый пароль"
          value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        {error && <p className={s.error}>{error}</p>}
        {success && <p style={{color:'var(--color-success,#a6e3a1)',fontSize:'0.85rem'}}>Пароль хранилища изменён</p>}
        <button className={s.submitBtn} type="submit" disabled={loading}>
          {loading ? 'Сохранение…' : 'Сменить пароль хранилища'}
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

interface DeviceRecord {
  id: string
  deviceName: string
  createdAt: number
}

function DevicesSection({ currentDeviceId }: { currentDeviceId: string | null }) {
  const [devices, setDevices] = useState<DeviceRecord[]>([])
  const [showModal, setShowModal] = useState(false)

  const load = () => {
    void api.getDevices().then((list) => setDevices(list)).catch(() => {})
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (id: string) => {
    try {
      await api.deleteDevice(id)
      setDevices((prev) => prev.filter((d) => d.id !== id))
    } catch { /* сервер сам сделает logout если текущее устройство */ }
  }

  return (
    <section className={s.section}>
      <h3 className={s.sectionTitle}>Мои устройства</h3>
      {devices.map((d) => (
        <div key={d.id} className={s.field} style={{ alignItems: 'center' }}>
          <span className={s.value}>
            {d.deviceName}
            {d.id === currentDeviceId && ' ★'}
          </span>
          <span className={s.label} style={{ fontSize: '0.75rem' }}>
            {new Date(d.createdAt).toLocaleDateString()}
          </span>
          {d.id !== currentDeviceId && (
            <button
              className={s.dangerBtn}
              style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: '0.8rem' }}
              onClick={() => void handleDelete(d.id)}
            >
              Отвязать
            </button>
          )}
        </div>
      ))}
      <button className={s.submitBtn} onClick={() => setShowModal(true)}>
        + Добавить устройство
      </button>
      {showModal && <LinkDeviceModal onClose={() => { setShowModal(false); load() }} />}
    </section>
  )
}
