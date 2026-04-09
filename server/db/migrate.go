package db

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// Migration описывает одну версионированную миграцию схемы БД.
type Migration struct {
	ID  int
	SQL string
}

// migrations — список всех миграций в порядке применения.
// Для добавления новой: append с следующим ID.
var migrations = []Migration{
	{1, `ALTER TABLE messages ADD COLUMN client_msg_id TEXT`},
	{2, `ALTER TABLE messages ADD COLUMN recipient_id TEXT NOT NULL DEFAULT ''`},
	{3, `ALTER TABLE messages ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0`},
	{4, `ALTER TABLE messages ADD COLUMN edited_at INTEGER`},
	{5, `ALTER TABLE identity_keys ADD COLUMN device_id TEXT`},
	{6, `ALTER TABLE pre_keys ADD COLUMN device_id TEXT`},
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

		if _, err := tx.Exec(m.SQL); err != nil {
			_ = tx.Rollback()
			// Идемпотентность: свежие установки уже содержат колонки в schema
			if strings.Contains(err.Error(), "duplicate column name") {
				if _, err2 := db.Exec(
					`INSERT INTO schema_migrations(id, applied_at) VALUES(?, ?)`,
					m.ID, time.Now().Unix(),
				); err2 != nil {
					return fmt.Errorf("record idempotent migration %d: %w", m.ID, err2)
				}
				continue
			}
			return fmt.Errorf("migration %d: %w", m.ID, err)
		}

		if _, err := tx.Exec(
			`INSERT INTO schema_migrations(id, applied_at) VALUES(?, ?)`,
			m.ID, time.Now().Unix(),
		); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("record migration %d: %w", m.ID, err)
		}

		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %d: %w", m.ID, err)
		}
	}

	return nil
}
