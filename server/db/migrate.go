package db

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// Migration описывает одну версионированную миграцию схемы БД.
// Если заполнен Steps, все шаги выполняются в одной транзакции (для DDL из нескольких операторов).
// Иначе используется единственный оператор SQL.
type Migration struct {
	ID    int
	SQL   string
	Steps []string
}

// migrations — список всех миграций в порядке применения.
// Для добавления новой: append с следующим ID.
var migrations = []Migration{
	{ID: 1, SQL: `ALTER TABLE messages ADD COLUMN client_msg_id TEXT`},
	{ID: 2, SQL: `ALTER TABLE messages ADD COLUMN recipient_id TEXT NOT NULL DEFAULT ''`},
	{ID: 3, SQL: `ALTER TABLE messages ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0`},
	{ID: 4, SQL: `ALTER TABLE messages ADD COLUMN edited_at INTEGER`},
	{ID: 5, SQL: `ALTER TABLE identity_keys ADD COLUMN device_id TEXT`},
	{ID: 6, SQL: `ALTER TABLE pre_keys ADD COLUMN device_id TEXT`},
	// Migration 7: меняем PK identity_keys с user_id на (user_id, device_id).
	// SQLite не поддерживает ALTER TABLE для смены PK — пересоздаём таблицу.
	{ID: 7, Steps: []string{
		`CREATE TABLE identity_keys_new (
			user_id       TEXT NOT NULL,
			device_id     TEXT NOT NULL DEFAULT '',
			ik_public     BLOB NOT NULL,
			spk_public    BLOB NOT NULL,
			spk_signature BLOB NOT NULL,
			spk_id        INTEGER NOT NULL,
			updated_at    INTEGER NOT NULL,
			PRIMARY KEY (user_id, device_id),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		`INSERT INTO identity_keys_new
			SELECT user_id, COALESCE(device_id,''), ik_public, spk_public, spk_signature, spk_id, updated_at
			FROM identity_keys`,
		`DROP TABLE identity_keys`,
		`ALTER TABLE identity_keys_new RENAME TO identity_keys`,
	}},
	// Migration 8: адресная доставка сообщений по устройству.
	// Пустая строка = доставить всем устройствам пользователя (обратная совместимость).
	{ID: 8, SQL: `ALTER TABLE messages ADD COLUMN destination_device_id TEXT NOT NULL DEFAULT ''`},
	// Migration 9: роль пользователя (admin/user)
	{ID: 9, SQL: `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`},
	// Migration 10-12: новые таблицы (CREATE IF NOT EXISTS — идемпотентны)
	{ID: 10, SQL: `CREATE TABLE IF NOT EXISTS invite_codes (
		code        TEXT PRIMARY KEY,
		created_by  TEXT NOT NULL REFERENCES users(id),
		used_by     TEXT REFERENCES users(id),
		used_at     INTEGER,
		expires_at  INTEGER,
		created_at  INTEGER NOT NULL
	)`},
	{ID: 11, SQL: `CREATE TABLE IF NOT EXISTS registration_requests (
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
	)`},
	{ID: 12, SQL: `CREATE TABLE IF NOT EXISTS password_reset_requests (
		id           TEXT PRIMARY KEY,
		user_id      TEXT NOT NULL REFERENCES users(id),
		status       TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'rejected')),
		temp_password TEXT,
		created_at   INTEGER NOT NULL,
		resolved_at  INTEGER,
		resolved_by  TEXT REFERENCES users(id)
	)`},
	{ID: 13, Steps: []string{
		`CREATE INDEX IF NOT EXISTS idx_registration_requests_status ON registration_requests(status)`,
		`CREATE INDEX IF NOT EXISTS idx_password_reset_requests_status ON password_reset_requests(status)`,
	}},
	// Migration 14: привязка медиафайла к сообщению для корректного удаления.
	{ID: 14, SQL: `ALTER TABLE media_objects ADD COLUMN client_msg_id TEXT`},
}

// RunMigrations создаёт таблицу schema_migrations и применяет все
// непримененные миграции. Идемпотентен: безопасно вызывать при каждом старте.
func RunMigrations(db *sql.DB) error {
	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		id         INTEGER PRIMARY KEY,
		applied_at INTEGER NOT NULL
	)`)
	if err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	rows, err := db.Query(`SELECT id FROM schema_migrations`)
	if err != nil {
		return fmt.Errorf("query applied migrations: %w", err)
	}
	defer rows.Close()

	applied := make(map[int]bool)
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("scan migration id: %w", err)
		}
		applied[id] = true
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate migrations: %w", err)
	}

	for _, m := range migrations {
		if applied[m.ID] {
			continue
		}

		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("begin migration %d: %w", m.ID, err)
		}

		// Выполняем один оператор SQL или несколько шагов (Steps)
		stmts := m.Steps
		if len(stmts) == 0 {
			stmts = []string{m.SQL}
		}
		var execErr error
		for _, stmt := range stmts {
			if _, err := tx.Exec(stmt); err != nil {
				execErr = err
				break
			}
		}
		if execErr != nil {
			_ = tx.Rollback()
			// Идемпотентность: свежие установки уже содержат колонки в schema,
			// или ALTER TABLE на несуществующую таблицу (устаревшие тест-БД).
			idempotent := strings.Contains(execErr.Error(), "duplicate column name") ||
				strings.Contains(execErr.Error(), "no such table")
			if idempotent {
				// tx уже откатана выше; INSERT записываем вне транзакции
				if _, err2 := db.Exec(
					`INSERT INTO schema_migrations(id, applied_at) VALUES(?, ?)`,
					m.ID, time.Now().Unix(),
				); err2 != nil {
					return fmt.Errorf("record idempotent migration %d: %w", m.ID, err2)
				}
				continue
			}
			return fmt.Errorf("migration %d: %w", m.ID, execErr)
		}

		if _, err := tx.Exec(
			`INSERT INTO schema_migrations(id, applied_at) VALUES(?, ?)`,
			m.ID, time.Now().Unix(),
		); err != nil {
			// Откатываем транзакцию при ошибке INSERT
			_ = tx.Rollback()
			return fmt.Errorf("record migration %d: %w", m.ID, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %d: %w", m.ID, err)
		}
	}

	return nil
}
