package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	secmw "github.com/messenger/server/internal/middleware"
)

// TestWSConnect_RateLimited — установление WebSocket-соединения должно
// лимитироваться по IP так же, как REST auth-эндпоинты: серия подключений
// сверх лимита получает 429 ещё до апгрейда соединения.
func TestWSConnect_RateLimited(t *testing.T) {
	limiter := secmw.NewRateLimiter(3, time.Minute, false)
	// Заглушка вместо настоящего апгрейда: если её вызвали — значит лимит не сработал.
	upgraded := 0
	stub := func(w http.ResponseWriter, _ *http.Request) {
		upgraded++
		w.WriteHeader(http.StatusSwitchingProtocols)
	}

	r := chi.NewRouter()
	registerWSRoute(r, limiter, stub)

	call := func() int {
		req := httptest.NewRequest(http.MethodGet, "/ws", nil)
		req.RemoteAddr = "10.0.0.7:5555"
		rr := httptest.NewRecorder()
		r.ServeHTTP(rr, req)
		return rr.Code
	}

	for i := 1; i <= 3; i++ {
		if got := call(); got == http.StatusTooManyRequests {
			t.Fatalf("request #%d unexpectedly rate-limited", i)
		}
	}
	if got := call(); got != http.StatusTooManyRequests {
		t.Fatalf("4th WS connect: want 429, got %d", got)
	}
	if upgraded > 3 {
		t.Fatalf("upgrade handler called %d times, limit must block before upgrade", upgraded)
	}
}
