import { describe, expect, it, vi } from 'vitest'

const {
  ApiError,
  createBrowserApiClient,
} = await import('./browser-api-client')

function mockFetch(responses: Array<{ status: number; body?: unknown }>) {
  let call = 0
  return vi.fn(async () => {
    const response = responses[Math.min(call++, responses.length - 1)]
    if (response.status === 204) {
      return new Response(null, { status: 204 })
    }
    return new Response(JSON.stringify(response.body ?? {}), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

describe('shared browser api client', () => {
  it('работает через явные deps и повторяет запрос после refresh', async () => {
    const fetchMock = mockFetch([
      { status: 401, body: { error: 'expired' } },
      { status: 200, body: { accessToken: 'new-token' } },
      { status: 200, body: { chats: [] } },
    ])

    const client = createBrowserApiClient({
      fetchFn: fetchMock as typeof fetch,
      getBaseUrl() {
        return 'https://example.test'
      },
    })
    client.setAccessToken('old-token')

    const result = await client.api.getChats()

    expect(result).toEqual({ chats: [] })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/auth/refresh')
  })

  it('бросает ApiError при неуспешном refresh', async () => {
    const fetchMock = mockFetch([
      { status: 401, body: { error: 'expired' } },
      { status: 401, body: { error: 'refresh failed' } },
    ])

    const client = createBrowserApiClient({
      fetchFn: fetchMock as typeof fetch,
      getBaseUrl() {
        return 'https://example.test'
      },
    })
    client.setAccessToken('old-token')

    await expect(client.api.getChats()).rejects.toBeInstanceOf(ApiError)
    await expect(client.api.getChats()).rejects.toMatchObject({ status: 401 })
  })
})
