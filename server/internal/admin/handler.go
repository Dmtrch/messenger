package admin

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/auth"
	"golang.org/x/crypto/bcrypt"
)

type Handler struct {
	DB *sql.DB
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

	user := db.User{
		ID:           uuid.New().String(),
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

// CreateInviteCode — POST /api/admin/invite-codes
func (h *Handler) CreateInviteCode(w http.ResponseWriter, r *http.Request) {
	adminID := auth.UserIDFromCtx(r)
	var body struct {
		ExpiresAt int64 `json:"expiresAt"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)

	code := db.InviteCode{
		Code:      uuid.New().String()[:8],
		CreatedBy: adminID,
		ExpiresAt: body.ExpiresAt,
		CreatedAt: time.Now().UnixMilli(),
	}
	if err := db.CreateInviteCode(h.DB, code); err != nil {
		httpErr(w, "server error", 500)
		return
	}
	jsonReply(w, 201, map[string]any{"code": code.Code, "expiresAt": code.ExpiresAt})
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

	hash, err := bcrypt.GenerateFromPassword([]byte(body.NewPassword), 12)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}
	if err := db.UpdateUserPassword(h.DB, userID, string(hash)); err != nil {
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

	reqs, _ := db.ListPasswordResetRequests(h.DB, "")
	var targetUserID string
	for _, req := range reqs {
		if req.ID == id {
			targetUserID = req.UserID
			break
		}
	}
	if targetUserID == "" {
		httpErr(w, "not found", 404)
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(body.TempPassword), 12)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}
	_ = db.UpdateUserPassword(h.DB, targetUserID, string(hash))
	_ = db.ResolvePasswordResetRequest(h.DB, id, body.TempPassword, adminID, time.Now().UnixMilli())
	w.WriteHeader(204)
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
