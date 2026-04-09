// Package middleware содержит HTTP-middleware для security headers и rate limiting.
package middleware

import (
	"net/http"
	"strings"
	"sync"
	"time"
)

// SecurityHeaders добавляет стандартные security headers на все ответы.
// HSTS выставляется только при isHTTPS=true (определяется в main при старте).
func SecurityHeaders(isHTTPS bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Content-Security-Policy",
				"default-src 'self'; "+
					"script-src 'self'; "+
					"style-src 'self' 'unsafe-inline'; "+
					"img-src 'self' blob: data:; "+
					"connect-src 'self' wss: ws:; "+
					"font-src 'self'; "+
					"worker-src 'self'")
			if isHTTPS {
				h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RateLimiter — простой in-memory per-IP ограничитель на основе sliding window.
type RateLimiter struct {
	mu          sync.Mutex
	entries     map[string]*rlEntry
	limit       int
	window      time.Duration
	behindProxy bool // доверять X-Real-IP / X-Forwarded-For только если true
}

type rlEntry struct {
	count   int
	resetAt time.Time
}

// NewRateLimiter создаёт лимитер: limit запросов за window.
// behindProxy=true: доверять прокси-заголовкам для определения реального IP.
func NewRateLimiter(limit int, window time.Duration, behindProxy bool) *RateLimiter {
	rl := &RateLimiter{
		entries:     make(map[string]*rlEntry),
		limit:       limit,
		window:      window,
		behindProxy: behindProxy,
	}
	go rl.cleanupLoop()
	return rl
}

// Allow возвращает true, если запрос с данного IP разрешён.
func (rl *RateLimiter) Allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	e, ok := rl.entries[ip]
	if !ok || time.Now().After(e.resetAt) {
		rl.entries[ip] = &rlEntry{count: 1, resetAt: time.Now().Add(rl.window)}
		return true
	}
	if e.count >= rl.limit {
		return false
	}
	e.count++
	return true
}

// Middleware возвращает chi-совместимый middleware с 429 при превышении лимита.
func (rl *RateLimiter) Middleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !rl.Allow(realIP(r, rl.behindProxy)) {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Retry-After", "60")
				w.WriteHeader(http.StatusTooManyRequests)
				w.Write([]byte(`{"error":"too many requests"}`)) //nolint:errcheck
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// cleanupLoop удаляет устаревшие записи каждые 5 минут.
func (rl *RateLimiter) cleanupLoop() {
	t := time.NewTicker(5 * time.Minute)
	for range t.C {
		rl.mu.Lock()
		now := time.Now()
		for ip, e := range rl.entries {
			if now.After(e.resetAt) {
				delete(rl.entries, ip)
			}
		}
		rl.mu.Unlock()
	}
}

// realIP извлекает IP клиента.
// Прокси-заголовки X-Real-IP / X-Forwarded-For читаются только при behindProxy=true —
// иначе они могут быть подделаны клиентом для обхода rate limiting.
func realIP(r *http.Request, behindProxy bool) string {
	if behindProxy {
		if ip := r.Header.Get("X-Real-IP"); ip != "" {
			return strings.TrimSpace(ip)
		}
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			if idx := strings.IndexByte(fwd, ','); idx != -1 {
				return strings.TrimSpace(fwd[:idx])
			}
			return strings.TrimSpace(fwd)
		}
	}
	// RemoteAddr имеет вид "ip:port"
	addr := r.RemoteAddr
	if idx := strings.LastIndexByte(addr, ':'); idx != -1 {
		return addr[:idx]
	}
	return addr
}
