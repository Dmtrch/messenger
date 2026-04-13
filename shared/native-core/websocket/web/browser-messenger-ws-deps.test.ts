import { describe, expect, it, vi } from 'vitest'

import type { ChatSummary } from '../../api/web/browser-api-client'

const {
  mapChatSummariesToRealtimeChats,
  scheduleBrowserRealtimeTask,
} = await import('./browser-messenger-ws-deps')

describe('browser messenger ws deps', () => {
  it('mapChatSummariesToRealtimeChats приводит browser api chats к shared realtime model', () => {
    const chats = mapChatSummariesToRealtimeChats([
      {
        id: 'chat-1',
        type: 'direct',
        name: 'Alice',
        avatarPath: '/a.png',
        members: ['me', 'alice'],
        unreadCount: 2,
        updatedAt: 123,
        lastMessage: {
          id: 'msg-1',
          senderId: 'alice',
          encryptedPayload: 'ciphertext',
          timestamp: 120,
        },
      },
      {
        id: 'chat-2',
        type: 'group',
        name: 'Team',
        members: ['me', 'alice', 'bob'],
        unreadCount: 0,
        updatedAt: 200,
      },
    ] satisfies ChatSummary[])

    expect(chats).toEqual([
      expect.objectContaining({
        id: 'chat-1',
        type: 'direct',
        name: 'Alice',
        unreadCount: 2,
        lastMessage: expect.objectContaining({
          id: 'msg-1',
          chatId: 'chat-1',
          senderId: 'alice',
          encryptedPayload: 'ciphertext',
          status: 'delivered',
          type: 'text',
        }),
      }),
      expect.objectContaining({
        id: 'chat-2',
        type: 'group',
        name: 'Team',
        unreadCount: 0,
        lastMessage: undefined,
      }),
    ])
  })

  it('scheduleBrowserRealtimeTask использует переданный browser timer', () => {
    const setTimeoutMock = vi.fn((_run: () => void, _delayMs: number) => 42)

    const task = scheduleBrowserRealtimeTask(setTimeoutMock, 1500, vi.fn())

    expect(setTimeoutMock).toHaveBeenCalledTimes(1)
    expect(task).toBe(42)
  })
})
