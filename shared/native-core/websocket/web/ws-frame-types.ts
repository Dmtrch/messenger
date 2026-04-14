import type { CallWSFrame, CallWSSendFrame } from '../../calls/web/call-ws-types'

export const WS_FRAME_TYPES = [
  'message',
  'ack',
  'typing',
  'presence',
  'prekey_request',
  'prekey_low',
  'read',
  'message_deleted',
  'message_edited',
  'skdm',
  ...['call_offer', 'call_answer', 'call_end', 'call_reject', 'call_busy', 'ice_candidate'],
] as const

export type MessageRecipient = {
  userId: string
  deviceId?: string
  ciphertext: string
}

export type WSMessageFrame = {
  type: 'message'
  chatId: string
  ciphertext: string
  senderKeyId: number
  senderId: string
  senderDeviceId?: string
  timestamp: number
  messageId: string
  clientMsgId?: string
  replyToId?: string
}

export type WSAckFrame = {
  type: 'ack'
  clientMsgId: string
  chatId?: string
  timestamp: number
}

export type WSTypingFrame = {
  type: 'typing'
  chatId: string
  userId: string
}

export type WSPresenceFrame = {
  type: 'presence'
  userId: string
  status: 'online' | 'offline'
}

export type WSPrekeyRequestFrame = {
  type: 'prekey_request'
}

export type WSPrekeyLowFrame = {
  type: 'prekey_low'
  count: number
}

export type WSReadFrame = {
  type: 'read'
  chatId: string
  messageId: string
  userId: string
}

export type WSMessageDeletedFrame = {
  type: 'message_deleted'
  chatId: string
  clientMsgId: string
}

export type WSMessageEditedFrame = {
  type: 'message_edited'
  chatId: string
  clientMsgId: string
  ciphertext: string
  editedAt: number
}

export type WSSKDMFrame = {
  type: 'skdm'
  chatId: string
  senderId: string
  ciphertext: string
}

export type WSFrame =
  | WSMessageFrame
  | WSAckFrame
  | WSTypingFrame
  | WSPresenceFrame
  | WSPrekeyRequestFrame
  | WSPrekeyLowFrame
  | WSReadFrame
  | WSMessageDeletedFrame
  | WSMessageEditedFrame
  | WSSKDMFrame
  | CallWSFrame

export type WSSendMessageFrame = {
  type: 'message'
  chatId: string
  clientMsgId: string
  senderKeyId: number
  recipients: MessageRecipient[]
  replyToId?: string
}

export type WSSendSKDMFrame = {
  type: 'skdm'
  chatId: string
  recipients: Array<{ userId: string; ciphertext: string }>
}

export type WSSendTypingFrame = {
  type: 'typing'
  chatId: string
}

export type WSSendReadFrame = {
  type: 'read'
  chatId: string
  messageId: string
}

export type WSSendFrame =
  | WSSendMessageFrame
  | WSSendSKDMFrame
  | WSSendTypingFrame
  | WSSendReadFrame
  | CallWSSendFrame
