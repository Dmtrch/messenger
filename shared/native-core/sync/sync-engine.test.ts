import { describe, expect, it, vi } from 'vitest'

import {
  SyncEngine,
  type SyncDispatcher,
  type SyncSessionValidator,
} from './sync-engine'
import {
  InMemoryMessageRepository,
  type OutboxEntry,
} from '../messages/message-repository'

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

describe('SyncEngine', () => {
  it('после reconnect повторно отправляет pending outbox entries и удаляет успешные', async () => {
    const repository = new InMemoryMessageRepository()
    await repository.saveOutgoing(makeOutboxEntry({ clientMsgId: 'client-1' }))
    await repository.saveOutgoing(makeOutboxEntry({ clientMsgId: 'client-2' }))

    const validator: SyncSessionValidator = {
      ensureValidSession: vi.fn().mockResolvedValue(true),
    }
    const dispatcher: SyncDispatcher = {
      sendOutboxEntry: vi.fn().mockResolvedValue({ kind: 'sent' }),
      syncServerState: vi.fn().mockResolvedValue(undefined),
    }

    const engine = new SyncEngine({
      repository,
      validator,
      dispatcher,
      now: () => 5_000,
    })

    await engine.reconcileAfterReconnect()

    expect(validator.ensureValidSession).toHaveBeenCalled()
    expect(dispatcher.syncServerState).toHaveBeenCalled()
    expect(dispatcher.sendOutboxEntry).toHaveBeenCalledTimes(2)
    expect(await repository.getPendingOutbox()).toHaveLength(0)
  })

  it('если отправка завершается permanent_failure, оставляет entry в outbox как failed', async () => {
    const repository = new InMemoryMessageRepository()
    await repository.saveOutgoing(makeOutboxEntry())

    const validator: SyncSessionValidator = {
      ensureValidSession: vi.fn().mockResolvedValue(true),
    }
    const dispatcher: SyncDispatcher = {
      sendOutboxEntry: vi.fn().mockResolvedValue({ kind: 'permanent_failure' }),
      syncServerState: vi.fn().mockResolvedValue(undefined),
    }

    const engine = new SyncEngine({
      repository,
      validator,
      dispatcher,
      now: () => 5_000,
    })

    await engine.reconcileAfterReconnect()

    const outbox = await repository.getPendingOutbox()
    expect(outbox).toHaveLength(1)
    expect(outbox[0]?.status).toBe('failed')
    expect(outbox[0]?.lastAttemptAt).toBe(5_000)
  })

  it('если сессия невалидна, не начинает resend outbox', async () => {
    const repository = new InMemoryMessageRepository()
    await repository.saveOutgoing(makeOutboxEntry())

    const validator: SyncSessionValidator = {
      ensureValidSession: vi.fn().mockResolvedValue(false),
    }
    const dispatcher: SyncDispatcher = {
      sendOutboxEntry: vi.fn(),
      syncServerState: vi.fn(),
    }

    const engine = new SyncEngine({
      repository,
      validator,
      dispatcher,
      now: () => 5_000,
    })

    await engine.reconcileAfterReconnect()

    expect(dispatcher.syncServerState).not.toHaveBeenCalled()
    expect(dispatcher.sendOutboxEntry).not.toHaveBeenCalled()
    expect(await repository.getPendingOutbox()).toHaveLength(1)
  })
})
