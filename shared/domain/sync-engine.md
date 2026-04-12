# Shared Sync and Outbox Engine

Этот документ фиксирует sync semantics Shared Core.

## Scope

Shared Sync Engine покрывает:

- local chat cache;
- local message cache;
- outbox queue;
- retry policy;
- reconcile после reconnect;
- совместную работу cache и cursor pagination.

## Outbox

`OutboxEntry` должен содержать:

- `clientMsgId`
- `chatId`
- `encryptedPayload`
- `recipients`
- `createdAt`
- `retryCount`
- `lastAttemptAt`

## Retry

Обязательная retry semantics:

- отправка повторяется после reconnect;
- exponential details могут отличаться, но contract retry остаётся общим;
- permanent failure должен отображаться как `failed`, а не как потерянное сообщение.

## Reconcile

После reconnect Shared Core обязан:

1. восстановить WS transport;
2. подтвердить session validity;
3. догрузить серверные изменения при необходимости;
4. повторно отправить допустимые outbox entries;
5. обновить локальный unread/read state.

## Cursor pagination integration

Sync engine обязан совместно работать с cursor-based pagination:

- локальный кэш не подменяет серверную догрузку;
- `nextCursor` сохраняется как часть локального состояния;
- клиенты должны уметь различать локально закешированную и ещё не загруженную историю.

## Shared rules

1. Outbox и retry — часть Shared Core, а не platform-specific feature.
2. Sync semantics должны совпадать с текущим поведением PWA.
3. Native clients не должны проектировать новую offline-модель отдельно от web-клиента.
