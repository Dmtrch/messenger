# Stage 5 — Cryptographic Improvements: Design Spec

Date: 2026-04-09  
Status: Approved

## Scope

Four independent crypto improvements:

1. **Skipped message keys** — fix out-of-order decryption in Double Ratchet
2. **Prekey_request lifecycle** — automatic OPK replenishment via WebSocket
3. **Sender Keys for groups** — E2E encryption for group chats
4. **Encrypted media at rest** — client-side file encryption before upload

---

## 5.1 Skipped Message Keys

### Problem

`ratchet.ts` advances the receive chain key immediately on decrypt. If a message arrives out of order (e.g., msg #3 before msg #2), the chain key is advanced past the key needed for msg #2, causing permanent decryption failure.

### Solution

Cache skipped message keys in `RatchetState`.

**State change:**
```typescript
export interface RatchetState {
  // ... existing fields ...
  skippedKeys: Record<string, string>  // key: "dhPubBase64:n" → messageKey base64
}
```

**Decrypt logic:**
1. Compute lookup key `"${dhPub}:${n}"`
2. If found in `skippedKeys` → use that key, delete from cache, decrypt
3. If not found → advance chain until `recvCount == n`, caching skipped keys along the way
4. Hard limit: 100 skipped keys per session (drop oldest on overflow)

**Serialization:** `skippedKeys` is a plain object — included in existing JSON serialization.

**Files:** `client/src/crypto/ratchet.ts` only.

---

## 5.2 Prekey_request Lifecycle

### Problem

When Bob's one-time prekeys (OPK) run out, new sessions fall back to no-OPK X3DH (weaker). Server notices but cannot proactively notify Bob via WebSocket from the keys handler.

### Solution

Server sends `prekey_low` WebSocket event on connection. Client replenishes automatically.

**Server (`ws/hub.go`):** After registering a client, query `CountFreePreKeys`. If < 10 → push event:
```json
{"type": "prekey_low", "count": 3}
```

**Client (`useMessengerWS.ts`):** Handle `prekey_low` event:
1. Load existing OPKs from keystore
2. Generate 20 new X25519 OPK pairs (IDs = max existing ID + 1..20, to avoid collisions)
3. POST to `/api/keys/prekeys`
4. Save new OPKs to IndexedDB keystore

**Files:** `server/internal/ws/hub.go`, `client/src/hooks/useMessengerWS.ts`, `client/src/crypto/keystore.ts` (add `appendOneTimePreKeys`).

---

## 5.3 Sender Keys for Groups

### Protocol Overview

Based on Signal's Sender Key protocol:
- Each sender maintains one `SenderKey` per group (symmetric chain, no DH)
- First message from a sender triggers lazy distribution (Approach A)
- Each member receives an encrypted `SenderKeyDistributionMessage` (SKDM) via their individual Double Ratchet session
- Group messages are encrypted with a symmetric ratchet on the SenderKey

### Sender Key State

```typescript
// client/src/crypto/senderkey.ts (new file)
interface SenderKeyState {
  chainKey: Uint8Array        // 32 bytes, advances each message
  iteration: number           // message counter
  signingKeyPair: {           // Ed25519 — authenticates ciphertext
    publicKey: Uint8Array
    privateKey: Uint8Array
  }
}
```

### SKDM Format

```typescript
interface SKDistributionMessage {
  senderId: string
  chatId: string
  chainKey: string          // base64
  iteration: number
  signingPublicKey: string  // base64
}
```

The SKDM is serialized to JSON, then encrypted via `encryptMessage(chatId, recipientId, JSON.stringify(skdm))`.

### Wire Format (Group Message)

```json
{
  "v": 1,
  "type": "group",
  "chatId": "...",
  "iteration": 42,
  "sig": "<base64 Ed25519 signature of ciphertext>",
  "ct": "<base64 XSalsa20-Poly1305 ciphertext>"
}
```

### Lazy Distribution Flow (Approach A)

On `encryptMessage` for a group chat:
1. Check if local `SenderKeyState` exists for `(chatId, myUserId)`
2. If not → generate new SenderKey → fetch group members → for each member ≠ self: send SKDM via individual E2E session as WS message with `type: "skdm"`
3. Encrypt message with SenderKey symmetric ratchet
4. Broadcast group wire payload

On receiving `skdm` WS event:
1. Decrypt SKDM via individual E2E session
2. Parse `SKDistributionMessage`
3. Store sender's `SenderKeyState` in keystore

On receiving group message:
1. Look up sender's `SenderKeyState` from keystore
2. Advance chain from `state.iteration` to message `iteration` (cache intermediate keys if gap > 0; hard limit 100 skipped)
3. Verify Ed25519 signature
4. Decrypt ciphertext

### Server Changes

New WS message routing: `type: "skdm"` is delivered point-to-point (same as regular messages) — no special server logic needed. The existing `Deliver(userID, payload)` covers it.

### Storage

Add to `keystore.ts`:
- `saveMySenderKey(chatId, state)` / `loadMySenderKey(chatId)`
- `savePeerSenderKey(chatId, senderId, state)` / `loadPeerSenderKey(chatId, senderId)`

### Files

- New: `client/src/crypto/senderkey.ts`
- Modified: `client/src/crypto/keystore.ts`, `client/src/crypto/session.ts`, `client/src/hooks/useMessengerWS.ts`, `client/src/store/chatStore.ts`

---

## 5.4 Encrypted Media at Rest

### Problem

Currently, files are uploaded as plaintext and stored on disk. Server stores readable media. Only the `mediaId` reference is E2E encrypted within the message — the actual file content is not.

### Solution

Client-side encryption before upload. Decryption key travels inside the E2E-encrypted message payload.

### Encryption Flow (Upload)

1. Generate random 32-byte `mediaKey` (`crypto_secretbox_keygen`)
2. Generate random 24-byte nonce
3. Encrypt: `ciphertext = nonce || secretbox_easy(file_bytes, nonce, mediaKey)`
4. Upload `ciphertext` to `/api/media/upload` (same endpoint, no server change needed)
5. Build message payload:
   ```json
   {
     "mediaId": "...",
     "mediaKey": "<base64 32 bytes>",
     "originalName": "photo.jpg",
     "mediaType": "image/jpeg",
     "text": "optional caption"
   }
   ```
6. This payload is E2E encrypted via Double Ratchet as usual

### Decryption Flow (Download)

1. Decrypt message → parse payload JSON → extract `mediaId` + `mediaKey`
2. Fetch ciphertext from `/api/media/:id` (authenticated)
3. Decode nonce from first 24 bytes
4. `plaintext = secretbox_open_easy(ciphertext[24:], nonce, fromBase64(mediaKey))`
5. Create object URL for display

### Server Changes

None required. Server stores and serves ciphertext opaquely.

### Backward Compatibility

Messages without `mediaKey` in payload are treated as legacy plaintext media (download and display as before).

### Files

- `client/src/api/client.ts` — add `uploadEncryptedMedia(file): Promise<{mediaId}>`
- `client/src/components/ChatWindow/ChatWindow.tsx` — use encrypted upload, decrypt on display

---

## Implementation Order

1. 5.1 Skipped keys (smallest, isolated)
2. 5.2 Prekey lifecycle (small, two files)
3. 5.4 Encrypted media (medium, no backend changes)
4. 5.3 Sender Keys (largest, needs 5.1 working first for group decrypt)

---

## Non-Goals

- Key rotation for Sender Keys (out of scope for this stage)
- New member joining existing group after messages sent (no retroactive key sharing)
- Server-side media re-encryption
