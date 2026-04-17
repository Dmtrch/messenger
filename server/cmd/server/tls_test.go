package main

import (
	"crypto/tls"
	"testing"
)

// TestTLSConfig_MinVersion13 — P1-TLS-1: контрактный тест. MinVersion должен
// быть TLS 1.3 и никогда не откатываться при правке конфига.
func TestTLSConfig_MinVersion13(t *testing.T) {
	cfg := tlsConfig()
	if cfg.MinVersion != tls.VersionTLS13 {
		t.Fatalf("MinVersion: want %x (TLS 1.3), got %x", tls.VersionTLS13, cfg.MinVersion)
	}
}
