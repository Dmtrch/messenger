package db

import (
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:?_pragma=foreign_keys(ON)&_pragma=journal_mode(WAL)")
	if err != nil {
		t.Fatal("open test db:", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// TestRunMigrations_FreshDB: свежая БД с полной схемой.
// Колонки уже есть → duplicate column name → все миграции всё равно записаны.
func TestRunMigrations_FreshDB(t *testing.T) {
	db := openTestDB(t)

	if _, err := db.Exec(schema); err != nil {
		t.Fatal("apply schema:", err)
	}

	if err := RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations on fresh DB: %v", err)
	}

	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&count); err != nil {
		t.Fatal("count migrations:", err)
	}
	if count != len(migrations) {
		t.Errorf("expected %d migrations recorded, got %d", len(migrations), count)
	}
}

// TestRunMigrations_Idempotent: повторный вызов не возвращает ошибку.
func TestRunMigrations_Idempotent(t *testing.T) {
	db := openTestDB(t)

	if _, err := db.Exec(schema); err != nil {
		t.Fatal("apply schema:", err)
	}

	if err := RunMigrations(db); err != nil {
		t.Fatal("first run:", err)
	}
	if err := RunMigrations(db); err != nil {
		t.Fatalf("second run (idempotency): %v", err)
	}
}

// TestRunMigrations_LegacyDB: старая БД без новых колонок получает их через миграции.
func TestRunMigrations_LegacyDB(t *testing.T) {
	db := openTestDB(t)

	mustExec(t, db, `CREATE TABLE messages (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sender_id       TEXT NOT NULL,
        ciphertext      BLOB NOT NULL,
        created_at      INTEGER NOT NULL
    )`)
	mustExec(t, db, `CREATE TABLE identity_keys (
        user_id       TEXT PRIMARY KEY,
        ik_public     BLOB NOT NULL,
        spk_public    BLOB NOT NULL,
        spk_signature BLOB NOT NULL,
        spk_id        INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
    )`)
	mustExec(t, db, `CREATE TABLE pre_keys (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    TEXT NOT NULL,
        key_public BLOB NOT NULL,
        used       INTEGER NOT NULL DEFAULT 0
    )`)

	if err := RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations on legacy DB: %v", err)
	}

	// Проверяем что колонки появились
	_, err := db.Exec(`INSERT INTO messages
        (id, conversation_id, sender_id, ciphertext, created_at, client_msg_id, recipient_id, is_deleted)
        VALUES('1','c1','u1',x'00',1,'cmid','r1',0)`)
	if err != nil {
		t.Fatalf("new columns not added to messages: %v", err)
	}

	_, err = db.Exec(`INSERT INTO identity_keys
        (user_id, ik_public, spk_public, spk_signature, spk_id, updated_at, device_id)
        VALUES('u1',x'00',x'00',x'00',1,1,'dev1')`)
	if err != nil {
		t.Fatalf("device_id not added to identity_keys: %v", err)
	}
}

func mustExec(t *testing.T, db *sql.DB, q string) {
	t.Helper()
	if _, err := db.Exec(q); err != nil {
		t.Fatalf("mustExec: %v\nSQL: %s", err, q)
	}
}
