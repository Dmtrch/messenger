# Shared Crypto Interfaces

Этот документ описывает platform-neutral crypto contracts для Shared Core.

## CryptoEngine

### Назначение

Инкапсулирует криптографическую модель Messenger без привязки к конкретному runtime.

### Обязанности

- генерация и хранение device-scoped key material через platform adapters;
- X3DH session bootstrap;
- Double Ratchet send / receive;
- Sender Keys для групп;
- совместимость с текущим wire-format.

### Contract

```text
interface CryptoEngine {
  generateIdentityBundle(deviceInfo): DeviceIdentityBundle
  createOutboundSession(peerUserId, peerDeviceId, bundle): SessionBootstrap
  decryptInboundSessionMessage(senderUserId, senderDeviceId, payload): DecryptedMessage
  encryptForDevices(chatId, recipients, plaintext): EncryptedRecipientPayload[]
  encryptSenderKeyDistribution(chatId, recipients): SenderKeyDistributionPayload[]
  decryptGroupMessage(chatId, senderUserId, senderKeyId, payload): DecryptedMessage
}
```

## X3DH

Обязательные свойства:

- initiator/responder semantics должны совпадать с текущей PWA-реализацией;
- формат key bundle должен оставаться совместимым;
- session bootstrap должен быть device-scoped.

## Double Ratchet

Обязательные свойства:

- send / receive chain semantics совпадают с текущей реализацией;
- поддерживаются skipped message keys;
- out-of-order сообщения должны дешифровываться без platform-specific fork логики.

## Sender Keys

Обязательные свойства:

- групповой message flow остаётся совместимым с текущим клиентом;
- sender key rotation остаётся частью общей модели;
- distribution message не получает platform-specific envelope.

## Совместимость

1. `CryptoEngine` не меняет `X3DH`, `Double Ratchet`, `Sender Keys`.
2. Все реализации должны проверяться через общие test vectors.
3. Нативные клиенты используют bindings к `libsodium` family, но не меняют саму модель.
