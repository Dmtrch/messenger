# Задачи на следующую сессию

Актуально на: 2026-04-10. Ветка: `feature/stage9-multi-device`.

---

## Выполнено в этой сессии

### Этап 9, серверная часть (фазы 1–5) — multi-device архитектура

- **Migration #8** — `messages.destination_device_id TEXT NOT NULL DEFAULT ''` (пустая строка = broadcast)
- **queries.go** — `GetIdentityKeysByUserID`, `Message.DestinationDeviceID`, обновлены все SELECT/INSERT для messages
- **GET /api/keys/:userId** → `{ "devices": [ {deviceId, ikPublic, spkId, spkPublic, spkSignature, opkId?, opkPublic?} ] }` — один entry на активное устройство
- **WS Hub** — `client.deviceID`, `recipient.DeviceID`, новый `DeliverToDevice`, `senderDeviceId` в WS payload `message`
- **ServeWS** — читает `?deviceId=`, валидирует принадлежность пользователю
- **Тесты** — migration #8, обновлены `GetBundle` тесты, исправлен некорректный assert в `hub_calls_test.go`

---

## Приоритет 1 — Must (клиентская часть 4.1, фазы 6–9)

### 1.1 session.ts — рефактор sessionKey + multi-device шифрование

**Файл:** `client/src/crypto/session.ts`

#### Изменения:

**sessionKey: chatId:peerId → peerId:deviceId** (следует Signal Sesame spec — сессия между парой устройств, не зависит от чата)
```typescript
// БЫЛО
function sessionKey(chatId: string, peerId: string) { return `${chatId}:${peerId}`; }
// СТАЛО
function sessionKey(peerUserId: string, peerDeviceId: string) { return `${peerUserId}:${peerDeviceId}`; }
```

**encryptForAllDevices** — итерация по массиву bundles, возвращает `[{deviceId, ciphertext}]`:
```typescript
async function encryptForAllDevices(
    recipientId: string,
    bundles: DeviceBundle[],
    plaintext: string
): Promise<{ deviceId: string; ciphertext: string }[]>
```

**decryptMessage** — добавить `senderDeviceId: string` параметр:
```typescript
// БЫЛО: decryptMessage(chatId, senderId, ciphertext)
// СТАЛО: decryptMessage(senderId, senderDeviceId, ciphertext)
```

**Экспортировать** обновлённый `invalidateGroupSenderKey` без изменений.

---

### 1.2 client.ts — обновить типы PreKeyBundle

**Файл:** `client/src/api/client.ts`

```typescript
// БЫЛО
interface PreKeyBundle { ikPub, spkPub, spkSig, opkPub?, opkId? }

// СТАЛО
interface DeviceBundle {
    deviceId: string;
    ikPublic: string;
    spkPublic: string;
    spkSignature: string;
    opkPublic?: string;
    opkId?: number;
}
interface PreKeyBundleResponse { devices: DeviceBundle[]; }

// getKeyBundle(userId: string): Promise<PreKeyBundleResponse>
```

---

### 1.3 useMessengerWS.ts — передать senderDeviceId в decryptMessage

**Файл:** `client/src/hooks/useMessengerWS.ts`

В обработчике события `message`:
```typescript
// Сервер теперь передаёт senderDeviceId в каждом сообщении
const { senderId, senderDeviceId, ciphertext, chatId, ... } = data;
const plaintext = await decryptMessage(senderId, senderDeviceId ?? '', ciphertext);
```

---

### 1.4 ChatWindowPage.tsx — fan-out отправка на все устройства получателя

**Файл:** `client/src/pages/ChatWindowPage.tsx`

При отправке:
1. `GET /api/keys/:recipientId` → `{ devices: DeviceBundle[] }`
2. `encryptForAllDevices(recipientId, bundles, plaintext)` → `[{deviceId, ciphertext}]`
3. WS message: `recipients` стал массивом `[{userId, deviceId, ciphertext}]`

Также включить копии для **собственных устройств отправителя** (если endpoint `GET /api/keys/me` реализован или через сохранённый `deviceId`).

---

### 1.5 WS connect — передавать deviceId

**Файл:** `client/src/hooks/useMessengerWS.ts` или `client/src/api/websocket.ts`

При подключении добавить `?deviceId=<myDeviceId>` к WS URL. `deviceId` получается из ответа `POST /api/keys/register` и сохраняется в authStore или localStorage.

---

## Приоритет 2 — Should

### 2.1 Тесты для клиентских изменений

- `client/src/crypto/session.test.ts` (новый или обновить) — проверить новый `sessionKey`, `encryptForAllDevices`, `decryptMessage` с `senderDeviceId`
- Обновить `client/src/api/client.test.ts` если затронуто изменением типов

---

## Контекст для быстрого старта

Ветка: `feature/stage9-multi-device`. Серверная часть коммита: `984a28b`.

**Что работает на сервере:**
- `GET /api/keys/:userId` возвращает `{ devices: [...] }` — по одному bundle на устройство
- WS сообщение содержит `senderDeviceId`
- WS принимает `?deviceId=` и валидирует владельца
- `messages.destination_device_id` хранится в БД; `DeliverToDevice` доставляет адресно

**Что осталось на клиенте:**
- Рефактор `sessionKey` с `chatId:peerId` → `peerId:deviceId`
- Обновить типы API (`DeviceBundle[]` вместо плоского bundle)
- `decryptMessage(senderId, senderDeviceId, ciphertext)` — использовать `senderDeviceId`
- Fan-out: шифровать отдельно для каждого устройства получателя
- WS connect: передавать `?deviceId=`

**Ключевые файлы этой сессии:**
- `server/db/migrate.go` — migration #8
- `server/db/queries.go` — GetIdentityKeysByUserID, Message.DestinationDeviceID
- `server/internal/keys/handler.go` — GetBundle multi-device
- `server/internal/ws/hub.go` — deviceID, DeliverToDevice, senderDeviceId
- `docs/superpowers/plans/2026-04-10-stage9-multi-device.md` — полный план

**Ключевые файлы для следующей сессии:**
- `client/src/crypto/session.ts` — sessionKey, encryptForAllDevices, decryptMessage
- `client/src/api/client.ts` — PreKeyBundleResponse тип
- `client/src/hooks/useMessengerWS.ts` — senderDeviceId, ?deviceId= в URL
- `client/src/pages/ChatWindowPage.tsx` — fan-out отправка
