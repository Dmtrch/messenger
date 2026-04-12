import { describe, expect, it } from 'vitest'

import {
  InMemoryMessageRepository,
  type MessageRecord,
  type MessagePage,
  type OutboxEntry,
} from './message-repository'

function makeMessage(overrides: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id: 'message-1',
    chatId: 'chat-1',
    senderId: 'user-1',
    encryptedPayload: 'ciphertext',
    senderKeyId: 1,
    timestamp: 1_000,
    status: 'sent',
    kind: 'text',
    ...overrides,
  }
}

function makeOutboxEntry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    clientMsgId: 'client-1',
    chatId: 'chat-1',
    encryptedPayload: 'ciphertext',
    recipients: [{ userId: 'user-2', deviceId: 'device-2', ciphertext: 'ciphertext' }],
    createdAt: 1_000,
    retryCount: 0,
    lastAttemptAt: null,
    status: 'pending',
    kind: 'text',
    senderKeyId: 1,
    ...overrides,
  }
}

describe('InMemoryMessageRepository', () => {
  it('сохраняет первую страницу и возвращает nextCursor', async () => {
    const repository = new InMemoryMessageRepository()
    const page: MessagePage = {
      chatId: 'chat-1',
      messages: [
        makeMessage({ id: 'message-2', timestamp: 2_000 }),
        makeMessage({ id: 'message-3', timestamp: 3_000 }),
      ],
      nextCursor: 'cursor-1',
    }

    await repository.saveMessagePage('chat-1', page, 'initial')

    const stored = await repository.getMessagePage('chat-1')
    expect(stored.messages.map((message) => message.id)).toEqual(['message-2', 'message-3'])
    expect(await repository.nextCursor('chat-1')).toBe('cursor-1')
  })

  it('при сохранении older page делает merge без дублей и сохраняет хронологический порядок', async () => {
    const repository = new InMemoryMessageRepository()

    await repository.saveMessagePage('chat-1', {
      chatId: 'chat-1',
      messages: [
        makeMessage({ id: 'message-2', timestamp: 2_000 }),
        makeMessage({ id: 'message-3', timestamp: 3_000 }),
      ],
      nextCursor: 'cursor-1',
    }, 'initial')

    await repository.saveMessagePage('chat-1', {
      chatId: 'chat-1',
      messages: [
        makeMessage({ id: 'message-1', timestamp: 1_000 }),
        makeMessage({ id: 'message-2', timestamp: 2_000 }),
      ],
      nextCursor: 'cursor-0',
    }, 'older')

    const stored = await repository.getMessagePage('chat-1')
    expect(stored.messages.map((message) => message.id)).toEqual([
      'message-1',
      'message-2',
      'message-3',
    ])
    expect(await repository.nextCursor('chat-1')).toBe('cursor-0')
  })

  it('сохраняет outbox entry и обновляет статус сообщения по clientMsgId', async () => {
    const repository = new InMemoryMessageRepository()

    await repository.saveOutgoing(makeOutboxEntry())
    await repository.updateMessageStatus('chat-1', 'client-1', 'failed')

    const outbox = await repository.getPendingOutbox()
    expect(outbox).toHaveLength(1)
    expect(outbox[0]?.status).toBe('failed')
    expect(outbox[0]?.retryCount).toBe(1)
  })

  it('markRead обновляет статус сообщения до read', async () => {
    const repository = new InMemoryMessageRepository()

    await repository.saveMessagePage('chat-1', {
      chatId: 'chat-1',
      messages: [makeMessage({ id: 'message-1', status: 'delivered' })],
      nextCursor: undefined,
    }, 'initial')

    await repository.markRead('chat-1', 'message-1', 'user-2', 2_000)

    const stored = await repository.getMessagePage('chat-1')
    expect(stored.messages[0]?.status).toBe('read')
  })
})
