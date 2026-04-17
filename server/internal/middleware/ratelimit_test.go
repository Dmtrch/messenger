package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	secmw "github.com/messenger/server/internal/middleware"
)

// TestRateLimiter_BlocksAfterLimit — P1-PWD-3: лимитер должен блокировать
// запросы сверх лимита и отдавать 429 с Retry-After.
func TestRateLimiter_BlocksAfterLimit(t *testing.T) {
	rl := secmw.NewRateLimiter(3, time.Minute, false)
	handler := rl.Middleware()(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	call := func() int {
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		req.RemoteAddr = "10.0.0.1:4242"
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		return rr.Code
	}

	for i := 1; i <= 3; i++ {
		if got := call(); got != http.StatusOK {
			t.Fatalf("request #%d: want 200, got %d", i, got)
		}
	}
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.RemoteAddr = "10.0.0.1:4242"
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("4th request: want 429, got %d", rr.Code)
	}
	if rr.Header().Get("Retry-After") == "" {
		t.Errorf("expected Retry-After header on 429")
	}
}

// TestRateLimiter_PerIPIsolation — разные IP не должны влиять друг на друга.
func TestRateLimiter_PerIPIsolation(t *testing.T) {
	rl := secmw.NewRateLimiter(2, time.Minute, false)
	handler := rl.Middleware()(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	call := func(ip string) int {
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		req.RemoteAddr = ip + ":1234"
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		return rr.Code
	}

	if call("10.0.0.1") != 200 || call("10.0.0.1") != 200 {
		t.Fatal("first two requests for IP1 should succeed")
	}
	if call("10.0.0.1") != http.StatusTooManyRequests {
		t.Fatal("third request for IP1 should be blocked")
	}
	if call("10.0.0.2") != 200 {
		t.Fatal("IP2 should have its own bucket")
	}
}

// TestRateLimiter_IgnoresProxyHeadersWhenNotBehindProxy — защита от подделки
// X-Forwarded-For клиентом для обхода лимита.
func TestRateLimiter_IgnoresProxyHeadersWhenNotBehindProxy(t *testing.T) {
	rl := secmw.NewRateLimiter(2, time.Minute, false)
	handler := rl.Middleware()(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	call := func(xff string) int {
		req := httptest.NewRequest(http.MethodPost, "/", nil)
		req.RemoteAddr = "10.0.0.1:1234"
		if xff != "" {
			req.Header.Set("X-Forwarded-For", xff)
		}
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		return rr.Code
	}

	if call("1.1.1.1") != 200 || call("2.2.2.2") != 200 {
		t.Fatal("first two should pass")
	}
	if call("3.3.3.3") != http.StatusTooManyRequests {
		t.Fatal("X-Forwarded-For must not be trusted when behindProxy=false")
	}
}
