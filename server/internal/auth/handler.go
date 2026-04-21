package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/messenger/server/db"
	secmw "github.com/messenger/server/internal/middleware"
	"github.com/messenger/server/internal/password"
)

type Handler struct {
	DB               *sql.DB
	JWTSecret        []byte
	RegistrationMode string // open|invite|approval
	BehindProxy      bool   // определяет, как извлекать IP для журнала активаций
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username    string `json:"username"`
		DisplayName string `json:"displayName"`
		Password    string `json:"password"`
		InviteCode  string `json:"inviteCode"`
		// Signal Protocol public keys
		IKPublic     string `json:"ikPublic"`
		SPKId        int    `json:"spkId"`
		SPKPublic    string `json:"spkPublic"`
		SPKSignature string `json:"spkSignature"`
		OPKPublics   []struct {
			ID  int    `json:"id"`
			Key string `json:"key"`
		} `json:"opkPublics"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpErr(w, "invalid body", 400)
		return
	}
	if len(req.Username) < 3 || len(req.Username) > 64 || len(req.Password) < 8 || len(req.Password) > 128 {
		httpErr(w, "username 3-64 chars, password 8-128 chars", 400)
		return
	}

	// Проверка режима регистрации
	var reqInviteCode string
	switch h.RegistrationMode {
	case "invite":
		if req.InviteCode == "" {
			inviteErr(w, 400, "invite_required", "invite code required")
			return
		}
		code, err := db.GetInviteCode(h.DB, req.InviteCode)
		if err != nil {
			httpErr(w, "server error", 500)
			return
		}
		if code == nil {
			inviteErr(w, 404, "invite_not_found", "invalid invite code")
			return
		}
		if code.UsedBy != "" {
			inviteErr(w, 409, "invite_already_used", "invite code already used")
			return
		}
		if code.RevokedAt > 0 {
			inviteErr(w, 410, "invite_revoked", "invite code was revoked")
			return
		}
		if code.ExpiresAt > 0 && time.Now().UnixMilli() > code.ExpiresAt {
			inviteErr(w, 410, "invite_expired", "invite code expired")
			return
		}
		reqInviteCode = req.InviteCode
	case "approval":
		httpErr(w, "registration requires admin approval, use /api/auth/request-register", 403)
		return
	// "open" — без ограничений
	}

	existing, _ := db.GetUserByUsername(h.DB, req.Username)
	if existing != nil {
		httpErr(w, "username taken", 409)
		return
	}

	hash, err := password.Hash(req.Password)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}

	user := db.User{
		ID:           uuid.New().String(),
		Username:     req.Username,
		DisplayName:  req.DisplayName,
		PasswordHash: hash,
		Role:         "user",
		CreatedAt:    time.Now().UnixMilli(),
	}
	if err := db.CreateUser(h.DB, user); err != nil {
		httpErr(w, "server error", 500)
		return
	}

	if h.RegistrationMode == "invite" && reqInviteCode != "" {
		now := time.Now().UnixMilli()
		if err := db.UseInviteCode(h.DB, reqInviteCode, user.ID, now); err == nil {
			_ = db.CreateInviteActivation(h.DB, db.InviteActivation{
				Code:        reqInviteCode,
				UserID:      user.ID,
				IP:          secmw.ClientIP(r, h.BehindProxy),
				UserAgent:   r.UserAgent(),
				ActivatedAt: now,
			})
		}
	}

	// Сохранить публичные ключи Signal Protocol если переданы
	if req.IKPublic != "" {
		ikPub, _ := decodeB64(req.IKPublic)
		spkPub, _ := decodeB64(req.SPKPublic)
		spkSig, _ := decodeB64(req.SPKSignature)
		opkRaw := make([][]byte, 0, len(req.OPKPublics))
		for _, k := range req.OPKPublics {
			b, err := decodeB64(k.Key)
			if err == nil {
				opkRaw = append(opkRaw, b)
			}
		}
		_ = saveKeys(h.DB, user.ID, ikPub, spkPub, spkSig, req.SPKId, opkRaw)
	}

	resp, err := h.issueTokens(w, r, user.ID, user.Username, user.DisplayName, "user")
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}
	jsonReply(w, 201, resp)
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpErr(w, "invalid body", 400)
		return
	}

	user, _ := db.GetUserByUsername(h.DB, req.Username)
	if user == nil {
		httpErr(w, "invalid credentials", 401)
		return
	}
	if err := password.Verify(user.PasswordHash, req.Password); err != nil {
		httpErr(w, "invalid credentials", 401)
		return
	}
	// Lazy-миграция: если хеш устарел (bcrypt), пересчитываем в Argon2id.
	// Ошибка пересчёта не должна срывать логин — просто логируем.
	if password.NeedsRehash(user.PasswordHash) {
		if newHash, err := password.Hash(req.Password); err == nil {
			if err := db.UpdateUserPassword(h.DB, user.ID, newHash); err != nil {
				log.Printf("lazy password rehash: user=%s: %v", user.ID, err)
			}
		}
	}

	resp, err := h.issueTokens(w, r, user.ID, user.Username, user.DisplayName, user.Role)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}
	jsonReply(w, 200, resp)
}

func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("refresh_token")
	if err != nil {
		httpErr(w, "missing refresh token", 401)
		return
	}

	hash := sha256hex(cookie.Value)
	userID, expiresAt, err := db.GetSession(h.DB, hash)
	if err != nil || time.Now().UnixMilli() > expiresAt {
		httpErr(w, "invalid or expired token", 401)
		return
	}
	db.DeleteSession(h.DB, hash)

	user, _ := db.GetUserByID(h.DB, userID)
	if user == nil {
		httpErr(w, "user not found", 401)
		return
	}

	resp, err := h.issueTokens(w, r, user.ID, user.Username, user.DisplayName, user.Role)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}
	jsonReply(w, 200, resp)
}

func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromCtx(r)
	if userID == "" {
		httpErr(w, "unauthorized", 401)
		return
	}

	var req struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpErr(w, "invalid body", 400)
		return
	}
	if len(req.NewPassword) < 8 {
		httpErr(w, "new password must be at least 8 characters", 400)
		return
	}

	user, _ := db.GetUserByID(h.DB, userID)
	if user == nil {
		httpErr(w, "user not found", 404)
		return
	}
	if err := password.Verify(user.PasswordHash, req.CurrentPassword); err != nil {
		httpErr(w, "invalid current password", 403)
		return
	}

	newHash, err := password.Hash(req.NewPassword)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}
	if err := db.UpdateUserPassword(h.DB, userID, newHash); err != nil {
		httpErr(w, "server error", 500)
		return
	}

	// Инвалидируем все сессии кроме текущей (текущий refresh token в cookie)
	currentHash := ""
	if cookie, err := r.Cookie("refresh_token"); err == nil {
		currentHash = sha256hex(cookie.Value)
	}
	_ = db.DeleteUserSessionsExcept(h.DB, userID, currentHash)

	w.WriteHeader(204)
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie("refresh_token"); err == nil {
		db.DeleteSession(h.DB, sha256hex(cookie.Value))
	}
	http.SetCookie(w, &http.Cookie{
		Name: "refresh_token", Value: "", MaxAge: -1,
		HttpOnly: true, SameSite: http.SameSiteStrictMode,
	})
	w.WriteHeader(204)
}

// issueTokens creates access JWT (15 min) + refresh token in httpOnly cookie (7 days).
func (h *Handler) issueTokens(w http.ResponseWriter, r *http.Request, userID, username, displayName, role string) (map[string]any, error) {
	// Include session_epoch so middleware can detect revoked sessions.
	epoch := int64(0)
	if u, err := db.GetUserByID(h.DB, userID); err == nil && u != nil {
		epoch = u.SessionEpoch
	}

	access, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":   userID,
		"name":  username,
		"role":  role,
		"epoch": epoch,
		"exp":   time.Now().Add(15 * time.Minute).Unix(),
		"iat":   time.Now().Unix(),
	}).SignedString(h.JWTSecret)
	if err != nil {
		return nil, err
	}

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	refreshRaw := hex.EncodeToString(raw)
	exp := time.Now().Add(7 * 24 * time.Hour)

	if err := db.SaveSession(h.DB, uuid.New().String(), userID, sha256hex(refreshRaw), exp.UnixMilli()); err != nil {
		return nil, err
	}

	// Secure только при HTTPS; SameSite=Strict защищает от CSRF
	isHTTPS := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	http.SetCookie(w, &http.Cookie{
		Name:     "refresh_token",
		Value:    refreshRaw,
		Expires:  exp,
		HttpOnly: true,
		Secure:   isHTTPS,
		SameSite: http.SameSiteStrictMode,
		Path:     "/api/auth",
	})

	return map[string]any{
		"accessToken": access,
		"userId":      userID,
		"username":    username,
		"displayName": displayName,
		"role":        role,
	}, nil
}

// RequestRegister принимает заявку на регистрацию (режим approval).
func (h *Handler) RequestRegister(w http.ResponseWriter, r *http.Request) {
	if h.RegistrationMode != "approval" {
		httpErr(w, "server does not use approval mode", 400)
		return
	}
	var req struct {
		Username     string `json:"username"`
		DisplayName  string `json:"displayName"`
		Password     string `json:"password"`
		IKPublic     string `json:"ikPublic"`
		SPKId        int    `json:"spkId"`
		SPKPublic    string `json:"spkPublic"`
		SPKSignature string `json:"spkSignature"`
		OPKPublics   []struct {
			ID  int    `json:"id"`
			Key string `json:"key"`
		} `json:"opkPublics"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpErr(w, "invalid body", 400)
		return
	}
	if len(req.Username) < 3 || len(req.Username) > 64 || len(req.Password) < 8 || len(req.Password) > 128 {
		httpErr(w, "username 3-64 chars, password 8-128 chars", 400)
		return
	}

	existing, _ := db.GetUserByUsername(h.DB, req.Username)
	if existing != nil {
		httpErr(w, "username taken", 409)
		return
	}

	hash, err := password.Hash(req.Password)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}

	opkJSON, _ := json.Marshal(req.OPKPublics)
	regReq := db.RegistrationRequest{
		ID:           uuid.New().String(),
		Username:     req.Username,
		DisplayName:  req.DisplayName,
		IKPublic:     req.IKPublic,
		SPKId:        req.SPKId,
		SPKPublic:    req.SPKPublic,
		SPKSignature: req.SPKSignature,
		OPKPublics:   string(opkJSON),
		PasswordHash: hash,
		Status:       "pending",
		CreatedAt:    time.Now().UnixMilli(),
	}
	if err := db.CreateRegistrationRequest(h.DB, regReq); err != nil {
		httpErr(w, "server error", 500)
		return
	}
	jsonReply(w, 201, map[string]string{
		"status":  "pending",
		"message": "Registration request submitted, awaiting admin approval",
	})
}

// PasswordResetRequest позволяет пользователю запросить сброс пароля через администратора.
func (h *Handler) PasswordResetRequest(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpErr(w, "invalid body", 400)
		return
	}

	user, _ := db.GetUserByUsername(h.DB, req.Username)
	if user == nil {
		// Не раскрываем существование пользователя
		jsonReply(w, 200, map[string]string{"status": "pending"})
		return
	}

	if err := db.CreatePasswordResetRequest(h.DB, uuid.New().String(), user.ID, time.Now().UnixMilli()); err != nil {
		httpErr(w, "server error", 500)
		return
	}
	jsonReply(w, 200, map[string]string{"status": "pending"})
}

func decodeB64(s string) ([]byte, error) { return base64.StdEncoding.DecodeString(s) }

func saveKeys(database *sql.DB, userID string, ik, spk, spkSig []byte, spkID int, opks [][]byte) error {
	if err := db.UpsertIdentityKey(database, db.IdentityKey{
		UserID: userID, IKPublic: ik, SPKPublic: spk,
		SPKSignature: spkSig, SPKId: spkID, UpdatedAt: time.Now().UnixMilli(),
	}); err != nil {
		return err
	}
	if len(opks) > 0 {
		return db.InsertPreKeys(database, userID, opks)
	}
	return nil
}

// DeviceLinkRequest генерирует одноразовый токен привязки нового устройства (TTL 120 с).
// Требует авторизации: вызывается с основного устройства, которое показывает QR-код.
func (h *Handler) DeviceLinkRequest(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromCtx(r)
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		httpErr(w, "server error", 500)
		return
	}
	token := hex.EncodeToString(raw)
	expiresAt := time.Now().Add(120 * time.Second).UnixMilli()
	if err := db.SaveDeviceLinkToken(h.DB, db.DeviceLinkToken{
		Token:     token,
		UserID:    userID,
		ExpiresAt: expiresAt,
	}); err != nil {
		httpErr(w, "server error", 500)
		return
	}
	jsonReply(w, 200, map[string]any{"token": token, "expiresAt": expiresAt})
}

// DeviceLinkActivate активирует токен привязки: регистрирует новое устройство и выдаёт JWT.
// Не требует авторизации — это точка входа для нового устройства.
func (h *Handler) DeviceLinkActivate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token        string `json:"token"`
		DeviceName   string `json:"deviceName"`
		IKPublic     string `json:"ikPublic"`
		SPKId        int    `json:"spkId"`
		SPKPublic    string `json:"spkPublic"`
		SPKSignature string `json:"spkSignature"`
		OPKPublics   []struct {
			ID  int    `json:"id"`
			Key string `json:"key"`
		} `json:"opkPublics"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpErr(w, "invalid body", 400)
		return
	}
	if req.Token == "" || req.DeviceName == "" {
		httpErr(w, "token and deviceName required", 400)
		return
	}

	t, err := db.GetDeviceLinkToken(h.DB, req.Token)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}
	if t == nil {
		httpErr(w, "invalid token", 404)
		return
	}
	if t.Used {
		httpErr(w, "token already used", 410)
		return
	}
	if time.Now().UnixMilli() > t.ExpiresAt {
		httpErr(w, "token expired", 410)
		return
	}
	if err := db.MarkDeviceLinkTokenUsed(h.DB, req.Token); err != nil {
		httpErr(w, "server error", 500)
		return
	}

	user, err := db.GetUserByID(h.DB, t.UserID)
	if err != nil || user == nil {
		httpErr(w, "user not found", 404)
		return
	}

	deviceID := uuid.New().String()
	now := time.Now().UnixMilli()
	if err := db.UpsertDevice(h.DB, db.Device{
		ID:         deviceID,
		UserID:     t.UserID,
		DeviceName: req.DeviceName,
		CreatedAt:  now,
		LastSeenAt: now,
	}); err != nil {
		httpErr(w, "server error", 500)
		return
	}

	ik, _ := base64.StdEncoding.DecodeString(req.IKPublic)
	spk, _ := base64.StdEncoding.DecodeString(req.SPKPublic)
	spkSig, _ := base64.StdEncoding.DecodeString(req.SPKSignature)
	if err := db.UpsertIdentityKey(h.DB, db.IdentityKey{
		UserID:       t.UserID,
		DeviceID:     deviceID,
		IKPublic:     ik,
		SPKPublic:    spk,
		SPKSignature: spkSig,
		SPKId:        req.SPKId,
		UpdatedAt:    now,
	}); err != nil {
		httpErr(w, "server error", 500)
		return
	}

	if len(req.OPKPublics) > 0 {
		opks := make([][]byte, len(req.OPKPublics))
		for i, o := range req.OPKPublics {
			opks[i], _ = base64.StdEncoding.DecodeString(o.Key)
		}
		if _, err := db.InsertPreKeysForDevice(h.DB, t.UserID, deviceID, opks); err != nil {
			httpErr(w, "server error", 500)
			return
		}
	}

	resp, err := h.issueTokens(w, r, t.UserID, user.Username, user.DisplayName, user.Role)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}
	resp["deviceId"] = deviceID
	jsonReply(w, 200, resp)
}

func sha256hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func httpErr(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// inviteErr отвечает клиенту структурированной ошибкой по инвайту.
// error_code — стабильный идентификатор для клиента (см. test-vectors/invites.json).
func inviteErr(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg, "error_code": code})
}

func jsonReply(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
