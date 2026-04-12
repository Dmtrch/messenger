package chat_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/auth"
	"github.com/messenger/server/internal/chat"
)

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

func createUser(t *testing.T, database *sql.DB, id, username string) db.User {
	t.Helper()
	user := db.User{
		ID:           id,
		Username:     username,
		DisplayName:  username,
		PasswordHash: "$2a$12$testhash",
		CreatedAt:    time.Now().UnixMilli(),
	}
	if err := db.CreateUser(database, user); err != nil {
		t.Fatalf("create user %s: %v", username, err)
	}
	return user
}

func withUserID(r *http.Request, userID string) *http.Request {
	ctx := context.WithValue(r.Context(), auth.UserIDKey, userID)
	return r.WithContext(ctx)
}

func withChiParam(r *http.Request, key, value string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add(key, value)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

func newHandler(database *sql.DB) *chat.Handler {
	return &chat.Handler{DB: database, Hub: nil}
}

func postJSON(handler http.HandlerFunc, userID string, body any) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req = withUserID(req, userID)
	rr := httptest.NewRecorder()
	handler(rr, req)
	return rr
}

// createChat через API, возвращает chatID.
func createChatViaAPI(t *testing.T, h *chat.Handler, creatorID string, memberIDs []string) string {
	t.Helper()
	rr := postJSON(h.CreateChat, creatorID, map[string]any{
		"type":      "direct",
		"memberIds": memberIDs,
	})
	if rr.Code != 200 && rr.Code != 201 {
		t.Fatalf("createChat: want 200/201, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	json.Unmarshal(rr.Body.Bytes(), &resp)
	chatMap, _ := resp["chat"].(map[string]any)
	return chatMap["id"].(string)
}

// ── CreateChat ────────────────────────────────────────────────────────────────

func TestCreateChat_Success(t *testing.T) {
	database := newTestDB(t)
	alice := createUser(t, database, "user-alice", "alice")
	bob := createUser(t, database, "user-bob", "bob")
	h := newHandler(database)

	rr := postJSON(h.CreateChat, alice.ID, map[string]any{
		"type":      "direct",
		"memberIds": []string{bob.ID},
	})
	if rr.Code != 200 && rr.Code != 201 {
		t.Fatalf("want 200/201, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestCreateChat_GroupSuccess(t *testing.T) {
	database := newTestDB(t)
	alice := createUser(t, database, "user-alice", "alice")
	bob := createUser(t, database, "user-bob", "bob")
	charlie := createUser(t, database, "user-charlie", "charlie")
	h := newHandler(database)

	rr := postJSON(h.CreateChat, alice.ID, map[string]any{
		"type":      "group",
		"memberIds": []string{bob.ID, charlie.ID},
		"name":      "Test Group",
	})
	if rr.Code != 200 && rr.Code != 201 {
		t.Fatalf("want 200/201, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestCreateChat_InvalidType(t *testing.T) {
	database := newTestDB(t)
	alice := createUser(t, database, "user-alice", "alice")
	h := newHandler(database)

	rr := postJSON(h.CreateChat, alice.ID, map[string]any{
		"type":      "unknown",
		"memberIds": []string{},
	})
	if rr.Code != 400 {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

// ── ListMessages (forbidden access) ─────────────────────────────────────────

func TestListMessages_Forbidden_NonMember(t *testing.T) {
	database := newTestDB(t)
	alice := createUser(t, database, "user-alice", "alice")
	bob := createUser(t, database, "user-bob", "bob")
	charlie := createUser(t, database, "user-charlie", "charlie")
	h := newHandler(database)

	// Alice и Bob создают чат
	chatID := createChatViaAPI(t, h, alice.ID, []string{bob.ID})

	// Charlie (не участник) пытается получить сообщения
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = withUserID(req, charlie.ID)
	req = withChiParam(req, "chatId", chatID)
	rr := httptest.NewRecorder()
	h.ListMessages(rr, req)

	if rr.Code != 404 {
		t.Fatalf("want 404 for non-member, got %d", rr.Code)
	}
}

func TestListMessages_Success_Member(t *testing.T) {
	database := newTestDB(t)
	alice := createUser(t, database, "user-alice", "alice")
	bob := createUser(t, database, "user-bob", "bob")
	h := newHandler(database)

	chatID := createChatViaAPI(t, h, alice.ID, []string{bob.ID})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = withUserID(req, alice.ID)
	req = withChiParam(req, "chatId", chatID)
	rr := httptest.NewRecorder()
	h.ListMessages(rr, req)

	if rr.Code != 200 {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
}

// ── DeleteMessage (authorization) ───────────────────────────────────────────

func TestDeleteMessage_Forbidden_NotSender(t *testing.T) {
	database := newTestDB(t)
	alice := createUser(t, database, "user-alice", "alice")
	bob := createUser(t, database, "user-bob", "bob")
	h := newHandler(database)

	chatID := createChatViaAPI(t, h, alice.ID, []string{bob.ID})

	// Вставляем сообщение от Alice напрямую в БД
	clientMsgID := uuid.New().String()
	if err := db.SaveMessage(database, db.Message{
		ID:             uuid.New().String(),
		ClientMsgID:    clientMsgID,
		ConversationID: chatID,
		SenderID:       alice.ID,
		RecipientID:    alice.ID,
		Ciphertext:     []byte("ciphertext"),
		CreatedAt:      time.Now().UnixMilli(),
	}); err != nil {
		t.Fatalf("create message: %v", err)
	}

	// Bob пытается удалить сообщение Alice
	req := httptest.NewRequest(http.MethodDelete, "/", nil)
	req = withUserID(req, bob.ID)
	req = withChiParam(req, "clientMsgId", clientMsgID)
	rr := httptest.NewRecorder()
	h.DeleteMessage(rr, req)

	if rr.Code != 403 {
		t.Fatalf("want 403, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestDeleteMessage_Success_BySender(t *testing.T) {
	database := newTestDB(t)
	alice := createUser(t, database, "user-alice", "alice")
	bob := createUser(t, database, "user-bob", "bob")
	h := newHandler(database)

	chatID := createChatViaAPI(t, h, alice.ID, []string{bob.ID})

	clientMsgID := uuid.New().String()
	if err := db.SaveMessage(database, db.Message{
		ID:             uuid.New().String(),
		ClientMsgID:    clientMsgID,
		ConversationID: chatID,
		SenderID:       alice.ID,
		RecipientID:    alice.ID,
		Ciphertext:     []byte("ciphertext"),
		CreatedAt:      time.Now().UnixMilli(),
	}); err != nil {
		t.Fatalf("create message: %v", err)
	}

	// Alice удаляет своё сообщение
	req := httptest.NewRequest(http.MethodDelete, "/", nil)
	req = withUserID(req, alice.ID)
	req = withChiParam(req, "clientMsgId", clientMsgID)
	rr := httptest.NewRecorder()
	h.DeleteMessage(rr, req)

	if rr.Code != 204 {
		t.Fatalf("want 204, got %d: %s", rr.Code, rr.Body.String())
	}
}

// ── EditMessage (authorization) ──────────────────────────────────────────────

func TestEditMessage_Forbidden_NotSender(t *testing.T) {
	database := newTestDB(t)
	alice := createUser(t, database, "user-alice", "alice")
	bob := createUser(t, database, "user-bob", "bob")
	h := newHandler(database)

	chatID := createChatViaAPI(t, h, alice.ID, []string{bob.ID})

	clientMsgID := uuid.New().String()
	if err := db.SaveMessage(database, db.Message{
		ID:             uuid.New().String(),
		ClientMsgID:    clientMsgID,
		ConversationID: chatID,
		SenderID:       alice.ID,
		RecipientID:    alice.ID,
		Ciphertext:     []byte("ciphertext"),
		CreatedAt:      time.Now().UnixMilli(),
	}); err != nil {
		t.Fatalf("create message: %v", err)
	}

	b, _ := json.Marshal(map[string]any{
		"recipients": []map[string]any{
			{"userId": alice.ID, "ciphertext": []byte("new")},
		},
	})
	req := httptest.NewRequest(http.MethodPatch, "/", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req = withUserID(req, bob.ID) // bob пытается редактировать
	req = withChiParam(req, "clientMsgId", clientMsgID)
	rr := httptest.NewRecorder()
	h.EditMessage(rr, req)

	if rr.Code != 403 {
		t.Fatalf("want 403, got %d: %s", rr.Code, rr.Body.String())
	}
}
