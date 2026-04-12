# WebRTC Calls — Design Spec (Stage 9)

**Date:** 2026-04-09  
**Status:** ✅ Implemented  
**Scope:** 1-on-1 audio/video calls with WebRTC signaling over WebSocket

---

## 1. Overview

Add real-time audio/video calling to the messenger. The server acts as a signaling relay only — media traffic travels P2P between clients via WebRTC. The server maintains in-memory call state to enforce timeouts, detect busy state, and clean up on disconnect.

**Out of scope:** group calls (requires SFU), call recording, call history persistence.

---

## 2. Architecture

### 2.1 Approach

**Stateful Hub** (Approach B): the existing WebSocket `Hub` is extended with call session state. No new packages; call handlers are methods on `Hub` in `server/internal/ws/hub.go`.

### 2.2 Server-Side

#### Call Session

```go
type callSession struct {
    callID      string
    chatID      string
    initiatorID string
    targetID    string
    state       string    // "ringing" | "active" | "ended"
    timer       *time.Timer
}
```

Added to `Hub`:

```go
calls   map[string]*callSession
callsMu sync.Mutex
```

#### Signaling Handlers

New `inMsg` fields:

```go
// type: call_*
CallID     string `json:"callId"`
TargetID   string `json:"targetId"`   // call_offer only
SDP        string `json:"sdp"`        // call_offer, call_answer
Candidate  json.RawMessage `json:"candidate"` // ice_candidate
```

Handler routing added to `readPump` switch:

| Message type   | Server action |
|----------------|---------------|
| `call_offer`   | Check target busy → create `callSession` in `"ringing"` state → start 30s timer → relay to target |
| `call_answer`  | Transition session to `"active"` → cancel timer → relay to initiator |
| `ice_candidate`| Pure transit: look up peer by callID → relay |
| `call_end`     | Delete session → relay to all participants |
| `call_reject`  | Delete session → relay to initiator |

`call_busy` is sent server-side (not a client-initiated type): when `call_offer` arrives for a target that already has an active/ringing session, server responds to initiator with `call_busy`.

#### Disconnect cleanup

`unregister(c)` is extended: after removing the client, Hub checks if the user has any active call session (as initiator or target). If found, sends `call_end{reason:"hangup"}` to all participants and deletes the session.

#### Timeout

30-second timer started on `call_offer`. On fire: set state to `"ended"`, send `call_end{reason:"timeout"}` to both initiator and target, delete session.

#### ICE Servers Endpoint

`GET /api/calls/ice-servers` (JWT required). Returns STUN and optional TURN configuration.

New environment variables:

| Variable              | Default                          | Description |
|-----------------------|----------------------------------|-------------|
| `STUN_URL`            | `stun:stun.l.google.com:19302`   | STUN server URL |
| `TURN_URL`            | `` (disabled)                    | TURN server URL |
| `TURN_SECRET`         | ``                               | HMAC-SHA256 key for temporary credentials |
| `TURN_CREDENTIAL_TTL` | `86400`                          | Credential TTL in seconds |

TURN credential format (coturn time-limited credentials):
- `username` = `{expiresTimestamp}:{userID}`
- `credential` = `base64(HMAC-SHA256(TURN_SECRET, username))`

Response shape:
```json
{
  "iceServers": [
    { "urls": "stun:stun.l.google.com:19302" },
    { "urls": "turn:example.com:3478", "username": "1234567890:alice", "credential": "abc123==" }
  ]
}
```

TURN entry is omitted from the response when `TURN_URL` is not set.

---

### 2.3 Client-Side

#### New Files

| File | Responsibility |
|------|----------------|
| `client/src/store/callStore.ts` | Zustand store: call state machine, streams, peer info |
| `client/src/hooks/useWebRTC.ts` | `RTCPeerConnection` lifecycle, ICE negotiation, media acquisition |
| `client/src/hooks/useCallHandler.ts` | Incoming WS call-frame handler, delegates to callStore |
| `client/src/components/CallOverlay/CallOverlay.tsx` | Fullscreen overlay UI |
| `client/src/components/CallOverlay/CallOverlay.module.css` | Styles |
| `client/src/utils/ringtone.ts` | Web Audio API ringtone (oscillator, no external files) |

#### callStore State Machine

```
idle
  └─ initiateCall() ──────────────────► calling   (outgoing, awaiting answer)
  └─ incomingCall(frame) ─────────────► ringing   (incoming, awaiting user action)

calling
  └─ onCallAnswer() ──────────────────► active
  └─ onCallEnd/Reject/Busy/timeout ──► idle

ringing
  └─ acceptCall() ────────────────────► active
  └─ rejectCall() ────────────────────► idle
  └─ onCallEnd/timeout ───────────────► idle

active
  └─ hangUp() / onCallEnd ────────────► idle
```

Store fields:

```typescript
interface CallState {
  status: 'idle' | 'ringing' | 'calling' | 'active'
  callId: string | null
  chatId: string | null
  peerId: string | null
  isVideo: boolean
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  isMuted: boolean
  isCameraOff: boolean
}
```

#### useWebRTC Hook

Responsibilities:
- Fetch ICE servers from `/api/calls/ice-servers` on call initiation
- Create `RTCPeerConnection` with fetched config
- Add local media tracks to connection
- Handle `onicecandidate` → send `ice_candidate` via WS
- Handle `ontrack` → set `remoteStream` in callStore
- Create SDP offer (initiator) or answer (receiver)
- Clean up connection and streams on call end

#### useCallHandler Hook

Mounted once at app level. Processes incoming WS frames:

```typescript
case 'call_offer'    → callStore.incomingCall(frame)
case 'call_answer'   → webRTC.handleAnswer(frame.sdp)
case 'ice_candidate' → webRTC.addIceCandidate(frame.candidate)
case 'call_end'      → callStore.reset(); webRTC.cleanup()
case 'call_reject'   → callStore.reset(); show "Call declined" toast
case 'call_busy'     → callStore.reset(); show "User is busy" toast
```

#### WSFrame / WSSendFrame additions

```typescript
// WSFrame (incoming)
| { type: 'call_offer';    callId: string; chatId: string; callerId: string; sdp: string; isVideo: boolean }
| { type: 'call_answer';   callId: string; sdp: string }
| { type: 'call_end';      callId: string; reason?: 'timeout' | 'rejected' | 'hangup' }
| { type: 'call_reject';   callId: string }
| { type: 'call_busy';     callId: string }
| { type: 'ice_candidate'; callId: string; candidate: RTCIceCandidateInit }

// WSSendFrame (outgoing)
| { type: 'call_offer';    callId: string; chatId: string; targetId: string; sdp: string; isVideo: boolean }
| { type: 'call_answer';   callId: string; sdp: string }
| { type: 'call_end';      callId: string }
| { type: 'call_reject';   callId: string }
| { type: 'ice_candidate'; callId: string; candidate: RTCIceCandidateInit }
```

#### CallOverlay Component

Mounted globally in App root, rendered only when `callStore.status !== 'idle'`.

**Ringing state:**
- Caller name and avatar
- "Incoming audio/video call" label
- [Accept] [Decline] buttons
- Ringtone starts on mount, stops on unmount

**Calling state:**
- "Calling…" + peer name
- [Cancel] button

**Active state:**
- Remote video (full screen background)
- Local video (picture-in-picture, bottom right)
- For audio-only calls: avatar placeholder instead of video
- Control bar: [Mute toggle] [Camera toggle] [Hang up]
- Call duration timer

#### Ringtone

`ringtone.ts` uses Web Audio API oscillator. No external audio files required. API:
```typescript
export function startRingtone(): () => void  // returns stop function
```

#### Call Initiation UI

`ChatWindow` header gains two icon buttons: audio call and video call. Visible only for direct chats (group calls out of scope). Disabled if already in a call.

---

## 3. Data Flow

### 3.1 Successful Call

```
Alice                    Server                    Bob
  |── call_offer ───────►|                          |
  |                      |── call_offer ────────────►| ringtone starts
  |                      |                          |
  |                      |◄── call_answer ───────────|
  |◄── call_answer ──────|                          |
  |                      |                          |
  |◄─── ice_candidate ──►|◄─── ice_candidate ───────►| (relayed both ways)
  |                      |                          |
  |══════════════ P2P WebRTC media (bypasses server) ════════════|
  |                      |                          |
  |── call_end ─────────►|── call_end ─────────────►|
```

### 3.2 Timeout (Bob does not answer in 30s)

```
Server: timer fires → delete callSession
  → Deliver(initiatorID, {type:"call_end", reason:"timeout"})
  → Deliver(targetID,    {type:"call_end", reason:"timeout"})
Both clients: stop ringtone/calling UI, reset to idle
```

### 3.3 Busy

```
Alice ── call_offer ──► Server
Server: finds active session for Bob's userID
  → Deliver(aliceID, {type:"call_busy", callId})
Alice: shows toast "User is busy", resets to idle
```

### 3.4 Disconnect During Call

```
Bob's WS closes → Hub.unregister(c)
  → Hub scans calls for Bob → finds active session
  → Deliver(aliceID, {type:"call_end", reason:"hangup"})
  → delete callSession
```

---

## 4. Error Handling

| Situation | Handling |
|-----------|----------|
| `getUserMedia` denied | Show permission error UI, abort call initiation |
| ICE connection failed, TURN available | WebRTC retries automatically via TURN |
| ICE connection failed, no TURN | Send `call_end`, show "Could not establish connection" |
| WS disconnect during call | `onDisconnect` callback resets callStore to idle, show toast |
| Duplicate `call_offer` for same callId | Server ignores (session already exists) |
| `TURN_SECRET` not set | `/api/calls/ice-servers` returns STUN only |

---

## 5. Files to Create / Modify

### Server

| File | Change |
|------|--------|
| `server/internal/ws/hub.go` | Add `callSession`, `calls` map, `callsMu`, call handlers, disconnect cleanup |
| `server/cmd/server/main.go` | Add `GET /api/calls/ice-servers` handler, read new env vars |

### Client

| File | Change |
|------|--------|
| `client/src/types/index.ts` | Add call WSFrame and WSSendFrame types |
| `client/src/store/callStore.ts` | **New** — Zustand call state machine |
| `client/src/hooks/useWebRTC.ts` | **New** — RTCPeerConnection management |
| `client/src/hooks/useCallHandler.ts` | **New** — WS call frame dispatcher |
| `client/src/hooks/useMessengerWS.ts` | Add call frame cases to switch |
| `client/src/components/CallOverlay/CallOverlay.tsx` | **New** — fullscreen overlay |
| `client/src/components/CallOverlay/CallOverlay.module.css` | **New** — styles |
| `client/src/utils/ringtone.ts` | **New** — Web Audio API ringtone |
| `client/src/App.tsx` | Mount `<CallOverlay />` + `useCallHandler()` globally |
| `client/src/components/ChatWindow/ChatWindow.tsx` | Add call buttons to header |

---

## 6. Testing Checklist

- [ ] Alice calls Bob → Bob sees incoming call overlay with ringtone
- [ ] Bob accepts → both see active call, media flows P2P
- [ ] Bob declines → Alice sees "Call declined" toast
- [ ] Bob ignores → after 30s both clients reset to idle
- [ ] Alice calls Bob who is in another call → Alice sees "User is busy"
- [ ] Alice disconnects during active call → Bob's UI resets
- [ ] No TURN configured → `ice-servers` returns STUN only
- [ ] TURN configured → `ice-servers` returns valid temporary credentials
- [ ] Camera/mic toggle works during active call
- [ ] Call initiated from audio button is audio-only (no video track)
- [ ] `getUserMedia` denied → error message shown, no call started
