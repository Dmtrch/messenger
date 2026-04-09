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

// addMockClient регистрирует фейкового клиента и возвращает его канал сообщений.
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

	// call-2 не должен быть сохранён в map — цель занята
	h.callsMu.Lock()
	_, stored := h.calls["call-2"]
	h.callsMu.Unlock()
	if stored {
		t.Error("call-2 session should NOT be stored when target is busy")
	}

	// Останавливаем вручную вставленный таймер явно
	h.callsMu.Lock()
	if s, ok := h.calls["existing"]; ok && s.timer != nil {
		s.timer.Stop()
	}
	h.callsMu.Unlock()
}

func TestHandleCallOffer_MissingFields(t *testing.T) {
	h := setupTestHub(t)
	t.Cleanup(func() { stopAllTimers(h) })
	setupConversation(t, h.db, "chat1", []string{"alice", "bob"})

	aliceCh, aliceClient := addMockClient(h, "alice")

	// CallID пустой — должна прийти ошибка, сессия не сохраняется
	h.handleCallOffer(aliceClient, inMsg{
		Type:     "call_offer",
		CallID:   "",
		ChatID:   "chat1",
		TargetID: "bob",
		SDP:      "sdp-offer",
	})

	f := readFrame(aliceCh)
	if f == nil || f["type"] != "error" {
		t.Errorf("expected error frame, got %v", f)
	}

	h.callsMu.Lock()
	count := len(h.calls)
	h.callsMu.Unlock()
	if count != 0 {
		t.Errorf("expected no sessions stored, got %d", count)
	}
}

func TestHandleCallOffer_NonMember(t *testing.T) {
	h := setupTestHub(t)
	t.Cleanup(func() { stopAllTimers(h) })
	// Чат содержит только bob — alice не является участником
	setupConversation(t, h.db, "chat1", []string{"bob"})

	aliceCh, aliceClient := addMockClient(h, "alice")

	h.handleCallOffer(aliceClient, inMsg{
		Type:     "call_offer",
		CallID:   "call-x",
		ChatID:   "chat1",
		TargetID: "bob",
		SDP:      "sdp-offer",
	})

	f := readFrame(aliceCh)
	if f == nil || f["type"] != "error" {
		t.Errorf("expected error frame for non-member, got %v", f)
	}

	h.callsMu.Lock()
	_, stored := h.calls["call-x"]
	h.callsMu.Unlock()
	if stored {
		t.Error("call-x session should NOT be stored for non-member")
	}
}

func TestHandleCallOffer_InitiatorAlreadyInCall(t *testing.T) {
	h := setupTestHub(t)
	t.Cleanup(func() { stopAllTimers(h) })
	// chat1: alice+bob, chat2: alice+carol
	setupConversation(t, h.db, "chat1", []string{"alice", "bob"})
	setupConversation(t, h.db, "chat2", []string{"alice", "carol"})

	aliceCh, aliceClient := addMockClient(h, "alice")
	_, _ = addMockClient(h, "bob")

	// alice уже является инициатором звонка с carol
	h.callsMu.Lock()
	existingTimer := time.AfterFunc(30*time.Second, func() {})
	h.calls["alice-carol"] = &callSession{
		callID:      "alice-carol",
		chatID:      "chat2",
		initiatorID: "alice",
		targetID:    "carol",
		state:       "ringing",
		timer:       existingTimer,
	}
	h.callsMu.Unlock()

	// alice пытается позвонить bob — должна получить call_busy
	h.handleCallOffer(aliceClient, inMsg{
		Type:     "call_offer",
		CallID:   "call-new",
		ChatID:   "chat1",
		TargetID: "bob",
		SDP:      "sdp-offer",
	})

	f := readFrame(aliceCh)
	if f == nil {
		t.Fatal("alice should receive call_busy when she is already in a call")
	}
	tp, _ := f["type"].(string)
	if tp != "call_busy" {
		t.Errorf("expected call_busy, got %v", tp)
	}

	// call-new не должен быть сохранён — инициатор занят
	h.callsMu.Lock()
	_, storedNew := h.calls["call-new"]
	h.callsMu.Unlock()
	if storedNew {
		t.Error("call-new session should NOT be stored when initiator is already in a call")
	}

	// Останавливаем вручную вставленный таймер явно
	h.callsMu.Lock()
	if s, ok := h.calls["alice-carol"]; ok && s.timer != nil {
		s.timer.Stop()
	}
	h.callsMu.Unlock()
	existingTimer.Stop()
}

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
	if sess.timer != nil {
		t.Error("expected timer to be nil after answer")
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

	// Сессия должна быть удалена
	h.callsMu.Lock()
	_, exists := h.calls["call-1"]
	h.callsMu.Unlock()
	if exists {
		t.Error("session should be deleted after call_reject")
	}
}

func TestHandleCallEnd_RejectsThirdParty(t *testing.T) {
	h := setupTestHub(t)
	t.Cleanup(func() { stopAllTimers(h) })

	aliceCh, _ := addMockClient(h, "alice")
	bobCh, _ := addMockClient(h, "bob")
	carolCh, carolClient := addMockClient(h, "carol")

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

	// carol (не участник звонка) пытается завершить его
	h.handleCallEnd(carolClient, inMsg{Type: "call_end", CallID: "call-1"})

	// carol должна получить ошибку
	f := readFrame(carolCh)
	if f == nil || f["type"] != "error" {
		t.Errorf("carol should receive error, got %v", f)
	}

	// alice и bob не должны получить call_end
	if f := readFrame(aliceCh); f != nil {
		t.Errorf("alice should not receive call_end, got %v", f)
	}
	if f := readFrame(bobCh); f != nil {
		t.Errorf("bob should not receive call_end, got %v", f)
	}

	// Сессия должна остаться
	h.callsMu.Lock()
	_, exists := h.calls["call-1"]
	h.callsMu.Unlock()
	if !exists {
		t.Error("session should NOT be deleted when third party sends call_end")
	}

	// Убираем таймер явно
	h.callsMu.Lock()
	if s, ok := h.calls["call-1"]; ok && s.timer != nil {
		s.timer.Stop()
	}
	h.callsMu.Unlock()
}

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
	_ = aliceCh

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

func TestHandleCallOffer_TargetNotMember(t *testing.T) {
	h := setupTestHub(t)
	t.Cleanup(func() { stopAllTimers(h) })
	// chat1 содержит только alice — bob НЕ является участником
	setupConversation(t, h.db, "chat1", []string{"alice"})

	aliceCh, aliceClient := addMockClient(h, "alice")
	_, _ = addMockClient(h, "bob")

	// alice пытается позвонить bob в чате, где bob не состоит
	h.handleCallOffer(aliceClient, inMsg{
		Type:     "call_offer",
		CallID:   "call-x",
		ChatID:   "chat1",
		TargetID: "bob",
		SDP:      "sdp-offer",
	})

	f := readFrame(aliceCh)
	if f == nil {
		t.Fatal("alice should receive an error frame")
	}
	tp, _ := f["type"].(string)
	if tp != "error" {
		t.Errorf("expected type=error, got %v", tp)
	}

	// Сессия не должна быть сохранена
	h.callsMu.Lock()
	_, stored := h.calls["call-x"]
	h.callsMu.Unlock()
	if stored {
		t.Error("call-x session should NOT be stored when target is not a chat member")
	}
}

func TestHandleIceCandidate_RejectsThirdParty(t *testing.T) {
	h := setupTestHub(t)
	t.Cleanup(func() { stopAllTimers(h) })

	aliceCh, _ := addMockClient(h, "alice")
	bobCh, _ := addMockClient(h, "bob")
	carolCh, carolClient := addMockClient(h, "carol")

	h.callsMu.Lock()
	h.calls["call-1"] = &callSession{
		callID:      "call-1",
		chatID:      "chat1",
		initiatorID: "alice",
		targetID:    "bob",
		state:       "active",
	}
	h.callsMu.Unlock()

	candidate := json.RawMessage(`{"candidate":"x"}`)
	h.handleIceCandidate(carolClient, inMsg{
		Type:      "ice_candidate",
		CallID:    "call-1",
		Candidate: candidate,
	})

	// carol должна получить ошибку
	f := readFrame(carolCh)
	if f == nil || f["type"] != "error" {
		t.Errorf("carol should receive error, got %v", f)
	}

	// alice и bob не должны ничего получить
	if f := readFrame(aliceCh); f != nil {
		t.Errorf("alice should not receive candidate, got %v", f)
	}
	if f := readFrame(bobCh); f != nil {
		t.Errorf("bob should not receive candidate, got %v", f)
	}
}
