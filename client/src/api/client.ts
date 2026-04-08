/**
 * HTTP API клиент для Go backend.
 *
 * Auth: JWT Bearer (15 мин) + silent refresh через httpOnly cookie (7 дней).
 * Refresh выполняется автоматически при 401 — один раз, затем повтор запроса.
 */

const BASE = ''  // относительный путь — браузер подставляет текущий host автоматически

// ── Типы ──────────────────────────────────────────────────

export interface AuthRegisterReq {
  username: string
  password: string
  displayName: string
  ikPublic: string
  spkId: number
  spkPublic: string
  spkSignature: string
  opkPublics: Array<{ id: number; key: string }>
}

export interface AuthRegisterRes {
  userId: string
  accessToken: string
}

export interface AuthLoginReq {
  username: string
  challenge: string
  signature: string
}

export interface AuthLoginRes {
  accessToken: string
  user: {
    id: string
    username: string
    displayName: string
    avatarPath?: string
    ikPublic: string
  }
}

export interface PreKeyBundle {
  userId: string
  ikPublic: string
  spkId: number
  spkPublic: string
  spkSignature: string
  opkId?: number
  opkPublic?: string
}

export interface ChatSummary {
  id: string
  type: 'direct' | 'group'
  name: string
  avatarPath?: string
  members: string[]
  lastMessageText?: string
  lastMessageTs?: number
  unreadCount: number
  updatedAt: number
}

export interface MessageRecord {
  id: string
  chatId: string
  senderId: string
  encryptedPayload: string
  senderKeyId: number
  timestamp: number
  delivered: boolean
  read: boolean
}

export interface MessagesPage {
  messages: MessageRecord[]
  nextCursor?: number   // timestamp для следующей страницы
}

export interface MediaUploadRes {
  mediaId: string
  originalName: string
  contentType: string
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

// ── Token management ──────────────────────────────────────

let _accessToken: string | null = null
let _refreshInFlight: Promise<string | null> | null = null

export function setAccessToken(token: string | null): void {
  _accessToken = token
}

async function doRefresh(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!res.ok) return null
    const data = (await res.json()) as { accessToken: string }
    _accessToken = data.accessToken
    return _accessToken
  } catch {
    return null
  }
}

// ── Media blob cache ──────────────────────────────────────
// Кеш object URL для аутентифицированных медиафайлов.
const _mediaBlobCache = new Map<string, string>()

// ── Core request ──────────────────────────────────────────

async function req<T>(
  path: string,
  options: RequestInit & { skipAuth?: boolean; _retry?: boolean } = {}
): Promise<T> {
  const { skipAuth = false, _retry = false, ...fetchOpts } = options

  const isFormData = fetchOpts.body instanceof FormData
  const headers: Record<string, string> = {
    ...(!isFormData && fetchOpts.body ? { 'Content-Type': 'application/json' } : {}),
    ...(!skipAuth && _accessToken ? { Authorization: `Bearer ${_accessToken}` } : {}),
    ...(fetchOpts.headers as Record<string, string> | undefined ?? {}),
  }

  const response = await fetch(`${BASE}${path}`, {
    ...fetchOpts,
    headers,
    credentials: 'include',
  })

  if (response.status === 401 && !skipAuth && !_retry) {
    if (!_refreshInFlight) {
      _refreshInFlight = doRefresh().finally(() => { _refreshInFlight = null })
    }
    const token = await _refreshInFlight
    if (token) return req<T>(path, { ...options, _retry: true })
    throw new ApiError(401, 'Сессия истекла — войдите снова')
  }

  if (!response.ok) {
    let msg = response.statusText
    try { msg = ((await response.json()) as { error?: string }).error ?? msg } catch { /* */ }
    throw new ApiError(response.status, msg)
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

/** Загружает медиафайл с авторизацией и возвращает кешированный object URL. */
async function fetchMediaBlobUrl(mediaId: string): Promise<string> {
  const cached = _mediaBlobCache.get(mediaId)
  if (cached) return cached

  const path = `/api/media/${encodeURIComponent(mediaId)}`
  const headers: Record<string, string> = _accessToken
    ? { Authorization: `Bearer ${_accessToken}` }
    : {}

  let response = await fetch(`${BASE}${path}`, { headers, credentials: 'include' })

  if (response.status === 401) {
    if (!_refreshInFlight) {
      _refreshInFlight = doRefresh().finally(() => { _refreshInFlight = null })
    }
    const token = await _refreshInFlight
    if (!token) throw new ApiError(401, 'Сессия истекла')
    response = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
  }

  if (!response.ok) throw new ApiError(response.status, 'media fetch failed')

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  _mediaBlobCache.set(mediaId, url)
  return url
}

// ── Public API ────────────────────────────────────────────

export const api = {

  // ── Auth ─────────────────────────────────────────────────
  register: (body: AuthRegisterReq) =>
    req<AuthRegisterRes>('/api/auth/register', {
      method: 'POST', body: JSON.stringify(body), skipAuth: true,
    }),

  login: (body: AuthLoginReq) =>
    req<AuthLoginRes>('/api/auth/login', {
      method: 'POST', body: JSON.stringify(body), skipAuth: true,
    }),

  /** Явный refresh — используется при запуске приложения */
  refresh: () =>
    req<{ accessToken: string }>('/api/auth/refresh', { method: 'POST', skipAuth: true }),

  logout: () =>
    req<void>('/api/auth/logout', { method: 'POST' }),

  // ── Keys ─────────────────────────────────────────────────
  getKeyBundle: (userId: string) =>
    req<PreKeyBundle>(`/api/keys/${encodeURIComponent(userId)}`),

  uploadPreKeys: (keys: Array<{ id: number; key: string }>) =>
    req<void>('/api/keys/prekeys', { method: 'POST', body: JSON.stringify({ keys }) }),

  // ── Chats ─────────────────────────────────────────────────
  getChats: () =>
    req<{ chats: ChatSummary[] }>('/api/chats'),

  createChat: (body: { type: 'direct' | 'group'; memberIds: string[]; name?: string }) =>
    req<{ chat: ChatSummary }>('/api/chats', { method: 'POST', body: JSON.stringify(body) }),

  getMessages: (chatId: string, params?: { before?: number; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.before != null) qs.set('before', String(params.before))
    if (params?.limit  != null) qs.set('limit',  String(params.limit))
    const query = qs.size ? `?${qs}` : ''
    return req<MessagesPage>(`/api/chats/${encodeURIComponent(chatId)}/messages${query}`)
  },

  // ── Media ─────────────────────────────────────────────────
  uploadMedia: (file: File, chatId?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (chatId) form.append('chat_id', chatId)
    return req<MediaUploadRes>('/api/media/upload', { method: 'POST', body: form })
  },

  /** Загружает медиафайл с авторизацией и возвращает кешированный object URL. */
  fetchMediaBlobUrl,

  // ── Messages ─────────────────────────────────────────────
  deleteMessage: (clientMsgId: string) =>
    req<void>(`/api/messages/${encodeURIComponent(clientMsgId)}`, { method: 'DELETE' }),

  editMessage: (clientMsgId: string, recipients: Array<{ userId: string; ciphertext: string }>) =>
    req<{ editedAt: number }>(`/api/messages/${encodeURIComponent(clientMsgId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ recipients }),
    }),

  // ── Push ─────────────────────────────────────────────────
  subscribePush: (subscription: PushSubscriptionJSON) =>
    req<void>('/api/push/subscribe', { method: 'POST', body: JSON.stringify(subscription) }),

  // ── Users ─────────────────────────────────────────────────
  searchUsers: (q: string) =>
    req<{ users: Array<{ id: string; username: string; displayName: string }> }>(
      `/api/users/search?q=${encodeURIComponent(q)}`
    ),
}
