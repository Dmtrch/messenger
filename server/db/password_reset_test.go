package db

import (
	"database/sql"
	"strings"
	"testing"
)

// TestResolvePasswordResetRequest_NoPlaintextStored проверяет, что временный
// пароль не сохраняется в таблице password_reset_requests в открытом виде.
func TestResolvePasswordResetRequest_NoPlaintextStored(t *testing.T) {
	db := openTestDB(t)
	if _, err := db.Exec(schema); err != nil {
		t.Fatal("apply schema:", err)
	}

	user := User{ID: "u1", Username: "alice", DisplayName: "Alice", PasswordHash: "x", Role: "user", CreatedAt: 1}
	if err := CreateUser(db, user); err != nil {
		t.Fatal("create user:", err)
	}
	admin := User{ID: "admin1", Username: "admin", DisplayName: "Admin", PasswordHash: "x", Role: "admin", CreatedAt: 1}
	if err := CreateUser(db, admin); err != nil {
		t.Fatal("create admin:", err)
	}
	if err := CreatePasswordResetRequest(db, "req1", "u1", 100); err != nil {
		t.Fatal("create reset request:", err)
	}

	const tempPassword = "S3cretTemp!"
	if err := ResolvePasswordResetRequest(db, "req1", "admin1", 200); err != nil {
		t.Fatal("resolve reset request:", err)
	}

	// Открытый временный пароль не должен попадать в БД.
	var stored sql.NullString
	if err := db.QueryRow(`SELECT temp_password FROM password_reset_requests WHERE id=?`, "req1").Scan(&stored); err != nil {
		t.Fatal("read temp_password:", err)
	}
	if stored.Valid && strings.Contains(stored.String, tempPassword) {
		t.Fatalf("временный пароль сохранён в открытом виде: %q", stored.String)
	}

	// Статус заявки должен стать completed.
	got, err := GetPasswordResetRequest(db, "req1")
	if err != nil {
		t.Fatal("get reset request:", err)
	}
	if got == nil || got.Status != "completed" {
		t.Fatalf("ожидался статус completed, получено %+v", got)
	}
	if strings.Contains(got.TempPassword, tempPassword) {
		t.Fatalf("GetPasswordResetRequest вернул открытый временный пароль: %q", got.TempPassword)
	}
}
