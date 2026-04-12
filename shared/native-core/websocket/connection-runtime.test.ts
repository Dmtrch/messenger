import { describe, expect, it, vi } from 'vitest'

import {
  WSConnectionRuntime,
  type ReconnectScheduler,
  type WSAuthSessionProvider,
  type WSConnectionAdapter,
} from './connection-runtime'

function createAdapter(): WSConnectionAdapter {
  return {
    open: vi.fn(),
    close: vi.fn(),
    send: vi.fn(),
  }
}

function createScheduler() {
  const tasks: Array<{ delayMs: number; run: () => void }> = []

  const scheduler: ReconnectScheduler = {
    schedule(delayMs, run) {
      tasks.push({ delayMs, run })
      return {
        cancel: vi.fn(),
      }
    },
  }

  return { scheduler, tasks }
}

describe('WSConnectionRuntime', () => {
  it('перед connect открывает transport c accessToken и deviceId и переводит state в connecting', async () => {
    const adapter = createAdapter()
    const auth: WSAuthSessionProvider = {
      getSession: vi.fn().mockResolvedValue({
        accessToken: 'token-1',
        deviceId: 'device-1',
      }),
      handleAuthFailure: vi.fn(),
    }
    const { scheduler } = createScheduler()

    const runtime = new WSConnectionRuntime({
      adapter,
      auth,
      scheduler,
      reconnect: { initialDelayMs: 1_000, maxDelayMs: 8_000 },
    })

    await runtime.connect()

    expect(runtime.currentState()).toBe('connecting')
    expect(adapter.open).toHaveBeenCalledWith({
      accessToken: 'token-1',
      deviceId: 'device-1',
    })
  })

  it('после recoverable close планирует reconnect с экспоненциальным backoff', async () => {
    const adapter = createAdapter()
    const auth: WSAuthSessionProvider = {
      getSession: vi.fn().mockResolvedValue({
        accessToken: 'token-1',
        deviceId: 'device-1',
      }),
      handleAuthFailure: vi.fn(),
    }
    const { scheduler, tasks } = createScheduler()

    const runtime = new WSConnectionRuntime({
      adapter,
      auth,
      scheduler,
      reconnect: { initialDelayMs: 1_000, maxDelayMs: 4_000 },
    })

    await runtime.connect()
    runtime.markConnected()
    runtime.handleClose({ kind: 'recoverable', reason: 'network_lost' })

    expect(runtime.currentState()).toBe('reconnecting')
    expect(tasks[0]?.delayMs).toBe(1_000)

    await tasks[0]?.run()
    expect(adapter.open).toHaveBeenCalledTimes(2)

    runtime.markConnected()
    runtime.handleClose({ kind: 'recoverable', reason: 'network_lost' })

    expect(tasks[1]?.delayMs).toBe(2_000)
  })

  it('при auth failure не планирует reconnect и делегирует recovery в auth provider', async () => {
    const adapter = createAdapter()
    const auth: WSAuthSessionProvider = {
      getSession: vi.fn().mockResolvedValue({
        accessToken: 'token-1',
        deviceId: 'device-1',
      }),
      handleAuthFailure: vi.fn().mockResolvedValue(undefined),
    }
    const { scheduler, tasks } = createScheduler()

    const runtime = new WSConnectionRuntime({
      adapter,
      auth,
      scheduler,
      reconnect: { initialDelayMs: 1_000, maxDelayMs: 4_000 },
    })

    await runtime.connect()
    runtime.markConnected()
    await runtime.handleClose({ kind: 'auth_failed', reason: 'token_expired' })

    expect(runtime.currentState()).toBe('auth_failed')
    expect(auth.handleAuthFailure).toHaveBeenCalledWith({
      accessToken: 'token-1',
      deviceId: 'device-1',
    })
    expect(tasks).toHaveLength(0)
  })
})
