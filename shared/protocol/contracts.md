# Shared Protocol Contracts

Этот документ фиксирует платформенно-независимые transport contracts для всех клиентов Messenger.

## Назначение

Общий протокольный слой должен оставаться единым для:

- `Desktop`
- `Android`
- `iOS`
- текущего web/PWA-клиента

Этот документ не вводит новый wire-format. Он фиксирует, что нативные клиенты обязаны оставаться совместимыми с текущими REST и WebSocket payload, которые уже используются в проекте.

## Источники истины

Текущие рабочие контракты находятся в:

- `client/src/api/client.ts`
- `client/src/types/index.ts`
- `server/internal/ws/`
- `server/internal/*/handler.go`

На этапе Shared Core все новые клиенты должны проектироваться как consumers этих контрактов, а не как отдельная protocol family.

## Обязательные contract groups

### Auth

- register
- login
- refresh
- logout
- device registration

### Chats and messages

- chat summary
- message history page
- message send
- read receipt
- typing
- delete / edit

### Keys and devices

- `GET /api/keys/:userId`
- `POST /api/keys/register`
- `POST /api/keys/prekeys`
- multi-device bundle semantics

### Media

- encrypted upload
- authenticated download
- media binding to chat

### Calls

- `call_offer`
- `call_answer`
- `ice_candidate`
- `call_end`
- `call_reject`
- `call_busy`

## Compatibility rules

1. Нативные клиенты не вводят отдельные имена событий для уже существующих payload.
2. Нативные клиенты не меняют существующий message envelope без отдельного RFC.
3. Если новый клиенту нужен platform adapter, он добавляется поверх общего contract, а не вместо него.
