/**
 * Тесты API клиента: auto-refresh при 401, failed refresh → ApiError.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api, ApiError, setAccessToken } from './client'

// ── Хелперы ───────────────────────────────────────────────────────────────────

/** Создаёт мок fetch, который возвращает заданный ответ. */
function mockFetch(responses: Array<{ status: number; body?: unknown }>) {
  let call = 0
  return vi.fn(async () => {
    const r = responses[Math.min(call++, responses.length - 1)]
    // 204 No Content не может иметь тело
    if (r.status === 204) {
      return new Response(null, { status: 204 })
    }
    const json = r.body !== undefined ? JSON.stringify(r.body) : ''
    return new Response(json, {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

beforeEach(() => {
  setAccessToken('valid-token')
})

afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
})

// ── Auto-refresh при 401 ──────────────────────────────────────────────────────

describe('auto-refresh on 401', () => {
  it('Успешный refresh → повтор исходного запроса', async () => {
    // Первый вызов fetch → 401, второй (refresh) → 200 с токеном, третий (retry) → 200
    const fetchMock = mockFetch([
      { status: 401, body: { error: 'expired' } },
      { status: 200, body: { accessToken: 'new-token' } },
      { status: 200, body: { chats: [] } },
    ])
    vi.stubGlobal('fetch', fetchMock)

    const result = await api.getChats()
    expect(result).toEqual({ chats: [] })

    // Всего 3 вызова: исходный + refresh + retry
    expect(fetchMock).toHaveBeenCalledTimes(3)
    // Второй вызов — refresh endpoint
    expect(fetchMock.mock.calls[1][0]).toContain('/api/auth/refresh')
    // Третий вызов — повтор с новым токеном
    const retryHeaders = fetchMock.mock.calls[2][1]?.headers as Record<string, string>
    expect(retryHeaders?.['Authorization']).toBe('Bearer new-token')
  })

  it('Неуспешный refresh → ApiError 401', async () => {
    const fetchMock = mockFetch([
      { status: 401, body: { error: 'expired' } },
      { status: 401, body: { error: 'refresh failed' } }, // refresh тоже 401
    ])
    vi.stubGlobal('fetch', fetchMock)

    await expect(api.getChats()).rejects.toThrow(ApiError)
    await expect(api.getChats()).rejects.toMatchObject({ status: 401 })
  })

  it('skipAuth=true → refresh не вызывается при 401', async () => {
    // login имеет skipAuth=true — при 401 не должно быть авторефреша
    const fetchMock = mockFetch([
      { status: 401, body: { error: 'invalid credentials' } },
    ])
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      api.login({ username: 'x', challenge: 'c', signature: 's' })
    ).rejects.toThrow(ApiError)
    // Только один вызов — без refresh
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('Параллельные 401 → refresh вызывается один раз (deduplicated)', async () => {
    let refreshCalled = 0
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/auth/refresh')) {
        refreshCalled++
        return new Response(JSON.stringify({ accessToken: 'new-token' }), { status: 200 })
      }
      if (url.includes('/api/chats') || url.includes('/api/users')) {
        return new Response(JSON.stringify({ error: 'expired' }), { status: 401 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    // Запускаем два запроса параллельно — оба получат 401
    const [r1, r2] = await Promise.allSettled([api.getChats(), api.searchUsers('test')])

    // Refresh должен быть вызван только один раз (shared Promise)
    expect(refreshCalled).toBe(1)
  })
})

// ── Успешные запросы ──────────────────────────────────────────────────────────

describe('successful requests', () => {
  it('Добавляет Authorization Bearer header если токен установлен', async () => {
    setAccessToken('my-token')
    const fetchMock = mockFetch([{ status: 200, body: { chats: [] } }])
    vi.stubGlobal('fetch', fetchMock)

    await api.getChats()

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers?.['Authorization']).toBe('Bearer my-token')
  })

  it('Не добавляет Authorization если токен null', async () => {
    setAccessToken(null)
    const fetchMock = mockFetch([{ status: 200, body: { accessToken: 'tok' } }])
    vi.stubGlobal('fetch', fetchMock)

    // refresh не требует токена (skipAuth=true)
    await api.refresh()
    // Проверяем что вызов был без auth header
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers?.['Authorization']).toBeUndefined()
  })

  it('204 → возвращает undefined', async () => {
    const fetchMock = mockFetch([{ status: 204 }])
    vi.stubGlobal('fetch', fetchMock)

    const result = await api.logout()
    expect(result).toBeUndefined()
  })
})

// ── ApiError ──────────────────────────────────────────────────────────────────

describe('ApiError', () => {
  it('Не-200/401 ответ → ApiError с правильным status', async () => {
    const fetchMock = mockFetch([{ status: 500, body: { error: 'internal error' } }])
    vi.stubGlobal('fetch', fetchMock)

    try {
      await api.getChats()
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).status).toBe(500)
      expect((err as ApiError).message).toBe('internal error')
    }
  })

  it('404 → ApiError 404', async () => {
    const fetchMock = mockFetch([{ status: 404, body: { error: 'not found' } }])
    vi.stubGlobal('fetch', fetchMock)

    await expect(api.getKeyBundle('unknown-user')).rejects.toMatchObject({ status: 404 })
  })
})
