package auth_test

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

	"github.com/golang-jwt/jwt/v5"
	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/auth"
)

const testSecret = "test-secret-key-32bytes-padxxxxx"

// newTestDB открывает SQLite во временном файле для одного теста.
func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

func newHandler(database *sql.DB) *auth.Handler {
	return &auth.Handler{DB: database, JWTSecret: []byte(testSecret)}
}

func doPost(handler http.HandlerFunc, body any) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	handler(rr, req)
	return rr
}

func doPostWithCookie(handler http.HandlerFunc, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rr := httptest.NewRecorder()
	handler(rr, req)
	return rr
}

func doPostWithContext(handler http.HandlerFunc, body any, userID string) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	ctx := context.WithValue(req.Context(), auth.UserIDKey, userID)
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()
	handler(rr, req)
	return rr
}

// loginUser регистрирует и логинит пользователя, возвращает access token и refresh cookie.
func loginUser(t *testing.T, h *auth.Handler, username, password string) (accessToken string, refreshCookie *http.Cookie, userID string) {
	t.Helper()
	rr := doPost(h.Register, map[string]any{
		"username": username, "displayName": username, "password": password,
	})
	if rr.Code != 201 {
		t.Fatalf("register: want 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	json.Unmarshal(rr.Body.Bytes(), &resp)
	accessToken, _ = resp["accessToken"].(string)
	userID, _ = resp["userId"].(string)

	for _, c := range rr.Result().Cookies() {
		if c.Name == "refresh_token" {
			refreshCookie = c
		}
	}
	return
}

// ── Register ────────────────────────────────────────────────────────────────

func TestRegister_Success(t *testing.T) {
	h := newHandler(newTestDB(t))
	rr := doPost(h.Register, map[string]any{
		"username": "alice", "displayName": "Alice", "password": "password123",
	})
	if rr.Code != 201 {
		t.Fatalf("want 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp["accessToken"] == nil {
		t.Fatal("accessToken missing in response")
	}
}

func TestRegister_DuplicateUsername(t *testing.T) {
	h := newHandler(newTestDB(t))
	body := map[string]any{"username": "alice", "displayName": "Alice", "password": "password123"}
	doPost(h.Register, body)
	rr := doPost(h.Register, body)
	if rr.Code != 409 {
		t.Fatalf("want 409, got %d", rr.Code)
	}
}

func TestRegister_ShortPassword(t *testing.T) {
	h := newHandler(newTestDB(t))
	rr := doPost(h.Register, map[string]any{
		"username": "bob", "displayName": "Bob", "password": "short",
	})
	if rr.Code != 400 {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

// ── Login ───────────────────────────────────────────────────────────────────

func TestLogin_Success(t *testing.T) {
	h := newHandler(newTestDB(t))
	doPost(h.Register, map[string]any{"username": "alice", "displayName": "Alice", "password": "password123"})

	rr := doPost(h.Login, map[string]any{"username": "alice", "password": "password123"})
	if rr.Code != 200 {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp["accessToken"] == nil {
		t.Fatal("accessToken missing")
	}
}

func TestLogin_InvalidCredentials(t *testing.T) {
	h := newHandler(newTestDB(t))
	doPost(h.Register, map[string]any{"username": "alice", "displayName": "Alice", "password": "password123"})

	rr := doPost(h.Login, map[string]any{"username": "alice", "password": "wrongpassword"})
	if rr.Code != 401 {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}

func TestLogin_UnknownUser(t *testing.T) {
	h := newHandler(newTestDB(t))
	rr := doPost(h.Login, map[string]any{"username": "nobody", "password": "password123"})
	if rr.Code != 401 {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}

// ── Refresh ──────────────────────────────────────────────────────────────────

func TestRefresh_Success(t *testing.T) {
	h := newHandler(newTestDB(t))
	_, refreshCookie, _ := loginUser(t, h, "alice", "password123")

	rr := doPostWithCookie(h.Refresh, nil, refreshCookie)
	if rr.Code != 200 {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp["accessToken"] == nil {
		t.Fatal("accessToken missing after refresh")
	}
}

func TestRefresh_Rotation(t *testing.T) {
	// Повторное использование одного refresh token должно вернуть 401 (token rotation).
	h := newHandler(newTestDB(t))
	_, refreshCookie, _ := loginUser(t, h, "alice", "password123")

	// Первый refresh — успешен
	doPostWithCookie(h.Refresh, nil, refreshCookie)

	// Второй refresh с тем же токеном — должен отклонить
	rr := doPostWithCookie(h.Refresh, nil, refreshCookie)
	if rr.Code != 401 {
		t.Fatalf("want 401 after token reuse, got %d", rr.Code)
	}
}

func TestRefresh_MissingCookie(t *testing.T) {
	h := newHandler(newTestDB(t))
	rr := doPostWithCookie(h.Refresh, nil, nil)
	if rr.Code != 401 {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}

func TestRefresh_ExpiredToken(t *testing.T) {
	// Создаём просроченную сессию напрямую в БД.
	database := newTestDB(t)
	h := newHandler(database)
	_, _, _ = loginUser(t, h, "alice", "password123")

	// Просрочиваем все сессии
	database.Exec(`UPDATE sessions SET expires_at = ? WHERE 1=1`, time.Now().Add(-1*time.Hour).UnixMilli())

	cookie := &http.Cookie{Name: "refresh_token", Value: "any-value"}
	rr := doPostWithCookie(h.Refresh, nil, cookie)
	if rr.Code != 401 {
		t.Fatalf("want 401 for expired token, got %d", rr.Code)
	}
}

// ── ChangePassword ──────────────────────────────────────────────────────────

func TestChangePassword_WrongCurrent(t *testing.T) {
	database := newTestDB(t)
	h := newHandler(database)
	_, _, userID := loginUser(t, h, "alice", "password123")

	rr := doPostWithContext(h.ChangePassword, map[string]any{
		"currentPassword": "wrongpassword",
		"newPassword":     "newpassword456",
	}, userID)
	if rr.Code != 403 {
		t.Fatalf("want 403, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestChangePassword_Success(t *testing.T) {
	database := newTestDB(t)
	h := newHandler(database)
	_, _, userID := loginUser(t, h, "alice", "password123")

	rr := doPostWithContext(h.ChangePassword, map[string]any{
		"currentPassword": "password123",
		"newPassword":     "newpassword456",
	}, userID)
	if rr.Code != 204 {
		t.Fatalf("want 204, got %d: %s", rr.Code, rr.Body.String())
	}

	// Старый пароль больше не работает
	rr = doPost(h.Login, map[string]any{"username": "alice", "password": "password123"})
	if rr.Code != 401 {
		t.Fatalf("old password should be rejected, got %d", rr.Code)
	}

	// Новый пароль работает
	rr = doPost(h.Login, map[string]any{"username": "alice", "password": "newpassword456"})
	if rr.Code != 200 {
		t.Fatalf("new password should work, got %d", rr.Code)
	}
}

func TestChangePassword_ShortNew(t *testing.T) {
	database := newTestDB(t)
	h := newHandler(database)
	_, _, userID := loginUser(t, h, "alice", "password123")

	rr := doPostWithContext(h.ChangePassword, map[string]any{
		"currentPassword": "password123",
		"newPassword":     "short",
	}, userID)
	if rr.Code != 400 {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

// ── JWT validation (Middleware) ──────────────────────────────────────────────

func TestMiddleware_InvalidToken(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	})
	handler := auth.Middleware([]byte(testSecret))(next)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer invalid.jwt.token")
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 401 {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}

func TestMiddleware_ExpiredToken(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	})
	handler := auth.Middleware([]byte(testSecret))(next)

	expired, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "user-1",
		"exp": time.Now().Add(-1 * time.Hour).Unix(),
	}).SignedString([]byte(testSecret))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+expired)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 401 {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}

func TestMiddleware_ValidToken(t *testing.T) {
	var gotUserID string
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUserID = auth.UserIDFromCtx(r)
		w.WriteHeader(200)
	})
	handler := auth.Middleware([]byte(testSecret))(next)

	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": "user-abc",
		"exp": time.Now().Add(15 * time.Minute).Unix(),
	}).SignedString([]byte(testSecret))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	if gotUserID != "user-abc" {
		t.Fatalf("want userID=user-abc, got %q", gotUserID)
	}
}
