package bots

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/messenger/server/db"
)

type botCtxKey string

const botIDKey  botCtxKey = "botID"
const ownerIDKey botCtxKey = "botOwnerID"

// BotAuthMiddleware аутентифицирует бота через заголовок Authorization: Bot <token>.
// Если токен валиден и бот активен — кладёт botID и ownerID в контекст.
// Если заголовок отсутствует — передаёт управление дальше (может быть JWT).
// Если заголовок есть, но токен невалиден — 401.
func BotAuthMiddleware(database *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if !strings.HasPrefix(authHeader, "Bot ") {
				next.ServeHTTP(w, r)
				return
			}
			plaintext := strings.TrimPrefix(authHeader, "Bot ")
			sum := sha256.Sum256([]byte(plaintext))
			hash := hex.EncodeToString(sum[:])

			bot, err := db.GetBotByTokenHash(database, hash)
			if err != nil {
				httpErr(w, "internal error", http.StatusInternalServerError)
				return
			}
			if bot == nil || !bot.Active {
				httpErr(w, "unauthorized", http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), botIDKey, bot.ID)
			ctx = context.WithValue(ctx, ownerIDKey, bot.OwnerID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// BotIDFromCtx возвращает botID из контекста запроса (пусто если не бот).
func BotIDFromCtx(r *http.Request) string {
	v, _ := r.Context().Value(botIDKey).(string)
	return v
}

// IsBotRequest возвращает true если запрос аутентифицирован как бот.
func IsBotRequest(r *http.Request) bool {
	return BotIDFromCtx(r) != ""
}

// BotIDFromCtxVal возвращает botID из context.Context (используется в ws/hub).
func BotIDFromCtxVal(ctx context.Context) string {
	v, _ := ctx.Value(botIDKey).(string)
	return v
}
