import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { getServerUrl } from '@/config/serverConfig'
import s from './pages.module.css'

type Tab = 'requests' | 'users' | 'invites' | 'resets'

interface RegRequest { id: string; username: string; display_name: string; status: string; created_at: number }
interface AdminUser { id: string; username: string; display_name: string; role: string }
interface InviteCode { code: string; used_by: string; expires_at: number; created_at: number }
interface ResetRequest { id: string; user_id: string; username: string; status: string; created_at: number }

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
    await apiPost(`/api/admin/registration-requests/${id}/approve`, {})
    void load()
  }

  const rejectRequest = async (id: string) => {
    await apiPost(`/api/admin/registration-requests/${id}/reject`, {})
    void load()
  }

  const createInvite = async () => {
    await apiPost('/api/admin/invite-codes', {})
    void load()
  }

  const resetPassword = async (userId: string) => {
    const pwd = newPassword[userId]
    if (!pwd || pwd.length < 8) { alert('Пароль минимум 8 символов'); return }
    await apiPost(`/api/admin/users/${userId}/reset-password`, { newPassword: pwd })
    setNewPassword(p => ({ ...p, [userId]: '' }))
    alert('Пароль изменён')
  }

  const resolveReset = async (id: string) => {
    const tmp = tempPasswords[id]
    if (!tmp || tmp.length < 8) { alert('Временный пароль минимум 8 символов'); return }
    await apiPost(`/api/admin/password-reset-requests/${id}/resolve`, { tempPassword: tmp })
    setTempPasswords(p => ({ ...p, [id]: '' }))
    void load()
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
            onClick={() => setTab(t)}>
            {t === 'requests' ? 'Заявки' : t === 'users' ? 'Пользователи' : t === 'invites' ? 'Инвайты' : 'Сброс паролей'}
          </button>
        ))}
      </div>

      {error && <p className={s.error}>{error}</p>}
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
              <div><strong>{u.username}</strong> <span className={s.badge}>{u.role}</span></div>
              <div className={s.adminItemActions}>
                <input className={s.inputSmall} type="password" placeholder="Новый пароль (мин. 8)"
                  value={newPassword[u.id] ?? ''}
                  onChange={e => setNewPassword(p => ({ ...p, [u.id]: e.target.value }))} />
                <button className={s.btnDanger} onClick={() => resetPassword(u.id)}>Сбросить пароль</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'invites' && (
        <div className={s.adminList}>
          <button className={s.btn} onClick={createInvite}>Создать инвайт-код</button>
          {invites.map(c => (
            <div key={c.code} className={`${s.adminItem} ${c.used_by ? s.used : ''}`}>
              <div><code>{c.code}</code> {c.used_by ? '✓ использован' : '⏳ активен'}</div>
              {!c.used_by && (
                <button className={s.btnSmall} onClick={() => {
                  const link = `${window.location.origin}/auth?invite=${c.code}`
                  void navigator.clipboard.writeText(link)
                  alert('Ссылка скопирована')
                }}>Копировать ссылку</button>
              )}
            </div>
          ))}
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
