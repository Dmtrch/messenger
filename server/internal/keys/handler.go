package keys

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/auth"
)

type Handler struct {
	DB *sql.DB
}

// GET /api/keys/:userId — ключевой пакет для X3DH
func (h *Handler) GetBundle(w http.ResponseWriter, r *http.Request) {
	targetID := chi.URLParam(r, "userId")

	ik, err := db.GetIdentityKey(h.DB, targetID)
	if err != nil || ik == nil {
		httpErr(w, "keys not found", 404)
		return
	}

	opkID, opkPub, err := db.PopPreKey(h.DB, targetID)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}

	// Уведомить через WS если OPK закончились
	if count, _ := db.CountFreePreKeys(h.DB, targetID); count < 5 {
		// Хаб недоступен отсюда — клиент сам запросит при следующем подключении
		_ = count
	}

	resp := map[string]any{
		"userId":       targetID,
		"ikPublic":     base64.StdEncoding.EncodeToString(ik.IKPublic),
		"spkId":        ik.SPKId,
		"spkPublic":    base64.StdEncoding.EncodeToString(ik.SPKPublic),
		"spkSignature": base64.StdEncoding.EncodeToString(ik.SPKSignature),
	}
	if opkPub != nil {
		resp["opkId"] = opkID
		resp["opkPublic"] = base64.StdEncoding.EncodeToString(opkPub)
	}
	reply(w, 200, resp)
}

// POST /api/keys/prekeys — загрузить новые одноразовые ключи
func (h *Handler) UploadPreKeys(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromCtx(r)

	var req struct {
		Keys []struct {
			ID  int    `json:"id"`
			Key string `json:"key"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Keys) == 0 {
		httpErr(w, "invalid body", 400)
		return
	}

	rawKeys := make([][]byte, 0, len(req.Keys))
	for _, k := range req.Keys {
		b, err := base64.StdEncoding.DecodeString(k.Key)
		if err != nil {
			httpErr(w, "invalid base64", 400)
			return
		}
		rawKeys = append(rawKeys, b)
	}

	if err := db.InsertPreKeys(h.DB, userID, rawKeys); err != nil {
		httpErr(w, "server error", 500)
		return
	}
	reply(w, 204, nil)
}

// RegisterKeys сохраняет ключи при регистрации — вызывается из auth.Handler
func RegisterKeys(database *sql.DB, userID string, ikPublic, spkPublic, spkSignature []byte, spkID int, opkPublics [][]byte) error {
	if err := db.UpsertIdentityKey(database, db.IdentityKey{
		UserID:       userID,
		IKPublic:     ikPublic,
		SPKPublic:    spkPublic,
		SPKSignature: spkSignature,
		SPKId:        spkID,
		UpdatedAt:    time.Now().UnixMilli(),
	}); err != nil {
		return err
	}
	if len(opkPublics) > 0 {
		return db.InsertPreKeys(database, userID, opkPublics)
	}
	return nil
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
