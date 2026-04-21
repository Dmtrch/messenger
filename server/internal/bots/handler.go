package bots

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/auth"
)

type Handler struct {
	DB *sql.DB
}

// generateToken генерирует plaintext-токен (32 случайных байта в hex) и его SHA-256 хеш.
func generateToken() (plaintext, hash string, err error) {
	buf := make([]byte, 32)
	if _, err = rand.Read(buf); err != nil {
		return
	}
	plaintext = hex.EncodeToString(buf)
	sum := sha256.Sum256([]byte(plaintext))
	hash = hex.EncodeToString(sum[:])
	return
}

type botResponse struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	WebhookURL string `json:"webhookUrl"`
	Active     bool   `json:"active"`
	CreatedAt  int64  `json:"createdAt"`
}

func botToResponse(b db.Bot) botResponse {
	return botResponse{
		ID:         b.ID,
		Name:       b.Name,
		WebhookURL: b.WebhookURL,
		Active:     b.Active,
		CreatedAt:  b.CreatedAt,
	}
}

// POST /api/bots — создать бота
func (h *Handler) CreateBot(w http.ResponseWriter, r *http.Request) {
	ownerID := auth.UserIDFromCtx(r)

	var body struct {
		Name       string `json:"name"`
		WebhookURL string `json:"webhookUrl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		httpErr(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// Проверить webhook URL allowlist
	if body.WebhookURL != "" && !isLocalURL(body.WebhookURL) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnprocessableEntity)
		w.Write([]byte(`{"error":"webhook_url_not_allowed","message":"only localhost/127.x/10.x/192.168.x allowed"}`))
		return
	}

	plaintext, tokenHash, err := generateToken()
	if err != nil {
		httpErr(w, "failed to generate token", http.StatusInternalServerError)
		return
	}

	bot := db.Bot{
		ID:         uuid.NewString(),
		Name:       body.Name,
		OwnerID:    ownerID,
		TokenHash:  tokenHash,
		WebhookURL: body.WebhookURL,
		Active:     true,
		CreatedAt:  time.Now().UnixMilli(),
	}
	if err := db.CreateBot(h.DB, bot); err != nil {
		httpErr(w, "failed to create bot", http.StatusInternalServerError)
		return
	}

	reply(w, http.StatusCreated, map[string]any{
		"bot":   botToResponse(bot),
		"token": plaintext,
	})
}

// GET /api/bots — список ботов текущего пользователя
func (h *Handler) ListBots(w http.ResponseWriter, r *http.Request) {
	ownerID := auth.UserIDFromCtx(r)

	bots, err := db.ListBotsByOwner(h.DB, ownerID)
	if err != nil {
		httpErr(w, "failed to list bots", http.StatusInternalServerError)
		return
	}

	result := make([]botResponse, 0, len(bots))
	for _, b := range bots {
		result = append(result, botToResponse(b))
	}
	reply(w, http.StatusOK, map[string]any{"bots": result})
}

// DELETE /api/bots/{botId} — удалить бота
func (h *Handler) DeleteBot(w http.ResponseWriter, r *http.Request) {
	ownerID := auth.UserIDFromCtx(r)
	botID := chi.URLParam(r, "botId")

	err := db.DeleteBot(h.DB, botID, ownerID)
	if err == sql.ErrNoRows {
		httpErr(w, "bot not found", http.StatusNotFound)
		return
	}
	if err != nil {
		httpErr(w, "failed to delete bot", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// POST /api/bots/{botId}/token — перегенерировать токен
func (h *Handler) RegenerateToken(w http.ResponseWriter, r *http.Request) {
	ownerID := auth.UserIDFromCtx(r)
	botID := chi.URLParam(r, "botId")

	// Проверяем, что бот существует и принадлежит owner
	bot, err := db.GetBotByID(h.DB, botID)
	if err != nil {
		httpErr(w, "failed to get bot", http.StatusInternalServerError)
		return
	}
	if bot == nil || bot.OwnerID != ownerID {
		httpErr(w, "bot not found", http.StatusNotFound)
		return
	}

	plaintext, newHash, err := generateToken()
	if err != nil {
		httpErr(w, "failed to generate token", http.StatusInternalServerError)
		return
	}

	if err := db.UpdateBotToken(h.DB, botID, newHash); err != nil {
		httpErr(w, "failed to update token", http.StatusInternalServerError)
		return
	}

	reply(w, http.StatusOK, map[string]string{"token": plaintext})
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
