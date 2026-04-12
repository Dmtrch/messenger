# Shared WebSocket Lifecycle

Этот документ описывает контракт realtime-соединения для Shared Core.

## Connection states

```text
WSConnectionState =
  | idle
  | connecting
  | connected
  | reconnecting
  | disconnected
  | auth_failed
```

## Lifecycle

1. `WSClient` открывает соединение с `token + deviceId`.
2. После connect начинает inbound event dispatch.
3. При сетевой ошибке переходит в `reconnecting`.
4. При истечении сессии или `401`-эквиваленте передаёт управление в `AuthEngine`.

## Reconnect policy

Обязательные свойства:

- reconnect должен быть автоматическим;
- reconnect не должен ломать local outbox semantics;
- reconnect должен повторно синхронизировать unread/read/message state после восстановления.

## Event dispatch

`WSClient` обязан уметь:

- парсить inbound frames;
- маршрутизировать их в shared domain events;
- отправлять outbound frames без UI-specific knowledge.

## Shared rules

1. Нельзя делать разные state machine для desktop, android и ios.
2. Platform-specific network adapters должны сохранять одинаковую reconnect semantics.
3. Все клиенты обязаны использовать общий event dispatch contract.
