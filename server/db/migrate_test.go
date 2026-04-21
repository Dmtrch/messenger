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

	// users нужна для FK в identity_keys
	mustExec(t, db, `CREATE TABLE users (
		id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
		display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
	)`)
	mustExec(t, db, `INSERT INTO users VALUES ('u1','u1','U1','hash',1)`)
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

// TestRunMigrations_Migration7_CompositeKey: миграция #7 пересоздаёт identity_keys
// с составным PK (user_id, device_id). Проверяем, что после Open:
// - два ключа одного user с разными device_id допустимы
// - дублирующийся (user_id, device_id) запрещён.
func TestRunMigrations_Migration7_CompositeKey(t *testing.T) {
	db := openTestDB(t)

	// Симулируем старую схему без составного PK.
	// users нужна для FK — создаём и добавляем тестового пользователя.
	mustExec(t, db, `CREATE TABLE users (
		id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
		display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
	)`)
	mustExec(t, db, `INSERT INTO users VALUES ('u1','u1','U1','hash',1)`)
	mustExec(t, db, `CREATE TABLE identity_keys (
		user_id TEXT PRIMARY KEY,
		ik_public BLOB NOT NULL, spk_public BLOB NOT NULL,
		spk_signature BLOB NOT NULL, spk_id INTEGER NOT NULL, updated_at INTEGER NOT NULL
	)`)
	mustExec(t, db, `CREATE TABLE pre_keys (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL, key_public BLOB NOT NULL,
		used INTEGER NOT NULL DEFAULT 0
	)`)
	mustExec(t, db, `CREATE TABLE messages (
		id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
		sender_id TEXT NOT NULL, ciphertext BLOB NOT NULL, created_at INTEGER NOT NULL
	)`)

	if err := RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	// Вставляем одного user с двумя устройствами — должно работать
	mustExec(t, db, `INSERT INTO identity_keys VALUES ('u1','dev1',x'01',x'02',x'03',1,1000)`)
	mustExec(t, db, `INSERT INTO identity_keys VALUES ('u1','dev2',x'04',x'05',x'06',2,2000)`)

	// Дублирующийся (u1, dev1) должен упасть с ошибкой UNIQUE
	_, err := db.Exec(`INSERT INTO identity_keys VALUES ('u1','dev1',x'07',x'08',x'09',3,3000)`)
	if err == nil {
		t.Fatal("expected UNIQUE constraint violation for duplicate (user_id, device_id)")
	}
}

// TestRunMigrations_Migration8_DestinationDeviceID: миграция #8 добавляет колонку
// destination_device_id в messages. Проверяем на старой схеме без этой колонки.
func TestRunMigrations_Migration8_DestinationDeviceID(t *testing.T) {
	db := openTestDB(t)

	mustExec(t, db, `CREATE TABLE users (
		id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
		display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
	)`)
	mustExec(t, db, `INSERT INTO users VALUES ('u1','u1','U1','hash',1)`)
	mustExec(t, db, `CREATE TABLE messages (
		id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
		sender_id TEXT NOT NULL, ciphertext BLOB NOT NULL, created_at INTEGER NOT NULL
	)`)
	mustExec(t, db, `CREATE TABLE identity_keys (
		user_id TEXT PRIMARY KEY,
		ik_public BLOB NOT NULL, spk_public BLOB NOT NULL,
		spk_signature BLOB NOT NULL, spk_id INTEGER NOT NULL, updated_at INTEGER NOT NULL
	)`)
	mustExec(t, db, `CREATE TABLE pre_keys (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL, key_public BLOB NOT NULL,
		used INTEGER NOT NULL DEFAULT 0
	)`)

	if err := RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	// Проверяем, что колонка destination_device_id доступна
	_, err := db.Exec(`INSERT INTO messages
		(id, conversation_id, sender_id, ciphertext, created_at, destination_device_id)
		VALUES('1','c1','u1',x'00',1,'device-xyz')`)
	if err != nil {
		t.Fatalf("destination_device_id column not added to messages: %v", err)
	}

	// Проверяем обратную совместимость: DEFAULT '' работает
	_, err = db.Exec(`INSERT INTO messages
		(id, conversation_id, sender_id, ciphertext, created_at)
		VALUES('2','c1','u1',x'00',2)`)
	if err != nil {
		t.Fatalf("messages insert without destination_device_id failed: %v", err)
	}
}

// legacySchema создаёт минимальный набор таблиц (без новых колонок/таблиц),
// достаточный для прохождения всех миграций 1–28 на "старой" БД.
func legacySchema(t *testing.T, db *sql.DB) {
	t.Helper()
	mustExec(t, db, `CREATE TABLE users (
		id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
		display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
	)`)
	mustExec(t, db, `INSERT INTO users VALUES ('u1','u1','U1','hash',1)`)
	mustExec(t, db, `CREATE TABLE messages (
		id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
		sender_id TEXT NOT NULL, ciphertext BLOB NOT NULL, created_at INTEGER NOT NULL
	)`)
	mustExec(t, db, `CREATE TABLE identity_keys (
		user_id TEXT PRIMARY KEY,
		ik_public BLOB NOT NULL, spk_public BLOB NOT NULL,
		spk_signature BLOB NOT NULL, spk_id INTEGER NOT NULL, updated_at INTEGER NOT NULL
	)`)
	mustExec(t, db, `CREATE TABLE pre_keys (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id TEXT NOT NULL, key_public BLOB NOT NULL,
		used INTEGER NOT NULL DEFAULT 0
	)`)
	mustExec(t, db, `CREATE TABLE conversations (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL DEFAULT '',
		is_group INTEGER NOT NULL DEFAULT 0,
		created_at INTEGER NOT NULL
	)`)
	mustExec(t, db, `CREATE TABLE media_objects (
		id TEXT PRIMARY KEY,
		uploader_id TEXT NOT NULL,
		filename TEXT NOT NULL,
		original_name TEXT NOT NULL,
		content_type TEXT NOT NULL,
		size INTEGER NOT NULL DEFAULT 0,
		created_at INTEGER NOT NULL
	)`)
}

// TestRunMigrations_Migration24_UserQuotas: миграция #24 создаёт таблицу user_quotas.
func TestRunMigrations_Migration24_UserQuotas(t *testing.T) {
	db := openTestDB(t)
	legacySchema(t, db)

	if err := RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	// Проверяем что таблица создана: INSERT + SELECT
	_, err := db.Exec(`INSERT INTO user_quotas (user_id, quota_bytes, used_bytes) VALUES ('u1', 1000, 200)`)
	if err != nil {
		t.Fatalf("insert into user_quotas: %v", err)
	}
	var quotaBytes, usedBytes int64
	if err := db.QueryRow(`SELECT quota_bytes, used_bytes FROM user_quotas WHERE user_id='u1'`).Scan(&quotaBytes, &usedBytes); err != nil {
		t.Fatalf("select from user_quotas: %v", err)
	}
	if quotaBytes != 1000 || usedBytes != 200 {
		t.Errorf("unexpected values: quota_bytes=%d, used_bytes=%d", quotaBytes, usedBytes)
	}

	// Идемпотентность
	if err := RunMigrations(db); err != nil {
		t.Fatalf("second RunMigrations (idempotency): %v", err)
	}
}

// TestRunMigrations_Migration25_Settings: миграция #25 создаёт таблицу settings.
func TestRunMigrations_Migration25_Settings(t *testing.T) {
	db := openTestDB(t)
	legacySchema(t, db)

	if err := RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	// INSERT + SELECT
	mustExec(t, db, `INSERT INTO settings (key, value) VALUES ('site_name', 'MyMessenger')`)
	var val string
	if err := db.QueryRow(`SELECT value FROM settings WHERE key='site_name'`).Scan(&val); err != nil {
		t.Fatalf("select from settings: %v", err)
	}
	if val != "MyMessenger" {
		t.Errorf("unexpected value: %q", val)
	}

	// Идемпотентность
	if err := RunMigrations(db); err != nil {
		t.Fatalf("second RunMigrations (idempotency): %v", err)
	}
}

// TestRunMigrations_Migration26_ModeratorMarker: миграция #26 — маркер (SELECT 1),
// проверяем что запись появилась в schema_migrations.
func TestRunMigrations_Migration26_ModeratorMarker(t *testing.T) {
	db := openTestDB(t)

	if _, err := db.Exec(schema); err != nil {
		t.Fatal("apply schema:", err)
	}

	if err := RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM schema_migrations WHERE id=26`).Scan(&count); err != nil {
		t.Fatalf("query schema_migrations for id=26: %v", err)
	}
	if count != 1 {
		t.Errorf("expected migration 26 recorded, got count=%d", count)
	}
}

// TestRunMigrations_Migration27_MaxMembers: миграция #27 добавляет колонку max_members в conversations.
func TestRunMigrations_Migration27_MaxMembers(t *testing.T) {
	db := openTestDB(t)
	legacySchema(t, db)

	if err := RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	// INSERT с max_members значением
	_, err := db.Exec(`INSERT INTO conversations (id, name, is_group, created_at, max_members) VALUES ('c1','Test',1,1,50)`)
	if err != nil {
		t.Fatalf("insert with max_members: %v", err)
	}

	// INSERT без max_members — DEFAULT NULL должен работать
	_, err = db.Exec(`INSERT INTO conversations (id, name, is_group, created_at) VALUES ('c2','Direct',0,1)`)
	if err != nil {
		t.Fatalf("insert without max_members: %v", err)
	}

	var maxMembers *int
	if err := db.QueryRow(`SELECT max_members FROM conversations WHERE id='c2'`).Scan(&maxMembers); err != nil {
		t.Fatalf("select max_members: %v", err)
	}
	if maxMembers != nil {
		t.Errorf("expected max_members=NULL for c2, got %v", *maxMembers)
	}
}

// TestRunMigrations_Migration28_Bots: миграция #28 создаёт таблицу bots.
func TestRunMigrations_Migration28_Bots(t *testing.T) {
	db := openTestDB(t)

	if _, err := db.Exec(schema); err != nil {
		t.Fatal("apply schema:", err)
	}

	if err := RunMigrations(db); err != nil {
		t.Fatalf("RunMigrations: %v", err)
	}

	// Добавляем пользователя для FK owner_id → users(id)
	mustExec(t, db, `INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES ('u1','u1','U1','hash',1)`)

	// Проверяем INSERT
	mustExec(t, db, `INSERT INTO bots (id, name, owner_id, token_hash, webhook_url, active, created_at)
		VALUES ('bot1','TestBot','u1','hash_abc','',1,1000)`)

	// UNIQUE constraint на token_hash
	_, err := db.Exec(`INSERT INTO bots (id, name, owner_id, token_hash, webhook_url, active, created_at)
		VALUES ('bot2','AnotherBot','u1','hash_abc','',1,2000)`)
	if err == nil {
		t.Fatal("expected UNIQUE constraint violation for duplicate token_hash")
	}

	// Вторая запись с другим token_hash — должна проходить
	mustExec(t, db, `INSERT INTO bots (id, name, owner_id, token_hash, webhook_url, active, created_at)
		VALUES ('bot3','Bot3','u1','hash_xyz','https://example.com',1,3000)`)

	// Идемпотентность
	if err := RunMigrations(db); err != nil {
		t.Fatalf("second RunMigrations (idempotency): %v", err)
	}
}

func mustExec(t *testing.T, db *sql.DB, q string) {
	t.Helper()
	if _, err := db.Exec(q); err != nil {
		t.Fatalf("mustExec: %v\nSQL: %s", err, q)
	}
}
