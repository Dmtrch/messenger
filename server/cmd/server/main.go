package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
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
	"github.com/messenger/server/internal/serverinfo"
	"github.com/messenger/server/internal/users"
	"github.com/messenger/server/internal/ws"
	"golang.org/x/crypto/bcrypt"
)

//go:embed static
var staticFiles embed.FS

func main() {
	cfg, err := loadConfig("config.yaml")
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	if cfg.JWTSecret == "" {
		log.Fatal("JWT_SECRET is required (env или config.yaml)")
	}

	isHTTPS := cfg.TLSCert != "" && cfg.TLSKey != ""

	// Предупреждение: production без TLS небезопасен
	if !isHTTPS && !cfg.BehindProxy && cfg.AllowedOrigin != "" {
		log.Printf("WARNING: ALLOWED_ORIGIN is set but TLS is not configured — traffic is unencrypted")
	}

	// VAPID ключи для Web Push
	if cfg.VAPIDPrivate == "" || cfg.VAPIDPublic == "" {
		// Генерируем одноразово и выводим в лог — сохраните в переменные окружения или config.yaml
		priv, pub, err := webpush.GenerateVAPIDKeys()
		if err == nil && cfg.VAPIDPrivate == "" {
			cfg.VAPIDPrivate = priv
			cfg.VAPIDPublic = pub
			log.Printf("VAPID keys generated (add to env or config.yaml to persist):")
			log.Printf("  VAPID_PRIVATE_KEY=%s", priv)
			log.Printf("  VAPID_PUBLIC_KEY=%s", pub)
		}
	}

	database, err := db.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer database.Close()

	// Bootstrap admin: создаём при первом запуске если задан в конфиге
	if cfg.AdminUsername != "" && cfg.AdminPassword != "" {
		hash, err := bcrypt.GenerateFromPassword([]byte(cfg.AdminPassword), 12)
		if err != nil {
			log.Fatalf("hash admin password: %v", err)
		}
		if err := db.EnsureAdminUser(database, cfg.AdminUsername, string(hash)); err != nil {
			log.Fatalf("ensure admin user: %v", err)
		}
	}

	hub := ws.NewHub(cfg.JWTSecret, database, cfg.VAPIDPrivate, cfg.VAPIDPublic, cfg.AllowedOrigin)

	authHandler := &auth.Handler{DB: database, JWTSecret: []byte(cfg.JWTSecret)}
	chatHandler := &chat.Handler{DB: database, Hub: hub}
	mediaHandler := &media.Handler{MediaDir: cfg.MediaDir, DB: database}
	media.StartOrphanCleaner(database, cfg.MediaDir)
	usersHandler := &users.Handler{DB: database}
	keysHandler := &keys.Handler{DB: database}
	pushHandler := &push.Handler{DB: database, VAPIDPublic: cfg.VAPIDPublic, VAPIDPrivate: cfg.VAPIDPrivate}

	// Rate limiter для auth endpoints: 20 запросов в минуту с одного IP
	authLimiter := secmw.NewRateLimiter(20, time.Minute, cfg.BehindProxy)

	r := chi.NewRouter()
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Timeout(30 * time.Second))
	r.Use(secmw.SecurityHeaders(isHTTPS || cfg.BehindProxy))

	r.Route("/api", func(r chi.Router) {
		r.With(authLimiter.Middleware()).Post("/auth/register", authHandler.Register)
		r.With(authLimiter.Middleware()).Post("/auth/login", authHandler.Login)
		r.With(authLimiter.Middleware()).Post("/auth/refresh", authHandler.Refresh)
		r.Post("/auth/logout", authHandler.Logout)

		r.Get("/push/vapid-public-key", pushHandler.GetVAPIDPublicKey)

		r.Group(func(r chi.Router) {
			r.Use(auth.Middleware([]byte(cfg.JWTSecret)))
			r.Post("/auth/change-password", authHandler.ChangePassword)

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

			r.Get("/calls/ice-servers", iceServersHandler(cfg.STUNUrl, cfg.TURNUrl, cfg.TURNSecret, cfg.TURNCredTTL))
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

	addr := ":" + cfg.Port
	log.Printf("listening on %s (tls=%v)", addr, isHTTPS)

	if isHTTPS {
		log.Fatal(http.ListenAndServeTLS(addr, cfg.TLSCert, cfg.TLSKey, r))
	} else {
		log.Fatal(http.ListenAndServe(addr, r))
	}
}
