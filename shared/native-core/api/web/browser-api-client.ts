/**
 * Browser HTTP API client.
 *
 * Auth: JWT Bearer + silent refresh через httpOnly cookie.
 * Сетевой runtime задаётся через явные deps, поэтому модуль можно использовать
 * как в browser facade, так и в shared adapter-driven wiring.
 */

import _sodium from '../../../../client/node_modules/libsodium-wrappers-sumo/dist/modules-sumo/libsodium-wrappers.js'

export interface AuthRegisterReq {
  username: string
  password: string
  displayName: string
  ikPublic: string
  spkId: number
  spkPublic: string
  spkSignature: string
  opkPublics: Array<{ id: number; key: string }>
  inviteCode?: string
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

export interface DeviceBundle {
  deviceId: string
  ikPublic: string
  spkId: number
  spkPublic: string
  spkSignature: string
  opkId?: number
  opkPublic?: string
}

export interface PreKeyBundleResponse {
  devices: DeviceBundle[]
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
  nextCursor?: string
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

export interface BrowserApiClientDeps {
  fetchFn?: typeof fetch
  getBaseUrl(): string
  createObjectUrl?: (blob: Blob) => string
  loadSodium?: () => Promise<{
    crypto_secretbox_NONCEBYTES: number
    randombytes_buf(length: number): Uint8Array
    crypto_secretbox_easy(message: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array
    crypto_secretbox_open_easy(ciphertext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array
    to_base64(data: Uint8Array): string
    from_base64(data: string): Uint8Array
    ready?: Promise<unknown>
  }>
}

export interface BrowserApiClient {
  api: {
    register(body: AuthRegisterReq): Promise<AuthRegisterRes>
    login(body: AuthLoginReq): Promise<AuthLoginRes>
    refresh(): Promise<{ accessToken: string }>
    logout(): Promise<void>
    changePassword(currentPassword: string, newPassword: string): Promise<void>
    getKeyBundle(userId: string): Promise<PreKeyBundleResponse>
    uploadPreKeys(keys: Array<{ id: number; key: string }>): Promise<void>
    registerKeys(body: RegisterKeysReq): Promise<RegisterKeysRes>
    getChats(): Promise<{ chats: ChatSummary[] }>
    createChat(body: { type: 'direct' | 'group'; memberIds: string[]; name?: string }): Promise<{ chat: ChatSummary }>
    getMessages(chatId: string, params?: { before?: string; limit?: number }): Promise<MessagesPage>
    markChatRead(chatId: string, messageId?: string): Promise<void>
    uploadMedia(file: File, chatId?: string): Promise<MediaUploadRes>
    uploadEncryptedMedia(
      file: File,
      chatId?: string,
    ): Promise<{ mediaId: string; mediaKey: string; originalName: string; contentType: string }>
    fetchMediaBlobUrl(mediaId: string): Promise<string>
    fetchEncryptedMediaBlobUrl(mediaId: string, mediaKey: string, mimeType: string): Promise<string>
    deleteMessage(clientMsgId: string): Promise<void>
    editMessage(clientMsgId: string, recipients: Array<{ userId: string; ciphertext: string }>): Promise<{ editedAt: number }>
    getIceServers(): Promise<{ iceServers: RTCIceServer[] }>
    subscribePush(subscription: PushSubscriptionJSON): Promise<void>
    searchUsers(q: string): Promise<{ users: Array<{ id: string; username: string; displayName: string }> }>
  }
  setAccessToken(token: string | null): void
}

export function createBrowserApiClient(deps: BrowserApiClientDeps): BrowserApiClient {
  const getFetchFn = () => deps.fetchFn ?? fetch
  const createObjectUrl = deps.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob))
  const loadSodium = deps.loadSodium ?? defaultLoadSodium

  let accessToken: string | null = null
  let refreshInFlight: Promise<string | null> | null = null
  const mediaBlobCache = new Map<string, string>()

  function getBase() {
    return deps.getBaseUrl() || ''
  }

  function setAccessToken(token: string | null): void {
    accessToken = token
  }

  async function doRefresh(): Promise<string | null> {
    try {
      const response = await getFetchFn()(`${getBase()}${normalizePath('/api/auth/refresh')}`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!response.ok) return null
      const data = (await response.json()) as { accessToken: string }
      accessToken = data.accessToken
      return accessToken
    } catch {
      return null
    }
  }

  async function req<T>(
    path: string,
    options: RequestInit & { skipAuth?: boolean; _retry?: boolean } = {},
  ): Promise<T> {
    const { skipAuth = false, _retry = false, ...fetchOpts } = options
    const isFormData = typeof FormData !== 'undefined' && fetchOpts.body instanceof FormData
    const headers: Record<string, string> = {
      ...(!isFormData && fetchOpts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(!skipAuth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(fetchOpts.headers as Record<string, string> | undefined ?? {}),
    }

    const response = await getFetchFn()(`${getBase()}${normalizePath(path)}`, {
      ...fetchOpts,
      headers,
      credentials: 'include',
    })

    if (response.status === 401 && !skipAuth && !_retry) {
      if (!refreshInFlight) {
        refreshInFlight = doRefresh().finally(() => {
          refreshInFlight = null
        })
      }
      const token = await refreshInFlight
      if (token) return req<T>(path, { ...options, _retry: true })
      throw new ApiError(401, 'Сессия истекла — войдите снова')
    }

    if (!response.ok) {
      let message = response.statusText
      try {
        message = ((await response.json()) as { error?: string }).error ?? message
      } catch {
        // Оставляем statusText как fallback.
      }
      throw new ApiError(response.status, message)
    }

    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }

  async function fetchMediaBlobUrl(mediaId: string): Promise<string> {
    const cached = mediaBlobCache.get(mediaId)
    if (cached) return cached

    const path = `/api/media/${encodeURIComponent(mediaId)}`
    const headers: Record<string, string> = accessToken
      ? { Authorization: `Bearer ${accessToken}` }
      : {}

    let response = await getFetchFn()(`${getBase()}${normalizePath(path)}`, { headers, credentials: 'include' })

    if (response.status === 401) {
      if (!refreshInFlight) {
        refreshInFlight = doRefresh().finally(() => {
          refreshInFlight = null
        })
      }
      const token = await refreshInFlight
      if (!token) throw new ApiError(401, 'Сессия истекла')
      response = await getFetchFn()(`${getBase()}${normalizePath(path)}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      })
    }

    if (!response.ok) throw new ApiError(response.status, 'media fetch failed')

    const blob = await response.blob()
    const url = createObjectUrl(blob)
    mediaBlobCache.set(mediaId, url)
    return url
  }

  async function fetchEncryptedMediaBlobUrl(
    mediaId: string,
    mediaKey: string,
    mimeType: string,
  ): Promise<string> {
    const cacheKey = `${mediaId}:${mediaKey.slice(0, 8)}`
    const cached = mediaBlobCache.get(cacheKey)
    if (cached) return cached

    const path = `/api/media/${encodeURIComponent(mediaId)}`
    const headers: Record<string, string> = accessToken
      ? { Authorization: `Bearer ${accessToken}` }
      : {}

    let response = await getFetchFn()(`${getBase()}${normalizePath(path)}`, { headers, credentials: 'include' })

    if (response.status === 401) {
      if (!refreshInFlight) {
        refreshInFlight = doRefresh().finally(() => {
          refreshInFlight = null
        })
      }
      const token = await refreshInFlight
      if (!token) throw new ApiError(401, 'Сессия истекла')
      response = await getFetchFn()(`${getBase()}${normalizePath(path)}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      })
    }

    if (!response.ok) throw new ApiError(response.status, 'media fetch failed')

    const sodium = await loadSodium()
    if (sodium.ready) await sodium.ready

    const combined = new Uint8Array(await response.arrayBuffer())
    const nonce = combined.slice(0, sodium.crypto_secretbox_NONCEBYTES)
    const ciphertext = combined.slice(sodium.crypto_secretbox_NONCEBYTES)
    const key = sodium.from_base64(mediaKey)
    const plain = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key)

    const blob = new Blob([plain.buffer as ArrayBuffer], {
      type: mimeType || 'application/octet-stream',
    })
    const url = createObjectUrl(blob)
    mediaBlobCache.set(cacheKey, url)
    return url
  }

  async function uploadEncryptedMedia(
    file: File,
    chatId?: string,
  ): Promise<{ mediaId: string; mediaKey: string; originalName: string; contentType: string }> {
    const sodium = await loadSodium()
    if (sodium.ready) await sodium.ready

    const mediaKey = sodium.randombytes_buf(32)
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
    const plainBytes = new Uint8Array(await file.arrayBuffer())
    const ciphertext = sodium.crypto_secretbox_easy(plainBytes, nonce, mediaKey)

    const combined = new Uint8Array(nonce.length + ciphertext.length)
    combined.set(nonce)
    combined.set(ciphertext, nonce.length)

    const encryptedFile = new File([combined], 'encrypted', { type: 'application/octet-stream' })
    const form = new FormData()
    form.append('file', encryptedFile)
    if (chatId) form.append('chat_id', chatId)

    const response = await req<MediaUploadRes>('/api/media/upload', {
      method: 'POST',
      body: form,
    })

    return {
      mediaId: response.mediaId,
      mediaKey: sodium.to_base64(mediaKey),
      originalName: file.name,
      contentType: file.type,
    }
  }

  const api = {
    register: (body: AuthRegisterReq) =>
      req<AuthRegisterRes>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(body),
        skipAuth: true,
      }),

    login: (body: AuthLoginReq) =>
      req<AuthLoginRes>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(body),
        skipAuth: true,
      }),

    refresh: () =>
      req<{ accessToken: string }>('/api/auth/refresh', {
        method: 'POST',
        skipAuth: true,
      }),

    logout: () =>
      req<void>('/api/auth/logout', { method: 'POST' }),

    changePassword: (currentPassword: string, newPassword: string) =>
      req<void>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      }),

    getKeyBundle: (userId: string) =>
      req<PreKeyBundleResponse>(`/api/keys/${encodeURIComponent(userId)}`),

    uploadPreKeys: (keys: Array<{ id: number; key: string }>) =>
      req<void>('/api/keys/prekeys', {
        method: 'POST',
        body: JSON.stringify({ keys }),
      }),

    registerKeys: (body: RegisterKeysReq) =>
      req<RegisterKeysRes>('/api/keys/register', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    getChats: () =>
      req<{ chats: ChatSummary[] }>('/api/chats'),

    createChat: (body: { type: 'direct' | 'group'; memberIds: string[]; name?: string }) =>
      req<{ chat: ChatSummary }>('/api/chats', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    getMessages: (chatId: string, params?: { before?: string; limit?: number }) => {
      const qs = new URLSearchParams()
      if (params?.before != null) qs.set('before', params.before)
      if (params?.limit != null) qs.set('limit', String(params.limit))
      const query = qs.size ? `?${qs}` : ''
      return req<MessagesPage>(`/api/chats/${encodeURIComponent(chatId)}/messages${query}`)
    },

    markChatRead: (chatId: string, messageId?: string) =>
      req<void>(`/api/chats/${encodeURIComponent(chatId)}/read`, {
        method: 'POST',
        body: JSON.stringify(messageId ? { messageId } : {}),
      }),

    uploadMedia: (file: File, chatId?: string) => {
      const form = new FormData()
      form.append('file', file)
      if (chatId) form.append('chat_id', chatId)
      return req<MediaUploadRes>('/api/media/upload', {
        method: 'POST',
        body: form,
      })
    },

    fetchMediaBlobUrl,
    fetchEncryptedMediaBlobUrl,
    deleteMessage: (clientMsgId: string) =>
      req<void>(`/api/messages/${encodeURIComponent(clientMsgId)}`, {
        method: 'DELETE',
      }),

    editMessage: (clientMsgId: string, recipients: Array<{ userId: string; ciphertext: string }>) =>
      req<{ editedAt: number }>(`/api/messages/${encodeURIComponent(clientMsgId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ recipients }),
      }),

    getIceServers: () =>
      req<{ iceServers: RTCIceServer[] }>('/api/calls/ice-servers'),

    subscribePush: (subscription: PushSubscriptionJSON) =>
      req<void>('/api/push/subscribe', {
        method: 'POST',
        body: JSON.stringify(subscription),
      }),

    searchUsers: (q: string) =>
      req<{ users: Array<{ id: string; username: string; displayName: string }> }>(
        `/api/users/search?q=${encodeURIComponent(q)}`,
      ),
  }

  return {
    api: {
      ...api,
      uploadEncryptedMedia,
    } as BrowserApiClient['api'],
    setAccessToken,
  }
}

async function defaultLoadSodium() {
  return _sodium
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}
