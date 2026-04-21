import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useAuthStore } from '@/store/authStore'
import { getServerUrl } from '@/config/serverConfig'
import s from './pages.module.css'

type Tab = 'requests' | 'users' | 'invites' | 'resets' | 'settings' | 'system'

interface SystemStats {
  cpuPercent: number
  ramUsed: number
  ramTotal: number
  diskUsed: number
  diskTotal: number
}
interface StatPoint extends SystemStats { time: string }

interface RegRequest { id: string; username: string; display_name: string; status: string; created_at: number }
interface AdminUser { id: string; username: string; display_name: string; role: string; status: string; quotaBytes?: number; usedBytes?: number }
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

async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const token = useAuthStore.getState().accessToken
  const res = await fetch(`${getServerUrl()}${path}`, {
    method: 'PUT',
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
  const [editingQuota, setEditingQuota] = useState<Record<string, string>>({})
  const [editingRole, setEditingRole] = useState<Record<string, boolean>>({})
  const [retentionDays, setRetentionDays] = useState<number>(0)
  const [retentionInput, setRetentionInput] = useState<string>('0')
  const [maxGroupMembers, setMaxGroupMembers] = useState<number>(0)
  const [maxGroupMembersInput, setMaxGroupMembersInput] = useState<string>('0')
  const [sysStats, setSysStats] = useState<SystemStats | null>(null)
  const [statsHistory, setStatsHistory] = useState<StatPoint[]>([])

  // live clock для таймера обратного отсчёта (P1-INV-5)
  useEffect(() => {
    if (tab !== 'invites') return
    const t = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [tab])

  // SSE-подписка на системные метрики (P3-ADM-3c)
  useEffect(() => {
    if (tab !== 'system') return
    const token = useAuthStore.getState().accessToken
    const url = `${getServerUrl()}/api/admin/system/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`
    const es = new EventSource(url, { withCredentials: true })
    es.addEventListener('stats', (e: MessageEvent) => {
      const data = JSON.parse(e.data) as SystemStats
      setSysStats(data)
      setStatsHistory((prev) => {
        const point: StatPoint = { ...data, time: new Date().toLocaleTimeString() }
        return [...prev.slice(-19), point]
      })
    })
    return () => es.close()
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
      } else if (tab === 'settings') {
        const [retention, maxMembers] = await Promise.all([
          apiGet<{ retentionDays: number }>('/api/admin/settings/retention'),
          apiGet<{ maxMembers: number }>('/api/admin/settings/max-group-members').catch(() => ({ maxMembers: 0 })),
        ])
        setRetentionDays(retention.retentionDays)
        setRetentionInput(String(retention.retentionDays))
        setMaxGroupMembers(maxMembers.maxMembers)
        setMaxGroupMembersInput(String(maxMembers.maxMembers))
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

  const setUserRole = async (userId: string, role: string) => {
    try {
      await apiPut(`/api/admin/users/${userId}/role`, { role })
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u))
      setEditingRole(p => { const n = {...p}; delete n[userId]; return n })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const handleSaveQuota = async (userId: string) => {
    const raw = editingQuota[userId]
    if (raw === undefined) return
    const mb = parseFloat(raw)
    const quotaBytes = isNaN(mb) ? 0 : Math.round(mb * 1024 * 1024)
    try {
      await apiPut(`/api/admin/users/${userId}/quota`, { quotaBytes })
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, quotaBytes } : u))
      setEditingQuota((prev) => { const n = { ...prev }; delete n[userId]; return n })
      setSuccessMsg('Квота обновлена')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const handleSaveRetention = async () => {
    const days = parseInt(retentionInput, 10)
    if (isNaN(days) || days < 0) { setError('Введите число >= 0'); return }
    try {
      await apiPut('/api/admin/settings/retention', { retentionDays: days })
      setRetentionDays(days)
      setSuccessMsg('Настройки сохранены')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  const handleSaveMaxGroupMembers = async () => {
    const n = parseInt(maxGroupMembersInput, 10)
    if (isNaN(n) || n < 0) { setError('Введите число >= 0'); return }
    try {
      await apiPut('/api/admin/settings/max-group-members', { maxMembers: n })
      setMaxGroupMembers(n)
      setSuccessMsg('Настройки сохранены')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    }
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
        {(['requests', 'users', 'invites', 'resets', 'settings', 'system'] as Tab[]).map(t => (
          <button key={t} className={`${s.tab} ${tab === t ? s.tabActive : ''}`}
            onClick={() => { setTab(t); setError(''); setSuccessMsg('') }}>
            {t === 'requests' ? 'Заявки' : t === 'users' ? 'Пользователи' : t === 'invites' ? 'Инвайты' : t === 'resets' ? 'Сброс паролей' : t === 'system' ? 'Система' : 'Настройки'}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <strong>{u.username}</strong>
                <span
                  className={s.badge}
                  style={u.role === 'moderator' ? { background: 'steelblue' } : u.role === 'admin' ? { background: 'darkviolet' } : undefined}
                >
                  {u.role === 'moderator' ? 'Мод' : u.role}
                </span>
                {editingRole[u.id] ? (
                  <select
                    value={u.role}
                    onChange={e => void setUserRole(u.id, e.target.value)}
                    onBlur={() => setEditingRole(p => { const n = {...p}; delete n[u.id]; return n })}
                    style={{ fontSize: '12px' }}
                    autoFocus
                  >
                    <option value="user">user</option>
                    <option value="moderator">Мод</option>
                    <option value="admin">admin</option>
                  </select>
                ) : (
                  <button
                    className={s.btnSmall}
                    style={{ fontSize: '11px', padding: '2px 6px' }}
                    onClick={() => setEditingRole(p => ({ ...p, [u.id]: true }))}
                  >
                    ✎
                  </button>
                )}
                {u.status && u.status !== 'active' && (
                  <span className={s.badge} style={{ background: u.status === 'banned' ? 'crimson' : 'orange' }}>
                    {u.status}
                  </span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-secondary)' }}>Квота:</span>
                {editingQuota[u.id] !== undefined ? (
                  <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <input
                      type="number"
                      value={editingQuota[u.id]}
                      onChange={(e) => setEditingQuota((p) => ({ ...p, [u.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveQuota(u.id) }}
                      style={{ width: '60px', fontSize: '12px' }}
                      min="0"
                      step="1"
                    />
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>МБ</span>
                    <button onClick={() => void handleSaveQuota(u.id)} style={{ fontSize: '11px', padding: '2px 6px' }}>✓</button>
                    <button onClick={() => setEditingQuota((p) => { const n = {...p}; delete n[u.id]; return n })} style={{ fontSize: '11px', padding: '2px 4px' }}>✕</button>
                  </span>
                ) : (
                  <span
                    style={{ cursor: 'pointer', fontSize: '12px' }}
                    title="Нажмите для редактирования"
                    onClick={() => setEditingQuota((p) => ({
                      ...p,
                      [u.id]: u.quotaBytes ? String(Math.round((u.quotaBytes / 1024 / 1024) * 10) / 10) : '0'
                    }))}
                  >
                    {u.quotaBytes ? `${Math.round(u.quotaBytes / 1024 / 1024)} МБ` : '∞'}
                    {u.usedBytes ? ` / ${Math.round(u.usedBytes / 1024 / 1024)} МБ` : ''}
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
      {!loading && tab === 'settings' && (
        <div style={{ padding: '1rem', maxWidth: '400px' }}>
          <h3 style={{ marginBottom: '1rem' }}>Настройки хранилища</h3>
          <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
            Хранить медиа (дней)
          </label>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
            0 — бессрочно
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="number"
              min="0"
              value={retentionInput}
              onChange={(e) => setRetentionInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveRetention() }}
              style={{ width: '80px', padding: '0.375rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-input, var(--bg-secondary))', color: 'var(--text-primary)' }}
            />
            <span style={{ fontSize: '0.875rem' }}>дней</span>
            <button
              onClick={() => void handleSaveRetention()}
              style={{ padding: '0.375rem 0.75rem', borderRadius: '6px', background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              Сохранить
            </button>
          </div>
          {retentionDays > 0 && (
            <p style={{ marginTop: '0.75rem', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              Текущее значение: {retentionDays} дн.
            </p>
          )}

          <label style={{ display: 'block', marginTop: '1.5rem', marginBottom: '0.5rem', fontWeight: 500 }}>
            Макс. участников в группе
          </label>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
            0 — без ограничений
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="number"
              min="0"
              value={maxGroupMembersInput}
              onChange={(e) => setMaxGroupMembersInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveMaxGroupMembers() }}
              style={{ width: '80px', padding: '0.375rem 0.5rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-input, var(--bg-secondary))', color: 'var(--text-primary)' }}
            />
            <span style={{ fontSize: '0.875rem' }}>участн.</span>
            <button
              onClick={() => void handleSaveMaxGroupMembers()}
              style={{ padding: '0.375rem 0.75rem', borderRadius: '6px', background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              Сохранить
            </button>
          </div>
          {maxGroupMembers > 0 && (
            <p style={{ marginTop: '0.75rem', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              Текущее значение: {maxGroupMembers} участн.
            </p>
          )}
        </div>
      )}

      {!loading && tab === 'system' && (
        <div style={{ padding: '1rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>Мониторинг сервера</h3>

          {!sysStats && <p style={{ color: 'var(--text-secondary)' }}>Подключение...</p>}

          {sysStats && (
            <>
              {/* CPU + RAM LineChart */}
              <div style={{ marginBottom: '1.5rem' }}>
                <p style={{ fontWeight: 500, marginBottom: '0.5rem' }}>CPU / RAM, %</p>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={statsHistory}>
                    <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                    <Tooltip formatter={(v) => typeof v === 'number' ? `${v.toFixed(1)}%` : String(v ?? '')} />
                    <Line type="monotone" dataKey="cpuPercent" stroke="#ef4444" dot={false} name="CPU" strokeWidth={2} />
                    <Line
                      type="monotone"
                      dataKey={(d: StatPoint) => d.ramTotal > 0 ? Math.round(d.ramUsed / d.ramTotal * 100) : 0}
                      stroke="#3b82f6"
                      dot={false}
                      name="RAM"
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Disk ProgressBar */}
              <div style={{ marginBottom: '1rem' }}>
                <p style={{ fontWeight: 500, marginBottom: '0.5rem' }}>
                  Диск: {(sysStats.diskUsed / 1024 ** 3).toFixed(1)} / {(sysStats.diskTotal / 1024 ** 3).toFixed(1)} ГБ
                </p>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', height: '12px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${sysStats.diskTotal > 0 ? Math.min(100, sysStats.diskUsed / sysStats.diskTotal * 100) : 0}%`,
                    background: '#22c55e',
                    borderRadius: '6px',
                    transition: 'width 0.5s ease',
                  }} />
                </div>
              </div>

              {/* RAM ProgressBar */}
              <div>
                <p style={{ fontWeight: 500, marginBottom: '0.5rem' }}>
                  RAM: {(sysStats.ramUsed / 1024 ** 3).toFixed(1)} / {(sysStats.ramTotal / 1024 ** 3).toFixed(1)} ГБ
                </p>
                <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', height: '12px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${sysStats.ramTotal > 0 ? Math.min(100, sysStats.ramUsed / sysStats.ramTotal * 100) : 0}%`,
                    background: '#3b82f6',
                    borderRadius: '6px',
                    transition: 'width 0.5s ease',
                  }} />
                </div>
              </div>

              <p style={{ marginTop: '0.75rem', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                CPU: {sysStats.cpuPercent.toFixed(1)}%
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
