/**
 * Browser realtime transport для Messenger.
 *
 * Аутентификация: Bearer JWT через query `?token=<JWT>`.
 * При auth failure выполняется refresh и переподключение.
 */

export interface BrowserSocketLike {
  readyState: number
  onopen: (() => void) | null
  onmessage: ((event: { data: string }) => void) | null
  onclose: ((event: { code: number; reason?: string }) => void) | null
  onerror: (() => void) | null
  send(payload: string): void
  close(code?: number, reason?: string): void
}

export interface BrowserMessengerWSDeps<TFrame> {
  token: string
  onFrame(frame: TFrame): void
  onConnect?(): void
  onDisconnect?(): void
  onAuthFail?(): void
  createSocket(url: string): BrowserSocketLike
  getWsBaseUrl(): string
  loadDeviceId(): Promise<string | undefined>
  refreshAuth(): Promise<{ accessToken: string }>
  setAccessToken(token: string): void
  schedule(delayMs: number, run: () => void): unknown
  cancelScheduledReconnect(task: unknown): void
}

export interface BrowserMessengerWS<TSendFrame> {
  connect(): Promise<void>
  disconnect(): void
  send(frame: TSendFrame): boolean
  updateToken(token: string): void
}

export function createBrowserMessengerWS<TFrame, TSendFrame>(
  deps: BrowserMessengerWSDeps<TFrame>,
): BrowserMessengerWS<TSendFrame> {
  let socket: BrowserSocketLike | null = null
  let reconnectDelay = 1_000
  const maxDelay = 30_000
  let intentionalClose = false
  let reconnectTask: unknown = null
  let refreshAttempted = false
  let token = deps.token

  function scheduleReconnect(delay?: number) {
    const ms = delay ?? reconnectDelay
    reconnectTask = deps.schedule(ms, () => {
      if (delay === undefined) {
        reconnectDelay = Math.min(reconnectDelay * 2, maxDelay)
      }
      void open()
    })
  }

  function clearReconnect() {
    if (reconnectTask != null) {
      deps.cancelScheduledReconnect(reconnectTask)
      reconnectTask = null
    }
  }

  async function handleAuthFailure() {
    try {
      const response = await deps.refreshAuth()
      deps.setAccessToken(response.accessToken)
      token = response.accessToken
      refreshAttempted = false
      scheduleReconnect(0)
    } catch {
      deps.onAuthFail?.()
    }
  }

  function openUrl(url: string) {
    socket = deps.createSocket(url)

    socket.onopen = () => {
      reconnectDelay = 1_000
      deps.onConnect?.()
    }

    socket.onmessage = (event) => {
      try {
        deps.onFrame(JSON.parse(event.data) as TFrame)
      } catch {
        // Игнорируем невалидный фрейм.
      }
    }

    socket.onclose = (event) => {
      deps.onDisconnect?.()
      if (intentionalClose) return

      if (event.code === 4001 || (event.code === 1006 && !refreshAttempted)) {
        refreshAttempted = true
        void handleAuthFailure()
        return
      }

      refreshAttempted = false
      scheduleReconnect()
    }

    socket.onerror = () => {
      socket?.close()
    }
  }

  async function open() {
    const params = new URLSearchParams({ token })

    try {
      const deviceId = await deps.loadDeviceId()
      if (deviceId) params.set('deviceId', deviceId)
    } catch {
      // Используем только token fallback.
    }

    openUrl(`${deps.getWsBaseUrl()}/ws?${params.toString()}`)
  }

  return {
    async connect() {
      intentionalClose = false
      await open()
    },

    disconnect() {
      intentionalClose = true
      clearReconnect()
      socket?.close(1000, 'intentional')
      socket = null
    },

    send(frame) {
      if (!socket || socket.readyState !== 1) return false
      socket.send(JSON.stringify(frame))
      return true
    },

    updateToken(nextToken: string) {
      token = nextToken
    },
  }
}
