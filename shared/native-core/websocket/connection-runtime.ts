export type WSConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'auth_failed'

export interface WSRuntimeSession {
  accessToken: string
  deviceId: string
}

export interface WSAuthSessionProvider {
  getSession(): Promise<WSRuntimeSession | null>
  handleAuthFailure(session: WSRuntimeSession): Promise<void>
}

export interface WSConnectionAdapter {
  open(session: WSRuntimeSession): void
  close(reason?: string): void
  send(frame: unknown): boolean
}

export interface CancelableTask {
  cancel(): void
}

export interface ReconnectScheduler {
  schedule(delayMs: number, run: () => void | Promise<void>): CancelableTask
}

export interface ReconnectPolicy {
  initialDelayMs: number
  maxDelayMs: number
}

export interface CloseEventLike {
  kind: 'recoverable' | 'intentional' | 'auth_failed'
  reason: string
}

export interface WSConnectionRuntimeOptions {
  adapter: WSConnectionAdapter
  auth: WSAuthSessionProvider
  scheduler: ReconnectScheduler
  reconnect: ReconnectPolicy
}

export class WSConnectionRuntime {
  private state: WSConnectionState = 'idle'
  private reconnectDelayMs: number
  private reconnectTask: CancelableTask | null = null
  private session: WSRuntimeSession | null = null

  constructor(private readonly options: WSConnectionRuntimeOptions) {
    this.reconnectDelayMs = options.reconnect.initialDelayMs
  }

  currentState(): WSConnectionState {
    return this.state
  }

  async connect(): Promise<void> {
    const session = await this.options.auth.getSession()
    if (!session) {
      this.state = 'auth_failed'
      return
    }

    this.session = session
    this.state = this.state === 'reconnecting' ? 'reconnecting' : 'connecting'
    this.options.adapter.open(session)
  }

  disconnect(reason = 'intentional'): void {
    this.cancelReconnect()
    this.state = 'disconnected'
    this.options.adapter.close(reason)
  }

  markConnected(): void {
    this.cancelReconnect()
    this.state = 'connected'
  }

  async handleClose(event: CloseEventLike): Promise<void> {
    if (event.kind === 'intentional') {
      this.state = 'disconnected'
      return
    }

    if (event.kind === 'auth_failed') {
      this.cancelReconnect()
      this.state = 'auth_failed'
      if (this.session) {
        await this.options.auth.handleAuthFailure(this.session)
      }
      return
    }

    this.state = 'reconnecting'
    const delayMs = this.reconnectDelayMs
    this.reconnectTask = this.options.scheduler.schedule(delayMs, async () => {
      this.reconnectTask = null
      await this.connect()
    })
    this.reconnectDelayMs = Math.min(
      this.reconnectDelayMs * 2,
      this.options.reconnect.maxDelayMs,
    )
  }

  send(frame: unknown): boolean {
    if (this.state !== 'connected') return false
    return this.options.adapter.send(frame)
  }

  private cancelReconnect(): void {
    this.reconnectTask?.cancel()
    this.reconnectTask = null
  }
}
