# Shared Repository Contracts

Этот документ фиксирует repository layer для Shared Core.

## AuthRepository

```text
interface AuthRepository {
  saveSession(session): void
  loadSession(): AuthSession | null
  clearSession(): void
}
```

## ChatRepository

```text
interface ChatRepository {
  saveChats(chats): void
  upsertChat(chat): void
  getChats(): Chat[]
  getChat(chatId): Chat | null
}
```

## MessageRepository

```text
interface MessageRepository {
  saveMessagePage(chatId, page, direction): void
  getMessagePage(chatId, cursor?, limit?): MessagePage
  saveOutgoing(message): void
  updateMessageStatus(chatId, messageId, status): void
  markRead(chatId, messageId, userId, readAt): void
  nextCursor(chatId): Cursor | null
}
```

## DeviceRepository

```text
interface DeviceRepository {
  saveCurrentDevice(device): void
  loadCurrentDevice(): Device | null
  savePeerDevices(userId, devices): void
  getPeerDevices(userId): Device[]
}
```

## MediaRepository

```text
interface MediaRepository {
  saveAttachmentMetadata(attachment): void
  getAttachment(mediaId): Attachment | null
  bindAttachment(mediaId, chatId): void
}
```

## SettingsRepository

```text
interface SettingsRepository {
  get(key): SettingValue | null
  set(key, value): void
  remove(key): void
}
```

## Repository rules

1. Репозитории описывают persistence contract, а не transport behavior.
2. Все репозитории должны работать с `SQLite` в нативных клиентах, но интерфейсы не зависят от конкретного драйвера.
3. `MessageRepository` обязан поддерживать cursor-aware доступ к истории.
