package auth

import (
	"context"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type ctxKey string

const UserIDKey ctxKey = "userID"

const RoleKey ctxKey = "role"

// RoleFromCtx возвращает роль пользователя из контекста запроса.
func RoleFromCtx(r *http.Request) string {
	role, _ := r.Context().Value(RoleKey).(string)
	if role == "" {
		return "user"
	}
	return role
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
			ctx := context.WithValue(r.Context(), UserIDKey, userID)
			ctx = context.WithValue(ctx, RoleKey, role)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// UserIDFromCtx возвращает userID из контекста запроса.
func UserIDFromCtx(r *http.Request) string {
	id, _ := r.Context().Value(UserIDKey).(string)
	return id
}
