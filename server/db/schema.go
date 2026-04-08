package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// Open opens (or creates) the SQLite database in WAL mode.
func Open(dbPath string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0700); err != nil {
		return nil, fmt.Errorf("create db dir: %w", err)
	}

	db, err := sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	// SQLite supports only one concurrent writer
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("apply schema: %w", err)
	}

	// Миграция для существующих БД — ошибки игнорируются (колонка уже есть)
	for _, m := range []string{
		`ALTER TABLE messages ADD COLUMN client_msg_id TEXT`,
		`ALTER TABLE messages ADD COLUMN recipient_id TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE messages ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE messages ADD COLUMN edited_at INTEGER`,
	} {
		db.Exec(m) //nolint:errcheck
	}

	return db, nil
}

const schema = `
CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    username     TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contacts (
    user_id    TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, contact_id),
    FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (contact_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS conversations (
    id         TEXT PRIMARY KEY,
    type       TEXT NOT NULL CHECK(type IN ('direct','group')),
    name       TEXT,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    joined_at       INTEGER NOT NULL,
    PRIMARY KEY (conversation_id, user_id),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)         REFERENCES users(id) ON DELETE CASCADE
);

-- Only ciphertext stored; server never sees plaintext
CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    client_msg_id   TEXT,
    conversation_id TEXT NOT NULL,
    sender_id       TEXT NOT NULL,
    recipient_id    TEXT NOT NULL DEFAULT '',
    ciphertext      BLOB NOT NULL,
    sender_key_id   INTEGER NOT NULL DEFAULT 0,
    is_deleted      INTEGER NOT NULL DEFAULT 0,
    edited_at       INTEGER,
    created_at      INTEGER NOT NULL,
    delivered_at    INTEGER,
    read_at         INTEGER,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id)       REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_conv_time
    ON messages(conversation_id, created_at DESC);

-- Signal Protocol key material (public keys only)
CREATE TABLE IF NOT EXISTS identity_keys (
    user_id       TEXT PRIMARY KEY,
    ik_public     BLOB NOT NULL,
    spk_public    BLOB NOT NULL,
    spk_signature BLOB NOT NULL,
    spk_id        INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pre_keys (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    key_public BLOB NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Web Push VAPID subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id       TEXT PRIMARY KEY,
    user_id  TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh   BLOB NOT NULL,
    auth     BLOB NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Медиафайлы: сервер хранит только ciphertext, доступ по JWT
CREATE TABLE IF NOT EXISTS media_objects (
    id              TEXT PRIMARY KEY,           -- UUID = mediaId
    uploader_id     TEXT NOT NULL,
    conversation_id TEXT,                       -- NULL до привязки к чату
    filename        TEXT NOT NULL,              -- имя файла на диске
    original_name   TEXT NOT NULL,
    content_type    TEXT NOT NULL,
    size            INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    FOREIGN KEY (uploader_id)     REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
);
`
