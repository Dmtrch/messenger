package media_test

import (
	"bytes"
	"context"
	"database/sql"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/auth"
	"github.com/messenger/server/internal/media"
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

// buildUploadRequest создаёт multipart-запрос с file-полем и опциональным chat_id.
func buildUploadRequest(t *testing.T, chatID string) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	if chatID != "" {
		w.WriteField("chat_id", chatID) //nolint:errcheck
	}
	fw, _ := w.CreateFormFile("file", "test.bin")
	fw.Write([]byte("encrypted-blob")) //nolint:errcheck
	w.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/media/upload", &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	return req
}

// TestMediaUpload_ForbiddenForNonMember проверяет что upload с чужим chat_id возвращает 403.
func TestMediaUpload_ForbiddenForNonMember(t *testing.T) {
	database := newTestDB(t)

	alice := db.User{
		ID: "alice", Username: "alice", DisplayName: "Alice",
		PasswordHash: "x", Role: "user", CreatedAt: 1000000,
	}
	bob := db.User{
		ID: "bob", Username: "bob", DisplayName: "Bob",
		PasswordHash: "x", Role: "user", CreatedAt: 1000000,
	}
	db.CreateUser(database, alice)  //nolint:errcheck
	db.CreateUser(database, bob)    //nolint:errcheck

	// Создаём чат только с bob — alice не является участником
	db.CreateConversation(database, db.Conversation{ //nolint:errcheck
		ID:        "chat-bob-only",
		Type:      "direct",
		CreatedAt: 1000000,
	}, []string{bob.ID})

	h := &media.Handler{
		MediaDir: t.TempDir(),
		DB:       database,
	}

	req := buildUploadRequest(t, "chat-bob-only")
	req = withUserID(req, alice.ID)
	rr := httptest.NewRecorder()
	h.Upload(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("want 403, got %d: %s", rr.Code, rr.Body)
	}
}

// TestMediaUpload_AllowedForMember проверяет что участник чата успешно загружает файл.
func TestMediaUpload_AllowedForMember(t *testing.T) {
	database := newTestDB(t)

	alice := db.User{
		ID: "alice", Username: "alice", DisplayName: "Alice",
		PasswordHash: "x", Role: "user", CreatedAt: 1000000,
	}
	bob := db.User{
		ID: "bob", Username: "bob", DisplayName: "Bob",
		PasswordHash: "x", Role: "user", CreatedAt: 1000000,
	}
	db.CreateUser(database, alice) //nolint:errcheck
	db.CreateUser(database, bob)   //nolint:errcheck

	db.CreateConversation(database, db.Conversation{ //nolint:errcheck
		ID:        "chat-alice-bob",
		Type:      "direct",
		CreatedAt: 1000000,
	}, []string{alice.ID, bob.ID})

	h := &media.Handler{
		MediaDir: t.TempDir(),
		DB:       database,
	}

	req := buildUploadRequest(t, "chat-alice-bob")
	req = withUserID(req, alice.ID)
	rr := httptest.NewRecorder()
	h.Upload(rr, req)

	if rr.Code != http.StatusCreated {
		t.Errorf("want 201, got %d: %s", rr.Code, rr.Body)
	}
}
