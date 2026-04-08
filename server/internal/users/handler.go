package users

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/auth"
)

type Handler struct {
	DB *sql.DB
}

type UserDTO struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

// GET /api/users/search?q=<query>
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if len(q) < 2 {
		reply(w, 200, map[string]any{"users": []UserDTO{}})
		return
	}

	callerID := auth.UserIDFromCtx(r)
	users, err := db.SearchUsers(h.DB, q, 21)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}

	result := make([]UserDTO, 0, len(users))
	for _, u := range users {
		if u.ID == callerID {
			continue
		}
		result = append(result, UserDTO{ID: u.ID, Username: u.Username, DisplayName: u.DisplayName})
		if len(result) == 20 {
			break
		}
	}
	reply(w, 200, map[string]any{"users": result})
}

func httpErr(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func reply(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
