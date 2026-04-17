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

	if err := RunMigrations(db); err != nil {
		return nil, fmt.Errorf("run migrations: %w", err)
	}

	return db, nil
}

const schema = `
CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY,
    username       TEXT UNIQUE NOT NULL,
    display_name   TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    role           TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
    status         TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'banned')),
    session_epoch  INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL
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
-- PK составной (user_id, device_id) для поддержки multi-device модели
CREATE TABLE IF NOT EXISTS identity_keys (
    user_id       TEXT NOT NULL,
    device_id     TEXT NOT NULL DEFAULT '',
    ik_public     BLOB NOT NULL,
    spk_public    BLOB NOT NULL,
    spk_signature BLOB NOT NULL,
    spk_id        INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    PRIMARY KEY (user_id, device_id),
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

-- Устройства пользователей (основа multi-device модели)
CREATE TABLE IF NOT EXISTS devices (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    device_name  TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Состояние пользователя в чате: последнее прочитанное сообщение
CREATE TABLE IF NOT EXISTS chat_user_state (
    conversation_id  TEXT NOT NULL,
    user_id          TEXT NOT NULL,
    last_read_msg_id TEXT NOT NULL DEFAULT '',
    last_read_at     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)         REFERENCES users(id) ON DELETE CASCADE
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

-- Коды приглашения для регистрации.
-- TTL задаётся жёстко в admin-handler (180с, диапазон 60..600), expires_at хранит
-- вычисленное время истечения в UnixMilli. revoked_at = 0 означает «не отозван».
CREATE TABLE IF NOT EXISTS invite_codes (
    code        TEXT PRIMARY KEY,
    created_by  TEXT NOT NULL REFERENCES users(id),
    used_by     TEXT REFERENCES users(id),
    used_at     INTEGER,
    expires_at  INTEGER,
    revoked_at  INTEGER,
    created_at  INTEGER NOT NULL
);

-- Журнал активаций инвайт-кодов (IP, User-Agent) для аудита.
CREATE TABLE IF NOT EXISTS invite_activations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    code          TEXT NOT NULL REFERENCES invite_codes(code) ON DELETE CASCADE,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip            TEXT NOT NULL DEFAULT '',
    user_agent    TEXT NOT NULL DEFAULT '',
    activated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invite_activations_code
    ON invite_activations(code);

-- Заявки на регистрацию (требуют подтверждения админом)
CREATE TABLE IF NOT EXISTS registration_requests (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    ik_public     TEXT NOT NULL,
    spk_id        INTEGER NOT NULL,
    spk_public    TEXT NOT NULL,
    spk_signature TEXT NOT NULL,
    opk_publics   TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    created_at    INTEGER NOT NULL,
    reviewed_at   INTEGER,
    reviewed_by   TEXT REFERENCES users(id)
);

-- Запросы на сброс пароля
CREATE TABLE IF NOT EXISTS password_reset_requests (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id),
    status       TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'rejected')),
    -- temp_password хранится в открытом виде — нужен для отображения администратору
    -- должен быть немедленно сменён пользователем после использования
    temp_password TEXT,
    created_at   INTEGER NOT NULL,
    resolved_at  INTEGER,
    resolved_by  TEXT REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_registration_requests_status
    ON registration_requests(status);

CREATE INDEX IF NOT EXISTS idx_password_reset_requests_status
    ON password_reset_requests(status);
`
