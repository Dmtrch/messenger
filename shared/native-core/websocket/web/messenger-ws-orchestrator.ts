import type { CallWSFrame } from '../../calls/web/call-ws-types'
import type { RealtimeChat, RealtimeMessage } from './ws-model-types'
import type { WSFrame, WSSendFrame } from './ws-frame-types'

export interface MessengerWSOrchestratorDeps {
  currentUserId?: string
  getKnownChat(chatId: string): RealtimeChat | null
  getMessagesForChat(chatId: string): RealtimeMessage[]
  getCallFrameHandler(): ((frame: CallWSFrame) => void) | null
  addMessage(msg: RealtimeMessage, currentUserId?: string): void
  appendMessages(chatId: string, messages: RealtimeMessage[]): Promise<void>
  updateMessageStatus(chatId: string, msgId: string, status: RealtimeMessage['status']): void
  setTyping(chatId: string, userId: string, isTyping: boolean): void
  upsertChat(chat: RealtimeChat): void
  deleteMessage(chatId: string, msgId: string): void
  editMessage(chatId: string, clientMsgId: string, newText: string): void
  markRead(chatId: string): void
  setPresence(userId: string, online: boolean): void
  setSend(fn: ((frame: WSSendFrame) => boolean) | null): void
  logout(): void
  clearAccessToken(): void
  decryptMessage(senderId: string, senderDeviceId: string, encodedPayload: string): Promise<string>
  decryptGroupMessage(chatId: string, senderId: string, encodedPayload: string): Promise<string>
  handleIncomingSKDM(chatId: string, senderId: string, senderDeviceId: string, encodedSkdm: string): Promise<void>
  tryDecryptPreview(chatType: 'direct' | 'group', chatId: string, senderId: string, senderDeviceId: string, encryptedPayload: string): Promise<string>
  getChats(): Promise<{ chats: RealtimeChat[] }>
  uploadPreKeys(keys: Array<{ id: number; key: string }>): Promise<void>
  appendOneTimePreKeys(
    newKeys: Array<{ id?: number; publicKey: Uint8Array; privateKey?: Uint8Array }>,
  ): Promise<Array<{ id: number; publicKey: Uint8Array }>>
  savePreKeyReplenishTime(): Promise<void>
  isPreKeyReplenishOnCooldown(minIntervalMs: number): Promise<boolean>
  generateDHKeyPair(): { id?: number; publicKey: Uint8Array; privateKey?: Uint8Array }
  toBase64(data: Uint8Array): string
  schedule(delayMs: number, run: () => void): unknown
}

const PREKEY_REPLENISH_COOLDOWN_MS = 5 * 60 * 1000

function parsePayload(raw: string): Pick<RealtimeMessage, 'text' | 'mediaId' | 'mediaKey' | 'originalName' | 'type'> {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    if (obj && typeof obj.mediaId === 'string') {
      return {
        type: (obj.mediaType as RealtimeMessage['type']) ?? 'file',
        mediaId: obj.mediaId,
        mediaKey: typeof obj.mediaKey === 'string' ? obj.mediaKey : undefined,
        originalName: typeof obj.originalName === 'string' ? obj.originalName : undefined,
        text: typeof obj.text === 'string' ? obj.text : undefined,
      }
    }
  } catch {
    // plain text payload
  }
  return { type: 'text', text: raw }
}

async function replenishPreKeys(deps: MessengerWSOrchestratorDeps): Promise<void> {
  if (await deps.isPreKeyReplenishOnCooldown(PREKEY_REPLENISH_COOLDOWN_MS)) return
  const rawKeys = Array.from({ length: 20 }, () => deps.generateDHKeyPair())
  const saved = await deps.appendOneTimePreKeys(rawKeys)
  await deps.uploadPreKeys(saved.map((key) => ({
    id: key.id,
    key: deps.toBase64(key.publicKey),
  })))
  await deps.savePreKeyReplenishTime()
}

export function createMessengerWSOrchestrator(deps: MessengerWSOrchestratorDeps) {
  return {
    async onFrame(frame: WSFrame): Promise<void> {
      switch (frame.type) {
        case 'message': {
          const { messageId, chatId, senderId, senderDeviceId, ciphertext, senderKeyId, timestamp, clientMsgId, replyToId } = frame
          const knownChat = deps.getKnownChat(chatId)
          if (!knownChat) {
            deps.getChats().then(async (response) => {
              for (const chat of response.chats) {
                const raw = chat as RealtimeChat
                const lastMessage = raw.lastMessage
                const resolved = lastMessage?.encryptedPayload && lastMessage.senderId
                  ? {
                      ...raw,
                      lastMessage: {
                        ...lastMessage,
                        text: await deps.tryDecryptPreview(raw.type, raw.id, lastMessage.senderId, '', lastMessage.encryptedPayload),
                      },
                    }
                  : raw
                deps.upsertChat(resolved)
              }
            }).catch(() => {})
          }

          const existing = deps.getMessagesForChat(chatId).find(
            (message) => message.id === messageId || (clientMsgId && message.id === clientMsgId),
          )
          if (existing) break

          const isGroupPayload = (() => {
            try {
              return JSON.parse(atob(ciphertext))?.type === 'group'
            } catch {
              return false
            }
          })()

          try {
            const raw = isGroupPayload
              ? await deps.decryptGroupMessage(chatId, senderId, ciphertext)
              : await deps.decryptMessage(senderId, senderDeviceId ?? '', ciphertext)
            const parsed = parsePayload(raw)
            const message: RealtimeMessage = {
              id: messageId,
              clientMsgId,
              replyToId,
              chatId,
              senderId,
              encryptedPayload: ciphertext,
              senderKeyId,
              timestamp,
              status: 'delivered',
              ...parsed,
            }
            deps.addMessage(message, deps.currentUserId)
            void deps.appendMessages(chatId, [message]).catch(() => {})
          } catch {
            deps.addMessage({
              id: messageId,
              clientMsgId,
              replyToId,
              chatId,
              senderId,
              encryptedPayload: ciphertext,
              senderKeyId: senderKeyId ?? 0,
              timestamp,
              status: 'delivered',
              type: 'text',
              text: '[зашифровано]',
            }, deps.currentUserId)
          }
          break
        }

        case 'message_deleted':
          deps.deleteMessage(frame.chatId, frame.clientMsgId)
          break

        case 'message_edited': {
          const target = deps.getMessagesForChat(frame.chatId).find(
            (message) => message.id === frame.clientMsgId || message.clientMsgId === frame.clientMsgId,
          )
          if (!target) break
          deps.decryptMessage(target.senderId, '', frame.ciphertext)
            .then((text) => deps.editMessage(frame.chatId, frame.clientMsgId, text))
            .catch(() => deps.editMessage(frame.chatId, frame.clientMsgId, '[зашифровано]'))
          break
        }

        case 'ack':
          deps.updateMessageStatus(frame.chatId ?? '', frame.clientMsgId, 'sent')
          break

        case 'typing':
          deps.setTyping(frame.chatId, frame.userId, true)
          deps.schedule(4000, () => deps.setTyping(frame.chatId, frame.userId, false))
          break

        case 'presence':
          deps.setPresence(frame.userId, frame.status === 'online')
          break

        case 'skdm':
          void deps.handleIncomingSKDM(frame.chatId, frame.senderId, '', frame.ciphertext).catch(() => {})
          break

        case 'prekey_request':
          break

        case 'prekey_low':
          void replenishPreKeys(deps).catch(() => {})
          break

        case 'read':
          deps.updateMessageStatus(frame.chatId, frame.messageId, 'read')
          if (frame.userId === deps.currentUserId) {
            deps.markRead(frame.chatId)
          }
          break

        case 'call_offer':
        case 'call_answer':
        case 'call_end':
        case 'call_reject':
        case 'call_busy':
        case 'ice_candidate': {
          const handler = deps.getCallFrameHandler()
          if (handler) handler(frame)
          break
        }
      }
    },

    onConnect(send: (frame: WSSendFrame) => boolean): void {
      deps.setSend(send)
    },

    onDisconnect(): void {
      deps.setSend(null)
    },

    onAuthFail(): void {
      deps.clearAccessToken()
      deps.setSend(null)
      deps.logout()
    },
  }
}
