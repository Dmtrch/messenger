export interface User {
  id: string
  username: string
  displayName: string
  avatarPath?: string
  identityKeyPublic: string   // base64, Ed25519
  lastSeen?: number
  online?: boolean
}

export interface Chat {
  id: string
  type: 'direct' | 'group'
  name: string
  avatarPath?: string
  members: string[]           // user IDs
  lastMessage?: Message
  unreadCount: number
  updatedAt: number
}

export interface Message {
  id: string
  clientMsgId?: string        // id на стороне отправителя (для delete/edit)
  chatId: string
  senderId: string
  encryptedPayload: string    // base64, только ciphertext — как на сервере
  senderKeyId: number
  // Декодированные поля — только в памяти, не хранятся на сервере
  text?: string
  mediaId?: string
  originalName?: string
  timestamp: number
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
  type: 'text' | 'image' | 'file' | 'system'
  isEdited?: boolean
}

/** Публичный ключевой пакет пользователя (X3DH) */
export interface PublicKeyBundle {
  userId: string
  ikPublic: string            // base64, Ed25519 Identity Key
  spkId: number
  spkPublic: string           // base64, X25519 Signed PreKey
  spkSignature: string        // base64
  opkId?: number
  opkPublic?: string          // base64, X25519 One-Time PreKey (может отсутствовать)
}

/** WebSocket фреймы — имена полей соответствуют Go-серверу */
export type WSFrame =
  | { type: 'message'; chatId: string; ciphertext: string; senderKeyId: number; senderId: string; timestamp: number; messageId: string; clientMsgId?: string }
  | { type: 'ack'; clientMsgId: string; chatId?: string; timestamp: number }
  | { type: 'typing'; chatId: string; userId: string }
  | { type: 'presence'; userId: string; status: 'online' | 'offline' }
  | { type: 'prekey_request' }
  | { type: 'read'; chatId: string; messageId: string; userId: string }
  | { type: 'message_deleted'; chatId: string; clientMsgId: string }
  | { type: 'message_edited'; chatId: string; clientMsgId: string; ciphertext: string; editedAt: number }

export type WSSendFrame =
  | { type: 'message'; chatId: string; clientMsgId: string; senderKeyId: number; recipients: Array<{ userId: string; ciphertext: string }> }
  | { type: 'typing'; chatId: string }
  | { type: 'read'; chatId: string; messageId: string }
