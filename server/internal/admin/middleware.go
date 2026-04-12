package admin

import (
	"encoding/json"
	"net/http"

	"github.com/messenger/server/internal/auth"
)

// RequireAdmin проверяет роль из JWT-контекста. Должен применяться после auth.Middleware.
func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		role := auth.RoleFromCtx(r)
		if role != "admin" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]string{"error": "forbidden"})
			return
		}
		next.ServeHTTP(w, r)
	})
}
