package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/auth"
	"github.com/messenger/server/internal/chat"
	"github.com/messenger/server/internal/keys"
	"github.com/messenger/server/internal/media"
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

	database, err := db.Open(dbPath)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer database.Close()

	hub := ws.NewHub(jwtSecret, database, vapidPrivate, vapidPublic)

	authHandler := &auth.Handler{DB: database, JWTSecret: []byte(jwtSecret)}
	chatHandler := &chat.Handler{DB: database, Hub: hub}
	mediaHandler := &media.Handler{MediaDir: mediaDir}
	usersHandler := &users.Handler{DB: database}
	keysHandler := &keys.Handler{DB: database}
	pushHandler := &push.Handler{DB: database, VAPIDPublic: vapidPublic, VAPIDPrivate: vapidPrivate}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))

	r.Route("/api", func(r chi.Router) {
		r.Post("/auth/register", authHandler.Register)
		r.Post("/auth/login", authHandler.Login)
		r.Post("/auth/refresh", authHandler.Refresh)
		r.Post("/auth/logout", authHandler.Logout)

		r.Get("/push/vapid-public-key", pushHandler.GetVAPIDPublicKey)

		r.Group(func(r chi.Router) {
			r.Use(auth.Middleware([]byte(jwtSecret)))

			r.Get("/users/search", usersHandler.Search)

			r.Get("/chats", chatHandler.ListChats)
			r.Post("/chats", chatHandler.CreateChat)
			r.Get("/chats/{chatId}/messages", chatHandler.ListMessages)
			r.Delete("/messages/{clientMsgId}", chatHandler.DeleteMessage)
			r.Patch("/messages/{clientMsgId}", chatHandler.EditMessage)

			r.Get("/keys/{userId}", keysHandler.GetBundle)
			r.Post("/keys/prekeys", keysHandler.UploadPreKeys)

			r.Post("/push/subscribe", pushHandler.Subscribe)

			r.Post("/media/upload", mediaHandler.Upload)
		})
		// Раздача файлов — без авторизации (имена случайные)
		r.Get("/media/{filename}", mediaHandler.Serve)
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
	log.Printf("listening on %s", addr)

	tlsCert := getenv("TLS_CERT", "")
	tlsKey := getenv("TLS_KEY", "")
	if tlsCert != "" && tlsKey != "" {
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
