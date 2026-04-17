package auth

import (
	"context"
	"database/sql"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/messenger/server/db"
)

type ctxKey string

const UserIDKey ctxKey = "userID"
const RoleKey   ctxKey = "role"
const EpochKey  ctxKey = "epoch"

// RoleFromCtx возвращает роль пользователя из контекста запроса.
func RoleFromCtx(r *http.Request) string {
	role, _ := r.Context().Value(RoleKey).(string)
	if role == "" {
		return "user"
	}
	return role
}

// EpochFromCtx возвращает session_epoch из JWT-контекста запроса.
func EpochFromCtx(r *http.Request) int64 {
	v, _ := r.Context().Value(EpochKey).(int64)
	return v
}

// Middleware извлекает userID из Bearer JWT и кладёт в контекст.
func Middleware(secret []byte) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if !strings.HasPrefix(authHeader, "Bearer ") {
				httpErr(w, "missing token", 401)
				return
			}
			tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
			token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
				if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, jwt.ErrSignatureInvalid
				}
				return secret, nil
			})
			if err != nil || !token.Valid {
				httpErr(w, "invalid token", 401)
				return
			}
			claims, ok := token.Claims.(jwt.MapClaims)
			if !ok {
				httpErr(w, "invalid claims", 401)
				return
			}
			userID, _ := claims["sub"].(string)
			role, _ := claims["role"].(string)
			if role == "" {
				role = "user"
			}
			epoch := int64(0)
			if v, ok := claims["epoch"].(float64); ok {
				epoch = int64(v)
			}
			ctx := context.WithValue(r.Context(), UserIDKey, userID)
			ctx = context.WithValue(ctx, RoleKey, role)
			ctx = context.WithValue(ctx, EpochKey, epoch)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// AccountStatusMiddleware проверяет статус аккаунта и актуальность session_epoch.
// Должен применяться после Middleware (JWT) в цепочке.
func AccountStatusMiddleware(database *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID := UserIDFromCtx(r)
			if userID == "" {
				next.ServeHTTP(w, r)
				return
			}
			user, err := db.GetUserByID(database, userID)
			if err != nil || user == nil {
				httpErr(w, "user not found", 401)
				return
			}
			if user.Status != "active" {
				httpErr(w, "account_"+user.Status, 403)
				return
			}
			if EpochFromCtx(r) < user.SessionEpoch {
				httpErr(w, "session_revoked", 401)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// UserIDFromCtx возвращает userID из контекста запроса.
func UserIDFromCtx(r *http.Request) string {
	id, _ := r.Context().Value(UserIDKey).(string)
	return id
}
