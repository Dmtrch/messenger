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
	"github.com/messenger/server/internal/admin"
	"github.com/messenger/server/internal/auth"
	"github.com/messenger/server/internal/chat"
	"github.com/messenger/server/internal/keys"
	"github.com/messenger/server/internal/clienterrors"
	"github.com/messenger/server/internal/logger"
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
	if err := logger.Init("logs"); err != nil {
		log.Printf("WARNING: could not init file logger: %v", err)
	}

	cfg, err := loadConfig("config.yaml")
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	if cfg.JWTSecret == "" {
		log.Fatal("JWT_SECRET is required (env или config.yaml)")
	}

	switch cfg.RegistrationMode {
	case "open", "invite", "approval":
		// ok
	default:
		log.Fatalf("invalid registration_mode %q: must be open|invite|approval", cfg.RegistrationMode)
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

	nativePushCfg := push.NativePushConfig{
		FCMLegacyKey: cfg.FCMLegacyKey,
		APNsKeyPath:  cfg.APNsKeyPath,
		APNsKeyID:    cfg.APNsKeyID,
		APNsTeamID:   cfg.APNsTeamID,
		APNsBundleID: cfg.APNsBundleID,
		APNsSandbox:  cfg.APNsSandbox,
	}

	hub := ws.NewHub(cfg.JWTSecret, database, cfg.VAPIDPrivate, cfg.VAPIDPublic, cfg.AllowedOrigin)
	hub.SetNativePushConfig(nativePushCfg)

	authHandler := &auth.Handler{
		DB:               database,
		JWTSecret:        []byte(cfg.JWTSecret),
		RegistrationMode: cfg.RegistrationMode,
	}
	adminHandler := &admin.Handler{DB: database}
	chatHandler := &chat.Handler{DB: database, Hub: hub, MediaDir: cfg.MediaDir}
	mediaHandler := &media.Handler{MediaDir: cfg.MediaDir, DB: database}
	media.StartOrphanCleaner(database, cfg.MediaDir)
	usersHandler := &users.Handler{DB: database}
	keysHandler := &keys.Handler{DB: database}
	pushHandler := &push.Handler{
		DB:           database,
		VAPIDPublic:  cfg.VAPIDPublic,
		VAPIDPrivate: cfg.VAPIDPrivate,
		NativeCfg:    nativePushCfg,
	}
	serverinfoHandler := &serverinfo.Handler{
		Name:             cfg.ServerName,
		Description:      cfg.ServerDescription,
		RegistrationMode: cfg.RegistrationMode,
	}

	// Rate limiter для auth endpoints: 20 запросов в минуту с одного IP
	authLimiter := secmw.NewRateLimiter(20, time.Minute, cfg.BehindProxy)

	r := chi.NewRouter()
	r.Use(secmw.RequestLogger)
	r.Use(secmw.Recoverer)
	r.Use(chimw.Timeout(30 * time.Second))
	r.Use(secmw.SecurityHeaders(isHTTPS || cfg.BehindProxy))
	r.Use(corsMiddleware(cfg.AllowedOrigin))

	clientErrorsHandler := &clienterrors.Handler{}

	r.Route("/api", func(r chi.Router) {
		r.Get("/server/info", serverinfoHandler.ServeHTTP)
		r.Post("/client-errors", clientErrorsHandler.ServeHTTP)

		r.With(authLimiter.Middleware()).Post("/auth/register", authHandler.Register)
		r.With(authLimiter.Middleware()).Post("/auth/login", authHandler.Login)
		r.With(authLimiter.Middleware()).Post("/auth/refresh", authHandler.Refresh)
		r.Post("/auth/logout", authHandler.Logout)
		r.With(authLimiter.Middleware()).Post("/auth/request-register", authHandler.RequestRegister)
		r.With(authLimiter.Middleware()).Post("/auth/password-reset-request", authHandler.PasswordResetRequest)

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
				r.Post("/push/native/register", pushHandler.RegisterNativeToken)

			r.Post("/media/upload", mediaHandler.Upload)
			r.Get("/media/{id}", mediaHandler.Serve)

			r.Get("/calls/ice-servers", iceServersHandler(cfg.STUNUrl, cfg.TURNUrl, cfg.TURNSecret, cfg.TURNCredTTL))

			r.Group(func(r chi.Router) {
				r.Use(admin.RequireAdmin)
				r.Get("/admin/registration-requests", adminHandler.ListRegistrationRequests)
				r.Post("/admin/registration-requests/{id}/approve", adminHandler.ApproveRegistrationRequest)
				r.Post("/admin/registration-requests/{id}/reject", adminHandler.RejectRegistrationRequest)
				r.Post("/admin/invite-codes", adminHandler.CreateInviteCode)
				r.Get("/admin/invite-codes", adminHandler.ListInviteCodes)
				r.Get("/admin/users", adminHandler.ListUsers)
				r.Post("/admin/users/{id}/reset-password", adminHandler.ResetUserPassword)
				r.Get("/admin/password-reset-requests", adminHandler.ListPasswordResetRequests)
				r.Post("/admin/password-reset-requests/{id}/resolve", adminHandler.ResolvePasswordResetRequest)
			})
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

// corsMiddleware добавляет заголовки CORS для HTTP API.
// Если allowedOrigin задан — разрешает только его; иначе отражает Origin запроса.
// Обрабатывает preflight OPTIONS запросы.
func corsMiddleware(allowedOrigin string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin == "" {
				next.ServeHTTP(w, r)
				return
			}

			allow := allowedOrigin
			if allow == "" {
				allow = origin
			}

			if allow == origin || allowedOrigin == "" {
				w.Header().Set("Access-Control-Allow-Origin", allow)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Vary", "Origin")
			}

			if r.Method == http.MethodOptions {
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
				w.Header().Set("Access-Control-Max-Age", "86400")
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
