# Messenger API Reference (V-3c)

Base URL: `https://<host>`  
All JSON request bodies require `Content-Type: application/json`.  
All timestamps are Unix milliseconds (int64) unless noted.

---

## Authentication

### Token scheme

- **Access token** — JWT (HS256), 15-minute lifetime. Pass as `Authorization: Bearer <token>` on authenticated endpoints.
- **Refresh token** — 7-day token stored in an `httpOnly`, `SameSite=Strict` cookie named `refresh_token` scoped to `/api/auth`.

### Rate limiting

Auth endpoints are limited to **20 requests / minute / IP**.

---

### POST /api/auth/register

Register a new account. Behaviour depends on `registrationMode`:

| Mode | Behaviour |
|---|---|
| `open` | Account created immediately |
| `invite` | `inviteCode` required |
| `approval` | Returns 403; use `/api/auth/request-register` instead |

**Auth required:** No

**Request**
```json
{
  "username": "alice",
  "displayName": "Alice",
  "password": "hunter2!",
  "inviteCode": "abc12345",
  "ikPublic": "<base64>",
  "spkId": 1,
  "spkPublic": "<base64>",
  "spkSignature": "<base64>",
  "opkPublics": [
    {"id": 1, "key": "<base64>"},
    {"id": 2, "key": "<base64>"}
  ]
}
```

`ikPublic`, `spkPublic`, `spkSignature`, `opkPublics` are optional at registration but required for E2E encryption. All key values are Base64-encoded (standard encoding).

**Response 201**
```json
{
  "accessToken": "<jwt>",
  "userId": "uuid",
  "username": "alice",
  "displayName": "Alice",
  "role": "user"
}
```

**Errors**

| Code | Body |
|---|---|
| 400 | `{"error": "username 3-64 chars, password 8-128 chars"}` |
| 403 | `{"error": "registration requires admin approval..."}` (approval mode) |
| 404 | `{"error": "invalid invite code", "error_code": "invite_not_found"}` |
| 409 | `{"error": "username taken"}` or `{"error_code": "invite_already_used"}` |
| 410 | `{"error_code": "invite_revoked"}` or `{"error_code": "invite_expired"}` |

---

### POST /api/auth/login

**Auth required:** No

**Request**
```json
{"username": "alice", "password": "hunter2!"}
```

**Response 200**
```json
{
  "accessToken": "<jwt>",
  "userId": "uuid",
  "username": "alice",
  "displayName": "Alice",
  "role": "user"
}
```

Sets `refresh_token` cookie. Lazy-migrates bcrypt hashes to Argon2id on success.

**Errors:** 400 invalid body · 401 invalid credentials

---

### POST /api/auth/refresh

Exchange the `refresh_token` cookie for a new access token + refresh token.

**Auth required:** No (cookie only)

**Request:** empty body

**Response 200** — same shape as login

**Errors:** 401 missing/invalid/expired token

---

### POST /api/auth/logout

Invalidates the refresh token and clears the cookie.

**Auth required:** No

**Response 204** — no body

---

### POST /api/auth/change-password

**Auth required:** Yes

**Request**
```json
{"currentPassword": "hunter2!", "newPassword": "newSecret99!"}
```

Invalidates all sessions except the current one.

**Response 204**

**Errors:** 400 invalid body · 403 wrong current password · 404 user not found

---

### POST /api/auth/request-register

Submit a registration request for admin approval (only when `registrationMode=approval`).

**Auth required:** No

**Request** — same fields as `/api/auth/register` (minus `inviteCode`)

**Response 201**
```json
{"status": "pending", "message": "Registration request submitted, awaiting admin approval"}
```

**Errors:** 400 invalid mode or validation · 409 username taken

---

### POST /api/auth/password-reset-request

Request a password reset via admin. The server never discloses whether a username exists.

**Auth required:** No

**Request**
```json
{"username": "alice"}
```

**Response 200**
```json
{"status": "pending"}
```

---

### POST /api/auth/device-link-request

Generate a one-time device-link token (TTL 120 s). Show as QR code on the primary device.

**Auth required:** Yes

**Response 200**
```json
{"token": "<64-hex-chars>", "expiresAt": 1700000000000}
```

---

### POST /api/auth/device-link-activate

Activate a device-link token from a new device. Issues a full session.

**Auth required:** No

**Request**
```json
{
  "token": "<hex-token>",
  "deviceName": "iPhone 15",
  "ikPublic": "<base64>",
  "spkId": 1,
  "spkPublic": "<base64>",
  "spkSignature": "<base64>",
  "opkPublics": [{"id": 1, "key": "<base64>"}]
}
```

**Response 200**
```json
{
  "accessToken": "<jwt>",
  "userId": "uuid",
  "username": "alice",
  "displayName": "Alice",
  "role": "user",
  "deviceId": "uuid"
}
```

**Errors:** 400 missing fields · 404 invalid token · 410 token used or expired

---

## Server Info

### GET /api/server/info

**Auth required:** No

**Response 200**
```json
{
  "name": "My Messenger",
  "description": "Self-hosted chat",
  "registrationMode": "open",
  "allowUsersCreateGroups": true,
  "maxUploadBytes": 104857600
}
```

---

### GET /api/version

**Auth required:** No

**Response 200**
```json
{
  "version": "1.2.3",
  "minClientVersion": "1.0.0",
  "buildDate": "2025-04-20T10:00:00Z"
}
```

---

## Users

### GET /api/users/search?q=\<query\>

Search users by username or display name. `q` must be at least 2 characters. Returns up to 20 results, excluding the caller.

**Auth required:** Yes

**Response 200**
```json
{
  "users": [
    {"id": "uuid", "username": "alice", "displayName": "Alice"}
  ]
}
```

---

## Chats

### GET /api/chats

List all chats for the authenticated user, ordered by most recent activity. Includes unread count and last (encrypted) message.

**Auth required:** Yes

**Response 200**
```json
{
  "chats": [
    {
      "id": "uuid",
      "type": "direct",
      "name": "Alice",
      "members": ["uuid-me", "uuid-alice"],
      "createdAt": 1700000000000,
      "updatedAt": 1700000001000,
      "unreadCount": 3,
      "lastMessage": {
        "id": "uuid",
        "senderId": "uuid-alice",
        "encryptedPayload": "<base64>",
        "timestamp": 1700000001000
      }
    }
  ]
}
```

---

### POST /api/chats

Create a new chat (direct or group). For `direct`, if a chat between the two users already exists, returns the existing chat with status 200.

**Auth required:** Yes (admin/moderator required to create groups if `allowUsersCreateGroups=false`)

**Request**
```json
{
  "type": "group",
  "memberIds": ["uuid-bob", "uuid-carol"],
  "name": "Team chat"
}
```

`name` is required for groups, ignored for direct chats.

**Response 201**
```json
{
  "chat": {
    "id": "uuid",
    "type": "group",
    "name": "Team chat",
    "members": ["uuid-me", "uuid-bob", "uuid-carol"],
    "createdAt": 1700000000000
  }
}
```

**Errors**

| Code | Body |
|---|---|
| 400 | `{"error": "type must be direct or group"}` |
| 403 | `{"error": "groups_creation_disabled"}` |
| 422 | `{"error": "group_member_limit_reached", "maxMembers": 50}` |

---

### GET /api/chats/{chatId}/messages

Paginated message history. Messages are returned encrypted; the client decrypts them.

**Auth required:** Yes (member of chat)

**Query params**

| Param | Default | Description |
|---|---|---|
| `before` | — | Message UUID cursor; returns messages older than this ID |
| `limit` | 50 | 1–100 |

**Response 200**
```json
{
  "messages": [
    {
      "id": "uuid",
      "chatId": "uuid",
      "senderId": "uuid",
      "encryptedPayload": "<base64>",
      "senderKeyId": 7,
      "timestamp": 1700000001000,
      "delivered": true,
      "read": false,
      "replyToId": "uuid-or-empty",
      "expiresAt": 1700003600000
    }
  ],
  "nextCursor": "uuid-oldest-in-page"
}
```

`nextCursor` is `null` when no more pages exist.

**Errors:** 404 not a member

---

### POST /api/chats/{chatId}/read

Mark messages in a chat as read.

**Auth required:** Yes (member of chat)

**Request** (body optional)
```json
{"messageId": "uuid"}
```

If `messageId` is omitted, marks the latest message in the chat as read.

Broadcasts a `read` frame to all chat participants via WebSocket.

**Response 204**

---

### POST /api/chats/{chatId}/ttl

Set the default auto-delete TTL for messages in a chat.

**Auth required:** Yes (member of chat)

**Request**
```json
{"ttlSeconds": 3600}
```

`ttlSeconds=0` disables auto-deletion. Valid non-zero range: 5–604800 (5 s to 7 days).

Broadcasts a `chat_ttl_updated` frame to all chat participants.

**Response 204**

**Errors:** 422 out of range

---

### POST /api/chats/{chatId}/members

Add a member to a group chat.

**Auth required:** Yes (existing member)

**Request**
```json
{"userId": "uuid"}
```

Broadcasts a `member_added` frame.

**Response 204**

**Errors:** 404 chat not found or not a member · 422 member limit reached

---

### DELETE /api/messages/{clientMsgId}

Delete a message (all per-recipient copies). Only the sender, admin, or moderator may delete.

**Auth required:** Yes

Broadcasts `message_deleted` frame. Removes associated media files from disk.

**Response 204**

**Errors:** 403 forbidden · 404 not found

---

### PATCH /api/messages/{clientMsgId}

Edit a message. Sends updated ciphertext per recipient.

**Auth required:** Yes (sender only)

**Request**
```json
{
  "recipients": [
    {"userId": "uuid", "ciphertext": "<bytes>"},
    {"userId": "uuid-me", "ciphertext": "<bytes>"}
  ]
}
```

Delivers `message_edited` frames to each recipient.

**Response 200**
```json
{"editedAt": 1700000099000}
```

**Errors:** 400 invalid body · 403 not sender · 404 not found

---

## Media

### POST /api/media/upload

Upload an E2E-encrypted binary file. Content is always opaque binary; the true MIME type is embedded in the encrypted message payload on the client side.

**Auth required:** Yes

**Request** — `multipart/form-data`

| Field | Required | Description |
|---|---|---|
| `file` | Yes | Binary blob (E2E-encrypted content) |
| `chat_id` | No | Associate with a specific chat |
| `msg_id` | No | Associate with a specific client message ID |
| `content_type` | No | Only `audio/*` values are accepted; all others default to `application/octet-stream` |

**Response 201**
```json
{
  "mediaId": "uuid",
  "originalName": "recording.ogg",
  "contentType": "audio/ogg"
}
```

**Errors**

| Code | Body |
|---|---|
| 403 | `{"error": "forbidden"}` — not a member of `chat_id` |
| 413 | `{"error": "file_too_large", "maxBytes": 104857600}` |
| 413 | `{"error": "quota_exceeded", "quotaBytes": 1073741824, "usedBytes": 1073741820}` |

---

### GET /api/media/{id}

Retrieve a media object. Access is granted to the uploader or any member of the associated chat.

**Auth required:** Yes

**Response 200** — raw binary with `Content-Type` as stored and `Cache-Control: private, max-age=86400`

**Errors:** 403 forbidden · 404 not found

---

### GET /api/chats/{chatId}/media?page=1&limit=20

List media objects attached to a chat (metadata only, no binary).

**Auth required:** Yes (member of chat)

**Query params:** `page` (default 1), `limit` (default 20, max 100)

**Response 200**
```json
{
  "items": [
    {"id": "uuid", "originalName": "photo.jpg", "size": 204800, "createdAt": 1700000000000}
  ],
  "hasMore": true
}
```

---

## E2E Key Management

### GET /api/keys/{userId}

Fetch the prekey bundle for all devices of a user. Used by the caller to establish an X3DH session. One-time prekeys (OPK) are consumed on fetch (except when the caller fetches their own keys).

**Auth required:** Yes

**Response 200**
```json
{
  "devices": [
    {
      "deviceId": "uuid",
      "ikPublic": "<base64>",
      "spkId": 1,
      "spkPublic": "<base64>",
      "spkSignature": "<base64>",
      "opkId": 42,
      "opkPublic": "<base64>"
    }
  ]
}
```

`opkId` and `opkPublic` are omitted if no one-time prekeys remain.

**Errors:** 404 keys not registered

---

### POST /api/keys/register

Register or update a device's key bundle. Idempotent — if the same `ikPublic` already exists for this user, the existing `deviceId` is reused.

**Auth required:** Yes

**Request**
```json
{
  "deviceName": "MacBook Pro",
  "ikPublic": "<base64>",
  "spkId": 1,
  "spkPublic": "<base64>",
  "spkSignature": "<base64>",
  "opkPublics": ["<base64>", "<base64>"]
}
```

**Response 200**
```json
{"deviceId": "uuid", "opkIds": [1, 2, 3]}
```

`opkIds` are server-assigned integer IDs for the uploaded one-time prekeys.

**Errors:** 400 missing required fields or invalid base64

---

### POST /api/keys/prekeys

Upload additional one-time prekeys for the current user.

**Auth required:** Yes

**Request**
```json
{
  "keys": [
    {"id": 10, "key": "<base64>"},
    {"id": 11, "key": "<base64>"}
  ]
}
```

**Response 204**

**Errors:** 400 empty or invalid base64

---

## Devices

### GET /api/devices

List all registered devices for the current user.

**Auth required:** Yes

**Response 200**
```json
[
  {
    "id": "uuid",
    "userId": "uuid",
    "deviceName": "iPhone 15",
    "createdAt": 1700000000000,
    "lastSeenAt": 1700001000000
  }
]
```

---

### DELETE /api/devices/{deviceId}

Remove a device. Closes its WebSocket connection and delivers a `device_removed` frame to the user's other devices.

**Auth required:** Yes (must own the device)

**Response 204**

**Errors:** 403 not owner · 404 not found

---

## Push Notifications

### GET /api/push/vapid-public-key

Retrieve the VAPID public key for Web Push subscription.

**Auth required:** No

**Response 200**
```json
{"publicKey": "<base64url-vapid-public-key>"}
```

**Errors:** 503 push not configured

---

### POST /api/push/subscribe

Save a Web Push subscription for the current user.

**Auth required:** Yes

**Request**
```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/...",
  "keys": {
    "p256dh": "<base64url>",
    "auth": "<base64url>"
  }
}
```

**Response 204**

---

### POST /api/push/native/register

Register a native push token (FCM or APNs) for the current device.

**Auth required:** Yes

**Request**
```json
{
  "platform": "fcm",
  "token": "<device-token>",
  "deviceId": "uuid"
}
```

`platform`: `"fcm"` or `"apns"`. `deviceId` defaults to `"default"` if omitted.

**Response 204**

---

## Calls

### GET /api/calls/ice-servers

Retrieve ICE server configuration for WebRTC.

**Auth required:** Yes

**Response 200**
```json
{
  "iceServers": [
    {"urls": ["stun:stun.l.google.com:19302"]},
    {
      "urls": ["turn:turn.example.com:3478"],
      "username": "user",
      "credential": "pass"
    }
  ]
}
```

---

### POST /api/calls/room

Create a group call room in the SFU.

**Auth required:** Yes

**Request**
```json
{"chatId": "uuid", "roomId": "optional-custom-id"}
```

`roomId` defaults to `<chatId>-room` if omitted.

**Response 201**
```json
{"roomId": "uuid-room", "chatId": "uuid"}
```

Broadcasts a `room_created` WS frame to all chat participants.

---

### DELETE /api/calls/room/{roomId}

Destroy a call room.

**Auth required:** Yes

**Response 204**

**Errors:** 404 room not found

---

### GET /api/calls/room/{roomId}/participants

List current participants in a room.

**Auth required:** Yes

**Response 200**
```json
[
  {"userId": "uuid", "deviceId": "uuid", "hasAudio": true, "hasVideo": false}
]
```

**Errors:** 404 room not found

---

### POST /api/calls/room/{roomId}/join

Join a room with an SDP offer (WebRTC negotiation).

**Auth required:** Yes

**Request**
```json
{"sdpOffer": "v=0\r\n...", "deviceId": "uuid"}
```

**Response 200**
```json
{"sdpAnswer": "v=0\r\n..."}
```

Broadcasts `participant_joined` WS frame.

**Errors:** 400 bad SDP · 404 room not found · 409 already in room

---

### POST /api/calls/room/{roomId}/leave

Leave a call room.

**Auth required:** Yes

**Response 204**

Broadcasts `participant_left` WS frame.

**Errors:** 404 room not found

---

## Bots

Rate limit: 60 requests / minute / IP.

### POST /api/bots

Create a bot. The bot token is returned **once** — store it securely.

**Auth required:** Yes

**Request**
```json
{"name": "notifier-bot", "webhookUrl": "http://localhost:9000/hook"}
```

`webhookUrl` is optional. Only `localhost`, `127.x.x.x`, `10.x.x.x`, `192.168.x.x` are allowed.

**Response 201**
```json
{
  "bot": {
    "id": "uuid",
    "name": "notifier-bot",
    "webhookUrl": "http://localhost:9000/hook",
    "active": true,
    "createdAt": 1700000000000
  },
  "token": "<64-hex-char plaintext token>"
}
```

**Errors:** 400 missing name · 422 `{"error": "webhook_url_not_allowed"}`

---

### GET /api/bots

List bots owned by the current user.

**Auth required:** Yes

**Response 200**
```json
{
  "bots": [
    {"id": "uuid", "name": "notifier-bot", "webhookUrl": "...", "active": true, "createdAt": 1700000000000}
  ]
}
```

---

### DELETE /api/bots/{botId}

Delete a bot.

**Auth required:** Yes (must be owner)

**Response 204**

**Errors:** 404 not found or not owner

---

### POST /api/bots/{botId}/token/rotate

Regenerate a bot's API token. Invalidates the previous token.

**Auth required:** Yes (must be owner)

**Response 200**
```json
{"token": "<new 64-hex-char plaintext token>"}
```

Also available as `POST /api/bots/{botId}/token` (same handler).

---

## Downloads

### GET /api/downloads/manifest

List available native app binaries with SHA-256 checksums.

**Auth required:** Yes

**Response 200**
```json
{
  "version": "1.2.3",
  "minClientVersion": "1.0.0",
  "changelog": "Bug fixes",
  "generated_at": "2025-04-20T10:00:00Z",
  "artifacts": [
    {
      "platform": "windows",
      "arch": "x86_64",
      "format": "exe",
      "filename": "messenger-1.2.3-windows-x86_64.exe",
      "url": "/api/downloads/messenger-1.2.3-windows-x86_64.exe",
      "sha256": "<hex>",
      "size_bytes": 52428800
    }
  ]
}
```

---

### GET /api/downloads/{filename}

Download a binary artifact. Path traversal is prevented.

**Auth required:** Yes

**Response 200** — raw binary with `Content-Disposition: attachment; filename="..."`

**Errors:** 404 not found

---

## Admin

All admin endpoints require `Authorization: Bearer <token>` with `role=admin` (or `role=moderator` for a subset of actions).

### Registration Requests

#### GET /api/admin/registration-requests?status=pending

**Response 200**
```json
{
  "requests": [
    {
      "id": "uuid",
      "username": "bob",
      "displayName": "Bob",
      "status": "pending",
      "createdAt": 1700000000000
    }
  ]
}
```

`status` filter is optional.

#### POST /api/admin/registration-requests/{id}/approve

Approves the request and creates the user account. Transfers key material from the request.

**Response 200** `{"status": "approved"}`

**Errors:** 404 not found · 409 already reviewed or username taken

#### POST /api/admin/registration-requests/{id}/reject

**Response 200** `{"status": "rejected"}`

---

### Invite Codes

#### POST /api/admin/invite-codes

Create an invite code with a configurable TTL.

**Request**
```json
{"ttlSeconds": 180}
```

`ttlSeconds` range: 60–600. Default: 180.

**Response 201**
```json
{"code": "a1b2c3d4", "expiresAt": 1700000180000, "ttlSeconds": 180}
```

**Errors:** 422 `{"error": "ttlSeconds out of bounds", "error_code": "invite_ttl_out_of_bounds", "min": 60, "max": 600}`

#### GET /api/admin/invite-codes

**Response 200** `{"codes": [...]}`

Each code object: `code`, `createdBy`, `expiresAt`, `createdAt`, `usedBy`, `revokedAt`.

#### DELETE /api/admin/invite-codes/{code}

Revoke an unused invite code.

**Response 204**

**Errors:** 404 not found or already used

#### GET /api/admin/invite-codes/{code}/activations

**Response 200**
```json
{
  "activations": [
    {"code": "a1b2c3d4", "userId": "uuid", "ip": "1.2.3.4", "userAgent": "...", "activatedAt": 1700000000000}
  ]
}
```

---

### User Management

#### GET /api/admin/users

**Response 200**
```json
{
  "users": [
    {
      "id": "uuid",
      "username": "alice",
      "displayName": "Alice",
      "role": "user",
      "status": "active",
      "createdAt": 1700000000000,
      "quotaBytes": 1073741824,
      "usedBytes": 204800
    }
  ]
}
```

#### POST /api/admin/users/{id}/reset-password

**Request** `{"newPassword": "TempPass123!"}`

**Response 204**

**Errors:** 400 password too short

#### POST /api/admin/users/{id}/suspend

Suspends the account, invalidates all sessions, and forcibly disconnects the user's WebSocket connections.

**Response 204**

#### POST /api/admin/users/{id}/unsuspend

Restores an active status.

**Response 204**

#### POST /api/admin/users/{id}/ban

Bans the account. Moderators cannot ban other admins or moderators.

**Response 204**

**Errors:** 403 insufficient role

#### POST /api/admin/users/{id}/revoke-sessions

Invalidates all sessions and disconnects WebSocket connections without changing account status.

**Response 204**

#### POST /api/admin/users/{id}/remote-wipe

Invalidates all sessions and delivers a `remote_wipe` WebSocket frame to the user's devices, prompting clients to erase local data.

**Response 204**

#### GET /api/admin/users/{id}/quota

**Response 200** `{"quotaBytes": 1073741824, "usedBytes": 204800}`

`quotaBytes=0` means unlimited.

#### PUT /api/admin/users/{id}/quota

**Request** `{"quotaBytes": 1073741824}`

`quotaBytes=0` removes the quota limit.

**Response 204**

**Errors:** 400 negative value

#### PUT /api/admin/users/{id}/role

**Request** `{"role": "moderator"}`

Valid roles: `user`, `moderator`, `admin`.

**Response 204**

---

### Password Reset Requests

#### GET /api/admin/password-reset-requests?status=pending

**Response 200** `{"requests": [...]}`

Each request: `id`, `userId`, `status`, `createdAt`, `resolvedAt`, `resolvedBy`, `tempPassword`.

#### POST /api/admin/password-reset-requests/{id}/resolve

**Request** `{"tempPassword": "TempPass123!"}`

Sets the temporary password and marks the request resolved.

**Response 204**

---

### Settings

#### GET /api/admin/settings/retention

**Response 200** `{"retentionDays": 30}`

`retentionDays=0` means disabled (files kept indefinitely).

#### PUT /api/admin/settings/retention

**Request** `{"retentionDays": 30}`

**Response 204**

#### GET /api/admin/settings/max-group-members

**Response 200** `{"maxMembers": 50}`

#### PUT /api/admin/settings/max-group-members

**Request** `{"maxMembers": 100}`

**Response 204**

**Errors:** 400 must be > 0

---

### System Monitoring (Admin)

#### GET /api/admin/system/stats

Snapshot of host resource usage.

**Auth required:** Admin

**Response 200**
```json
{
  "cpuPercent": 12.5,
  "ramUsed": 1073741824,
  "ramTotal": 8589934592,
  "diskUsed": 53687091200,
  "diskTotal": 107374182400
}
```

#### GET /api/admin/system/stream

Server-Sent Events stream of system stats, emitted every 5 seconds.

**Auth required:** Admin

**Response** `Content-Type: text/event-stream`

```
event: stats
data: {"cpuPercent":12.5,"ramUsed":1073741824,"ramTotal":8589934592,...}

event: stats
data: {...}
```

---

## WebSocket

### Connection

```
GET /ws?token=<jwt>[&deviceId=<uuid>]
Upgrade: websocket
```

- `token` — current access JWT
- `deviceId` — optional; must belong to the authenticated user

Bots authenticate via HTTP header instead:
```
Authorization: Bot <plaintext-token>
```

On auth failure the server sends close code **4001** (`unauthorized`) before closing.

---

### Client → Server frames

All frames are JSON text messages with a `type` field.

#### type: message

Send an E2E-encrypted message to a chat. The `recipients` array must contain one entry per target user (and one for the sender's own copy).

```json
{
  "type": "message",
  "chatId": "uuid",
  "clientMsgId": "client-generated-uuid",
  "senderKeyId": 7,
  "replyToId": "uuid-optional",
  "ttlSeconds": 3600,
  "recipients": [
    {"userId": "uuid-alice", "deviceId": "uuid-optional", "ciphertext": [1,2,3,...]},
    {"userId": "uuid-me",    "deviceId": "uuid-optional", "ciphertext": [4,5,6,...]}
  ]
}
```

`ttlSeconds=0` inherits the chat's default TTL. If `deviceId` is empty the message is delivered to all user devices.

#### type: skdm

Sender Key Distribution Message for group key distribution.

```json
{
  "type": "skdm",
  "chatId": "uuid",
  "recipients": [
    {"userId": "uuid-bob", "ciphertext": [...]}
  ]
}
```

#### type: typing

Broadcast a typing indicator to other chat members.

```json
{"type": "typing", "chatId": "uuid"}
```

#### type: read

Mark a specific message as read.

```json
{"type": "read", "messageId": "uuid"}
```

#### type: call_offer

Initiate a peer-to-peer call.

```json
{
  "type": "call_offer",
  "callId": "uuid",
  "chatId": "uuid",
  "targetId": "uuid",
  "sdp": "v=0\r\n...",
  "isVideo": false
}
```

#### type: call_answer

Accept an incoming call with an SDP answer.

```json
{"type": "call_answer", "callId": "uuid", "sdp": "v=0\r\n..."}
```

#### type: call_reject

Decline an incoming call.

```json
{"type": "call_reject", "callId": "uuid"}
```

#### type: call_end

End an active call.

```json
{"type": "call_end", "callId": "uuid"}
```

#### type: ice_candidate

Relay a WebRTC ICE candidate to the peer.

```json
{"type": "ice_candidate", "callId": "uuid", "candidate": {<RTCIceCandidateInit>}}
```

---

### Server → Client frames

All frames are JSON with a `type` field.

| type | Description |
|---|---|
| `message` | Incoming E2E-encrypted message |
| `ack` | Delivery confirmation for a sent message |
| `skdm` | Incoming Sender Key Distribution Message |
| `typing` | Another user is typing |
| `read` | A message was read by a recipient |
| `message_deleted` | A message was deleted |
| `message_edited` | A message ciphertext was updated |
| `message_expired` | A message exceeded its TTL and was deleted |
| `presence` | User came online or went offline |
| `chat_ttl_updated` | Chat default TTL changed |
| `member_added` | New member joined a group |
| `call_offer` | Incoming call offer |
| `call_answer` | Peer accepted the call |
| `call_reject` | Peer rejected the call |
| `call_end` | Call ended |
| `ice_candidate` | ICE candidate from peer |
| `room_created` | A group call room was created |
| `participant_joined` | User joined a group call room |
| `participant_left` | User left a group call room |
| `prekey_low` | OPK count dropped below 10 — upload more prekeys |
| `device_removed` | One of the user's devices was deleted |
| `remote_wipe` | Admin triggered a wipe — client must erase local data |
| `error` | Protocol error response |

#### message frame (server → client)

```json
{
  "type": "message",
  "messageId": "uuid",
  "clientMsgId": "client-uuid",
  "chatId": "uuid",
  "senderId": "uuid",
  "senderDeviceId": "uuid",
  "ciphertext": [1,2,3,...],
  "senderKeyId": 7,
  "timestamp": 1700000001000,
  "replyToId": "uuid-or-empty",
  "expiresAt": 1700003600000
}
```

#### ack frame

```json
{"type": "ack", "clientMsgId": "client-uuid", "timestamp": 1700000001000}
```

#### presence frame

```json
{"type": "presence", "userId": "uuid", "status": "online"}
```

`status`: `"online"` or `"offline"`.

#### prekey_low frame

```json
{"type": "prekey_low", "count": 3}
```

---

## Utility

### POST /api/client-errors

Log a client-side error to the server (for debugging). No authentication required.

**Auth required:** No

**Request** — free-form JSON

**Response 204**

---

## Common Error Format

All error responses use:

```json
{"error": "human-readable message"}
```

Some errors include an additional stable machine-readable code:

```json
{"error": "invite code expired", "error_code": "invite_expired"}
```

### Standard HTTP status codes

| Code | Meaning |
|---|---|
| 200 | OK |
| 201 | Created |
| 204 | No content |
| 400 | Bad request / validation error |
| 401 | Unauthenticated |
| 403 | Forbidden |
| 404 | Not found |
| 409 | Conflict |
| 410 | Gone (e.g. invite already used/revoked) |
| 413 | Payload too large / quota exceeded |
| 422 | Unprocessable entity (business rule violation) |
| 500 | Internal server error |
| 503 | Service unavailable |
