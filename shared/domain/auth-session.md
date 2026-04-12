# Shared Auth and Session Lifecycle

Этот документ фиксирует session semantics Shared Core.

## AuthSession

```text
AuthSession {
  accessToken: string
  refreshState: "present" | "missing" | "expired"
  userId: UserId
  deviceId: DeviceId
  issuedAt: Timestamp
  expiresAt: Timestamp
}
```

## Token lifecycle

Shared Core должен одинаково трактовать:

- login;
- silent refresh;
- logout;
- session restore after restart;
- forced re-authentication after refresh failure.

## Device registration

После успешной аутентификации клиент должен:

1. определить текущий `deviceId`;
2. убедиться, что device key bundle зарегистрирован;
3. связать `deviceId` с WebSocket transport и crypto session layer.

## AuthEngine responsibilities

- выполнить login;
- обновить access token;
- восстановить session state;
- инициировать device registration flow;
- отдать shared session state для `WSClient`, `CryptoEngine`, repositories.

## Session rules

1. `deviceId` считается частью session identity.
2. Нативные клиенты не вводят отдельную auth-схему.
3. Session restore должен работать без UI-specific assumptions.
