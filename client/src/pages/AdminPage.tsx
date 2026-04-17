import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { useAuthStore } from '@/store/authStore'
import { getServerUrl } from '@/config/serverConfig'
import s from './pages.module.css'

type Tab = 'requests' | 'users' | 'invites' | 'resets'

interface RegRequest { id: string; username: string; display_name: string; status: string; created_at: number }
interface AdminUser { id: string; username: string; display_name: string; role: string; status: string }
interface InviteCode {
  code: string
  usedBy: string
  expiresAt: number
  revokedAt: number
  createdAt: number
}
interface InviteActivation {
  id: number
  code: string
  userId: string
  ip: string
  userAgent: string
  activatedAt: number
}
interface ResetRequest { id: string; user_id: string; username: string; status: string; created_at: number }

// inviteState — производное состояние для UI (used/revoked/expired/active).
function inviteState(c: InviteCode, nowMs: number): 'used' | 'revoked' | 'expired' | 'active' {
  if (c.usedBy) return 'used'
  if (c.revokedAt && c.revokedAt > 0) return 'revoked'
  if (c.expiresAt > 0 && nowMs >= c.expiresAt) return 'expired'
  return 'active'
}

function formatCountdown(msLeft: number): string {
  if (msLeft <= 0) return '00:00'
  const total = Math.floor(msLeft / 1000)
  const mm = Math.floor(total / 60).toString().padStart(2, '0')
  const ss = (total % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}

async function apiDelete(path: string): Promise<void> {
  const token = useAuthStore.getState().accessToken
  const res = await fetch(`${getServerUrl()}${path}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  })
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error ?? res.statusText)
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const token = useAuthStore.getState().accessToken
  const res = await fetch(`${getServerUrl()}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const token = useAuthStore.getState().accessToken
  const res = await fetch(`${getServerUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error ?? res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export default function AdminPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('requests')
  const [regRequests, setRegRequests] = useState<RegRequest[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [invites, setInvites] = useState<InviteCode[]>([])
  const [resets, setResets] = useState<ResetRequest[]>([])
  const [newPassword, setNewPassword] = useState<Record<string, string>>({})
  const [tempPasswords, setTempPasswords] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [nowMs, setNowMs] = useState<number>(Date.now())
  const [activations, setActivations] = useState<Record<string, InviteActivation[]>>({})
  const [showQR, setShowQR] = useState<Record<string, boolean>>({})

  // live clock для таймера обратного отсчёта (P1-INV-5)
  useEffect(() => {
    if (tab !== 'invites') return
    const t = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [tab])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (tab === 'requests') {
        const data = await apiGet<{ requests: RegRequest[] }>('/api/admin/registration-requests?status=pending')
        setRegRequests(data.requests)
      } else if (tab === 'users') {
        const data = await apiGet<{ users: AdminUser[] }>('/api/admin/users')
        setUsers(data.users)
      } else if (tab === 'invites') {
        const data = await apiGet<{ codes: InviteCode[] }>('/api/admin/invite-codes')
        setInvites(data.codes)
      } else if (tab === 'resets') {
        const data = await apiGet<{ requests: ResetRequest[] }>('/api/admin/password-reset-requests?status=pending')
        setResets(data.requests)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { void load() }, [load])

  const approveRequest = async (id: string) => {
    try {
      await apiPost(`/api/admin/registration-requests/${id}/approve`, {})
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const rejectRequest = async (id: string) => {
    try {
      await apiPost(`/api/admin/registration-requests/${id}/reject`, {})
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const createInvite = async () => {
    try {
      await apiPost('/api/admin/invite-codes', {})
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const revokeInvite = async (code: string) => {
    if (!window.confirm(`Аннулировать инвайт ${code}?`)) return
    try {
      await apiDelete(`/api/admin/invite-codes/${encodeURIComponent(code)}`)
      setSuccessMsg('Инвайт аннулирован')
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const loadActivations = async (code: string) => {
    try {
      const data = await apiGet<{ activations: InviteActivation[] }>(
        `/api/admin/invite-codes/${encodeURIComponent(code)}/activations`,
      )
      setActivations(prev => ({ ...prev, [code]: data.activations ?? [] }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const resetPassword = async (userId: string) => {
    const pwd = newPassword[userId]
    if (!pwd || pwd.length < 8) { setError('Пароль минимум 8 символов'); return }
    try {
      await apiPost(`/api/admin/users/${userId}/reset-password`, { newPassword: pwd })
      setNewPassword(p => ({ ...p, [userId]: '' }))
      setError('')
      setSuccessMsg('Пароль изменён')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сброса пароля')
    }
  }

  const suspendUser = async (userId: string) => {
    if (!window.confirm('Приостановить аккаунт?')) return
    try { await apiPost(`/api/admin/users/${userId}/suspend`, {}); void load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Ошибка') }
  }

  const unsuspendUser = async (userId: string) => {
    try { await apiPost(`/api/admin/users/${userId}/unsuspend`, {}); void load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Ошибка') }
  }

  const banUser = async (userId: string) => {
    if (!window.confirm('Заблокировать аккаунт навсегда?')) return
    try { await apiPost(`/api/admin/users/${userId}/ban`, {}); void load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Ошибка') }
  }

  const revokeAllSessions = async (userId: string) => {
    if (!window.confirm('Выйти со всех устройств пользователя?')) return
    try { await apiPost(`/api/admin/users/${userId}/revoke-sessions`, {}); setSuccessMsg('Сессии отозваны') }
    catch (e) { setError(e instanceof Error ? e.message : 'Ошибка') }
  }

  const remoteWipe = async (userId: string) => {
    if (!window.confirm('УДАЛЁННОЕ СТИРАНИЕ: очистить все данные на устройствах пользователя?')) return
    try { await apiPost(`/api/admin/users/${userId}/remote-wipe`, {}); setSuccessMsg('Команда wipe отправлена') }
    catch (e) { setError(e instanceof Error ? e.message : 'Ошибка') }
  }

  const resolveReset = async (id: string) => {
    const tmp = tempPasswords[id]
    if (!tmp || tmp.length < 8) { setError('Временный пароль минимум 8 символов'); return }
    try {
      await apiPost(`/api/admin/password-reset-requests/${id}/resolve`, { tempPassword: tmp })
      setTempPasswords(p => ({ ...p, [id]: '' }))
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  return (
    <div className={s.adminPage}>
      <div className={s.adminHeader}>
        <button className={s.backBtn} onClick={() => navigate('/')}>← Назад</button>
        <h2>Панель администратора</h2>
      </div>

      <div className={s.tabs}>
        {(['requests', 'users', 'invites', 'resets'] as Tab[]).map(t => (
          <button key={t} className={`${s.tab} ${tab === t ? s.tabActive : ''}`}
            onClick={() => { setTab(t); setError(''); setSuccessMsg('') }}>
            {t === 'requests' ? 'Заявки' : t === 'users' ? 'Пользователи' : t === 'invites' ? 'Инвайты' : 'Сброс паролей'}
          </button>
        ))}
      </div>

      {error && <p className={s.error}>{error}</p>}
      {successMsg && <p style={{ color: 'green', fontSize: '0.875rem' }}>{successMsg}</p>}
      {loading && <p>Загрузка…</p>}

      {!loading && tab === 'requests' && (
        <div className={s.adminList}>
          {regRequests.length === 0 && <p>Нет ожидающих заявок</p>}
          {regRequests.map(r => (
            <div key={r.id} className={s.adminItem}>
              <div><strong>{r.username}</strong> ({r.display_name})</div>
              <div className={s.adminItemDate}>{new Date(r.created_at).toLocaleString()}</div>
              <div className={s.adminItemActions}>
                <button className={s.btnSuccess} onClick={() => approveRequest(r.id)}>Одобрить</button>
                <button className={s.btnDanger} onClick={() => rejectRequest(r.id)}>Отклонить</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'users' && (
        <div className={s.adminList}>
          {users.map(u => (
            <div key={u.id} className={s.adminItem}>
              <div>
                <strong>{u.username}</strong>{' '}
                <span className={s.badge}>{u.role}</span>{' '}
                {u.status && u.status !== 'active' && (
                  <span className={s.badge} style={{ background: u.status === 'banned' ? 'crimson' : 'orange' }}>
                    {u.status}
                  </span>
                )}
              </div>
              <div className={s.adminItemActions}>
                <input className={s.inputSmall} type="password" placeholder="Новый пароль (мин. 8)"
                  value={newPassword[u.id] ?? ''}
                  onChange={e => setNewPassword(p => ({ ...p, [u.id]: e.target.value }))} />
                <button className={s.btnDanger} onClick={() => resetPassword(u.id)}>Сбросить пароль</button>
              </div>
              <div className={s.adminItemActions} style={{ marginTop: 4 }}>
                {u.status === 'suspended'
                  ? <button className={s.btnSmall} onClick={() => unsuspendUser(u.id)}>Восстановить</button>
                  : u.status !== 'banned' && (
                    <button className={s.btnSmall} onClick={() => suspendUser(u.id)}>Приостановить</button>
                  )}
                {u.status !== 'banned' && (
                  <button className={s.btnDanger} style={{ fontSize: '0.75rem' }} onClick={() => banUser(u.id)}>Заблокировать</button>
                )}
                <button className={s.btnSmall} onClick={() => revokeAllSessions(u.id)}>Kill switch</button>
                <button className={s.btnDanger} style={{ fontSize: '0.75rem' }} onClick={() => remoteWipe(u.id)}>Remote wipe</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'invites' && (
        <div className={s.adminList}>
          <button className={s.btn} onClick={createInvite}>Создать инвайт-код (TTL 180с)</button>
          {invites.map(c => {
            const state = inviteState(c, nowMs)
            const inviteUrl = `${window.location.origin}/auth?invite=${c.code}`
            const msLeft = c.expiresAt - nowMs
            return (
              <div key={c.code} className={`${s.adminItem} ${state === 'used' ? s.used : ''}`}>
                <div>
                  <code>{c.code}</code>{' '}
                  {state === 'active' && (
                    <span style={{ color: 'green' }}>
                      ⏳ активен · осталось {formatCountdown(msLeft)}
                    </span>
                  )}
                  {state === 'used' && <span>✓ использован</span>}
                  {state === 'revoked' && <span style={{ color: 'crimson' }}>⛔ аннулирован</span>}
                  {state === 'expired' && <span style={{ color: 'gray' }}>⌛ истёк</span>}
                </div>
                {state === 'active' && (
                  <div className={s.adminItemActions}>
                    <button className={s.btnSmall} onClick={() => {
                      void navigator.clipboard.writeText(inviteUrl)
                      setSuccessMsg('Ссылка скопирована')
                    }}>Копировать ссылку</button>
                    <button
                      className={s.btnSmall}
                      onClick={() => setShowQR(p => ({ ...p, [c.code]: !p[c.code] }))}
                    >
                      {showQR[c.code] ? 'Скрыть QR' : 'Показать QR'}
                    </button>
                    <button className={s.btnDanger} onClick={() => revokeInvite(c.code)}>
                      Аннулировать
                    </button>
                  </div>
                )}
                {showQR[c.code] && state === 'active' && (
                  <div style={{ padding: '8px 0' }}>
                    <QRCodeSVG value={inviteUrl} size={160} level="M" includeMargin />
                    <div style={{ fontSize: '0.75rem', opacity: 0.7, wordBreak: 'break-all' }}>
                      {inviteUrl}
                    </div>
                  </div>
                )}
                <div className={s.adminItemActions}>
                  <button className={s.btnSmall} onClick={() => loadActivations(c.code)}>
                    Показать активации
                  </button>
                </div>
                {activations[c.code] && (
                  <div style={{ fontSize: '0.8rem', opacity: 0.85 }}>
                    {activations[c.code].length === 0 && <div>— журнал пуст</div>}
                    {activations[c.code].map(a => (
                      <div key={a.id}>
                        {new Date(a.activatedAt).toLocaleString()} · {a.ip || '—'} · {a.userAgent || '—'}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!loading && tab === 'resets' && (
        <div className={s.adminList}>
          {resets.length === 0 && <p>Нет ожидающих запросов</p>}
          {resets.map(r => (
            <div key={r.id} className={s.adminItem}>
              <div><strong>{r.username}</strong></div>
              <div className={s.adminItemDate}>{new Date(r.created_at).toLocaleString()}</div>
              <div className={s.adminItemActions}>
                <input className={s.inputSmall} type="text" placeholder="Временный пароль (мин. 8)"
                  value={tempPasswords[r.id] ?? ''}
                  onChange={e => setTempPasswords(p => ({ ...p, [r.id]: e.target.value }))} />
                <button className={s.btnSuccess} onClick={() => resolveReset(r.id)}>Выдать пароль</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
