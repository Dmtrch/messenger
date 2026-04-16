package admin_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/admin"
	"github.com/messenger/server/internal/auth"
	"github.com/messenger/server/internal/keys"
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

func withUserID(r *http.Request, userID string) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), auth.UserIDKey, userID))
}

func withChiParam(r *http.Request, key, value string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add(key, value)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

func b64(n int) string {
	buf := make([]byte, n)
	for i := range buf {
		buf[i] = byte(i % 256)
	}
	return base64.StdEncoding.EncodeToString(buf)
}

// TestApproveRegistration_KeysBundleAvailable проверяет что после approve
// prekey bundle пользователя доступен через GET /api/keys/:userId.
func TestApproveRegistration_KeysBundleAvailable(t *testing.T) {
	database := newTestDB(t)
	h := &admin.Handler{DB: database}
	keysH := &keys.Handler{DB: database}

	// Создаём заявку с ключами
	ikPublic := b64(32)
	spkPublic := b64(32)
	spkSignature := b64(64)
	opkKey := b64(32)
	opkPublics, _ := json.Marshal([]map[string]any{
		{"id": 1, "key": opkKey},
	})

	hash := "$2a$12$testhashxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
	reqID := "reg-001"
	err := db.CreateRegistrationRequest(database, db.RegistrationRequest{
		ID:           reqID,
		Username:     "alice",
		DisplayName:  "Alice",
		IKPublic:     ikPublic,
		SPKId:        1,
		SPKPublic:    spkPublic,
		SPKSignature: spkSignature,
		OPKPublics:   string(opkPublics),
		PasswordHash: hash,
		Status:       "pending",
		CreatedAt:    1000000,
	})
	if err != nil {
		t.Fatalf("create registration request: %v", err)
	}

	// Approve
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(nil))
	req = withChiParam(req, "id", reqID)
	req = withUserID(req, "admin-1")
	rr := httptest.NewRecorder()
	h.ApproveRegistrationRequest(rr, req)

	if rr.Code != 200 {
		t.Fatalf("approve: want 200, got %d: %s", rr.Code, rr.Body)
	}

	// Получаем пользователя чтобы узнать его ID
	user, err := db.GetUserByUsername(database, "alice")
	if err != nil || user == nil {
		t.Fatalf("user not created after approve: %v", err)
	}

	// GET /api/keys/:userId — bundle должен быть доступен
	getReq := httptest.NewRequest(http.MethodGet, "/", nil)
	getReq = withChiParam(getReq, "userId", user.ID)
	getReq = withUserID(getReq, "other-user")
	getRR := httptest.NewRecorder()
	keysH.GetBundle(getRR, getReq)

	if getRR.Code != 200 {
		t.Fatalf("get bundle: want 200, got %d: %s", getRR.Code, getRR.Body)
	}

	var resp map[string]any
	json.NewDecoder(getRR.Body).Decode(&resp)
	devices, ok := resp["devices"].([]any)
	if !ok || len(devices) == 0 {
		t.Fatalf("expected devices in bundle, got %v", resp)
	}

	dev := devices[0].(map[string]any)
	if dev["ikPublic"] != ikPublic {
		t.Errorf("ikPublic mismatch: want %s, got %v", ikPublic, dev["ikPublic"])
	}
	if dev["spkPublic"] != spkPublic {
		t.Errorf("spkPublic mismatch: want %s, got %v", spkPublic, dev["spkPublic"])
	}
}

// TestApproveRegistration_AlreadyApproved проверяет что повторный approve возвращает 409.
func TestApproveRegistration_AlreadyApproved(t *testing.T) {
	database := newTestDB(t)
	h := &admin.Handler{DB: database}

	db.CreateRegistrationRequest(database, db.RegistrationRequest{ //nolint:errcheck
		ID: "reg-002", Username: "bob", DisplayName: "Bob",
		IKPublic: b64(32), SPKId: 1, SPKPublic: b64(32), SPKSignature: b64(64),
		OPKPublics: "[]", PasswordHash: "$2a$12$testhashxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
		Status: "approved", CreatedAt: 1000000,
	})

	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(nil))
	req = withChiParam(req, "id", "reg-002")
	req = withUserID(req, "admin-1")
	rr := httptest.NewRecorder()
	h.ApproveRegistrationRequest(rr, req)

	if rr.Code != 409 {
		t.Errorf("want 409, got %d", rr.Code)
	}
}
