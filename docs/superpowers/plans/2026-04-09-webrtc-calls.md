# WebRTC Calls (Stage 9) Implementation Plan

> **Статус: ✅ Реализовано** — все задачи выполнены, смержено в main (2026-04-12).

**Goal:** Add 1-on-1 WebRTC audio/video calls with server-side signaling relay, 30-second timeout, busy detection, disconnect cleanup, fullscreen overlay UI with ringtone, and a `/api/calls/ice-servers` endpoint serving temporary HMAC-based TURN credentials.

**Architecture:** The existing WebSocket Hub is extended in-place with a `calls map[string]*callSession` and call handler methods. No new Go packages. A small `server/cmd/server/calls.go` file adds the ICE servers HTTP handler. On the client, a Zustand `callStore` holds state and a `_callFrameHandler` reference that `useCallHandler` populates; `useMessengerWS` dispatches call frames through it, decoupling the two hooks.

**Tech Stack:** Go (signaling Hub, HMAC-SHA256 TURN credentials), TypeScript/React (call hooks, Zustand), Web Audio API (ringtone, no external files), WebRTC `RTCPeerConnection`, CSS Modules (overlay)

---

## File Map

**Create (server):**
- `server/internal/ws/hub_calls_test.go` — unit tests for call handlers
- `server/cmd/server/calls.go` — `iceServersHandler` + `generateTurnCredentials`
- `server/cmd/server/calls_test.go` — unit test for HMAC credential generation

**Modify (server):**
- `server/internal/ws/hub.go` — `callSession` type, Hub fields, `inMsg` fields, handler methods, `unregister` cleanup, `readPump` switch cases
- `server/cmd/server/main.go` — env vars + `/api/calls/ice-servers` route

**Create (client):**
- `client/src/store/callStore.ts`
- `client/src/utils/ringtone.ts`
- `client/src/hooks/useWebRTC.ts`
- `client/src/hooks/useCallHandler.ts`
- `client/src/components/CallOverlay/CallOverlay.tsx`
- `client/src/components/CallOverlay/CallOverlay.module.css`

**Modify (client):**
- `client/src/types/index.ts` — call WSFrame + WSSendFrame types
- `client/src/api/client.ts` — `api.getIceServers()`
- `client/src/hooks/useMessengerWS.ts` — dispatch call frames to callStore
- `client/src/App.tsx` — mount `<CallOverlay />` + `useCallHandler()`
- `client/src/components/ChatWindow/ChatWindow.tsx` — call buttons in header

---

## Task 1: Server — callSession struct, Hub fields, inMsg extensions

**Files:**
- Modify: `server/internal/ws/hub.go`
- Create: `server/internal/ws/hub_calls_test.go`

- [x] **Step 1: Добавить `callSession` тип и поля Hub**

В `hub.go`, после строки `allowedOrigin string`:

```go
// hub.go — изменить Hub struct, добавить два поля
type Hub struct {
	mu            sync.RWMutex
	byUser        map[string]map[*client]struct{}
	jwtSecret     []byte
	db            *sql.DB
	vapidPrivate  string
	vapidPublic   string
	allowedOrigin string
	calls         map[string]*callSession // callID → активная сессия звонка
	callsMu       sync.Mutex
}
```

Добавить тип `callSession` сразу после `type client struct`:

```go
// callSession хранит состояние одного звонка между двумя пользователями.
type callSession struct {
	callID      string
	chatID      string
	initiatorID string
	targetID    string
	state       string // "ringing" | "active"
	timer       *time.Timer
}
```

- [x] **Step 2: Инициализировать `calls` в `NewHub`**

```go
// hub.go — изменить NewHub
func NewHub(jwtSecret string, database *sql.DB, vapidPrivate, vapidPublic, allowedOrigin string) *Hub {
	return &Hub{
		byUser:        make(map[string]map[*client]struct{}),
		calls:         make(map[string]*callSession),
		jwtSecret:     []byte(jwtSecret),
		db:            database,
		vapidPrivate:  vapidPrivate,
		vapidPublic:   vapidPublic,
		allowedOrigin: allowedOrigin,
	}
}
```

- [x] **Step 3: Расширить `inMsg` полями для звонков**

В `hub.go` изменить `type inMsg struct`:

```go
type inMsg struct {
	Type string `json:"type"`

	// type:"message"
	ChatID      string      `json:"chatId"`
	Recipients  []recipient `json:"recipients"`
	SenderKeyID int64       `json:"senderKeyId"`
	ClientMsgID string      `json:"clientMsgId"`

	// type:"read"
	MessageID string `json:"messageId"`

	// type:"call_*"
	CallID    string          `json:"callId"`
	TargetID  string          `json:"targetId"`
	SDP       string          `json:"sdp"`
	IsVideo   bool            `json:"isVideo"`
	Candidate json.RawMessage `json:"candidate"`
}
```

- [x] **Step 4: Создать тестовый файл с хелперами**

`server/internal/ws/hub_calls_test.go`:

```go
package ws

import (
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"github.com/messenger/server/db"
)

func setupTestHub(t *testing.T) *Hub {
	t.Helper()
	database, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return NewHub("secret", database, "", "", "")
}

// addMockClient регистрирует фиктивного клиента и возвращает его канал сообщений.
func addMockClient(h *Hub, userID string) (chan []byte, *client) {
	ch := make(chan []byte, 16)
	c := &client{userID: userID, send: ch}
	h.register(c)
	return ch, c
}

// readFrame читает первое доступное сообщение из канала без блокировки.
func readFrame(ch chan []byte) map[string]any {
	select {
	case raw := <-ch:
		var m map[string]any
		json.Unmarshal(raw, &m) //nolint:errcheck
		return m
	default:
		return nil
	}
}

// setupConversation создаёт пользователей и чат в тестовой БД.
func setupConversation(t *testing.T, database *sql.DB, convID string, memberIDs []string) {
	t.Helper()
	for _, uid := range memberIDs {
		db.CreateUser(database, db.User{ //nolint:errcheck
			ID:           uid,
			Username:     uid,
			DisplayName:  uid,
			PasswordHash: "x",
			CreatedAt:    time.Now().UnixMilli(),
		})
	}
	db.CreateConversation(database, db.Conversation{ //nolint:errcheck
		ID:        convID,
		Type:      "direct",
		Name:      sql.NullString{},
		CreatedAt: time.Now().UnixMilli(),
	}, memberIDs)
}

// stopAllTimers останавливает все таймеры звонков (вызывать в Cleanup).
func stopAllTimers(h *Hub) {
	h.callsMu.Lock()
	defer h.callsMu.Unlock()
	for _, s := range h.calls {
		if s.timer != nil {
			s.timer.Stop()
		}
	}
}
```

- [x] **Step 5: Запустить сборку для проверки компиляции**

```bash
cd server && go build ./...
```

Ожидается: успешная компиляция без ошибок.

- [x] **Step 6: Коммит**

```bash
git add server/internal/ws/hub.go server/internal/ws/hub_calls_test.go
git commit -m "feat(ws): добавить callSession тип, поля Hub и расширения inMsg для WebRTC звонков"
```

---

## Task 2: Server — handleCallOffer

**Files:**
- Modify: `server/internal/ws/hub.go`
- Modify: `server/internal/ws/hub_calls_test.go`

- [x] **Step 1: Написать failing-тест для handleCallOffer**

Добавить в `hub_calls_test.go`:

```go
func TestHandleCallOffer_RelaysToTarget(t *testing.T) {
	h := setupTestHub(t)
	t.Cleanup(func() { stopAllTimers(h) })
	setupConversation(t, h.db, "chat1", []string{"alice", "bob"})

	aliceCh, aliceClient := addMockClient(h, "alice")
	bobCh, _ := addMockClient(h, "bob")

	h.handleCallOffer(aliceClient, inMsg{
		Type:     "call_offer",
		CallID:   "call-1",
		ChatID:   "chat1",
		TargetID: "bob",
		SDP:      "sdp-offer",
		IsVideo:  true,
	})

	// alice не должна получить ничего
	if f := readFrame(aliceCh); f != nil {
		t.Errorf("alice should not receive frame, got %v", f)
	}

	// bob должен получить call_offer
	f := readFrame(bobCh)
	if f == nil {
		t.Fatal("bob did not receive call_offer")
	}
	if f["type"] != "call_offer" {
		t.Errorf("expected call_offer, got %v", f["type"])
	}
	if f["callerId"] != "alice" {
		t.Errorf("expected callerId=alice, got %v", f["callerId"])
	}
	if f["isVideo"] != true {
		t.Errorf("expected isVideo=true, got %v", f["isVideo"])
	}
}

func TestHandleCallOffer_BusyTarget(t *testing.T) {
	h := setupTestHub(t)
	t.Cleanup(func() { stopAllTimers(h) })
	setupConversation(t, h.db, "chat1", []string{"alice", "bob"})
	setupConversation(t, h.db, "chat2", []string{"carol", "bob"})

	aliceCh, aliceClient := addMockClient(h, "alice")
	_, _ = addMockClient(h, "bob")

	// bob уже в звонке с carol
	h.callsMu.Lock()
	h.calls["existing"] = &callSession{
		callID:      "existing",
		chatID:      "chat2",
		initiatorID: "carol",
		targetID:    "bob",
		state:       "ringing",
		timer:       time.AfterFunc(30*time.Second, func() {}),
	}
	h.callsMu.Unlock()

	h.handleCallOffer(aliceClient, inMsg{
		Type:     "call_offer",
		CallID:   "call-2",
		ChatID:   "chat1",
		TargetID: "bob",
		SDP:      "sdp",
	})

	f := readFrame(aliceCh)
	if f == nil {
		t.Fatal("alice should receive call_busy")
	}
	if f["type"] != "call_busy" {
		t.Errorf("expected call_busy, got %v", f["type"])
	}
}
```

- [x] **Step 2: Запустить тест — убедиться что FAIL**

```bash
cd server && go test ./internal/ws/... -run "TestHandleCallOffer" -v
```

Ожидается: ошибка компиляции (`handleCallOffer undefined`).

- [x] **Step 3: Реализовать `handleCallOffer`**

Добавить метод в `hub.go`:

```go
func (h *Hub) handleCallOffer(c *client, msg inMsg) {
	if msg.CallID == "" || msg.TargetID == "" || msg.SDP == "" || msg.ChatID == "" {
		h.errMsg(c, "callId, targetId, chatId and sdp required")
		return
	}
	// Проверяем что инициатор является участником чата
	ok, err := db.IsConversationMember(h.db, msg.ChatID, c.userID)
	if err != nil || !ok {
		h.errMsg(c, "forbidden")
		return
	}

	// Проверяем занятость получателя
	h.callsMu.Lock()
	for _, s := range h.calls {
		if s.initiatorID == msg.TargetID || s.targetID == msg.TargetID {
			h.callsMu.Unlock()
			busy, _ := json.Marshal(map[string]any{
				"type":   "call_busy",
				"callId": msg.CallID,
			})
			h.Deliver(c.userID, busy)
			return
		}
	}

	// Создаём сессию и запускаем таймер 30 секунд
	callID := msg.CallID
	initiatorID := c.userID
	targetID := msg.TargetID
	sess := &callSession{
		callID:      callID,
		chatID:      msg.ChatID,
		initiatorID: initiatorID,
		targetID:    targetID,
		state:       "ringing",
	}
	sess.timer = time.AfterFunc(30*time.Second, func() {
		h.callsMu.Lock()
		delete(h.calls, callID)
		h.callsMu.Unlock()
		timeout, _ := json.Marshal(map[string]any{
			"type":   "call_end",
			"callId": callID,
			"reason": "timeout",
		})
		h.Deliver(initiatorID, timeout)
		h.Deliver(targetID, timeout)
	})
	h.calls[callID] = sess
	h.callsMu.Unlock()

	// Пересылаем offer получателю
	offer, _ := json.Marshal(map[string]any{
		"type":     "call_offer",
		"callId":   callID,
		"chatId":   msg.ChatID,
		"callerId": initiatorID,
		"sdp":      msg.SDP,
		"isVideo":  msg.IsVideo,
	})
	h.Deliver(targetID, offer)
}
```

- [x] **Step 4: Запустить тест — убедиться что PASS**

```bash
cd server && go test ./internal/ws/... -run "TestHandleCallOffer" -v
```

Ожидается: оба теста PASS.

- [x] **Step 5: Коммит**

```bash
git add server/internal/ws/hub.go server/internal/ws/hub_calls_test.go
git commit -m "feat(ws): реализовать handleCallOffer с busy-detection и 30-секундным таймером"
```

---

## Task 3: Server — handleCallAnswer, handleCallEnd, handleCallReject

**Files:**
- Modify: `server/internal/ws/hub.go`
- Modify: `server/internal/ws/hub_calls_test.go`

- [x] **Step 1: Написать failing-тесты**

Добавить в `hub_calls_test.go`:

```go
func TestHandleCallAnswer_RelaysToInitiator(t *testing.T) {
	h := setupTestHub(t)
	t.Cleanup(func() { stopAllTimers(h) })

	aliceCh, _ := addMockClient(h, "alice")
	_, bobClient := addMockClient(h, "bob")

	timer := time.AfterFunc(30*time.Second, func() {})
	h.callsMu.Lock()
	h.calls["call-1"] = &callSession{
		callID:      "call-1",
		chatID:      "chat1",
		initiatorID: "alice",
		targetID:    "bob",
		state:       "ringing",
		timer:       timer,
	}
	h.callsMu.Unlock()

	h.handleCallAnswer(bobClient, inMsg{
		Type:   "call_answer",
		CallID: "call-1",
		SDP:    "sdp-answer",
	})

	f := readFrame(aliceCh)
	if f == nil {
		t.Fatal("alice should receive call_answer")
	}
	if f["type"] != "call_answer" {
		t.Errorf("expected call_answer, got %v", f["type"])
	}
	if f["sdp"] != "sdp-answer" {
		t.Errorf("expected sdp-answer, got %v", f["sdp"])
	}

	// Сессия должна перейти в состояние "active"
	h.callsMu.Lock()
	sess := h.calls["call-1"]
	h.callsMu.Unlock()
	if sess == nil || sess.state != "active" {
		t.Errorf("expected session state=active, got %v", sess)
	}
}

func TestHandleCallEnd_NotifiesBothParties(t *testing.T) {
	h := setupTestHub(t)
	t.Cleanup(func() { stopAllTimers(h) })

	aliceCh, aliceClient := addMockClient(h, "alice")
	bobCh, _ := addMockClient(h, "bob")

	timer := time.AfterFunc(30*time.Second, func() {})
	h.callsMu.Lock()
	h.calls["call-1"] = &callSession{
		callID:      "call-1",
		chatID:      "chat1",
		initiatorID: "alice",
		targetID:    "bob",
		state:       "active",
		timer:       timer,
	}
	h.callsMu.Unlock()

	// Alice завершает звонок
	h.handleCallEnd(aliceClient, inMsg{Type: "call_end", CallID: "call-1"})

	// Alice не должна получить call_end (она сама завершила)
	if f := readFrame(aliceCh); f != nil {
		t.Errorf("alice should not receive call_end, got %v", f)
	}

	// Bob должен получить call_end
	f := readFrame(bobCh)
	if f == nil {
		t.Fatal("bob should receive call_end")
	}
	if f["type"] != "call_end" {
		t.Errorf("expected call_end, got %v", f["type"])
	}
	if f["reason"] != "hangup" {
		t.Errorf("expected reason=hangup, got %v", f["reason"])
	}

	// Сессия должна быть удалена
	h.callsMu.Lock()
	_, exists := h.calls["call-1"]
	h.callsMu.Unlock()
	if exists {
		t.Error("session should be deleted after call_end")
	}
}

func TestHandleCallReject_NotifiesInitiator(t *testing.T) {
	h := setupTestHub(t)
	t.Cleanup(func() { stopAllTimers(h) })

	aliceCh, _ := addMockClient(h, "alice")
	_, bobClient := addMockClient(h, "bob")

	timer := time.AfterFunc(30*time.Second, func() {})
	h.callsMu.Lock()
	h.calls["call-1"] = &callSession{
		callID:      "call-1",
		chatID:      "chat1",
		initiatorID: "alice",
		targetID:    "bob",
		state:       "ringing",
		timer:       timer,
	}
	h.callsMu.Unlock()

	h.handleCallReject(bobClient, inMsg{Type: "call_reject", CallID: "call-1"})

	f := readFrame(aliceCh)
	if f == nil {
		t.Fatal("alice should receive call_reject")
	}
	if f["type"] != "call_reject" {
		t.Errorf("expected call_reject, got %v", f["type"])
	}
}
```

- [x] **Step 2: Запустить тесты — убедиться что FAIL**

```bash
cd server && go test ./internal/ws/... -run "TestHandleCallAnswer|TestHandleCallEnd|TestHandleCallReject" -v
```

Ожидается: ошибки компиляции.

- [x] **Step 3: Реализовать три метода**

Добавить в `hub.go`:

```go
func (h *Hub) handleCallAnswer(c *client, msg inMsg) {
	if msg.CallID == "" || msg.SDP == "" {
		h.errMsg(c, "callId and sdp required")
		return
	}
	h.callsMu.Lock()
	sess, ok := h.calls[msg.CallID]
	if !ok || sess.targetID != c.userID {
		h.callsMu.Unlock()
		h.errMsg(c, "call not found")
		return
	}
	if sess.timer != nil {
		sess.timer.Stop()
		sess.timer = nil
	}
	sess.state = "active"
	initiatorID := sess.initiatorID
	h.callsMu.Unlock()

	answer, _ := json.Marshal(map[string]any{
		"type":   "call_answer",
		"callId": msg.CallID,
		"sdp":    msg.SDP,
	})
	h.Deliver(initiatorID, answer)
}

func (h *Hub) handleCallEnd(c *client, msg inMsg) {
	if msg.CallID == "" {
		h.errMsg(c, "callId required")
		return
	}
	h.callsMu.Lock()
	sess, ok := h.calls[msg.CallID]
	if !ok {
		h.callsMu.Unlock()
		return
	}
	if sess.timer != nil {
		sess.timer.Stop()
	}
	delete(h.calls, msg.CallID)
	initiatorID := sess.initiatorID
	targetID := sess.targetID
	h.callsMu.Unlock()

	end, _ := json.Marshal(map[string]any{
		"type":   "call_end",
		"callId": msg.CallID,
		"reason": "hangup",
	})
	if c.userID != initiatorID {
		h.Deliver(initiatorID, end)
	}
	if c.userID != targetID {
		h.Deliver(targetID, end)
	}
}

func (h *Hub) handleCallReject(c *client, msg inMsg) {
	if msg.CallID == "" {
		h.errMsg(c, "callId required")
		return
	}
	h.callsMu.Lock()
	sess, ok := h.calls[msg.CallID]
	if !ok {
		h.callsMu.Unlock()
		return
	}
	if sess.timer != nil {
		sess.timer.Stop()
	}
	initiatorID := sess.initiatorID
	delete(h.calls, msg.CallID)
	h.callsMu.Unlock()

	reject, _ := json.Marshal(map[string]any{
		"type":   "call_reject",
		"callId": msg.CallID,
	})
	h.Deliver(initiatorID, reject)
}
```

- [x] **Step 4: Запустить тесты — убедиться что PASS**

```bash
cd server && go test ./internal/ws/... -run "TestHandleCallAnswer|TestHandleCallEnd|TestHandleCallReject" -v
```

Ожидается: все тесты PASS.

- [x] **Step 5: Коммит**

```bash
git add server/internal/ws/hub.go server/internal/ws/hub_calls_test.go
git commit -m "feat(ws): реализовать handleCallAnswer, handleCallEnd, handleCallReject"
```

---

## Task 4: Server — handleIceCandidate, unregister cleanup, readPump routing

**Files:**
- Modify: `server/internal/ws/hub.go`
- Modify: `server/internal/ws/hub_calls_test.go`

- [x] **Step 1: Написать failing-тест для ICE relay**

Добавить в `hub_calls_test.go`:

```go
func TestHandleIceCandidate_RelaysToPeer(t *testing.T) {
	h := setupTestHub(t)
	t.Cleanup(func() { stopAllTimers(h) })

	aliceCh, _ := addMockClient(h, "alice")
	bobCh, bobClient := addMockClient(h, "bob")

	h.callsMu.Lock()
	h.calls["call-1"] = &callSession{
		callID:      "call-1",
		chatID:      "chat1",
		initiatorID: "alice",
		targetID:    "bob",
		state:       "active",
	}
	h.callsMu.Unlock()

	candidate := json.RawMessage(`{"candidate":"ufrag","sdpMid":"0","sdpMLineIndex":0}`)
	h.handleIceCandidate(bobClient, inMsg{
		Type:      "ice_candidate",
		CallID:    "call-1",
		Candidate: candidate,
	})

	// bob не должен получить свой же кандидат
	if f := readFrame(bobCh); f != nil {
		t.Errorf("bob should not receive own candidate, got %v", f)
	}

	// alice должна получить кандидат
	f := readFrame(aliceCh)
	if f == nil {
		t.Fatal("alice should receive ice_candidate")
	}
	if f["type"] != "ice_candidate" {
		t.Errorf("expected ice_candidate, got %v", f["type"])
	}
}

func TestUnregisterCleansUpCall(t *testing.T) {
	h := setupTestHub(t)
	t.Cleanup(func() { stopAllTimers(h) })

	aliceCh, aliceClient := addMockClient(h, "alice")
	bobCh, _ := addMockClient(h, "bob")

	timer := time.AfterFunc(30*time.Second, func() {})
	h.callsMu.Lock()
	h.calls["call-1"] = &callSession{
		callID:      "call-1",
		chatID:      "chat1",
		initiatorID: "alice",
		targetID:    "bob",
		state:       "active",
		timer:       timer,
	}
	h.callsMu.Unlock()

	// Alice отключается
	h.unregister(aliceClient)
	_ = aliceCh // канал закрыт

	// Дать горутине время завершиться
	time.Sleep(10 * time.Millisecond)

	// Bob должен получить call_end
	f := readFrame(bobCh)
	if f == nil {
		t.Fatal("bob should receive call_end after alice disconnects")
	}
	if f["type"] != "call_end" {
		t.Errorf("expected call_end, got %v", f["type"])
	}
	if f["reason"] != "hangup" {
		t.Errorf("expected reason=hangup, got %v", f["reason"])
	}

	// Сессия должна быть удалена
	h.callsMu.Lock()
	_, exists := h.calls["call-1"]
	h.callsMu.Unlock()
	if exists {
		t.Error("session should be deleted after disconnect")
	}
}
```

- [x] **Step 2: Запустить тесты — убедиться что FAIL**

```bash
cd server && go test ./internal/ws/... -run "TestHandleIceCandidate|TestUnregister" -v
```

Ожидается: ошибки компиляции.

- [x] **Step 3: Реализовать `handleIceCandidate`**

Добавить в `hub.go`:

```go
func (h *Hub) handleIceCandidate(c *client, msg inMsg) {
	if msg.CallID == "" || len(msg.Candidate) == 0 {
		h.errMsg(c, "callId and candidate required")
		return
	}
	h.callsMu.Lock()
	sess, ok := h.calls[msg.CallID]
	if !ok {
		h.callsMu.Unlock()
		return
	}
	peerID := sess.initiatorID
	if c.userID == sess.initiatorID {
		peerID = sess.targetID
	}
	h.callsMu.Unlock()

	payload, _ := json.Marshal(map[string]any{
		"type":      "ice_candidate",
		"callId":    msg.CallID,
		"candidate": msg.Candidate,
	})
	h.Deliver(peerID, payload)
}
```

- [x] **Step 4: Реализовать `cleanupCallsForUser` и изменить `unregister`**

Добавить метод `cleanupCallsForUser` в `hub.go`:

```go
// cleanupCallsForUser завершает все звонки пользователя при разрыве соединения.
func (h *Hub) cleanupCallsForUser(userID string) {
	h.callsMu.Lock()
	type callCleanup struct {
		callID string
		peerID string
	}
	var toClean []callCleanup
	for id, s := range h.calls {
		if s.initiatorID == userID || s.targetID == userID {
			if s.timer != nil {
				s.timer.Stop()
			}
			peer := s.targetID
			if s.initiatorID != userID {
				peer = s.initiatorID
			}
			toClean = append(toClean, callCleanup{callID: id, peerID: peer})
			delete(h.calls, id)
		}
	}
	h.callsMu.Unlock()

	if len(toClean) == 0 {
		return
	}
	for _, cc := range toClean {
		end, _ := json.Marshal(map[string]any{
			"type":   "call_end",
			"callId": cc.callID,
			"reason": "hangup",
		})
		h.Deliver(cc.peerID, end)
	}
}
```

Изменить `unregister` в `hub.go` (убрать `defer`, вызвать cleanup после разблокировки):

```go
func (h *Hub) unregister(c *client) {
	h.mu.Lock()
	if set, ok := h.byUser[c.userID]; ok {
		delete(set, c)
		if len(set) == 0 {
			delete(h.byUser, c.userID)
		}
	}
	h.mu.Unlock()
	close(c.send)
	h.cleanupCallsForUser(c.userID)
}
```

- [x] **Step 5: Добавить call-case в `readPump` switch**

В `readPump` в `hub.go`, расширить `switch msg.Type`:

```go
switch msg.Type {
case "message":
    h.handleMessage(c, msg)
case "skdm":
    h.handleSKDM(c, msg)
case "typing":
    h.handleTyping(c, msg)
case "read":
    h.handleRead(c, msg)
case "call_offer":
    h.handleCallOffer(c, msg)
case "call_answer":
    h.handleCallAnswer(c, msg)
case "call_end":
    h.handleCallEnd(c, msg)
case "call_reject":
    h.handleCallReject(c, msg)
case "ice_candidate":
    h.handleIceCandidate(c, msg)
default:
    h.errMsg(c, "unknown type: "+msg.Type)
}
```

- [x] **Step 6: Запустить все тесты — убедиться что PASS**

```bash
cd server && go test ./internal/ws/... -v
```

Ожидается: все тесты PASS.

- [x] **Step 7: Коммит**

```bash
git add server/internal/ws/hub.go server/internal/ws/hub_calls_test.go
git commit -m "feat(ws): handleIceCandidate, cleanupCallsForUser при disconnect, routing в readPump"
```

---

## Task 5: Server — /api/calls/ice-servers endpoint

**Files:**
- Create: `server/cmd/server/calls.go`
- Create: `server/cmd/server/calls_test.go`
- Modify: `server/cmd/server/main.go`

- [x] **Step 1: Написать failing-тест**

`server/cmd/server/calls_test.go`:

```go
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"testing"
	"time"
)

func TestGenerateTurnCredentials_Format(t *testing.T) {
	secret := "test-secret"
	userID := "alice"
	ttl := int64(3600)

	username, credential := generateTurnCredentials(secret, userID, ttl)

	var expires int64
	var uid string
	if _, err := fmt.Sscanf(username, "%d:%s", &expires, &uid); err != nil {
		t.Fatalf("invalid username format %q: %v", username, err)
	}
	if uid != userID {
		t.Errorf("expected userID=%q, got %q", userID, uid)
	}
	now := time.Now().Unix()
	if expires < now || expires > now+ttl+5 {
		t.Errorf("expires %d out of expected range [%d, %d]", expires, now, now+ttl+5)
	}

	// Проверяем HMAC
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(username))
	expected := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if credential != expected {
		t.Errorf("credential mismatch: got %q, want %q", credential, expected)
	}
}

func TestGenerateTurnCredentials_DifferentUsers(t *testing.T) {
	_, c1 := generateTurnCredentials("secret", "alice", 3600)
	_, c2 := generateTurnCredentials("secret", "bob", 3600)
	if c1 == c2 {
		t.Error("different users should produce different credentials")
	}
}
```

- [x] **Step 2: Запустить тест — убедиться что FAIL**

```bash
cd server && go test ./cmd/server/... -run "TestGenerateTurnCredentials" -v
```

Ожидается: ошибка компиляции.

- [x] **Step 3: Создать `server/cmd/server/calls.go`**

```go
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/messenger/server/internal/auth"
)

type iceServerEntry struct {
	URLs       string `json:"urls"`
	Username   string `json:"username,omitempty"`
	Credential string `json:"credential,omitempty"`
}

// iceServersHandler возвращает STUN и опционально TURN с временными credentials.
// Монтируется под auth.Middleware.
func iceServersHandler(stunURL, turnURL, turnSecret string, ttl int64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := auth.UserIDFromCtx(r)
		servers := []iceServerEntry{{URLs: stunURL}}
		if turnURL != "" && turnSecret != "" {
			username, credential := generateTurnCredentials(turnSecret, userID, ttl)
			servers = append(servers, iceServerEntry{
				URLs:       turnURL,
				Username:   username,
				Credential: credential,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"iceServers": servers}) //nolint:errcheck
	}
}

// generateTurnCredentials создаёт временные HMAC-SHA256 credentials для coturn.
// username = "{expiresUnixTimestamp}:{userID}"
// credential = base64(HMAC-SHA256(secret, username))
func generateTurnCredentials(secret, userID string, ttl int64) (username, credential string) {
	expires := time.Now().Unix() + ttl
	username = fmt.Sprintf("%d:%s", expires, userID)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(username))
	credential = base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return
}
```

- [x] **Step 4: Запустить тест — убедиться что PASS**

```bash
cd server && go test ./cmd/server/... -run "TestGenerateTurnCredentials" -v
```

Ожидается: оба теста PASS.

- [x] **Step 5: Зарегистрировать роут в `main.go`**

В `main.go` добавить после `mediaDir := getenv(...)`:

```go
stunURL     := getenv("STUN_URL", "stun:stun.l.google.com:19302")
turnURL     := getenv("TURN_URL", "")
turnSecret  := getenv("TURN_SECRET", "")
turnTTLStr  := getenv("TURN_CREDENTIAL_TTL", "86400")
turnTTL     := int64(86400)
if v, err := strconv.ParseInt(turnTTLStr, 10, 64); err == nil {
    turnTTL = v
}
```

В `main.go` добавить `"strconv"` в imports.

В JWT-защищённой группе роутов добавить строку:

```go
r.Get("/calls/ice-servers", iceServersHandler(stunURL, turnURL, turnSecret, turnTTL))
```

- [x] **Step 6: Собрать и запустить все серверные тесты**

```bash
cd server && go build ./... && go test ./...
```

Ожидается: успешная сборка, все тесты PASS.

- [x] **Step 7: Коммит**

```bash
git add server/cmd/server/calls.go server/cmd/server/calls_test.go server/cmd/server/main.go
git commit -m "feat(calls): добавить GET /api/calls/ice-servers с HMAC TURN credentials"
```

---

## Task 6: Client — TypeScript types + API client extension

**Files:**
- Modify: `client/src/types/index.ts`
- Modify: `client/src/api/client.ts`

- [x] **Step 1: Добавить call-типы в `types/index.ts`**

В файле `client/src/types/index.ts` в конец блока `export type WSFrame =` добавить новые ветки (после `| { type: 'skdm'; ... }`):

```typescript
export type WSFrame =
  | { type: 'message'; chatId: string; ciphertext: string; senderKeyId: number; senderId: string; timestamp: number; messageId: string; clientMsgId?: string }
  | { type: 'ack'; clientMsgId: string; chatId?: string; timestamp: number }
  | { type: 'typing'; chatId: string; userId: string }
  | { type: 'presence'; userId: string; status: 'online' | 'offline' }
  | { type: 'prekey_request' }
  | { type: 'prekey_low'; count: number }
  | { type: 'read'; chatId: string; messageId: string; userId: string }
  | { type: 'message_deleted'; chatId: string; clientMsgId: string }
  | { type: 'message_edited'; chatId: string; clientMsgId: string; ciphertext: string; editedAt: number }
  | { type: 'skdm'; chatId: string; senderId: string; ciphertext: string }
  // WebRTC signaling (входящие)
  | { type: 'call_offer';    callId: string; chatId: string; callerId: string; sdp: string; isVideo: boolean }
  | { type: 'call_answer';   callId: string; sdp: string }
  | { type: 'call_end';      callId: string; reason?: 'timeout' | 'rejected' | 'hangup' }
  | { type: 'call_reject';   callId: string }
  | { type: 'call_busy';     callId: string }
  | { type: 'ice_candidate'; callId: string; candidate: RTCIceCandidateInit }
```

В конец блока `export type WSSendFrame =` добавить:

```typescript
export type WSSendFrame =
  | { type: 'message'; chatId: string; clientMsgId: string; senderKeyId: number; recipients: Array<{ userId: string; ciphertext: string }> }
  | { type: 'skdm'; chatId: string; recipients: Array<{ userId: string; ciphertext: string }> }
  | { type: 'typing'; chatId: string }
  | { type: 'read'; chatId: string; messageId: string }
  // WebRTC signaling (исходящие)
  | { type: 'call_offer';    callId: string; chatId: string; targetId: string; sdp: string; isVideo: boolean }
  | { type: 'call_answer';   callId: string; sdp: string }
  | { type: 'call_end';      callId: string }
  | { type: 'call_reject';   callId: string }
  | { type: 'ice_candidate'; callId: string; candidate: RTCIceCandidateInit }
```

- [x] **Step 2: Добавить `api.getIceServers()` в `client/src/api/client.ts`**

В объект `export const api = {` добавить метод (в конец списка методов):

```typescript
  async getIceServers(): Promise<{ iceServers: RTCIceServer[] }> {
    return req<{ iceServers: RTCIceServer[] }>('/api/calls/ice-servers')
  },
```

- [x] **Step 3: Проверить компиляцию**

```bash
cd client && npm run type-check
```

Ожидается: 0 ошибок.

- [x] **Step 4: Коммит**

```bash
git add client/src/types/index.ts client/src/api/client.ts
git commit -m "feat(client): добавить WebRTC call-типы и api.getIceServers"
```

---

## Task 7: Client — callStore

**Files:**
- Create: `client/src/store/callStore.ts`

- [x] **Step 1: Создать `client/src/store/callStore.ts`**

```typescript
import { create } from 'zustand'
import type { WSFrame } from '@/types'

export type CallStatus = 'idle' | 'ringing' | 'calling' | 'active'

type CallWSFrame = Extract<WSFrame, {
  type: 'call_offer' | 'call_answer' | 'call_end' | 'call_reject' | 'call_busy' | 'ice_candidate'
}>

interface IncomingOffer {
  callId: string
  chatId: string
  callerId: string
  sdp: string
  isVideo: boolean
}

interface CallState {
  status: CallStatus
  callId: string | null
  chatId: string | null
  peerId: string | null
  isVideo: boolean
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  isMuted: boolean
  isCameraOff: boolean
  /** Pending offer от входящего звонка — используется при accept */
  incomingOffer: IncomingOffer | null
  /** Уведомление для UI (busy / rejected) */
  notification: string | null

  // Actions
  startOutgoing: (callId: string, chatId: string, peerId: string, isVideo: boolean) => void
  setIncoming: (offer: IncomingOffer) => void
  setActive: () => void
  setLocalStream: (stream: MediaStream) => void
  setRemoteStream: (stream: MediaStream) => void
  toggleMute: () => void
  toggleCamera: () => void
  setNotification: (msg: string | null) => void
  reset: () => void

  /**
   * Устанавливается useCallHandler при монтировании.
   * useMessengerWS вызывает этот обработчик для routing call-фреймов.
   */
  _callFrameHandler: ((frame: CallWSFrame) => void) | null
  setCallFrameHandler: (fn: ((frame: CallWSFrame) => void) | null) => void
}

const emptyState = {
  status: 'idle' as CallStatus,
  callId: null,
  chatId: null,
  peerId: null,
  isVideo: false,
  localStream: null,
  remoteStream: null,
  isMuted: false,
  isCameraOff: false,
  incomingOffer: null,
  notification: null,
}

export const useCallStore = create<CallState>((set, get) => ({
  ...emptyState,
  _callFrameHandler: null,

  startOutgoing: (callId, chatId, peerId, isVideo) =>
    set({ status: 'calling', callId, chatId, peerId, isVideo }),

  setIncoming: (offer) =>
    set({ status: 'ringing', callId: offer.callId, chatId: offer.chatId, peerId: offer.callerId, isVideo: offer.isVideo, incomingOffer: offer }),

  setActive: () => set({ status: 'active', incomingOffer: null }),

  setLocalStream: (stream) => set({ localStream: stream }),

  setRemoteStream: (stream) => set({ remoteStream: stream }),

  toggleMute: () => set((s) => {
    s.localStream?.getAudioTracks().forEach((t) => { t.enabled = s.isMuted })
    return { isMuted: !s.isMuted }
  }),

  toggleCamera: () => set((s) => {
    s.localStream?.getVideoTracks().forEach((t) => { t.enabled = s.isCameraOff })
    return { isCameraOff: !s.isCameraOff }
  }),

  setNotification: (msg) => set({ notification: msg }),

  reset: () => set((s) => {
    s.localStream?.getTracks().forEach((t) => t.stop())
    s.remoteStream?.getTracks().forEach((t) => t.stop())
    return { ...emptyState }
  }),

  setCallFrameHandler: (fn) => set({ _callFrameHandler: fn }),
}))
```

- [x] **Step 2: Проверить компиляцию**

```bash
cd client && npm run type-check
```

Ожидается: 0 ошибок.

- [x] **Step 3: Коммит**

```bash
git add client/src/store/callStore.ts
git commit -m "feat(client): добавить callStore — Zustand state machine для звонков"
```

---

## Task 8: Client — ringtone.ts

**Files:**
- Create: `client/src/utils/ringtone.ts`

- [x] **Step 1: Создать `client/src/utils/ringtone.ts`**

```typescript
/**
 * Ringtone на Web Audio API — пульсирующий тональный сигнал без внешних файлов.
 * Возвращает функцию остановки.
 */
export function startRingtone(): () => void {
  let active = true
  let currentCtx: AudioContext | null = null

  function beep(): void {
    if (!active) return
    try {
      const ctx = new AudioContext()
      currentCtx = ctx
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.type = 'sine'
      osc.frequency.value = 440

      gain.gain.setValueAtTime(0.15, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7)

      osc.start()
      osc.stop(ctx.currentTime + 0.7)
      osc.onended = () => {
        ctx.close()
        currentCtx = null
        if (active) setTimeout(beep, 600)
      }
    } catch {
      // AudioContext может быть недоступен в некоторых окружениях
    }
  }

  beep()

  return () => {
    active = false
    currentCtx?.close()
    currentCtx = null
  }
}
```

- [x] **Step 2: Проверить компиляцию**

```bash
cd client && npm run type-check
```

Ожидается: 0 ошибок.

- [x] **Step 3: Коммит**

```bash
git add client/src/utils/ringtone.ts
git commit -m "feat(client): добавить ringtone утилиту на Web Audio API"
```

---

## Task 9: Client — useWebRTC hook

**Files:**
- Create: `client/src/hooks/useWebRTC.ts`

- [x] **Step 1: Создать `client/src/hooks/useWebRTC.ts`**

```typescript
import { useRef, useCallback } from 'react'
import { api } from '@/api/client'
import { useCallStore } from '@/store/callStore'
import { useWsStore } from '@/store/wsStore'

export interface WebRTCControls {
  initiateCall: (callId: string, chatId: string, targetId: string, isVideo: boolean) => Promise<void>
  acceptOffer: (callId: string, sdp: string, isVideo: boolean) => Promise<void>
  handleAnswer: (sdp: string) => Promise<void>
  addIceCandidate: (candidate: RTCIceCandidateInit) => Promise<void>
  hangUp: () => void
}

export function useWebRTC(): WebRTCControls {
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const callIdRef = useRef<string | null>(null)

  const send = useWsStore((s) => s.send)
  const setLocalStream = useCallStore((s) => s.setLocalStream)
  const setRemoteStream = useCallStore((s) => s.setRemoteStream)
  const setActive = useCallStore((s) => s.setActive)
  const reset = useCallStore((s) => s.reset)

  const getIceServers = useCallback(async (): Promise<RTCIceServer[]> => {
    try {
      const data = await api.getIceServers()
      return data.iceServers as RTCIceServer[]
    } catch {
      return [{ urls: 'stun:stun.l.google.com:19302' }]
    }
  }, [])

  const createPC = useCallback(async (callId: string): Promise<RTCPeerConnection> => {
    const iceServers = await getIceServers()
    const pc = new RTCPeerConnection({ iceServers })
    callIdRef.current = callId
    pcRef.current = pc

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && callIdRef.current) {
        send?.({
          type: 'ice_candidate',
          callId: callIdRef.current,
          candidate: candidate.toJSON() as RTCIceCandidateInit,
        })
      }
    }

    pc.ontrack = (event) => {
      const stream = event.streams[0]
      if (stream) setRemoteStream(stream)
    }

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState
      if (state === 'failed' || state === 'closed') {
        hangUp()
      }
    }

    return pc
  }, [getIceServers, send, setRemoteStream])

  const getLocalStream = useCallback(async (isVideo: boolean): Promise<MediaStream> => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideo })
    setLocalStream(stream)
    return stream
  }, [setLocalStream])

  const initiateCall = useCallback(async (callId: string, chatId: string, targetId: string, isVideo: boolean) => {
    const pc = await createPC(callId)
    const stream = await getLocalStream(isVideo)
    stream.getTracks().forEach((track) => pc.addTrack(track, stream))

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    send?.({
      type: 'call_offer',
      callId,
      chatId,
      targetId,
      sdp: offer.sdp!,
      isVideo,
    })
  }, [createPC, getLocalStream, send])

  const acceptOffer = useCallback(async (callId: string, sdp: string, isVideo: boolean) => {
    const pc = await createPC(callId)
    const stream = await getLocalStream(isVideo)
    stream.getTracks().forEach((track) => pc.addTrack(track, stream))

    await pc.setRemoteDescription({ type: 'offer', sdp })
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    setActive()

    send?.({
      type: 'call_answer',
      callId,
      sdp: answer.sdp!,
    })
  }, [createPC, getLocalStream, send, setActive])

  const handleAnswer = useCallback(async (sdp: string) => {
    if (!pcRef.current) return
    await pcRef.current.setRemoteDescription({ type: 'answer', sdp })
    setActive()
  }, [setActive])

  const addIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    if (!pcRef.current) return
    try {
      await pcRef.current.addIceCandidate(candidate)
    } catch {
      // ICE candidate может прийти до setRemoteDescription — игнорируем
    }
  }, [])

  const hangUp = useCallback(() => {
    const callId = callIdRef.current
    if (callId) {
      send?.({ type: 'call_end', callId })
    }
    pcRef.current?.close()
    pcRef.current = null
    callIdRef.current = null
    reset()
  }, [send, reset])

  return { initiateCall, acceptOffer, handleAnswer, addIceCandidate, hangUp }
}
```

- [x] **Step 2: Проверить компиляцию**

```bash
cd client && npm run type-check
```

Ожидается: 0 ошибок.

- [x] **Step 3: Коммит**

```bash
git add client/src/hooks/useWebRTC.ts
git commit -m "feat(client): добавить useWebRTC — управление RTCPeerConnection"
```

---

## Task 10: Client — useCallHandler

**Files:**
- Create: `client/src/hooks/useCallHandler.ts`

- [x] **Step 1: Создать `client/src/hooks/useCallHandler.ts`**

```typescript
import { useEffect, useCallback } from 'react'
import { useCallStore } from '@/store/callStore'
import { useWebRTC } from '@/hooks/useWebRTC'
import { useWsStore } from '@/store/wsStore'
import type { WSFrame } from '@/types'

type CallWSFrame = Extract<WSFrame, {
  type: 'call_offer' | 'call_answer' | 'call_end' | 'call_reject' | 'call_busy' | 'ice_candidate'
}>

export interface CallActions {
  initiateCall: (chatId: string, targetId: string, isVideo: boolean) => void
  acceptCall: () => void
  rejectCall: () => void
  hangUp: () => void
}

export function useCallHandler(): CallActions {
  const webRTC = useWebRTC()
  const setCallFrameHandler = useCallStore((s) => s.setCallFrameHandler)
  const setIncoming = useCallStore((s) => s.setIncoming)
  const setNotification = useCallStore((s) => s.setNotification)
  const send = useWsStore((s) => s.send)

  // Обработчик call-фреймов, вызывается из useMessengerWS
  const handleCallFrame = useCallback((frame: CallWSFrame) => {
    switch (frame.type) {
      case 'call_offer':
        setIncoming({ callId: frame.callId, chatId: frame.chatId, callerId: frame.callerId, sdp: frame.sdp, isVideo: frame.isVideo })
        break

      case 'call_answer':
        webRTC.handleAnswer(frame.sdp).catch((e) =>
          console.error('handleAnswer failed', e)
        )
        break

      case 'ice_candidate':
        webRTC.addIceCandidate(frame.candidate).catch((e) =>
          console.error('addIceCandidate failed', e)
        )
        break

      case 'call_end':
        useCallStore.getState().reset()
        break

      case 'call_reject':
        useCallStore.getState().reset()
        setNotification('Звонок отклонён')
        setTimeout(() => setNotification(null), 3000)
        break

      case 'call_busy':
        useCallStore.getState().reset()
        setNotification('Абонент занят')
        setTimeout(() => setNotification(null), 3000)
        break
    }
  }, [webRTC, setIncoming, setNotification])

  // Регистрируем обработчик в callStore, чтобы useMessengerWS мог его вызывать
  useEffect(() => {
    setCallFrameHandler(handleCallFrame)
    return () => setCallFrameHandler(null)
  }, [handleCallFrame, setCallFrameHandler])

  // === Публичные action-функции ===

  const initiateCall = useCallback((chatId: string, targetId: string, isVideo: boolean) => {
    const callId = crypto.randomUUID()
    useCallStore.getState().startOutgoing(callId, chatId, targetId, isVideo)
    webRTC.initiateCall(callId, chatId, targetId, isVideo).catch((e) => {
      console.error('initiateCall failed', e)
      useCallStore.getState().reset()
    })
  }, [webRTC])

  const acceptCall = useCallback(() => {
    const { incomingOffer } = useCallStore.getState()
    if (!incomingOffer) return
    webRTC.acceptOffer(incomingOffer.callId, incomingOffer.sdp, incomingOffer.isVideo).catch((e) => {
      console.error('acceptOffer failed', e)
      useCallStore.getState().reset()
    })
  }, [webRTC])

  const rejectCall = useCallback(() => {
    const { callId } = useCallStore.getState()
    if (callId) {
      send?.({ type: 'call_reject', callId })
    }
    useCallStore.getState().reset()
  }, [send])

  const hangUp = useCallback(() => {
    webRTC.hangUp()
  }, [webRTC])

  return { initiateCall, acceptCall, rejectCall, hangUp }
}
```

- [x] **Step 2: Проверить компиляцию**

```bash
cd client && npm run type-check
```

Ожидается: 0 ошибок.

- [x] **Step 3: Коммит**

```bash
git add client/src/hooks/useCallHandler.ts
git commit -m "feat(client): добавить useCallHandler — оркестрация WebRTC и routing WS фреймов"
```

---

## Task 11: Client — useMessengerWS call frame routing

**Files:**
- Modify: `client/src/hooks/useMessengerWS.ts`

- [x] **Step 1: Добавить call-фреймы в switch внутри `useMessengerWS.ts`**

В файле `useMessengerWS.ts` в блоке обработки фреймов (switch по `frame.type`) добавить case-ветки ПЕРЕД `default:`/ветками `unknown`:

```typescript
case 'call_offer':
case 'call_answer':
case 'call_end':
case 'call_reject':
case 'call_busy':
case 'ice_candidate': {
  // Делегируем в useCallHandler через callStore._callFrameHandler
  const handler = useCallStore.getState()._callFrameHandler
  handler?.(frame as Parameters<typeof handler>[0])
  break
}
```

В начало файла добавить импорт:

```typescript
import { useCallStore } from '@/store/callStore'
```

- [x] **Step 2: Проверить компиляцию**

```bash
cd client && npm run type-check
```

Ожидается: 0 ошибок.

- [x] **Step 3: Запустить lint**

```bash
cd client && npm run lint
```

Ожидается: 0 warnings.

- [x] **Step 4: Коммит**

```bash
git add client/src/hooks/useMessengerWS.ts
git commit -m "feat(client): routing WebRTC call-фреймов из useMessengerWS в useCallHandler"
```

---

## Task 12: Client — CallOverlay component

**Files:**
- Create: `client/src/components/CallOverlay/CallOverlay.tsx`
- Create: `client/src/components/CallOverlay/CallOverlay.module.css`

- [x] **Step 1: Создать `CallOverlay.module.css`**

`client/src/components/CallOverlay/CallOverlay.module.css`:

```css
.overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #1a1a2e;
  color: #fff;
}

.remoteVideo {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #111;
}

.localVideo {
  position: absolute;
  bottom: 100px;
  right: 16px;
  width: 120px;
  height: 90px;
  border-radius: 8px;
  object-fit: cover;
  background: #222;
  border: 2px solid rgba(255,255,255,0.2);
}

.avatar {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: #333;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  margin-bottom: 16px;
}

.peerName {
  font-size: 24px;
  font-weight: 600;
  margin-bottom: 8px;
}

.statusText {
  font-size: 14px;
  color: rgba(255,255,255,0.6);
  margin-bottom: 48px;
}

.controls {
  position: absolute;
  bottom: 32px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  gap: 24px;
}

.btn {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  transition: opacity 0.15s;
}

.btn:hover { opacity: 0.85; }

.btnAccept  { background: #22c55e; }
.btnReject  { background: #ef4444; }
.btnHangup  { background: #ef4444; }
.btnMute    { background: rgba(255,255,255,0.15); }
.btnCamera  { background: rgba(255,255,255,0.15); }
.btnMuted   { background: rgba(255,255,255,0.05); }
.btnCamOff  { background: rgba(255,255,255,0.05); }

.timer {
  position: absolute;
  top: 24px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 13px;
  color: rgba(255,255,255,0.5);
}

.notification {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0,0,0,0.8);
  color: #fff;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 14px;
  z-index: 1001;
}
```

- [x] **Step 2: Создать `CallOverlay.tsx`**

`client/src/components/CallOverlay/CallOverlay.tsx`:

```typescript
import { useEffect, useRef, useState } from 'react'
import { useCallStore } from '@/store/callStore'
import { startRingtone } from '@/utils/ringtone'
import s from './CallOverlay.module.css'

interface Props {
  onAccept: () => void
  onReject: () => void
  onHangUp: () => void
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const sec = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}

export default function CallOverlay({ onAccept, onReject, onHangUp }: Props) {
  const status       = useCallStore((s) => s.status)
  const peerId       = useCallStore((s) => s.peerId)
  const isVideo      = useCallStore((s) => s.isVideo)
  const localStream  = useCallStore((s) => s.localStream)
  const remoteStream = useCallStore((s) => s.remoteStream)
  const isMuted      = useCallStore((s) => s.isMuted)
  const isCameraOff  = useCallStore((s) => s.isCameraOff)
  const toggleMute   = useCallStore((s) => s.toggleMute)
  const toggleCamera = useCallStore((s) => s.toggleCamera)
  const notification = useCallStore((s) => s.notification)

  const [elapsed, setElapsed] = useState(0)
  const localVideoRef  = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)

  // Таймер длительности активного звонка
  useEffect(() => {
    if (status !== 'active') { setElapsed(0); return }
    const id = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(id)
  }, [status])

  // Ringtone при входящем звонке
  useEffect(() => {
    if (status !== 'ringing') return
    return startRingtone()
  }, [status])

  // Привязка потоков к video-элементам
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream
    }
  }, [localStream])

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream
    }
  }, [remoteStream])

  if (status === 'idle' && !notification) return null

  // Уведомление (busy / rejected) без overlay
  if (status === 'idle' && notification) {
    return <div className={s.notification}>{notification}</div>
  }

  const peerLabel = peerId ?? 'Неизвестный'

  return (
    <div className={s.overlay}>
      {/* Видео-фон */}
      {status === 'active' && isVideo && (
        <>
          <video
            ref={remoteVideoRef}
            className={s.remoteVideo}
            autoPlay
            playsInline
          />
          <video
            ref={localVideoRef}
            className={s.localVideo}
            autoPlay
            playsInline
            muted
          />
        </>
      )}

      {/* Центральный блок */}
      {(status === 'ringing' || status === 'calling' || (status === 'active' && !isVideo)) && (
        <>
          <div className={s.avatar}>
            {peerLabel.charAt(0).toUpperCase()}
          </div>
          <div className={s.peerName}>{peerLabel}</div>
          <div className={s.statusText}>
            {status === 'ringing' && 'Входящий звонок'}
            {status === 'calling' && 'Вызов...'}
            {status === 'active'  && formatDuration(elapsed)}
          </div>
        </>
      )}

      {/* Таймер поверх видео */}
      {status === 'active' && isVideo && (
        <div className={s.timer}>{formatDuration(elapsed)}</div>
      )}

      {/* Кнопки управления */}
      <div className={s.controls}>
        {status === 'ringing' && (
          <>
            <button className={`${s.btn} ${s.btnReject}`} onClick={onReject} aria-label="Отклонить">
              📵
            </button>
            <button className={`${s.btn} ${s.btnAccept}`} onClick={onAccept} aria-label="Принять">
              📞
            </button>
          </>
        )}

        {status === 'calling' && (
          <button className={`${s.btn} ${s.btnReject}`} onClick={onHangUp} aria-label="Отмена">
            📵
          </button>
        )}

        {status === 'active' && (
          <>
            <button
              className={`${s.btn} ${isMuted ? s.btnMuted : s.btnMute}`}
              onClick={toggleMute}
              aria-label={isMuted ? 'Включить микрофон' : 'Выключить микрофон'}
            >
              {isMuted ? '🔇' : '🎤'}
            </button>
            {isVideo && (
              <button
                className={`${s.btn} ${isCameraOff ? s.btnCamOff : s.btnCamera}`}
                onClick={toggleCamera}
                aria-label={isCameraOff ? 'Включить камеру' : 'Выключить камеру'}
              >
                {isCameraOff ? '📷' : '📹'}
              </button>
            )}
            <button className={`${s.btn} ${s.btnHangup}`} onClick={onHangUp} aria-label="Завершить">
              📵
            </button>
          </>
        )}
      </div>
    </div>
  )
}
```

- [x] **Step 3: Проверить компиляцию**

```bash
cd client && npm run type-check
```

Ожидается: 0 ошибок.

- [x] **Step 4: Коммит**

```bash
git add client/src/components/CallOverlay/
git commit -m "feat(client): добавить CallOverlay — fullscreen overlay для входящих и активных звонков"
```

---

## Task 13: Client — интеграция в App.tsx и ChatWindow.tsx

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/ChatWindow/ChatWindow.tsx`

- [x] **Step 1: Обновить `App.tsx`**

Заменить `AppRoutes` в `client/src/App.tsx`:

```typescript
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useMessengerWS } from '@/hooks/useMessengerWS'
import { useOfflineSync } from '@/hooks/useOfflineSync'
import { useCallHandler } from '@/hooks/useCallHandler'
import CallOverlay from '@/components/CallOverlay/CallOverlay'
import ChatListPage from '@/pages/ChatListPage'
import ChatWindowPage from '@/pages/ChatWindowPage'
import ProfilePage from '@/pages/ProfilePage'
import AuthPage from '@/pages/AuthPage'
import OfflineIndicator from '@/components/OfflineIndicator/OfflineIndicator'

function AppRoutes() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  useMessengerWS()
  useOfflineSync()
  const { initiateCall, acceptCall, rejectCall, hangUp } = useCallHandler()

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="*" element={<Navigate to="/auth" replace />} />
      </Routes>
    )
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<ChatListPage />} />
        <Route path="/chat/:chatId" element={<ChatWindowPage initiateCall={initiateCall} />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <CallOverlay onAccept={acceptCall} onReject={rejectCall} onHangUp={hangUp} />
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <OfflineIndicator />
      <AppRoutes />
    </BrowserRouter>
  )
}
```

- [x] **Step 2: Обновить `ChatWindowPage` (или `ChatWindow`) для приёма `initiateCall` пропа**

В `client/src/pages/ChatWindowPage.tsx` (или аналоге) добавить передачу `initiateCall` в `ChatWindow`. Если `ChatWindowPage` не передаёт props в `ChatWindow`, найти компонент по пути и добавить:

```typescript
// В ChatWindowPage.tsx — добавить проп и передать в ChatWindow
interface Props {
  initiateCall: (chatId: string, targetId: string, isVideo: boolean) => void
}

export default function ChatWindowPage({ initiateCall }: Props) {
  const { chatId } = useParams()
  const navigate = useNavigate()
  return (
    <ChatWindow
      chatId={chatId ?? ''}
      onBack={() => navigate('/')}
      onCall={initiateCall}
    />
  )
}
```

- [x] **Step 3: Добавить кнопки звонка в `ChatWindow` header**

В `ChatWindow.tsx` в интерфейс Props добавить:

```typescript
interface Props {
  chatId: string
  onBack: () => void
  onCall?: (chatId: string, targetId: string, isVideo: boolean) => void
}
```

В компоненте найти строку `const chat = useChatStore(...)` и добавить:

```typescript
// Определяем peer для direct-чатов (второй участник — не currentUser)
const peerId = chat?.type === 'direct'
  ? chat.members.find((id) => id !== currentUser?.id) ?? null
  : null
```

В JSX заменить блок `<header className={s.header}>`:

```typescript
<header className={s.header}>
  <button className={s.backBtn} onClick={onBack} aria-label="Назад">
    <BackIcon />
  </button>
  <div className={s.info}>
    <span className={s.chatName}>{chat?.name ?? 'Чат'}</span>
    {typingUsers.length > 0 && (
      <span className={s.typing}>печатает...</span>
    )}
  </div>
  {onCall && peerId && (
    <div className={s.callBtns}>
      <button
        className={s.callBtn}
        onClick={() => onCall(chatId, peerId, false)}
        aria-label="Аудио звонок"
        title="Аудио звонок"
      >
        📞
      </button>
      <button
        className={s.callBtn}
        onClick={() => onCall(chatId, peerId, true)}
        aria-label="Видео звонок"
        title="Видео звонок"
      >
        📹
      </button>
    </div>
  )}
</header>
```

В `ChatWindow.module.css` добавить стили:

```css
.callBtns {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.callBtn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 20px;
  padding: 4px 8px;
  border-radius: 6px;
  opacity: 0.7;
  transition: opacity 0.15s;
}

.callBtn:hover {
  opacity: 1;
  background: rgba(0,0,0,0.05);
}
```

- [x] **Step 4: Проверить компиляцию и lint**

```bash
cd client && npm run type-check && npm run lint
```

Ожидается: 0 ошибок, 0 warnings.

- [x] **Step 5: Проверить сборку**

```bash
cd client && npm run build
```

Ожидается: успешная сборка.

- [x] **Step 6: Финальный коммит**

```bash
git add client/src/App.tsx client/src/components/ChatWindow/ChatWindow.tsx
git add client/src/components/ChatWindow/ChatWindow.module.css
# если изменялся ChatWindowPage:
git add client/src/pages/ChatWindowPage.tsx
git commit -m "feat(client): интегрировать CallOverlay и кнопки звонков в ChatWindow"
```

---

## Чеклист из спека

- [x] Alice звонит Bob → Bob видит incoming call overlay с ringtone
- [x] Bob принимает → оба видят active call, медиа идёт P2P
- [x] Bob отклоняет → Alice видит toast "Звонок отклонён"
- [x] Bob игнорирует → через 30 сек оба клиента сбрасываются в idle
- [x] Alice звонит занятому Bob → Alice видит "Абонент занят"
- [x] Alice отключается во время звонка → UI Bob сбрасывается
- [x] TURN не настроен → `/api/calls/ice-servers` возвращает только STUN
- [x] TURN настроен → `/api/calls/ice-servers` возвращает валидные временные credentials
- [x] Переключение камеры/микрофона работает во время активного звонка
- [x] Аудио-звонок не запрашивает видеодорожку
- [x] `getUserMedia` denied → сообщение об ошибке, звонок не инициируется
