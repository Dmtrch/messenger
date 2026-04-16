package ws_test

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/ws"
)

const testSecret = "test-secret-key-32bytes-padxxxxx"

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

func newHub(database *sql.DB) *ws.Hub {
	return ws.NewHub(testSecret, database, "", "", "")
}

func makeJWT(userID string, exp time.Duration) string {
	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": userID,
		"exp": time.Now().Add(exp).Unix(),
	}).SignedString([]byte(testSecret))
	return token
}

// dialWS подключается к тестовому серверу через WebSocket.
func dialWS(t *testing.T, srv *httptest.Server, token string) (*websocket.Conn, error) {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "?token=" + token
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	return conn, err
}

// ── Auth ─────────────────────────────────────────────────────────────────────

func TestWSHub_InvalidToken_ClosedWith4001(t *testing.T) {
	database := newTestDB(t)
	hub := newHub(database)
	srv := httptest.NewServer(http.HandlerFunc(hub.ServeWS))
	defer srv.Close()

	conn, err := dialWS(t, srv, "invalid.jwt.token")
	if err != nil {
		// Некоторые реализации отклоняют апгрейд до WS — тоже допустимо
		return
	}
	defer conn.Close()

	// Ждём закрытие с кодом 4001
	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, _, err = conn.ReadMessage()
	if err == nil {
		t.Fatal("expected connection to be closed")
	}

	closeErr, ok := err.(*websocket.CloseError)
	if !ok {
		t.Fatalf("expected CloseError, got: %T %v", err, err)
	}
	if closeErr.Code != 4001 {
		t.Fatalf("expected close code 4001, got %d", closeErr.Code)
	}
}

func TestWSHub_ValidToken_Connects(t *testing.T) {
	database := newTestDB(t)

	// Создаём пользователя
	user := db.User{
		ID: "user-ws-test", Username: "wstest", DisplayName: "WS Test",
		PasswordHash: "$2a$12$testhash", Role: "user", CreatedAt: time.Now().UnixMilli(),
	}
	if err := db.CreateUser(database, user); err != nil {
		t.Fatalf("create user: %v", err)
	}

	hub := newHub(database)
	srv := httptest.NewServer(http.HandlerFunc(hub.ServeWS))
	defer srv.Close()

	token := makeJWT("user-ws-test", 15*time.Minute)
	conn, err := dialWS(t, srv, token)
	if err != nil {
		t.Fatalf("dial with valid token: %v", err)
	}
	defer conn.Close()

	// Соединение успешно установлено — отправляем ping
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
		t.Fatalf("ping: %v", err)
	}
}

func TestWSHub_ExpiredToken_Rejected(t *testing.T) {
	database := newTestDB(t)
	hub := newHub(database)
	srv := httptest.NewServer(http.HandlerFunc(hub.ServeWS))
	defer srv.Close()

	expiredToken := makeJWT("user-1", -1*time.Hour) // уже просрочен
	conn, err := dialWS(t, srv, expiredToken)
	if err != nil {
		return // апгрейд отклонён — ожидаемо
	}
	defer conn.Close()

	conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, _, err = conn.ReadMessage()
	if err == nil {
		t.Fatal("expected connection to be closed for expired token")
	}
	if closeErr, ok := err.(*websocket.CloseError); ok {
		if closeErr.Code != 4001 {
			t.Fatalf("expected close code 4001, got %d", closeErr.Code)
		}
	}
}

// ── BroadcastToConversation ──────────────────────────────────────────────────

func TestWSHub_Broadcast_DeliveredToMember(t *testing.T) {
	database := newTestDB(t)

	alice := db.User{
		ID: "user-alice", Username: "alice", DisplayName: "Alice",
		PasswordHash: "$2a$12$testhash", Role: "user", CreatedAt: time.Now().UnixMilli(),
	}
	bob := db.User{
		ID: "user-bob", Username: "bob", DisplayName: "Bob",
		PasswordHash: "$2a$12$testhash", Role: "user", CreatedAt: time.Now().UnixMilli(),
	}
	db.CreateUser(database, alice)
	db.CreateUser(database, bob)

	// Создаём conversation
	conv := db.Conversation{
		ID: "conv-1", Type: "direct", CreatedAt: time.Now().UnixMilli(),
	}
	db.CreateConversation(database, conv, []string{alice.ID, bob.ID})

	hub := newHub(database)
	srv := httptest.NewServer(http.HandlerFunc(hub.ServeWS))
	defer srv.Close()

	// Alice подключается
	aliceToken := makeJWT(alice.ID, 15*time.Minute)
	aliceConn, err := dialWS(t, srv, aliceToken)
	if err != nil {
		t.Fatalf("alice dial: %v", err)
	}
	defer aliceConn.Close()

	// Небольшая задержка для регистрации клиента в хабе
	time.Sleep(50 * time.Millisecond)

	// Broadcast в conversation
	payload := []byte(`{"type":"test","chatId":"conv-1"}`)
	hub.BroadcastToConversation(conv.ID, payload)

	// Хаб может отправить служебные сообщения (prekey_low и т.п.) — читаем до нужного.
	aliceConn.SetReadDeadline(time.Now().Add(2 * time.Second))
	found := false
	for i := 0; i < 5; i++ {
		_, msg, err := aliceConn.ReadMessage()
		if err != nil {
			t.Fatalf("alice read: %v", err)
		}
		if string(msg) == string(payload) {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("broadcast message %q not received by alice", payload)
	}
}
