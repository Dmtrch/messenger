import { afterEach, describe, expect, it, vi } from 'vitest'

const store = new Map<string, unknown>()

vi.mock('../../../../client/node_modules/idb-keyval/dist/index.js', () => ({
  createStore: vi.fn(() => ({ name: 'mock-store' })),
  get: vi.fn(async (key: string) => store.get(key)),
  set: vi.fn(async (key: string, value: unknown) => {
    store.set(key, value)
  }),
  del: vi.fn(async (key: string) => {
    store.delete(key)
  }),
}))

const {
  createBrowserCryptoStore,
} = await import('./browser-keystore')

afterEach(() => {
  store.clear()
})

describe('browser-keystore', () => {
  it('создаёт browser crypto store и сохраняет identity/session state', async () => {
    const keystore = createBrowserCryptoStore()

    await keystore.saveIdentityKey({
      publicKey: new Uint8Array([1, 2, 3]),
      privateKey: new Uint8Array([4, 5, 6]),
    })
    await keystore.saveRatchetSession({
      chatId: 'peer-1:device-1',
      state: new Uint8Array([7, 8, 9]),
      updatedAt: 1,
    })

    expect(await keystore.loadIdentityKey()).toEqual({
      publicKey: new Uint8Array([1, 2, 3]),
      privateKey: new Uint8Array([4, 5, 6]),
    })
    expect(await keystore.loadRatchetSession('peer-1:device-1')).toEqual({
      chatId: 'peer-1:device-1',
      state: new Uint8Array([7, 8, 9]),
      updatedAt: 1,
    })
  })
})
