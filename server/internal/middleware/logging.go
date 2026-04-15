package middleware

import (
	"fmt"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/messenger/server/internal/logger"
)

// RequestLogger is a chi-compatible middleware that writes one JSON line per
// request to logs/access.log.
func RequestLogger(next http.Handler) http.Handler {
	w := logger.AccessWriter()
	return http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := &statusWriter{ResponseWriter: rw, status: http.StatusOK}
		next.ServeHTTP(ww, r)
		latency := time.Since(start)
		fmt.Fprintf(w,
			`{"time":%q,"method":%q,"path":%q,"status":%d,"latency_ms":%d}`+"\n",
			time.Now().UTC().Format(time.RFC3339),
			r.Method,
			r.URL.Path,
			ww.status,
			latency.Milliseconds(),
		)
	})
}

// Recoverer replaces chimw.Recoverer: catches panics, logs them to
// logs/errors.log, and returns HTTP 500.
func Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				stack := string(debug.Stack())
				logger.Error("panic recovered",
					"method", r.Method,
					"path", r.URL.Path,
					"panic", fmt.Sprintf("%v", rec),
					"stack", stack,
				)
				http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// statusWriter wraps ResponseWriter to capture the HTTP status code.
type statusWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusWriter) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}
