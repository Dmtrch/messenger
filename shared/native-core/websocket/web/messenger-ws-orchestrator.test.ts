import { describe, expect, it, vi } from 'vitest'

import type { RealtimeChat, RealtimeMessage } from './ws-model-types'
import type { WSFrame, WSSendFrame } from './ws-frame-types'

const {
  createMessengerWSOrchestrator,
} = await import('./messenger-ws-orchestrator')

describe('messenger ws orchestrator', () => {
  it('расшифровывает incoming message и добавляет его в store + persistence', async () => {
    const addMessage = vi.fn()
    const appendMessages = vi.fn().mockResolvedValue(undefined)

    const orchestrator = createMessengerWSOrchestrator({
      currentUserId: 'me',
      getKnownChat: vi.fn().mockReturnValue({
        id: 'chat-1',
        type: 'direct',
      } satisfies Partial<RealtimeChat>),
      getMessagesForChat: vi.fn().mockReturnValue([]),
      getCallFrameHandler: vi.fn().mockReturnValue(null),
      addMessage,
      appendMessages,
      updateMessageStatus: vi.fn(),
      setTyping: vi.fn(),
      upsertChat: vi.fn(),
      deleteMessage: vi.fn(),
      editMessage: vi.fn(),
      markRead: vi.fn(),
      setSend: vi.fn(),
      logout: vi.fn(),
      clearAccessToken: vi.fn(),
      decryptMessage: vi.fn().mockResolvedValue('hello-runtime'),
      decryptGroupMessage: vi.fn(),
      handleIncomingSKDM: vi.fn(),
      tryDecryptPreview: vi.fn(),
      getChats: vi.fn(),
      uploadPreKeys: vi.fn(),
      appendOneTimePreKeys: vi.fn(),
      savePreKeyReplenishTime: vi.fn(),
      isPreKeyReplenishOnCooldown: vi.fn().mockResolvedValue(false),
      generateDHKeyPair: vi.fn(),
      toBase64: vi.fn(),
      schedule: vi.fn(),
    })

    await orchestrator.onFrame({
      type: 'message',
      messageId: 'msg-1',
      chatId: 'chat-1',
      senderId: 'alice',
      senderDeviceId: 'dev-1',
      ciphertext: btoa(JSON.stringify({ msg: { ciphertext: 'x', header: { dhPublic: 'a', n: 0, pn: 0 } } })),
      senderKeyId: 0,
      timestamp: 1,
    } satisfies WSFrame)

    expect(addMessage).toHaveBeenCalledTimes(1)
    const message = addMessage.mock.calls[0][0] as RealtimeMessage
    expect(message.text).toBe('hello-runtime')
    expect(message.status).toBe('delivered')
    expect(appendMessages).toHaveBeenCalledWith('chat-1', [expect.objectContaining({ id: 'msg-1' })])
  })

  it('при prekey_low вызывает replenish и upload новых ключей', async () => {
    const uploadPreKeys = vi.fn().mockResolvedValue(undefined)
    const savePreKeyReplenishTime = vi.fn().mockResolvedValue(undefined)

    const orchestrator = createMessengerWSOrchestrator({
      currentUserId: 'me',
      getKnownChat: vi.fn().mockReturnValue(null),
      getMessagesForChat: vi.fn().mockReturnValue([]),
      getCallFrameHandler: vi.fn().mockReturnValue(null),
      addMessage: vi.fn(),
      appendMessages: vi.fn(),
      updateMessageStatus: vi.fn(),
      setTyping: vi.fn(),
      upsertChat: vi.fn(),
      deleteMessage: vi.fn(),
      editMessage: vi.fn(),
      markRead: vi.fn(),
      setSend: vi.fn(),
      logout: vi.fn(),
      clearAccessToken: vi.fn(),
      decryptMessage: vi.fn(),
      decryptGroupMessage: vi.fn(),
      handleIncomingSKDM: vi.fn(),
      tryDecryptPreview: vi.fn(),
      getChats: vi.fn(),
      uploadPreKeys,
      appendOneTimePreKeys: vi.fn().mockResolvedValue([
        { id: 1, publicKey: new Uint8Array([1]) },
        { id: 2, publicKey: new Uint8Array([2]) },
      ]),
      savePreKeyReplenishTime,
      isPreKeyReplenishOnCooldown: vi.fn().mockResolvedValue(false),
      generateDHKeyPair: vi.fn()
        .mockReturnValueOnce({ id: 0, publicKey: new Uint8Array([1]) })
        .mockReturnValueOnce({ id: 0, publicKey: new Uint8Array([2]) }),
      toBase64: vi.fn((value: Uint8Array) => String(value[0])),
      schedule: vi.fn(),
    })

    await orchestrator.onFrame({ type: 'prekey_low', count: 3 } satisfies WSFrame)
    await Promise.resolve()
    await Promise.resolve()

    expect(uploadPreKeys).toHaveBeenCalledWith([
      { id: 1, key: '1' },
      { id: 2, key: '2' },
    ])
    expect(savePreKeyReplenishTime).toHaveBeenCalled()
  })

  it('onConnect/onDisconnect/onAuthFail управляют send/logout side effects', () => {
    const setSend = vi.fn()
    const logout = vi.fn()
    const clearAccessToken = vi.fn()

    const orchestrator = createMessengerWSOrchestrator({
      currentUserId: 'me',
      getKnownChat: vi.fn().mockReturnValue(null),
      getMessagesForChat: vi.fn().mockReturnValue([]),
      getCallFrameHandler: vi.fn().mockReturnValue(null),
      addMessage: vi.fn(),
      appendMessages: vi.fn(),
      updateMessageStatus: vi.fn(),
      setTyping: vi.fn(),
      upsertChat: vi.fn(),
      deleteMessage: vi.fn(),
      editMessage: vi.fn(),
      markRead: vi.fn(),
      setSend,
      logout,
      clearAccessToken,
      decryptMessage: vi.fn(),
      decryptGroupMessage: vi.fn(),
      handleIncomingSKDM: vi.fn(),
      tryDecryptPreview: vi.fn(),
      getChats: vi.fn(),
      uploadPreKeys: vi.fn(),
      appendOneTimePreKeys: vi.fn(),
      savePreKeyReplenishTime: vi.fn(),
      isPreKeyReplenishOnCooldown: vi.fn().mockResolvedValue(false),
      generateDHKeyPair: vi.fn(),
      toBase64: vi.fn(),
      schedule: vi.fn(),
    })

    const send = vi.fn<(_: WSSendFrame) => boolean>().mockReturnValue(true)

    orchestrator.onConnect(send)
    expect(setSend).toHaveBeenCalledWith(send)

    orchestrator.onDisconnect()
    expect(setSend).toHaveBeenLastCalledWith(null)

    orchestrator.onAuthFail()
    expect(clearAccessToken).toHaveBeenCalled()
    expect(logout).toHaveBeenCalled()
    expect(setSend).toHaveBeenLastCalledWith(null)
  })
})
