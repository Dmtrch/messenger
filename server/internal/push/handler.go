package push

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"log"
	"net/http"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/google/uuid"
	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/auth"
)

type Handler struct {
	DB         *sql.DB
	VAPIDPublic  string
	VAPIDPrivate string
}

// GET /api/push/vapid-public-key — отдать VAPID публичный ключ клиенту
func (h *Handler) GetVAPIDPublicKey(w http.ResponseWriter, r *http.Request) {
	if h.VAPIDPublic == "" {
		httpErr(w, "push not configured", 503)
		return
	}
	reply(w, 200, map[string]string{"publicKey": h.VAPIDPublic})
}

// POST /api/push/subscribe — сохранить push-подписку
func (h *Handler) Subscribe(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromCtx(r)

	var sub struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(r.Body).Decode(&sub); err != nil || sub.Endpoint == "" {
		httpErr(w, "invalid subscription", 400)
		return
	}

	p256dh, _ := base64.RawURLEncoding.DecodeString(sub.Keys.P256dh)
	authKey, _ := base64.RawURLEncoding.DecodeString(sub.Keys.Auth)

	if err := db.UpsertPushSub(h.DB, db.PushSub{
		ID:       uuid.New().String(),
		UserID:   userID,
		Endpoint: sub.Endpoint,
		P256DH:   p256dh,
		Auth:     authKey,
	}); err != nil {
		httpErr(w, "server error", 500)
		return
	}
	reply(w, 204, nil)
}

// SendNotification отправляет push-уведомление пользователю (вызывается из ws/hub).
// payload — JSON, не содержит текст сообщения (только звук/бейдж).
func SendNotification(database *sql.DB, vapidPrivate, vapidPublic, userID string, payload []byte) {
	if vapidPrivate == "" || vapidPublic == "" {
		return
	}
	subs, err := db.GetPushSubs(database, userID)
	if err != nil || len(subs) == 0 {
		return
	}

	for _, sub := range subs {
		wSub := &webpush.Subscription{
			Endpoint: sub.Endpoint,
			Keys: webpush.Keys{
				P256dh: base64.RawURLEncoding.EncodeToString(sub.P256DH),
				Auth:   base64.RawURLEncoding.EncodeToString(sub.Auth),
			},
		}
		resp, err := webpush.SendNotification(payload, wSub, &webpush.Options{
			VAPIDPublicKey:  vapidPublic,
			VAPIDPrivateKey: vapidPrivate,
			TTL:             30,
		})
		if err != nil {
			log.Printf("push send to %s: %v", userID, err)
			continue
		}
		resp.Body.Close()
	}
}

func httpErr(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func reply(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	if code == 204 || v == nil {
		w.WriteHeader(code)
		return
	}
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
