package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"testing"
	"time"
)

func TestGenerateTurnCredentials_Format(t *testing.T) {
	secret := "test-secret"
	userID := "alice"
	ttl := int64(3600)

	username, credential := generateTurnCredentials(secret, userID, ttl)

	var expires int64
	var uid string
	if _, err := fmt.Sscanf(username, "%d:%s", &expires, &uid); err != nil {
		t.Fatalf("invalid username format %q: %v", username, err)
	}
	if uid != userID {
		t.Errorf("expected userID=%q, got %q", userID, uid)
	}
	now := time.Now().Unix()
	if expires < now || expires > now+ttl+5 {
		t.Errorf("expires %d out of expected range [%d, %d]", expires, now, now+ttl+5)
	}

	// Проверяем HMAC
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(username))
	expected := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if credential != expected {
		t.Errorf("credential mismatch: got %q, want %q", credential, expected)
	}
}

func TestGenerateTurnCredentials_DifferentUsers(t *testing.T) {
	_, c1 := generateTurnCredentials("secret", "alice", 3600)
	_, c2 := generateTurnCredentials("secret", "bob", 3600)
	if c1 == c2 {
		t.Error("different users should produce different credentials")
	}
}
