package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/auth"
	"github.com/messenger/server/internal/chat"
	"github.com/messenger/server/internal/keys"
	"github.com/messenger/server/internal/media"
	secmw "github.com/messenger/server/internal/middleware"
	"github.com/messenger/server/internal/push"
	"github.com/messenger/server/internal/users"
	"github.com/messenger/server/internal/ws"
)

//go:embed static
var staticFiles embed.FS

func main() {
	port := getenv("PORT", "8080")
	dbPath := getenv("DB_PATH", "./messenger.db")
	mediaDir := getenv("MEDIA_DIR", "./media")
	jwtSecret := getenv("JWT_SECRET", "")
	if jwtSecret == "" {
		log.Fatal("JWT_SECRET is required")
	}

	allowedOrigin := getenv("ALLOWED_ORIGIN", "")
	tlsCert := getenv("TLS_CERT", "")
	tlsKey := getenv("TLS_KEY", "")
	isHTTPS := tlsCert != "" && tlsKey != ""

	// Предупреждение: production без TLS небезопасен
	if !isHTTPS && allowedOrigin != "" {
		log.Printf("WARNING: ALLOWED_ORIGIN is set but TLS is not configured — traffic is unencrypted")
	}

	// VAPID ключи для Web Push
	vapidPrivate := getenv("VAPID_PRIVATE_KEY", "")
	vapidPublic := getenv("VAPID_PUBLIC_KEY", "")
	if vapidPrivate == "" || vapidPublic == "" {
		// Генерируем одноразово и выводим в лог — сохраните в переменные окружения
		priv, pub, err := webpush.GenerateVAPIDKeys()
		if err == nil && vapidPrivate == "" {
			vapidPrivate = priv
			vapidPublic = pub
			log.Printf("VAPID keys generated (add to env to persist):")
			log.Printf("  VAPID_PRIVATE_KEY=%s", priv)
			log.Printf("  VAPID_PUBLIC_KEY=%s", pub)
		}
	}

	stunURL    := getenv("STUN_URL", "stun:stun.l.google.com:19302")
	turnURL    := getenv("TURN_URL", "")
	turnSecret := getenv("TURN_SECRET", "")
	turnTTLStr := getenv("TURN_CREDENTIAL_TTL", "86400")
	turnTTL    := int64(86400)
	if v, err := strconv.ParseInt(turnTTLStr, 10, 64); err == nil {
		turnTTL = v
	}

	database, err := db.Open(dbPath)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer database.Close()

	hub := ws.NewHub(jwtSecret, database, vapidPrivate, vapidPublic, allowedOrigin)

	authHandler := &auth.Handler{DB: database, JWTSecret: []byte(jwtSecret)}
	chatHandler := &chat.Handler{DB: database, Hub: hub}
	mediaHandler := &media.Handler{MediaDir: mediaDir, DB: database}
	usersHandler := &users.Handler{DB: database}
	keysHandler := &keys.Handler{DB: database}
	pushHandler := &push.Handler{DB: database, VAPIDPublic: vapidPublic, VAPIDPrivate: vapidPrivate}

	// Rate limiter для auth endpoints: 20 запросов в минуту с одного IP
	authLimiter := secmw.NewRateLimiter(20, time.Minute)

	r := chi.NewRouter()
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(30 * time.Second))
	r.Use(secmw.SecurityHeaders(isHTTPS))

	r.Route("/api", func(r chi.Router) {
		r.With(authLimiter.Middleware()).Post("/auth/register", authHandler.Register)
		r.With(authLimiter.Middleware()).Post("/auth/login", authHandler.Login)
		r.With(authLimiter.Middleware()).Post("/auth/refresh", authHandler.Refresh)
		r.Post("/auth/logout", authHandler.Logout)

		r.Get("/push/vapid-public-key", pushHandler.GetVAPIDPublicKey)

		r.Group(func(r chi.Router) {
			r.Use(auth.Middleware([]byte(jwtSecret)))

			r.Get("/users/search", usersHandler.Search)

			r.Get("/chats", chatHandler.ListChats)
			r.Post("/chats", chatHandler.CreateChat)
			r.Get("/chats/{chatId}/messages", chatHandler.ListMessages)
			r.Post("/chats/{chatId}/read", chatHandler.MarkChatRead)
			r.Delete("/messages/{clientMsgId}", chatHandler.DeleteMessage)
			r.Patch("/messages/{clientMsgId}", chatHandler.EditMessage)

			r.Get("/keys/{userId}", keysHandler.GetBundle)
			r.Post("/keys/prekeys", keysHandler.UploadPreKeys)
			r.Post("/keys/register", keysHandler.RegisterDevice)

			r.Post("/push/subscribe", pushHandler.Subscribe)

			r.Post("/media/upload", mediaHandler.Upload)
			r.Get("/media/{id}", mediaHandler.Serve)

			r.Get("/calls/ice-servers", iceServersHandler(stunURL, turnURL, turnSecret, turnTTL))
		})
	})

	r.Get("/ws", hub.ServeWS)

	staticFS, err := fs.Sub(staticFiles, "static")
	if err != nil {
		log.Fatalf("static fs: %v", err)
	}
	fileServer := http.FileServer(http.FS(staticFS))

	r.Get("/assets/*", func(w http.ResponseWriter, r *http.Request) {
		fileServer.ServeHTTP(w, r)
	})
	r.Get("/*", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		f, err := staticFS.Open(path)
		if err != nil {
			r.URL.Path = "/"
			http.ServeFileFS(w, r, staticFS, "index.html")
			return
		}
		f.Close()
		fileServer.ServeHTTP(w, r)
	})

	addr := ":" + port
	log.Printf("listening on %s (tls=%v)", addr, isHTTPS)

	if isHTTPS {
		log.Fatal(http.ListenAndServeTLS(addr, tlsCert, tlsKey, r))
	} else {
		log.Fatal(http.ListenAndServe(addr, r))
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
