# Shared Crypto Contracts

Пакет для контрактов криптографического слоя.

Назначение:

- описать интерфейсы для `X3DH`, `Double Ratchet`, `Sender Keys`;
- зафиксировать session/device semantics;
- держать границу между общей криптографической моделью и platform bindings.

Важно:

- алгоритмы и wire-format должны оставаться совместимыми с текущей реализацией в `client/src/crypto/`.

## Документы

- [interfaces.md](interfaces.md) — CryptoEngine contract
- [aes-gcm-spec.md](aes-gcm-spec.md) — AES-256-GCM spec для медиашифрования
- [../../docs/crypto-rationale.md](../../docs/crypto-rationale.md) — Rationale криптографических решений
