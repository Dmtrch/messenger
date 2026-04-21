package integration_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/auth"
)

const testJWTSecret = "test-secret-key-32bytes-padxxxxx"

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

func newAuthHandler(database *sql.DB) *auth.Handler {
	return &auth.Handler{
		DB:               database,
		JWTSecret:        []byte(testJWTSecret),
		RegistrationMode: "open",
	}
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

// registerAndLogin регистрирует пользователя и возвращает accessToken, refreshCookie, userID.
func registerAndLogin(t *testing.T, h *auth.Handler, username, password string) (accessToken string, refreshCookie *http.Cookie, userID string) {
	t.Helper()
	rr := doPost(h.Register, map[string]any{
		"username": username, "displayName": username, "password": password,
	})
	if rr.Code != 201 {
		t.Fatalf("register: want 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	json.Unmarshal(rr.Body.Bytes(), &resp) //nolint:errcheck
	accessToken, _ = resp["accessToken"].(string)
	userID, _ = resp["userId"].(string)
	for _, c := range rr.Result().Cookies() {
		if c.Name == "refresh_token" {
			refreshCookie = c
		}
	}
	return
}

// TestAuthFlow_RegisterLoginProtected: регистрация → логин → защищённый ресурс.
func TestAuthFlow_RegisterLoginProtected(t *testing.T) {
	database := newTestDB(t)
	h := newAuthHandler(database)

	// 1. Регистрация
	rrReg := doPost(h.Register, map[string]any{
		"username": "alice", "displayName": "Alice", "password": "password123",
	})
	if rrReg.Code != 201 {
		t.Fatalf("register: want 201, got %d: %s", rrReg.Code, rrReg.Body.String())
	}

	// 2. Логин
	rrLogin := doPost(h.Login, map[string]any{
		"username": "alice", "password": "password123",
	})
	if rrLogin.Code != 200 {
		t.Fatalf("login: want 200, got %d: %s", rrLogin.Code, rrLogin.Body.String())
	}
	var loginResp map[string]any
	json.Unmarshal(rrLogin.Body.Bytes(), &loginResp) //nolint:errcheck
	accessToken, _ := loginResp["accessToken"].(string)
	if accessToken == "" {
		t.Fatal("accessToken missing in login response")
	}

	// 3. Запрос к защищённому ресурсу через middleware с Bearer token
	var gotUserID string
	protected := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUserID = auth.UserIDFromCtx(r)
		w.WriteHeader(200)
	})
	handler := auth.Middleware([]byte(testJWTSecret))(protected)

	req := httptest.NewRequest(http.MethodGet, "/api/chats", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != 200 {
		t.Fatalf("protected resource: want 200, got %d", rr.Code)
	}
	if gotUserID == "" {
		t.Fatal("userID not set in context after auth middleware")
	}
}

// TestAuthFlow_RefreshToken: регистрация → логин → refresh.
func TestAuthFlow_RefreshToken(t *testing.T) {
	database := newTestDB(t)
	h := newAuthHandler(database)

	_, refreshCookie, _ := registerAndLogin(t, h, "bob", "password123")
	if refreshCookie == nil {
		t.Fatal("refresh_token cookie missing after login")
	}

	// Refresh
	rrRefresh := doPostWithCookie(h.Refresh, nil, refreshCookie)
	if rrRefresh.Code != 200 {
		t.Fatalf("refresh: want 200, got %d: %s", rrRefresh.Code, rrRefresh.Body.String())
	}
	var refreshResp map[string]any
	json.Unmarshal(rrRefresh.Body.Bytes(), &refreshResp) //nolint:errcheck
	newToken, _ := refreshResp["accessToken"].(string)
	if newToken == "" {
		t.Fatal("accessToken missing after refresh")
	}

	// Повторное использование того же refresh cookie должно вернуть 401 (token rotation)
	rrReuse := doPostWithCookie(h.Refresh, nil, refreshCookie)
	if rrReuse.Code != 401 {
		t.Fatalf("reused refresh token: want 401, got %d", rrReuse.Code)
	}
}

// TestAuthFlow_InvalidCredentials: неверный пароль → 401.
func TestAuthFlow_InvalidCredentials(t *testing.T) {
	database := newTestDB(t)
	h := newAuthHandler(database)

	doPost(h.Register, map[string]any{
		"username": "carol", "displayName": "Carol", "password": "password123",
	})

	rr := doPost(h.Login, map[string]any{
		"username": "carol", "password": "wrongpassword",
	})
	if rr.Code != 401 {
		t.Fatalf("want 401, got %d", rr.Code)
	}
}

// TestAuthFlow_ProtectedWithoutToken: запрос без токена → 401.
func TestAuthFlow_ProtectedWithoutToken(t *testing.T) {
	protected := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	})
	handler := auth.Middleware([]byte(testJWTSecret))(protected)

	req := httptest.NewRequest(http.MethodGet, "/api/chats", nil)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != 401 {
		t.Fatalf("want 401 without token, got %d", rr.Code)
	}
}

// TestAuthFlow_RoleInContext: после логина роль из JWT попадает в контекст.
func TestAuthFlow_RoleInContext(t *testing.T) {
	database := newTestDB(t)
	h := newAuthHandler(database)
	accessToken, _, _ := registerAndLogin(t, h, "dave", "password123")

	var gotRole string
	protected := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotRole = auth.RoleFromCtx(r)
		w.WriteHeader(200)
	})
	handler := auth.Middleware([]byte(testJWTSecret))(protected)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	if rr.Code != 200 {
		t.Fatalf("want 200, got %d", rr.Code)
	}
	if gotRole == "" {
		t.Fatal("role not set in context")
	}
}

// doGetWithToken выполняет GET-запрос с заданным Bearer-токеном через middleware-обёртку.
func doGetWithToken(t *testing.T, handler http.Handler, path, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	return rr
}

// doGetWithContext выполняет вызов handler напрямую, проставив userID в контекст.
func doGetWithContext(handler http.HandlerFunc, userID string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	ctx := context.WithValue(req.Context(), auth.UserIDKey, userID)
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()
	handler(rr, req)
	return rr
}
