import {
  type InMemoryMessageRepository,
  type OutboxEntry,
} from '../messages/message-repository'

export interface SyncSessionValidator {
  ensureValidSession(): Promise<boolean>
}

export interface SyncDispatcher {
  syncServerState(): Promise<void>
  sendOutboxEntry(entry: OutboxEntry): Promise<{ kind: 'sent' | 'permanent_failure' }>
}

export interface SyncEngineOptions {
  repository: InMemoryMessageRepository
  validator: SyncSessionValidator
  dispatcher: SyncDispatcher
  now?: () => number
}

export class SyncEngine {
  private readonly now: () => number

  constructor(private readonly options: SyncEngineOptions) {
    this.now = options.now ?? (() => Date.now())
  }

  async reconcileAfterReconnect(): Promise<void> {
    const valid = await this.options.validator.ensureValidSession()
    if (!valid) return

    await this.options.dispatcher.syncServerState()

    const pendingEntries = await this.options.repository.getPendingOutbox()
    for (const entry of pendingEntries) {
      const result = await this.options.dispatcher.sendOutboxEntry(entry)
      if (result.kind === 'sent') {
        await this.options.repository.removeOutboxEntry(entry.clientMsgId)
        continue
      }

      await this.options.repository.updateOutboxAttempt(
        entry.clientMsgId,
        this.now(),
        'failed',
      )
    }
  }
}
