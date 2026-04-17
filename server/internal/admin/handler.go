package admin

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
	"github.com/messenger/server/internal/password"
)

// UserNotifier is implemented by ws.Hub; defined here to avoid circular import.
type UserNotifier interface {
	Deliver(userID string, payload []byte)
	DisconnectUser(userID string)
}

type Handler struct {
	DB  *sql.DB
	Hub UserNotifier // nil-safe: may be omitted in tests
}

// ListRegistrationRequests — GET /api/admin/registration-requests?status=pending
func (h *Handler) ListRegistrationRequests(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	reqs, err := db.ListRegistrationRequests(h.DB, status)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}
	if reqs == nil {
		reqs = []db.RegistrationRequest{}
	}
	jsonReply(w, 200, map[string]any{"requests": reqs})
}

// ApproveRegistrationRequest — POST /api/admin/registration-requests/{id}/approve
func (h *Handler) ApproveRegistrationRequest(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	adminID := auth.UserIDFromCtx(r)

	req, _ := db.GetRegistrationRequest(h.DB, id)
	if req == nil {
		httpErr(w, "not found", 404)
		return
	}
	if req.Status != "pending" {
		httpErr(w, "request already reviewed", 409)
		return
	}

	// Проверяем что username ещё не занят
	existing, _ := db.GetUserByUsername(h.DB, req.Username)
	if existing != nil {
		httpErr(w, "username already registered", 409)
		return
	}

	userID := uuid.New().String()
	user := db.User{
		ID:           userID,
		Username:     req.Username,
		DisplayName:  req.DisplayName,
		PasswordHash: req.PasswordHash,
		Role:         "user",
		CreatedAt:    time.Now().UnixMilli(),
	}
	if err := db.CreateUser(h.DB, user); err != nil {
		httpErr(w, "server error", 500)
		return
	}

	// Переносим ключевой материал из заявки в рабочие таблицы.
	if err := transferKeys(h.DB, userID, req); err != nil {
		// Не прерываем — пользователь создан, ключи можно зарегистрировать при первом входе.
		_ = err
	}

	_ = db.UpdateRegistrationRequestStatus(h.DB, id, "approved", adminID, time.Now().UnixMilli())
	jsonReply(w, 200, map[string]string{"status": "approved"})
}

// RejectRegistrationRequest — POST /api/admin/registration-requests/{id}/reject
func (h *Handler) RejectRegistrationRequest(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	adminID := auth.UserIDFromCtx(r)

	req, _ := db.GetRegistrationRequest(h.DB, id)
	if req == nil {
		httpErr(w, "not found", 404)
		return
	}
	_ = db.UpdateRegistrationRequestStatus(h.DB, id, "rejected", adminID, time.Now().UnixMilli())
	jsonReply(w, 200, map[string]string{"status": "rejected"})
}

// InviteTTL — разрешённые границы TTL инвайтов, см. PRD P1-INV-1.
const (
	InviteTTLDefault = 180 // секунд
	InviteTTLMin     = 60
	InviteTTLMax     = 600
)

// CreateInviteCode — POST /api/admin/invite-codes.
// Принимает опциональный ttlSeconds в диапазоне [60, 600]; по умолчанию 180.
// Любые попытки передать expiresAt напрямую игнорируются.
func (h *Handler) CreateInviteCode(w http.ResponseWriter, r *http.Request) {
	adminID := auth.UserIDFromCtx(r)
	var body struct {
		TTLSeconds int `json:"ttlSeconds"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	ttl := body.TTLSeconds
	if ttl == 0 {
		ttl = InviteTTLDefault
	}
	if ttl < InviteTTLMin || ttl > InviteTTLMax {
		jsonReply(w, 422, map[string]any{
			"error":      "ttlSeconds out of bounds",
			"error_code": "invite_ttl_out_of_bounds",
			"min":        InviteTTLMin,
			"max":        InviteTTLMax,
		})
		return
	}

	now := time.Now()
	expiresAt := now.Add(time.Duration(ttl) * time.Second).UnixMilli()
	code := db.InviteCode{
		Code:      uuid.New().String()[:8],
		CreatedBy: adminID,
		ExpiresAt: expiresAt,
		CreatedAt: now.UnixMilli(),
	}
	if err := db.CreateInviteCode(h.DB, code); err != nil {
		httpErr(w, "server error", 500)
		return
	}
	jsonReply(w, 201, map[string]any{
		"code":       code.Code,
		"expiresAt":  code.ExpiresAt,
		"ttlSeconds": ttl,
	})
}

// ListInviteCodes — GET /api/admin/invite-codes
func (h *Handler) ListInviteCodes(w http.ResponseWriter, r *http.Request) {
	codes, err := db.ListInviteCodes(h.DB)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}
	if codes == nil {
		codes = []db.InviteCode{}
	}
	jsonReply(w, 200, map[string]any{"codes": codes})
}

// RevokeInviteCode — DELETE /api/admin/invite-codes/{code}.
// Помечает код отозванным. Уже использованные коды не трогаем.
func (h *Handler) RevokeInviteCode(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	if code == "" {
		httpErr(w, "code required", 400)
		return
	}
	err := db.RevokeInviteCode(h.DB, code, time.Now().UnixMilli())
	if err == db.ErrInviteNotFound {
		httpErr(w, "invite not found or already used", 404)
		return
	}
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}
	w.WriteHeader(204)
}

// ListInviteActivations — GET /api/admin/invite-codes/{code}/activations.
func (h *Handler) ListInviteActivations(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	if code == "" {
		httpErr(w, "code required", 400)
		return
	}
	list, err := db.ListInviteActivations(h.DB, code)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}
	if list == nil {
		list = []db.InviteActivation{}
	}
	jsonReply(w, 200, map[string]any{"activations": list})
}

// ListUsers — GET /api/admin/users
func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := db.ListUsers(h.DB)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}
	if users == nil {
		users = []db.User{}
	}
	jsonReply(w, 200, map[string]any{"users": users})
}

// ResetUserPassword — POST /api/admin/users/{id}/reset-password
func (h *Handler) ResetUserPassword(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	var body struct {
		NewPassword string `json:"newPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.NewPassword) < 8 {
		httpErr(w, "newPassword must be at least 8 characters", 400)
		return
	}

	hash, err := password.Hash(body.NewPassword)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}
	if err := db.UpdateUserPassword(h.DB, userID, hash); err != nil {
		httpErr(w, "server error", 500)
		return
	}
	w.WriteHeader(204)
}

// ListPasswordResetRequests — GET /api/admin/password-reset-requests?status=pending
func (h *Handler) ListPasswordResetRequests(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	reqs, err := db.ListPasswordResetRequests(h.DB, status)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}
	if reqs == nil {
		reqs = []db.PasswordResetRequest{}
	}
	jsonReply(w, 200, map[string]any{"requests": reqs})
}

// ResolvePasswordResetRequest — POST /api/admin/password-reset-requests/{id}/resolve
func (h *Handler) ResolvePasswordResetRequest(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	adminID := auth.UserIDFromCtx(r)
	var body struct {
		TempPassword string `json:"tempPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.TempPassword) < 8 {
		httpErr(w, "tempPassword must be at least 8 characters", 400)
		return
	}

	resetReq, err := db.GetPasswordResetRequest(h.DB, id)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}
	if resetReq == nil {
		httpErr(w, "not found", 404)
		return
	}

	hash, err := password.Hash(body.TempPassword)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}
	if err := db.UpdateUserPassword(h.DB, resetReq.UserID, hash); err != nil {
		httpErr(w, "server error", 500)
		return
	}
	if err := db.ResolvePasswordResetRequest(h.DB, id, body.TempPassword, adminID, time.Now().UnixMilli()); err != nil {
		httpErr(w, "server error", 500)
		return
	}
	w.WriteHeader(204)
}

// SuspendUser — POST /api/admin/users/{id}/suspend
func (h *Handler) SuspendUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	if err := db.SetUserStatus(h.DB, userID, "suspended"); err != nil {
		httpErr(w, "server error", 500)
		return
	}
	_ = db.IncrementSessionEpoch(h.DB, userID)
	_ = db.DeleteUserSessionsExcept(h.DB, userID, "")
	if h.Hub != nil {
		h.Hub.DisconnectUser(userID)
	}
	w.WriteHeader(204)
}

// UnsuspendUser — POST /api/admin/users/{id}/unsuspend
func (h *Handler) UnsuspendUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	if err := db.SetUserStatus(h.DB, userID, "active"); err != nil {
		httpErr(w, "server error", 500)
		return
	}
	w.WriteHeader(204)
}

// BanUser — POST /api/admin/users/{id}/ban
func (h *Handler) BanUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	if err := db.SetUserStatus(h.DB, userID, "banned"); err != nil {
		httpErr(w, "server error", 500)
		return
	}
	_ = db.IncrementSessionEpoch(h.DB, userID)
	_ = db.DeleteUserSessionsExcept(h.DB, userID, "")
	if h.Hub != nil {
		h.Hub.DisconnectUser(userID)
	}
	w.WriteHeader(204)
}

// RevokeAllSessions — POST /api/admin/users/{id}/revoke-sessions
func (h *Handler) RevokeAllSessions(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	_ = db.IncrementSessionEpoch(h.DB, userID)
	_ = db.DeleteUserSessionsExcept(h.DB, userID, "")
	if h.Hub != nil {
		h.Hub.DisconnectUser(userID)
	}
	w.WriteHeader(204)
}

// RemoteWipe — POST /api/admin/users/{id}/remote-wipe
// Инвалидирует все сессии и уведомляет клиент кадром remote_wipe для очистки локальных данных.
func (h *Handler) RemoteWipe(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	_ = db.IncrementSessionEpoch(h.DB, userID)
	_ = db.DeleteUserSessionsExcept(h.DB, userID, "")
	if h.Hub != nil {
		wipe, _ := json.Marshal(map[string]string{"type": "remote_wipe"})
		h.Hub.Deliver(userID, wipe)
	}
	w.WriteHeader(204)
}

// transferKeys переносит ik/spk/opk из registration_request в рабочие таблицы.
// Генерирует device ID, так как заявка на регистрацию не содержит device UUID —
// устройство будет явно переименовано при первом RegisterDevice после логина.
func transferKeys(database *sql.DB, userID string, req *db.RegistrationRequest) error {
	ik, err := base64.StdEncoding.DecodeString(req.IKPublic)
	if err != nil {
		return err
	}
	spk, err := base64.StdEncoding.DecodeString(req.SPKPublic)
	if err != nil {
		return err
	}
	spkSig, err := base64.StdEncoding.DecodeString(req.SPKSignature)
	if err != nil {
		return err
	}
	now := time.Now().UnixMilli()
	deviceID := uuid.New().String()
	if err := db.UpsertDevice(database, db.Device{
		ID:         deviceID,
		UserID:     userID,
		DeviceName: "Initial device",
		CreatedAt:  now,
		LastSeenAt: now,
	}); err != nil {
		return err
	}
	if err := db.UpsertIdentityKey(database, db.IdentityKey{
		UserID:       userID,
		DeviceID:     deviceID,
		IKPublic:     ik,
		SPKPublic:    spk,
		SPKSignature: spkSig,
		SPKId:        req.SPKId,
		UpdatedAt:    now,
	}); err != nil {
		return err
	}
	if req.OPKPublics == "" || req.OPKPublics == "null" {
		return nil
	}
	var opkList []struct {
		ID  int    `json:"id"`
		Key string `json:"key"`
	}
	if err := json.Unmarshal([]byte(req.OPKPublics), &opkList); err != nil {
		return err
	}
	opks := make([][]byte, 0, len(opkList))
	for _, o := range opkList {
		keyBytes, err := base64.StdEncoding.DecodeString(o.Key)
		if err != nil {
			continue
		}
		opks = append(opks, keyBytes)
	}
	if len(opks) > 0 {
		return db.InsertPreKeys(database, userID, opks)
	}
	return nil
}

// ── helpers ───────────────────────────────────────────────────────────────────

func httpErr(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func jsonReply(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
