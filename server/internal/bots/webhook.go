package bots

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"time"
)

// isLocalURL возвращает true если URL указывает на localhost или RFC-1918 адрес.
func isLocalURL(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	// Извлечь только hostname (без порта)
	hostname := u.Hostname()
	if hostname == "" {
		return false
	}

	// Резолвить через net.LookupHost чтобы обработать "localhost" и DNS-имена
	addrs, err := net.LookupHost(hostname)
	if err != nil {
		// Если резолв не удался — пробуем распарсить напрямую как IP
		addrs = []string{hostname}
	}

	for _, addr := range addrs {
		ip := net.ParseIP(addr)
		if ip == nil {
			continue
		}
		if isAllowedIP(ip) {
			return true
		}
	}
	return false
}

// isAllowedIP проверяет: loopback (127.x), 10.x, 192.168.x
func isAllowedIP(ip net.IP) bool {
	if ip.IsLoopback() {
		return true
	}
	ip4 := ip.To4()
	if ip4 == nil {
		return false
	}
	// 10.0.0.0/8
	if ip4[0] == 10 {
		return true
	}
	// 192.168.0.0/16
	if ip4[0] == 192 && ip4[1] == 168 {
		return true
	}
	return false
}

// DeliverWebhook отправляет POST на webhookURL с JSON payload.
// secret используется для подписи HMAC-SHA256 (заголовок X-Messenger-Signature).
// Retry 3 раза с backoff 1s/2s/4s.
// Запускать в горутине — не блокирует вызывающего.
func DeliverWebhook(webhookURL string, payload []byte, secret string) {
	// Defence in depth: проверяем allowlist перед отправкой
	if !isLocalURL(webhookURL) {
		log.Printf("webhook: blocked non-local URL %s", webhookURL)
		return
	}

	// Вычислить HMAC-SHA256 подпись
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	signature := fmt.Sprintf("sha256=%s", hex.EncodeToString(mac.Sum(nil)))

	backoffs := []time.Duration{time.Second, 2 * time.Second, 4 * time.Second}
	client := &http.Client{Timeout: 5 * time.Second}

	for attempt, delay := range backoffs {
		req, err := http.NewRequest(http.MethodPost, webhookURL, bytes.NewReader(payload))
		if err != nil {
			log.Printf("webhook attempt %d: failed to create request for %s: %v", attempt+1, webhookURL, err)
			break
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Messenger-Signature", signature)

		resp, err := client.Do(req)
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return
			}
			log.Printf("webhook attempt %d: non-2xx status %d for %s", attempt+1, resp.StatusCode, webhookURL)
		} else {
			log.Printf("webhook attempt %d: error for %s: %v", attempt+1, webhookURL, err)
		}
		if attempt < len(backoffs)-1 {
			time.Sleep(delay)
		}
	}
	log.Printf("webhook: all retries failed for %s", webhookURL)
}

