package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/messenger/server/internal/auth"
)

type iceServerEntry struct {
	URLs       string `json:"urls"`
	Username   string `json:"username,omitempty"`
	Credential string `json:"credential,omitempty"`
}

// iceServersHandler возвращает STUN и опционально TURN с временными credentials.
func iceServersHandler(stunURL, turnURL, turnSecret string, ttl int64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := auth.UserIDFromCtx(r)
		if userID == "" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		servers := []iceServerEntry{{URLs: stunURL}}
		if turnURL != "" && turnSecret != "" {
			username, credential := generateTurnCredentials(turnSecret, userID, ttl)
			servers = append(servers, iceServerEntry{
				URLs:       turnURL,
				Username:   username,
				Credential: credential,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{"iceServers": servers}) //nolint:errcheck
	}
}

// generateTurnCredentials создаёт временные HMAC-SHA256 credentials для coturn.
// username = "{expiresUnixTimestamp}:{userID}"
// credential = base64(HMAC-SHA256(secret, username))
func generateTurnCredentials(secret, userID string, ttl int64) (username, credential string) {
	expires := time.Now().Unix() + ttl
	username = fmt.Sprintf("%d:%s", expires, userID)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(username))
	credential = base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return
}
