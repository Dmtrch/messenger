import { describe, expect, it, vi } from 'vitest'

import type { WSFrame } from './ws-frame-types'

const { createBrowserMessengerWS } = await import('./browser-websocket-client')

class FakeSocket {
  static instances: FakeSocket[] = []

  static readonly OPEN = 1

  readonly sent: string[] = []
  readonly url: string
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number; reason?: string }) => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }

  send(payload: string) {
    this.sent.push(payload)
  }

  close(code = 1000, reason = 'closed') {
    this.onclose?.({ code, reason })
  }

  emitOpen() {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }

  emitMessage(frame: WSFrame) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
}

describe('browser websocket client', () => {
  it('при auth failure делает refresh и переподключается с новым токеном', async () => {
    FakeSocket.instances = []
    const onFrame = vi.fn()
    const onConnect = vi.fn()
    const onDisconnect = vi.fn()
    const onAuthFail = vi.fn()
    const setAccessToken = vi.fn()
    const scheduled: Array<() => void> = []

    const client = createBrowserMessengerWS<WSFrame, { type: 'typing'; chatId: string }>({
      token: 'old-token',
      onFrame,
      onConnect,
      onDisconnect,
      onAuthFail,
      createSocket(url) {
        return new FakeSocket(url)
      },
      getWsBaseUrl() {
        return 'wss://example.test'
      },
      async loadDeviceId() {
        return 'device-1'
      },
      async refreshAuth() {
        return { accessToken: 'new-token' }
      },
      setAccessToken,
      schedule(delayMs, run) {
        expect(delayMs).toBe(0)
        scheduled.push(run)
        return 1
      },
      cancelScheduledReconnect() {
        // no-op
      },
    })

    await client.connect()
    expect(FakeSocket.instances).toHaveLength(1)
    expect(FakeSocket.instances[0].url).toContain('token=old-token')
    expect(FakeSocket.instances[0].url).toContain('deviceId=device-1')

    FakeSocket.instances[0].emitOpen()
    expect(onConnect).toHaveBeenCalledTimes(1)

    FakeSocket.instances[0].close(4001, 'unauthorized')
    await Promise.resolve()

    expect(setAccessToken).toHaveBeenCalledWith('new-token')
    expect(onAuthFail).not.toHaveBeenCalled()
    expect(onDisconnect).toHaveBeenCalledTimes(1)

    scheduled[0]()
    await Promise.resolve()
    expect(FakeSocket.instances).toHaveLength(2)
    expect(FakeSocket.instances[1].url).toContain('token=new-token')
  })

  it('send возвращает false если сокет не открыт, и true после open', async () => {
    FakeSocket.instances = []
    const client = createBrowserMessengerWS<WSFrame, { type: 'typing'; chatId: string }>({
      token: 'token-1',
      onFrame: vi.fn(),
      createSocket(url) {
        return new FakeSocket(url)
      },
      getWsBaseUrl() {
        return 'wss://example.test'
      },
      async loadDeviceId() {
        return undefined
      },
      async refreshAuth() {
        return { accessToken: 'token-2' }
      },
      setAccessToken: vi.fn(),
      schedule() {
        return 1
      },
      cancelScheduledReconnect() {
        // no-op
      },
    })

    await client.connect()
    expect(client.send({ type: 'typing', chatId: 'chat-1' })).toBe(false)

    FakeSocket.instances[0].emitOpen()
    expect(client.send({ type: 'typing', chatId: 'chat-1' })).toBe(true)
    expect(FakeSocket.instances[0].sent[0]).toContain('"type":"typing"')
  })
})
