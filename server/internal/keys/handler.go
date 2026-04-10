package keys

import (
	"database/sql"
	"encoding/base64"
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

// GET /api/keys/:userId — ключевые пакеты для всех устройств (X3DH multi-device).
// Возвращает: { "devices": [ { deviceId, ikPublic, spkId, spkPublic, spkSignature, opkId?, opkPublic? }, ... ] }
func (h *Handler) GetBundle(w http.ResponseWriter, r *http.Request) {
	targetID := chi.URLParam(r, "userId")

	keys, err := db.GetIdentityKeysByUserID(h.DB, targetID)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}
	if len(keys) == 0 {
		httpErr(w, "keys not found", 404)
		return
	}

	type deviceBundle struct {
		DeviceID     string  `json:"deviceId"`
		IKPublic     string  `json:"ikPublic"`
		SPKId        int     `json:"spkId"`
		SPKPublic    string  `json:"spkPublic"`
		SPKSignature string  `json:"spkSignature"`
		OPKId        *int64  `json:"opkId,omitempty"`
		OPKPublic    *string `json:"opkPublic,omitempty"`
	}

	devices := make([]deviceBundle, 0, len(keys))
	for _, ik := range keys {
		opkID, opkPub, err := db.PopPreKey(h.DB, targetID, ik.DeviceID)
		if err != nil {
			httpErr(w, "server error", 500)
			return
		}

		bundle := deviceBundle{
			DeviceID:     ik.DeviceID,
			IKPublic:     base64.StdEncoding.EncodeToString(ik.IKPublic),
			SPKId:        ik.SPKId,
			SPKPublic:    base64.StdEncoding.EncodeToString(ik.SPKPublic),
			SPKSignature: base64.StdEncoding.EncodeToString(ik.SPKSignature),
		}
		if opkPub != nil {
			opkIDVal := opkID
			opkPubStr := base64.StdEncoding.EncodeToString(opkPub)
			bundle.OPKId = &opkIDVal
			bundle.OPKPublic = &opkPubStr
		}
		devices = append(devices, bundle)
	}

	reply(w, 200, map[string]any{"devices": devices})
}

// POST /api/keys/register — регистрация устройства и загрузка ключей
func (h *Handler) RegisterDevice(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromCtx(r)

	var req struct {
		DeviceName   string   `json:"deviceName"`
		IKPublic     string   `json:"ikPublic"`
		SPKId        int      `json:"spkId"`
		SPKPublic    string   `json:"spkPublic"`
		SPKSignature string   `json:"spkSignature"`
		OPKPublics   []string `json:"opkPublics"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpErr(w, "invalid body", 400)
		return
	}
	if req.IKPublic == "" || req.SPKPublic == "" || req.SPKSignature == "" {
		httpErr(w, "ikPublic, spkPublic and spkSignature are required", 400)
		return
	}
	if req.DeviceName == "" {
		req.DeviceName = "Unknown device"
	}

	ikPub, err := base64.StdEncoding.DecodeString(req.IKPublic)
	if err != nil {
		httpErr(w, "invalid ikPublic base64", 400)
		return
	}
	spkPub, err := base64.StdEncoding.DecodeString(req.SPKPublic)
	if err != nil {
		httpErr(w, "invalid spkPublic base64", 400)
		return
	}
	spkSig, err := base64.StdEncoding.DecodeString(req.SPKSignature)
	if err != nil {
		httpErr(w, "invalid spkSignature base64", 400)
		return
	}

	// Декодируем одноразовые ключи
	opkBytes := make([][]byte, 0, len(req.OPKPublics))
	for _, opk := range req.OPKPublics {
		b, err := base64.StdEncoding.DecodeString(opk)
		if err != nil {
			httpErr(w, "invalid opkPublics base64", 400)
			return
		}
		opkBytes = append(opkBytes, b)
	}

	now := time.Now().UnixMilli()

	// Идемпотентность: если IK уже зарегистрирован для этого пользователя — то же устройство.
	// Переиспользуем существующий device_id вместо создания нового при каждом входе.
	existing, err := db.GetIdentityKeyByIKPublic(h.DB, userID, ikPub)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}
	deviceID := uuid.New().String()
	if existing != nil && existing.DeviceID != "" {
		deviceID = existing.DeviceID
	}

	// Сохраняем/обновляем устройство (last_seen_at обновляется при каждом входе)
	if err := db.UpsertDevice(h.DB, db.Device{
		ID:         deviceID,
		UserID:     userID,
		DeviceName: req.DeviceName,
		CreatedAt:  now,
		LastSeenAt: now,
	}); err != nil {
		httpErr(w, "server error", 500)
		return
	}

	// Обновляем identity key (SPK может смениться при ротации)
	if err := db.UpsertIdentityKey(h.DB, db.IdentityKey{
		UserID:       userID,
		DeviceID:     deviceID,
		IKPublic:     ikPub,
		SPKPublic:    spkPub,
		SPKSignature: spkSig,
		SPKId:        req.SPKId,
		UpdatedAt:    now,
	}); err != nil {
		httpErr(w, "server error", 500)
		return
	}

	// Сохраняем одноразовые ключи с привязкой к устройству
	if len(opkBytes) > 0 {
		if err := db.InsertPreKeysForDevice(h.DB, userID, deviceID, opkBytes); err != nil {
			httpErr(w, "server error", 500)
			return
		}
	}

	reply(w, 200, map[string]string{"deviceId": deviceID})
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
