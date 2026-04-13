import type { ChatSummary } from '../../api/web/browser-api-client'
import type { RealtimeChat, RealtimeMessage } from './ws-model-types'

function mapLastMessage(chatId: string, lastMessage?: ChatSummary['lastMessage']): RealtimeMessage | undefined {
  if (!lastMessage) return undefined

  return {
    id: lastMessage.id,
    chatId,
    senderId: lastMessage.senderId,
    encryptedPayload: lastMessage.encryptedPayload,
    senderKeyId: 0,
    timestamp: lastMessage.timestamp,
    status: 'delivered',
    type: 'text',
  }
}

export function mapChatSummaryToRealtimeChat(chat: ChatSummary): RealtimeChat {
  return {
    id: chat.id,
    type: chat.type,
    name: chat.name,
    avatarPath: chat.avatarPath,
    members: chat.members,
    unreadCount: chat.unreadCount,
    updatedAt: chat.updatedAt,
    lastMessage: mapLastMessage(chat.id, chat.lastMessage),
  }
}

export function mapChatSummariesToRealtimeChats(chats: ChatSummary[]): RealtimeChat[] {
  return chats.map(mapChatSummaryToRealtimeChat)
}

export function scheduleBrowserRealtimeTask(
  setTimer: (run: () => void, delayMs: number) => unknown,
  delayMs: number,
  run: () => void,
): unknown {
  return setTimer(run, delayMs)
}
