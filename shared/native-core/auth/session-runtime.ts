export type RefreshState = 'present' | 'missing' | 'expired'

export interface AuthSession {
  accessToken: string
  refreshState: RefreshState
  userId: string
  deviceId: string
  issuedAt: number
  expiresAt: number
}

export interface LoginCredentials {
  username: string
  challenge: string
  signature: string
}

export interface RegisteredDevice {
  deviceId: string
  status: 'registered' | 'already_registered'
}

export interface AuthTransport {
  login(credentials: LoginCredentials): Promise<AuthSession>
  refresh(session: AuthSession): Promise<AuthSession>
  logout(session: AuthSession): Promise<void>
}

export interface SessionStore {
  load(): Promise<AuthSession | null>
  save(session: AuthSession): Promise<void>
  clear(): Promise<void>
}

export interface DeviceRegistrationService {
  ensureRegistered(session: AuthSession): Promise<RegisteredDevice>
}

export interface AuthSessionRuntimeOptions {
  transport: AuthTransport
  store: SessionStore
  devices: DeviceRegistrationService
  now?: () => number
}

export interface LoginResult {
  session: AuthSession
  device: RegisteredDevice
}

export class AuthSessionRuntime {
  private readonly now: () => number

  constructor(private readonly options: AuthSessionRuntimeOptions) {
    this.now = options.now ?? (() => Date.now())
  }

  async login(credentials: LoginCredentials): Promise<LoginResult> {
    const session = await this.options.transport.login(credentials)
    return this.persistAndRegister(session)
  }

  async refresh(session: AuthSession): Promise<LoginResult> {
    const refreshed = await this.options.transport.refresh(session)
    return this.persistAndRegister(refreshed)
  }

  async restoreSession(): Promise<AuthSession | null> {
    const session = await this.options.store.load()
    if (!session) return null

    if (!this.isExpired(session)) {
      await this.options.devices.ensureRegistered(session)
      return session
    }

    if (session.refreshState !== 'present') {
      await this.options.store.clear()
      return null
    }

    const restored = await this.refresh(session)
    return restored.session
  }

  async logout(session: AuthSession): Promise<void> {
    try {
      await this.options.transport.logout(session)
    } finally {
      await this.options.store.clear()
    }
  }

  private async persistAndRegister(session: AuthSession): Promise<LoginResult> {
    await this.options.store.save(session)
    const device = await this.options.devices.ensureRegistered(session)
    return { session, device }
  }

  private isExpired(session: AuthSession): boolean {
    return session.expiresAt <= this.now()
  }
}
