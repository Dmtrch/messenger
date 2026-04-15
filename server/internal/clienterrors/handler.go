// Package clienterrors handles incoming client-side error reports.
package clienterrors

import (
	"encoding/json"
	"net/http"

	"github.com/messenger/server/internal/logger"
)

// Handler accepts POST /api/client-errors and writes entries to
// logs/client-errors.log via the shared structured logger.
type Handler struct{}

type entry struct {
	Timestamp string `json:"timestamp"`
	Level     string `json:"level"`
	Message   string `json:"message"`
	UserID    string `json:"userId"`
	Route     string `json:"route"`
	Details   any    `json:"details,omitempty"`
}

type request struct {
	Entries []entry `json:"entries"`
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	for _, e := range req.Entries {
		args := []any{
			"client_timestamp", e.Timestamp,
			"level", e.Level,
			"userId", e.UserID,
			"route", e.Route,
		}
		if e.Details != nil {
			args = append(args, "details", e.Details)
		}
		switch e.Level {
		case "error":
			logger.Error("[client] "+e.Message, args...)
		case "warn":
			logger.Warn("[client] "+e.Message, args...)
		default:
			logger.Info("[client] "+e.Message, args...)
		}
	}

	w.WriteHeader(http.StatusNoContent)
}
