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
}
