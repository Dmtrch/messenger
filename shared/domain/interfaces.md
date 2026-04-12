# Shared Core Interfaces

Этот документ описывает platform-neutral интерфейсы Shared Core. Здесь нет реализации, только контракт и обязанности.

## AuthEngine

### Назначение

Управляет lifecycle аутентификации и session recovery.

### Обязанности

- login
- refresh access token
- logout
- восстановление сессии после рестарта
- регистрация и привязка `deviceId`

### Contract

```text
interface AuthEngine {
  login(credentials): AuthSession
  refresh(currentSession): AuthSession
  logout(currentSession): void
  restoreSession(): AuthSession | null
  ensureRegisteredDevice(session, deviceInfo): RegisteredDevice
}
```

## WSClient

### Назначение

Инкапсулирует WebSocket transport без UI-логики.

### Обязанности

- connect / disconnect
- reconnect policy
- auth binding через `token + deviceId`
- inbound frame parsing
- outbound frame dispatch

### Contract

```text
interface WSClient {
  connect(session, deviceId): void
  disconnect(reason?): void
  send(frame): void
  subscribe(listener): Subscription
  currentState(): WSConnectionState
}
```

## MessageRepository

### Назначение

Единая точка доступа к локальной message/chat persistence модели.

### Обязанности

- сохранять страницы истории;
- сохранять локальный outbox;
- отдавать историю по cursor-aware модели;
- синхронизировать локальный и серверный state.

### Contract

```text
interface MessageRepository {
  saveMessagePage(chatId, page, direction): void
  getMessagePage(chatId, cursor?, limit?): MessagePage
  saveOutgoing(message): void
  markDelivered(clientMsgId, deliveredAt): void
  markRead(chatId, messageId, userId, readAt): void
  nextCursor(chatId): Cursor | null
}
```

## Shared rules

1. Эти интерфейсы не содержат platform-specific API.
2. Эти интерфейсы не содержат UI state.
3. Cursor-based pagination обязательна для всех реализаций `MessageRepository`.
