# Shared Domain Models

Этот документ фиксирует канонические модели Shared Core. Он не привязан к конкретному языку и нужен как основа для `Desktop`, `Android`, `iOS`.

## User

```text
User {
  id: UserId
  username: string
  displayName: string
  avatarPath?: string
  role?: "admin" | "user"
  lastSeenAt?: Timestamp
  presence?: PresenceState
}
```

## Device

```text
Device {
  id: DeviceId
  userId: UserId
  deviceName: string
  platform: "desktop" | "android" | "ios" | "web"
  createdAt: Timestamp
  lastSeenAt?: Timestamp
  isCurrentDevice: boolean
}
```

## Chat

```text
Chat {
  id: ChatId
  type: "direct" | "group"
  name: string
  avatarPath?: string
  members: UserId[]
  lastMessagePreview?: MessagePreview
  unreadCount: number
  updatedAt: Timestamp
}
```

## Message

```text
Message {
  id: MessageId
  clientMsgId?: ClientMessageId
  chatId: ChatId
  senderId: UserId
  senderDeviceId?: DeviceId
  encryptedPayload: Ciphertext
  senderKeyId: number
  timestamp: Timestamp
  status: "sending" | "sent" | "delivered" | "read" | "failed"
  kind: "text" | "image" | "file" | "system"
  isEdited?: boolean
}
```

## Receipt

```text
Receipt {
  chatId: ChatId
  messageId: MessageId
  userId: UserId
  type: "delivered" | "read"
  timestamp: Timestamp
}
```

## Attachment

```text
Attachment {
  mediaId: MediaId
  chatId?: ChatId
  originalName?: string
  contentType?: string
  mediaKey?: Base64Key
  kind: "image" | "file" | "video" | "audio"
}
```

## TypingEvent

```text
TypingEvent {
  chatId: ChatId
  userId: UserId
  startedAt: Timestamp
}
```

## PresenceEvent

```text
PresenceEvent {
  userId: UserId
  state: "online" | "offline"
  timestamp: Timestamp
}
```

## MessagePage

```text
MessagePage {
  chatId: ChatId
  messages: Message[]
  nextCursor?: Cursor
}
```

## Правила моделей

1. `Message` хранит ciphertext как каноническое состояние, даже если UI держит расшифрованный preview в памяти.
2. `senderDeviceId` считается частью message semantics для multi-device.
3. `Receipt` не является UI-only состоянием; это часть shared domain.
4. `MessagePage.nextCursor` остаётся opaque value.
