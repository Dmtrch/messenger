export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
export type MessageKind = 'text' | 'image' | 'file' | 'system'
export type PageDirection = 'initial' | 'older' | 'newer'
export type OutboxStatus = 'pending' | 'failed'

export interface MessageRecord {
  id: string
  clientMsgId?: string
  chatId: string
  senderId: string
  senderDeviceId?: string
  encryptedPayload: string
  senderKeyId: number
  timestamp: number
  status: MessageStatus
  kind: MessageKind
  isEdited?: boolean
}

export interface MessagePage {
  chatId: string
  messages: MessageRecord[]
  nextCursor?: string
}

export interface OutboxRecipient {
  userId: string
  deviceId?: string
  ciphertext: string
}

export interface OutboxEntry {
  clientMsgId: string
  chatId: string
  encryptedPayload: string
  recipients: OutboxRecipient[]
  createdAt: number
  retryCount: number
  lastAttemptAt: number | null
  status: OutboxStatus
  kind: MessageKind
  senderKeyId: number
}

interface ChatState {
  messages: MessageRecord[]
  nextCursor?: string
}

export class InMemoryMessageRepository {
  private readonly chats = new Map<string, ChatState>()
  private readonly outbox = new Map<string, OutboxEntry>()

  async saveMessagePage(chatId: string, page: MessagePage, direction: PageDirection): Promise<void> {
    const current = this.chats.get(chatId) ?? { messages: [], nextCursor: undefined }
    const mergedMessages = this.mergeMessages(current.messages, page.messages, direction)
    this.chats.set(chatId, {
      messages: mergedMessages,
      nextCursor: page.nextCursor,
    })
  }

  async getMessagePage(chatId: string, _cursor?: string, limit?: number): Promise<MessagePage> {
    const current = this.chats.get(chatId) ?? { messages: [], nextCursor: undefined }
    const messages = typeof limit === 'number'
      ? current.messages.slice(-limit)
      : [...current.messages]

    return {
      chatId,
      messages,
      nextCursor: current.nextCursor,
    }
  }

  async saveOutgoing(entry: OutboxEntry): Promise<void> {
    if (this.outbox.has(entry.clientMsgId)) return
    this.outbox.set(entry.clientMsgId, { ...entry })
  }

  async getPendingOutbox(): Promise<OutboxEntry[]> {
    return [...this.outbox.values()].sort((left, right) => left.createdAt - right.createdAt)
  }

  async removeOutboxEntry(clientMsgId: string): Promise<void> {
    this.outbox.delete(clientMsgId)
  }

  async updateOutboxAttempt(clientMsgId: string, attemptedAt: number, status: OutboxStatus): Promise<void> {
    const entry = this.outbox.get(clientMsgId)
    if (!entry) return

    this.outbox.set(clientMsgId, {
      ...entry,
      status,
      retryCount: entry.retryCount + 1,
      lastAttemptAt: attemptedAt,
    })
  }

  async updateMessageStatus(chatId: string, messageId: string, status: MessageStatus): Promise<void> {
    const current = this.chats.get(chatId)
    if (current) {
      current.messages = current.messages.map((message) =>
        message.id === messageId || message.clientMsgId === messageId
          ? { ...message, status }
          : message,
      )
      this.chats.set(chatId, current)
    }

    const outboxEntry = this.outbox.get(messageId)
    if (outboxEntry) {
      this.outbox.set(messageId, {
        ...outboxEntry,
        status: status === 'failed' ? 'failed' : outboxEntry.status,
        retryCount: status === 'failed' ? outboxEntry.retryCount + 1 : outboxEntry.retryCount,
      })
    }
  }

  async markRead(chatId: string, messageId: string, _userId: string, _readAt: number): Promise<void> {
    await this.updateMessageStatus(chatId, messageId, 'read')
  }

  async nextCursor(chatId: string): Promise<string | null> {
    return this.chats.get(chatId)?.nextCursor ?? null
  }

  private mergeMessages(
    existing: MessageRecord[],
    incoming: MessageRecord[],
    direction: PageDirection,
  ): MessageRecord[] {
    if (direction === 'initial') {
      return this.deduplicateAndSort(incoming)
    }

    if (direction === 'older') {
      return this.deduplicateAndSort([...incoming, ...existing])
    }

    return this.deduplicateAndSort([...existing, ...incoming])
  }

  private deduplicateAndSort(messages: MessageRecord[]): MessageRecord[] {
    const unique = new Map<string, MessageRecord>()
    for (const message of messages) {
      unique.set(message.id, message)
    }

    return [...unique.values()].sort((left, right) => left.timestamp - right.timestamp)
  }
}
