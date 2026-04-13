import type { BrowserSocketLike } from './browser-websocket-client'

export interface BrowserLocationLike {
  protocol: string
  host: string
}

export function resolveBrowserWsBaseUrl(serverUrl?: string, location?: BrowserLocationLike): string {
  if (serverUrl) {
    const url = new URL(serverUrl)
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${url.host}`
  }

  if (!location) {
    throw new Error('Browser location is required when serverUrl is missing')
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}`
}

export function createBrowserSocketLike(socket: WebSocket): BrowserSocketLike {
  const adapter: BrowserSocketLike = {
    get readyState() {
      return socket.readyState
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send(payload) {
      socket.send(payload)
    },
    close(code, reason) {
      socket.close(code, reason)
    },
  }

  socket.onopen = () => {
    adapter.onopen?.()
  }
  socket.onmessage = (event) => {
    adapter.onmessage?.({ data: String(event.data) })
  }
  socket.onclose = (event) => {
    adapter.onclose?.({ code: event.code, reason: event.reason })
  }
  socket.onerror = () => {
    adapter.onerror?.()
  }

  return adapter
}

export function scheduleBrowserTask(
  setTimer: (run: () => void, delayMs: number) => unknown,
  delayMs: number,
  run: () => void,
): unknown {
  return setTimer(run, delayMs)
}

export function cancelBrowserTask(clearTimer: (task: unknown) => void, task: unknown): void {
  clearTimer(task)
}
