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
  deviceId?: string
  ikPublic: string
  spkId: number
  spkPublic: string
  spkSignature: string
  opkId?: number
  opkPublic?: string
}

export interface RegisterKeysReq {
  deviceName: string
  ikPublic: string
  spkId: number
  spkPublic: string
  spkSignature: string
  opkPublics: string[]
}

export interface RegisterKeysRes {
  deviceId: string
}

export interface LastMessageSummary {
  id: string
  senderId: string
  encryptedPayload: string
  timestamp: number
}

export interface ChatSummary {
  id: string
  type: 'direct' | 'group'
  name: string
  avatarPath?: string
  members: string[]
  lastMessage?: LastMessageSummary
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
  nextCursor?: string   // messageId для следующей страницы (opaque cursor)
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

/** Шифрует файл на стороне клиента и загружает ciphertext на сервер.
 *  Возвращает mediaId и base64-ключ для встраивания в зашифрованный payload. */
export async function uploadEncryptedMedia(
  file: File,
  chatId?: string,
): Promise<{ mediaId: string; mediaKey: string; originalName: string; contentType: string }> {
  // Импортируем libsodium лениво чтобы не тянуть в все бандлы
  const { default: _sodium } = await import('libsodium-wrappers')
  await _sodium.ready

  // Генерируем ключ и nonce
  const mediaKey = _sodium.randombytes_buf(32)
  const nonce = _sodium.randombytes_buf(_sodium.crypto_secretbox_NONCEBYTES)

  // Шифруем содержимое файла
  const plainBytes = new Uint8Array(await file.arrayBuffer())
  const ct = _sodium.crypto_secretbox_easy(plainBytes, nonce, mediaKey)

  // ciphertext = nonce || encrypted_bytes
  const combined = new Uint8Array(nonce.length + ct.length)
  combined.set(nonce)
  combined.set(ct, nonce.length)

  // Загружаем зашифрованный blob (имя файла скрываем — сервер видит только ciphertext)
  const encFile = new File([combined], 'encrypted', { type: 'application/octet-stream' })
  const form = new FormData()
  form.append('file', encFile)
  if (chatId) form.append('chat_id', chatId)

  const res = await req<MediaUploadRes>('/api/media/upload', { method: 'POST', body: form })

  return {
    mediaId: res.mediaId,
    mediaKey: _sodium.to_base64(mediaKey),
    originalName: file.name,
    contentType: file.type,
  }
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

/** Загружает зашифрованный медиафайл, расшифровывает ключом из payload и кэширует URL. */
async function fetchEncryptedMediaBlobUrl(mediaId: string, mediaKey: string, mimeType: string): Promise<string> {
  // Кэш-ключ включает mediaKey чтобы не перепутать при коллизии mediaId (теоретически)
  const cacheKey = `${mediaId}:${mediaKey.slice(0, 8)}`
  const cached = _mediaBlobCache.get(cacheKey)
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

  const { default: _sodium } = await import('libsodium-wrappers')
  await _sodium.ready

  const combined = new Uint8Array(await response.arrayBuffer())
  const nonce = combined.slice(0, _sodium.crypto_secretbox_NONCEBYTES)
  const ct = combined.slice(_sodium.crypto_secretbox_NONCEBYTES)
  const key = _sodium.from_base64(mediaKey)
  const plain = _sodium.crypto_secretbox_open_easy(ct, nonce, key)

  const blob = new Blob([plain.buffer as ArrayBuffer], { type: mimeType || 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  _mediaBlobCache.set(cacheKey, url)
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

  /** Регистрация устройства — вызывается после регистрации/входа, возвращает deviceId */
  registerKeys: (body: RegisterKeysReq) =>
    req<RegisterKeysRes>('/api/keys/register', { method: 'POST', body: JSON.stringify(body) }),

  // ── Chats ─────────────────────────────────────────────────
  getChats: () =>
    req<{ chats: ChatSummary[] }>('/api/chats'),

  createChat: (body: { type: 'direct' | 'group'; memberIds: string[]; name?: string }) =>
    req<{ chat: ChatSummary }>('/api/chats', { method: 'POST', body: JSON.stringify(body) }),

  getMessages: (chatId: string, params?: { before?: string; limit?: number }) => {
    const qs = new URLSearchParams()
    if (params?.before != null) qs.set('before', params.before)
    if (params?.limit  != null) qs.set('limit',  String(params.limit))
    const query = qs.size ? `?${qs}` : ''
    return req<MessagesPage>(`/api/chats/${encodeURIComponent(chatId)}/messages${query}`)
  },

  /** Отметить сообщения в чате прочитанными. messageId — опциональный курсор. */
  markChatRead: (chatId: string, messageId?: string) =>
    req<void>(`/api/chats/${encodeURIComponent(chatId)}/read`, {
      method: 'POST',
      body: JSON.stringify(messageId ? { messageId } : {}),
    }),

  // ── Media ─────────────────────────────────────────────────
  uploadMedia: (file: File, chatId?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (chatId) form.append('chat_id', chatId)
    return req<MediaUploadRes>('/api/media/upload', { method: 'POST', body: form })
  },

  /** Загружает медиафайл с авторизацией и возвращает кешированный object URL. */
  fetchMediaBlobUrl,

  /** Загружает зашифрованный медиафайл, расшифровывает и возвращает object URL. */
  fetchEncryptedMediaBlobUrl,

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
