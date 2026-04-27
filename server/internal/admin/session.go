package admin

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	cookieName    = "admin_session"
	cookiePath    = "/admin"
	sessionTTL    = 8 * time.Hour
	gcInterval    = 10 * time.Minute
	tokenByteSize = 32
)

type sessionEntry struct {
	adminID   string
	createdAt time.Time
}

// Store is an in-memory session store with HMAC-signed cookies.
type Store struct {
	secret   []byte
	mu       sync.RWMutex
	sessions map[string]sessionEntry
}

// NewStore creates a new Store with the given HMAC secret.
func NewStore(secret []byte) *Store {
	return &Store{
		secret:   secret,
		sessions: make(map[string]sessionEntry),
	}
}

// NewStoreWithGC creates a Store and starts a background GC goroutine.
func NewStoreWithGC(secret []byte) *Store {
	s := NewStore(secret)
	go func() {
		ticker := time.NewTicker(gcInterval)
		defer ticker.Stop()
		for range ticker.C {
			s.GC()
		}
	}()
	return s
}

// Create generates a new session, stores it, and sets the session cookie on w.
func (s *Store) Create(w http.ResponseWriter, adminID string) error {
	raw := make([]byte, tokenByteSize)
	if _, err := rand.Read(raw); err != nil {
		return err
	}
	token := hex.EncodeToString(raw)
	sig := s.sign(token)
	cookieValue := token + "." + sig

	s.mu.Lock()
	s.sessions[token] = sessionEntry{adminID: adminID, createdAt: time.Now()}
	s.mu.Unlock()

	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    cookieValue,
		Path:     cookiePath,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   false,
	})
	return nil
}

// Get reads and validates the session cookie, returning the adminID if valid.
func (s *Store) Get(r *http.Request) (adminID string, ok bool) {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return "", false
	}

	token, sig, found := strings.Cut(c.Value, ".")
	if !found {
		return "", false
	}

	expected := s.sign(token)
	if !hmac.Equal([]byte(sig), []byte(expected)) {
		return "", false
	}

	s.mu.RLock()
	entry, exists := s.sessions[token]
	s.mu.RUnlock()

	if !exists {
		return "", false
	}
	if time.Since(entry.createdAt) > sessionTTL {
		s.mu.Lock()
		delete(s.sessions, token)
		s.mu.Unlock()
		return "", false
	}

	return entry.adminID, true
}

// Delete clears the session cookie on the client side.
func (s *Store) Delete(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    "",
		Path:     cookiePath,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1,
	})
}

// GC removes all expired sessions from the in-memory map.
func (s *Store) GC() {
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	for token, entry := range s.sessions {
		if now.Sub(entry.createdAt) > sessionTTL {
			delete(s.sessions, token)
		}
	}
}

// sign returns the hex-encoded HMAC-SHA256 signature of token.
func (s *Store) sign(token string) string {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(token))
	return hex.EncodeToString(mac.Sum(nil))
}
