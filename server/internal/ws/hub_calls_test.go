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
