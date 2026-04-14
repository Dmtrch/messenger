export const WS_MESSAGE_STATUSES = [
  'sending',
  'sent',
  'delivered',
  'read',
  'failed',
] as const

export const WS_MESSAGE_KINDS = [
  'text',
  'image',
  'file',
  'system',
] as const

export type RealtimeMessageStatus = (typeof WS_MESSAGE_STATUSES)[number]
export type RealtimeMessageKind = (typeof WS_MESSAGE_KINDS)[number]

export interface RealtimeMessage {
  id: string
  clientMsgId?: string
  replyToId?: string
  chatId: string
  senderId: string
  encryptedPayload: string
  senderKeyId: number
  text?: string
  mediaId?: string
  mediaKey?: string
  originalName?: string
  timestamp: number
  status: RealtimeMessageStatus
  type: RealtimeMessageKind
  isEdited?: boolean
}

export interface RealtimeChat {
  id: string
  type: 'direct' | 'group'
  name: string
  avatarPath?: string
  members: string[]
  lastMessage?: RealtimeMessage
  unreadCount: number
  updatedAt: number
}
