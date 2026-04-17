package auth_test

import (
	"strings"
	"testing"
	"time"

	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/password"
	"golang.org/x/crypto/bcrypt"
)

// TestLogin_LazyRehashFromBcrypt — успешный вход пользователя с bcrypt-хешем
// должен триггерить пересчёт пароля в Argon2id (P1-PWD-2).
func TestLogin_LazyRehashFromBcrypt(t *testing.T) {
	database := newTestDB(t)
	h := newHandler(database)

	bcryptHash, err := bcrypt.GenerateFromPassword([]byte("hunter2-legacy"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("bcrypt: %v", err)
	}
	if err := db.CreateUser(database, db.User{
		ID: "legacy-user", Username: "legacy", DisplayName: "Legacy",
		PasswordHash: string(bcryptHash), Role: "user",
		CreatedAt: time.Now().UnixMilli(),
	}); err != nil {
		t.Fatalf("create user: %v", err)
	}

	rr := doPost(h.Login, map[string]any{"username": "legacy", "password": "hunter2-legacy"})
	if rr.Code != 200 {
		t.Fatalf("login: want 200, got %d %s", rr.Code, rr.Body)
	}

	user, err := db.GetUserByUsername(database, "legacy")
	if err != nil || user == nil {
		t.Fatalf("get user: %v", err)
	}
	if !strings.HasPrefix(user.PasswordHash, password.Argon2idPrefix) {
		t.Errorf("hash should be upgraded to argon2id, got prefix %.20s", user.PasswordHash)
	}
	if password.NeedsRehash(user.PasswordHash) {
		t.Errorf("upgraded hash should not need rehash")
	}
}
