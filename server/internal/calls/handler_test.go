package calls_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/messenger/server/internal/auth"
	"github.com/messenger/server/internal/calls"
	"github.com/messenger/server/internal/sfu"
)

// mockBroadcaster — no-op реализация calls.Broadcaster для тестов.
type mockBroadcaster struct{}

func (m *mockBroadcaster) BroadcastRoomCreated(chatID, roomID, creatorID string)                 {}
func (m *mockBroadcaster) BroadcastParticipantJoined(chatID, roomID, userID, deviceID string) {}
func (m *mockBroadcaster) BroadcastParticipantLeft(chatID, roomID, userID string)              {}
func (m *mockBroadcaster) BroadcastTrackAdded(chatID, roomID, userID, kind string)             {}

// newTestHandler создаёт Handler с чистым Manager и mockBroadcaster.
func newTestHandler() *calls.Handler {
	return &calls.Handler{
		SFU: sfu.NewManager(),
		Hub: &mockBroadcaster{},
	}
}

// newRouter регистрирует маршруты calls.Handler на chi-роутере.
func newRouter(h *calls.Handler) http.Handler {
	r := chi.NewRouter()
	r.Post("/api/calls/room", h.CreateRoom)
	r.Delete("/api/calls/room/{roomId}", h.DeleteRoom)
	r.Get("/api/calls/room/{roomId}/participants", h.GetParticipants)
	r.Post("/api/calls/room/{roomId}/join", h.JoinRoom)
	r.Post("/api/calls/room/{roomId}/leave", h.LeaveRoom)
	return r
}

// withUser добавляет userID в контекст запроса — имитирует auth.Middleware.
func withUser(r *http.Request, userID string) *http.Request {
	ctx := context.WithValue(r.Context(), auth.UserIDKey, userID)
	return r.WithContext(ctx)
}

// --------------------------------------------------------------------------
// POST /api/calls/room
// --------------------------------------------------------------------------

func TestCreateRoom_NoAuth_Returns401(t *testing.T) {
	h := newTestHandler()
	router := newRouter(h)

	body, _ := json.Marshal(map[string]string{"roomId": "r1", "chatId": "c1"})
	req := httptest.NewRequest(http.MethodPost, "/api/calls/room", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rr.Code)
	}
}

func TestCreateRoom_WithAuth_Returns201AndBody(t *testing.T) {
	h := newTestHandler()
	router := newRouter(h)

	body, _ := json.Marshal(map[string]string{"roomId": "r1", "chatId": "c1"})
	req := httptest.NewRequest(http.MethodPost, "/api/calls/room", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = withUser(req, "user1")

	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Errorf("status = %d, want 201", rr.Code)
	}

	var resp map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp["roomId"] == "" {
		t.Error("response must contain non-empty roomId")
	}
	if resp["chatId"] != "c1" {
		t.Errorf("chatId = %q, want %q", resp["chatId"], "c1")
	}
}

// --------------------------------------------------------------------------
// GET /api/calls/room/{roomId}/participants
// --------------------------------------------------------------------------

func TestGetParticipants_ExistingRoom_Returns200AndArray(t *testing.T) {
	h := newTestHandler()
	router := newRouter(h)

	// Create room first.
	body, _ := json.Marshal(map[string]string{"roomId": "r2", "chatId": "c2"})
	createReq := httptest.NewRequest(http.MethodPost, "/api/calls/room", bytes.NewReader(body))
	createReq.Header.Set("Content-Type", "application/json")
	createReq = withUser(createReq, "user1")
	createRR := httptest.NewRecorder()
	router.ServeHTTP(createRR, createReq)

	if createRR.Code != http.StatusCreated {
		t.Fatalf("CreateRoom status = %d", createRR.Code)
	}

	var createResp map[string]string
	json.NewDecoder(createRR.Body).Decode(&createResp) //nolint:errcheck
	roomID := createResp["roomId"]

	// Query participants.
	req := httptest.NewRequest(http.MethodGet, "/api/calls/room/"+roomID+"/participants", nil)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rr.Code)
	}

	// Body must decode as JSON array (empty on new room).
	var participants []interface{}
	if err := json.NewDecoder(rr.Body).Decode(&participants); err != nil {
		t.Fatalf("decode participants: %v", err)
	}
}

func TestGetParticipants_UnknownRoom_Returns404(t *testing.T) {
	h := newTestHandler()
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/api/calls/room/unknown-room-id/participants", nil)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rr.Code)
	}
}

// --------------------------------------------------------------------------
// DELETE /api/calls/room/{roomId}
// --------------------------------------------------------------------------

func TestDeleteRoom_ExistingRoom_Returns204(t *testing.T) {
	h := newTestHandler()
	router := newRouter(h)

	// Create room.
	body, _ := json.Marshal(map[string]string{"roomId": "r3", "chatId": "c3"})
	createReq := httptest.NewRequest(http.MethodPost, "/api/calls/room", bytes.NewReader(body))
	createReq.Header.Set("Content-Type", "application/json")
	createReq = withUser(createReq, "user1")
	createRR := httptest.NewRecorder()
	router.ServeHTTP(createRR, createReq)

	var createResp map[string]string
	json.NewDecoder(createRR.Body).Decode(&createResp) //nolint:errcheck
	roomID := createResp["roomId"]

	// Delete room.
	delReq := httptest.NewRequest(http.MethodDelete, "/api/calls/room/"+roomID, nil)
	delReq = withUser(delReq, "user1")
	delRR := httptest.NewRecorder()
	router.ServeHTTP(delRR, delReq)

	if delRR.Code != http.StatusNoContent {
		t.Errorf("status = %d, want 204", delRR.Code)
	}
}

func TestDeleteRoom_UnknownRoom_Returns404(t *testing.T) {
	h := newTestHandler()
	router := newRouter(h)

	req := httptest.NewRequest(http.MethodDelete, "/api/calls/room/unknown-room-id", nil)
	req = withUser(req, "user1")
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rr.Code)
	}
}
