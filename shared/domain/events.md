# Shared Domain Events

Этот документ описывает события, которые должны быть одинаково интерпретированы всеми клиентами.

## Chat events

- `ChatLoaded`
- `ChatUpdated`
- `UnreadCountChanged`

## Message events

- `MessageReceived`
- `MessageAcknowledged`
- `MessageDelivered`
- `MessageRead`
- `MessageEdited`
- `MessageDeleted`
- `MessageSendFailed`

## Realtime events

- `TypingStarted`
- `TypingStopped`
- `PresenceChanged`

## Crypto and device events

- `PreKeyLow`
- `PreKeyReplenished`
- `SenderKeyDistributionReceived`
- `DeviceRegistered`
- `SessionRecovered`

## Call signaling events

- `CallOfferReceived`
- `CallAnswerReceived`
- `IceCandidateReceived`
- `CallEnded`
- `CallRejected`
- `CallBusy`

## Event rules

1. События отражают общий domain смысл, а не детали UI framework.
2. Event naming должно совпадать между desktop, android и ios adapters.
3. Любое platform-specific событие должно транслироваться в один из shared domain events или оставаться вне Shared Core.
