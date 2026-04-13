import { describe, expect, it, vi } from 'vitest'

const {
  createBrowserSocketLike,
  resolveBrowserWsBaseUrl,
  scheduleBrowserTask,
  cancelBrowserTask,
} = await import('./browser-websocket-platform')

class FakeBrowserSocket {
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  readonly sent: string[] = []

  send(payload: string) {
    this.sent.push(payload)
  }

  close(code?: number, reason?: string) {
    this.onclose?.({ code: code ?? 1000, reason: reason ?? 'closed' })
  }
}

describe('browser websocket platform', () => {
  it('resolveBrowserWsBaseUrl корректно вычисляет ws base и fallback по location', () => {
    expect(resolveBrowserWsBaseUrl('https://api.example.test')).toBe('wss://api.example.test')
    expect(resolveBrowserWsBaseUrl('http://api.example.test')).toBe('ws://api.example.test')
    expect(resolveBrowserWsBaseUrl(undefined, { protocol: 'https:', host: 'messenger.local' })).toBe('wss://messenger.local')
    expect(resolveBrowserWsBaseUrl(undefined, { protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173')
  })

  it('createBrowserSocketLike оборачивает browser WebSocket в shared contract', () => {
    const raw = new FakeBrowserSocket()
    const socket = createBrowserSocketLike(raw as unknown as WebSocket)
    const onMessage = vi.fn()
    const onClose = vi.fn()

    socket.onmessage = onMessage
    socket.onclose = onClose

    raw.onmessage?.({ data: 123 })
    raw.onclose?.({ code: 1006, reason: 'network' })

    expect(onMessage).toHaveBeenCalledWith({ data: '123' })
    expect(onClose).toHaveBeenCalledWith({ code: 1006, reason: 'network' })
  })

  it('scheduleBrowserTask и cancelBrowserTask используют переданные browser timers', () => {
    const setTimeoutMock = vi.fn((_run: () => void, _delayMs: number) => 77)
    const clearTimeoutMock = vi.fn()

    const task = scheduleBrowserTask(setTimeoutMock, 250, vi.fn())
    cancelBrowserTask(clearTimeoutMock, task)

    expect(setTimeoutMock).toHaveBeenCalledTimes(1)
    expect(clearTimeoutMock).toHaveBeenCalledWith(77)
  })
})
