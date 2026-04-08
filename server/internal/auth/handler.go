package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/messenger/server/db"
	"golang.org/x/crypto/bcrypt"
)

type Handler struct {
	DB        *sql.DB
	JWTSecret []byte
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username    string `json:"username"`
		DisplayName string `json:"displayName"`
		Password    string `json:"password"`
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
	if len(req.Username) < 3 || len(req.Password) < 8 {
		httpErr(w, "username>=3 chars, password>=8 chars", 400)
		return
	}

	existing, _ := db.GetUserByUsername(h.DB, req.Username)
	if existing != nil {
		httpErr(w, "username taken", 409)
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}

	user := db.User{
		ID:           uuid.New().String(),
		Username:     req.Username,
		DisplayName:  req.DisplayName,
		PasswordHash: string(hash),
		CreatedAt:    time.Now().UnixMilli(),
	}
	if err := db.CreateUser(h.DB, user); err != nil {
		httpErr(w, "server error", 500)
		return
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

	resp, err := h.issueTokens(w, r, user.ID, user.Username, user.DisplayName)
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
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		httpErr(w, "invalid credentials", 401)
		return
	}

	resp, err := h.issueTokens(w, r, user.ID, user.Username, user.DisplayName)
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

	resp, err := h.issueTokens(w, r, user.ID, user.Username, user.DisplayName)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}
	jsonReply(w, 200, resp)
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie("refresh_token"); err == nil {
		db.DeleteSession(h.DB, sha256hex(cookie.Value))
	}
	http.SetCookie(w, &http.Cookie{
		Name: "refresh_token", Value: "", MaxAge: -1,
		HttpOnly: true, SameSite: http.SameSiteLaxMode,
	})
	w.WriteHeader(204)
}

// issueTokens creates access JWT (15 min) + refresh token in httpOnly cookie (7 days).
func (h *Handler) issueTokens(w http.ResponseWriter, r *http.Request, userID, username, displayName string) (map[string]any, error) {
	access, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":  userID,
		"name": username,
		"exp":  time.Now().Add(15 * time.Minute).Unix(),
		"iat":  time.Now().Unix(),
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

	// Secure только при HTTPS — при локальной разработке по HTTP не ставим
	isHTTPS := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	http.SetCookie(w, &http.Cookie{
		Name:     "refresh_token",
		Value:    refreshRaw,
		Expires:  exp,
		HttpOnly: true,
		Secure:   isHTTPS,
		SameSite: http.SameSiteLaxMode,
		Path:     "/api/auth",
	})

	return map[string]any{
		"accessToken": access,
		"userId":      userID,
		"username":    username,
		"displayName": displayName,
	}, nil
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

func sha256hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

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
