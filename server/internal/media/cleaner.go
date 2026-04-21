package media

import (
	"database/sql"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/messenger/server/db"
)

func StartRetentionCleaner(database *sql.DB, mediaDir string) {
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			runRetentionCleanup(database, mediaDir)
		}
	}()
}

func runRetentionCleanup(database *sql.DB, mediaDir string) {
	val, err := db.GetSetting(database, "media_retention_days")
	if err != nil || val == "" || val == "0" {
		return
	}
	days, err := strconv.Atoi(val)
	if err != nil || days <= 0 {
		return
	}
	cutoff := time.Now().Add(-time.Duration(days) * 24 * time.Hour).UnixMilli()
	filenames, err := db.DeleteMediaOlderThan(database, cutoff)
	if err != nil {
		return
	}
	for _, name := range filenames {
		path := filepath.Join(mediaDir, filepath.Clean(name))
		os.Remove(path) //nolint:errcheck
	}
}
