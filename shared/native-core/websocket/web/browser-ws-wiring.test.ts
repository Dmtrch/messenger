import { describe, expect, it, vi } from 'vitest'
import type { BrowserApiClient } from '../../api/web/browser-api-client'
import type { BrowserWSBindings } from './browser-ws-wiring'
import { createBrowserWSWiring } from './browser-ws-wiring'

function makeApiClient(overrides: Partial<{ getChats: ReturnType<typeof vi.fn>; uploadPreKeys: ReturnType<typeof vi.fn> }> = {}): BrowserApiClient {
  return {
    api: {
      getChats: overrides.getChats ?? vi.fn().mockResolvedValue({ chats: [] }),
      uploadPreKeys: overrides.uploadPreKeys ?? vi.fn().mockResolvedValue(undefined),
    } as unknown as BrowserApiClient['api'],
    setAccessToken: vi.fn(),
  }
}

function makeBindings(overrides: Partial<BrowserWSBindings> = {}): BrowserWSBindings {
  return {
    token: 'test-token',
    isAuthenticated: true,
    currentUserId: 'user-1',
    logout: vi.fn(),
    getCallFrameHandler: vi.fn().mockReturnValue(null),
    addMessage: vi.fn(),
    appendMessages: vi.fn().mockResolvedValue(undefined),
    updateMessageStatus: vi.fn(),
    setTyping: vi.fn(),
    upsertChat: vi.fn(),
    deleteMessage: vi.fn(),
    editMessage: vi.fn(),
    markRead: vi.fn(),
    getKnownChat: vi.fn().mockReturnValue(null),
    getMessagesForChat: vi.fn().mockReturnValue([]),
    setSend: vi.fn(),
    decryptMessage: vi.fn().mockResolvedValue(''),
    decryptGroupMessage: vi.fn().mockResolvedValue(''),
    handleIncomingSKDM: vi.fn().mockResolvedValue(undefined),
    tryDecryptPreview: vi.fn().mockResolvedValue(''),
    appendOneTimePreKeys: vi.fn().mockResolvedValue([]),
    savePreKeyReplenishTime: vi.fn().mockResolvedValue(undefined),
    isPreKeyReplenishOnCooldown: vi.fn().mockResolvedValue(false),
    generateDHKeyPair: vi.fn().mockReturnValue({ publicKey: new Uint8Array(32) }),
    toBase64: vi.fn().mockReturnValue('base64'),
    ...overrides,
  }
}

describe('createBrowserWSWiring', () => {
  it('вызывает setAccessToken с token из bindings при создании', () => {
    const client = makeApiClient()
    createBrowserWSWiring(client, makeBindings({ token: 'tok-abc' }))
    expect(client.setAccessToken).toHaveBeenCalledWith('tok-abc')
  })

  it('clearAccessToken вызывает setAccessToken(null)', () => {
    const client = makeApiClient()
    const wiring = createBrowserWSWiring(client, makeBindings())
    wiring.clearAccessToken()
    expect(client.setAccessToken).toHaveBeenCalledWith(null)
  })

  it('getChats вызывает api.getChats и преобразует ChatSummary → RealtimeChat', async () => {
    const chatSummary = {
      id: 'c1',
      type: 'direct' as const,
      name: 'Test',
      members: ['u1', 'u2'],
      unreadCount: 0,
      updatedAt: 1000,
    }
    const client = makeApiClient({
      getChats: vi.fn().mockResolvedValue({ chats: [chatSummary] }),
    })
    const wiring = createBrowserWSWiring(client, makeBindings())
    const result = await wiring.getChats()
    expect(result.chats).toHaveLength(1)
    expect(result.chats[0].id).toBe('c1')
    expect(result.chats[0].type).toBe('direct')
  })

  it('uploadPreKeys делегирует api.uploadPreKeys', async () => {
    const uploadMock = vi.fn().mockResolvedValue(undefined)
    const client = makeApiClient({ uploadPreKeys: uploadMock })
    const wiring = createBrowserWSWiring(client, makeBindings())
    const keys = [{ id: 1, key: 'abc' }]
    await wiring.uploadPreKeys(keys)
    expect(uploadMock).toHaveBeenCalledWith(keys)
  })

  it('поля из bindings передаются без изменений', () => {
    const addMsg = vi.fn()
    const client = makeApiClient()
    const wiring = createBrowserWSWiring(client, makeBindings({ addMessage: addMsg }))
    expect(wiring.addMessage).toBe(addMsg)
  })

  it('schedule вызывает setTimeout с правильным delay', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const client = makeApiClient()
    const wiring = createBrowserWSWiring(client, makeBindings())
    const run = vi.fn()
    wiring.schedule(500, run)
    expect(setTimeoutSpy).toHaveBeenCalledWith(run, 500)
    setTimeoutSpy.mockRestore()
  })
})
