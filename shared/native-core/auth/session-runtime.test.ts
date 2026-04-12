import { describe, expect, it, vi } from 'vitest'

import {
  AuthSessionRuntime,
  type AuthSession,
  type AuthTransport,
  type DeviceRegistrationService,
  type SessionStore,
} from './session-runtime'

function makeSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    accessToken: 'access-token',
    refreshState: 'present',
    userId: 'user-1',
    deviceId: 'device-1',
    issuedAt: 1_000,
    expiresAt: 2_000,
    ...overrides,
  }
}

function createStore(seed: AuthSession | null = null): SessionStore {
  let session = seed

  return {
    async load() {
      return session
    },
    async save(next) {
      session = next
    },
    async clear() {
      session = null
    },
  }
}

describe('AuthSessionRuntime', () => {
  it('выполняет login, сохраняет сессию и регистрирует устройство', async () => {
    const session = makeSession()
    const store = createStore()
    const transport: AuthTransport = {
      login: vi.fn().mockResolvedValue(session),
      refresh: vi.fn(),
      logout: vi.fn(),
    }
    const devices: DeviceRegistrationService = {
      ensureRegistered: vi.fn().mockResolvedValue({
        deviceId: 'device-1',
        status: 'registered',
      }),
    }

    const runtime = new AuthSessionRuntime({
      transport,
      store,
      devices,
      now: () => 1_500,
    })

    const result = await runtime.login({
      username: 'alice',
      challenge: 'challenge',
      signature: 'signature',
    })

    expect(result.session).toEqual(session)
    expect(result.device.status).toBe('registered')
    expect(transport.login).toHaveBeenCalledWith({
      username: 'alice',
      challenge: 'challenge',
      signature: 'signature',
    })
    expect(devices.ensureRegistered).toHaveBeenCalledWith(session)
    await expect(store.load()).resolves.toEqual(session)
  })

  it('при restoreSession делает silent refresh для истёкшей сессии с refreshState=present', async () => {
    const expired = makeSession({ accessToken: 'old-token', expiresAt: 900 })
    const refreshed = makeSession({ accessToken: 'new-token', issuedAt: 1_000, expiresAt: 3_000 })
    const store = createStore(expired)
    const transport: AuthTransport = {
      login: vi.fn(),
      refresh: vi.fn().mockResolvedValue(refreshed),
      logout: vi.fn(),
    }
    const devices: DeviceRegistrationService = {
      ensureRegistered: vi.fn().mockResolvedValue({
        deviceId: 'device-1',
        status: 'already_registered',
      }),
    }

    const runtime = new AuthSessionRuntime({
      transport,
      store,
      devices,
      now: () => 1_500,
    })

    const restored = await runtime.restoreSession()

    expect(restored).toEqual(refreshed)
    expect(transport.refresh).toHaveBeenCalledWith(expired)
    expect(devices.ensureRegistered).toHaveBeenCalledWith(refreshed)
    await expect(store.load()).resolves.toEqual(refreshed)
  })

  it('при restoreSession очищает сессию, если refresh недоступен', async () => {
    const expired = makeSession({ refreshState: 'missing', expiresAt: 900 })
    const store = createStore(expired)
    const transport: AuthTransport = {
      login: vi.fn(),
      refresh: vi.fn(),
      logout: vi.fn(),
    }
    const devices: DeviceRegistrationService = {
      ensureRegistered: vi.fn(),
    }

    const runtime = new AuthSessionRuntime({
      transport,
      store,
      devices,
      now: () => 1_500,
    })

    const restored = await runtime.restoreSession()

    expect(restored).toBeNull()
    expect(transport.refresh).not.toHaveBeenCalled()
    expect(devices.ensureRegistered).not.toHaveBeenCalled()
    await expect(store.load()).resolves.toBeNull()
  })

  it('logout очищает локальную сессию и уведомляет transport', async () => {
    const session = makeSession()
    const store = createStore(session)
    const transport: AuthTransport = {
      login: vi.fn(),
      refresh: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
    }
    const devices: DeviceRegistrationService = {
      ensureRegistered: vi.fn(),
    }

    const runtime = new AuthSessionRuntime({
      transport,
      store,
      devices,
      now: () => 1_500,
    })

    await runtime.logout(session)

    expect(transport.logout).toHaveBeenCalledWith(session)
    await expect(store.load()).resolves.toBeNull()
  })
})
