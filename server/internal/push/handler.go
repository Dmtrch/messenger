package push

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/auth"
)

// Handler обслуживает push-эндпоинты.
type Handler struct {
	DB           *sql.DB
	VAPIDPublic  string
	VAPIDPrivate string
	NativeCfg    NativePushConfig
}

// NativePushConfig хранит учётные данные для FCM и APNs.
// Все поля необязательны — если не заданы, соответствующий транспорт пропускается.
type NativePushConfig struct {
	FCMLegacyKey string // Firebase Server Key (Legacy FCM HTTP API)
	APNsKeyPath  string // путь к .p8 файлу (EC private key)
	APNsKeyID    string
	APNsTeamID   string
	APNsBundleID string
	APNsSandbox  bool
}

// GET /api/push/vapid-public-key — отдать VAPID публичный ключ клиенту
func (h *Handler) GetVAPIDPublicKey(w http.ResponseWriter, r *http.Request) {
	if h.VAPIDPublic == "" {
		httpErr(w, "push not configured", 503)
		return
	}
	reply(w, 200, map[string]string{"publicKey": h.VAPIDPublic})
}

// POST /api/push/subscribe — сохранить web push-подписку
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
		ID:       userID + ":" + sub.Endpoint,
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

// POST /api/push/native/register — сохранить нативный push-токен (FCM или APNs)
func (h *Handler) RegisterNativeToken(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromCtx(r)

	var req struct {
		Platform string `json:"platform"` // "fcm" | "apns"
		Token    string `json:"token"`
		DeviceID string `json:"deviceId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil ||
		req.Token == "" || req.Platform == "" {
		httpErr(w, "invalid request", 400)
		return
	}
	if req.DeviceID == "" {
		req.DeviceID = "default"
	}

	if err := db.UpsertNativePushToken(h.DB, db.NativePushToken{
		UserID:    userID,
		DeviceID:  req.DeviceID,
		Platform:  req.Platform,
		Token:     req.Token,
		UpdatedAt: time.Now().UnixMilli(),
	}); err != nil {
		httpErr(w, "server error", 500)
		return
	}
	reply(w, 204, nil)
}

// SendNotification отправляет web push-уведомление (VAPID) пользователю.
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

// SendNativeNotification отправляет FCM / APNs уведомление всем нативным
// устройствам пользователя. Вызывается асинхронно из hub при offline-доставке.
func SendNativeNotification(database *sql.DB, cfg NativePushConfig, userID, title, body string) {
	tokens, err := db.GetNativePushTokensByUserID(database, userID)
	if err != nil || len(tokens) == 0 {
		return
	}
	for _, t := range tokens {
		switch t.Platform {
		case "fcm":
			if cfg.FCMLegacyKey != "" {
				if err := sendFCM(cfg.FCMLegacyKey, t.Token, title, body); err != nil {
					log.Printf("FCM push to %s device %s: %v", userID, t.DeviceID, err)
				}
			}
		case "apns":
			if cfg.APNsKeyPath != "" && cfg.APNsKeyID != "" && cfg.APNsTeamID != "" {
				if err := sendAPNs(cfg, t.Token, title, body); err != nil {
					log.Printf("APNs push to %s device %s: %v", userID, t.DeviceID, err)
				}
			}
		}
	}
}

// ─── FCM (Legacy HTTP API) ────────────────────────────────────────────────────

func sendFCM(serverKey, token, title, body string) error {
	payload, _ := json.Marshal(map[string]any{
		"to": token,
		"notification": map[string]string{
			"title": title,
			"body":  body,
		},
		"data":     map[string]string{"type": "message"},
		"priority": "high",
	})

	req, err := http.NewRequest("POST", "https://fcm.googleapis.com/fcm/send",
		bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "key="+serverKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("FCM HTTP %d", resp.StatusCode)
	}
	return nil
}

// ─── APNs (Provider API, JWT auth, HTTP/2) ───────────────────────────────────

func sendAPNs(cfg NativePushConfig, deviceToken, title, body string) error {
	keyData, err := os.ReadFile(cfg.APNsKeyPath)
	if err != nil {
		return fmt.Errorf("read apns key: %w", err)
	}
	block, _ := pem.Decode(keyData)
	if block == nil {
		return fmt.Errorf("invalid PEM in apns key")
	}
	privRaw, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return fmt.Errorf("parse apns key: %w", err)
	}
	ecKey, ok := privRaw.(*ecdsa.PrivateKey)
	if !ok {
		return fmt.Errorf("apns key is not ECDSA")
	}

	jwtToken, err := buildAPNsJWT(ecKey, cfg.APNsKeyID, cfg.APNsTeamID)
	if err != nil {
		return fmt.Errorf("build apns jwt: %w", err)
	}

	host := "https://api.push.apple.com"
	if cfg.APNsSandbox {
		host = "https://api.sandbox.push.apple.com"
	}

	apnsPayload, _ := json.Marshal(map[string]any{
		"aps": map[string]any{
			"alert": map[string]string{
				"title": title,
				"body":  body,
			},
			"sound": "default",
			"badge": 1,
		},
	})

	url := fmt.Sprintf("%s/3/device/%s", host, deviceToken)
	req, err := http.NewRequest("POST", url, bytes.NewReader(apnsPayload))
	if err != nil {
		return err
	}
	req.Header.Set("authorization", "bearer "+jwtToken)
	req.Header.Set("apns-topic", cfg.APNsBundleID)
	req.Header.Set("apns-push-type", "alert")
	req.Header.Set("content-type", "application/json")

	// Go's net/http uses HTTP/2 automatically for HTTPS when the server supports it
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("APNs HTTP %d", resp.StatusCode)
	}
	return nil
}

// buildAPNsJWT формирует JWT для APNs Provider API (ES256).
func buildAPNsJWT(key *ecdsa.PrivateKey, keyID, teamID string) (string, error) {
	headerJSON, _ := json.Marshal(map[string]string{"alg": "ES256", "kid": keyID})
	claimsJSON, _ := json.Marshal(map[string]any{"iss": teamID, "iat": time.Now().Unix()})

	h64 := base64.RawURLEncoding.EncodeToString(headerJSON)
	c64 := base64.RawURLEncoding.EncodeToString(claimsJSON)
	signingInput := h64 + "." + c64

	digest := sha256.Sum256([]byte(signingInput))
	r, s, err := ecdsa.Sign(rand.Reader, key, digest[:])
	if err != nil {
		return "", err
	}

	keyBytes := (key.Curve.Params().BitSize + 7) / 8
	sig := make([]byte, 2*keyBytes)
	rB := r.Bytes()
	sB := s.Bytes()
	copy(sig[keyBytes-len(rB):keyBytes], rB)
	copy(sig[2*keyBytes-len(sB):], sB)

	return signingInput + "." + base64.RawURLEncoding.EncodeToString(sig), nil
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
