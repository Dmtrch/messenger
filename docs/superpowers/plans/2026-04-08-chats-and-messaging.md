# Chats & Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать приложение полностью рабочим — пользователи могут войти, найти друг друга, создать чат и обмениваться сообщениями в реальном времени.

**Architecture:** Go-сервер предоставляет защищённые JWT-маршруты для чатов, поиска пользователей и истории сообщений. React-клиент загружает чаты при входе, показывает диалог поиска пользователей для создания нового чата, отправляет и получает сообщения через WebSocket.

**Tech Stack:** Go 1.22 + Chi + gorilla/websocket + SQLite | React 18 + TypeScript + Zustand + Vite

---

## Карта файлов

### Backend (Go) — создать/изменить

| Файл | Действие | Ответственность |
|------|----------|-----------------|
| `server/internal/auth/middleware.go` | Создать | JWT middleware для защищённых роутов |
| `server/internal/chat/handler.go` | Создать | REST: GET /api/chats, POST /api/chats, GET /api/chats/:id/messages |
| `server/internal/users/handler.go` | Создать | REST: GET /api/users/search |
| `server/cmd/server/main.go` | Изменить | Подключить новые роуты с JWT middleware |
| `server/internal/ws/hub.go` | Изменить | Обработка входящих сообщений + сохранение в БД |

### Frontend (React/TypeScript) — создать/изменить

| Файл | Действие | Ответственность |
|------|----------|-----------------|
| `client/src/pages/AuthPage.tsx` | Изменить | Добавить переключение регистрация/вход |
| `client/src/store/authStore.ts` | Изменить | Загружать список чатов после входа |
| `client/src/pages/ChatListPage.tsx` | Изменить | Добавить кнопку «+» и вызов диалога |
| `client/src/components/NewChatDialog/NewChatDialog.tsx` | Создать | Поиск пользователей + создание чата |
| `client/src/components/NewChatDialog/NewChatDialog.module.css` | Создать | Стили диалога |
| `client/src/pages/ChatWindowPage.tsx` | Изменить | Загрузка истории сообщений при открытии |
| `client/src/components/ChatWindow/ChatWindow.tsx` | Изменить | Рендер сообщений + форма отправки |
| `client/src/api/client.ts` | Изменить | searchUsers, getChats (уже есть), login (уже есть) |

---

## Task 1: JWT Middleware (Backend)

**Files:**
- Create: `server/internal/auth/middleware.go`

- [ ] **Step 1: Создать файл middleware**

```go
// server/internal/auth/middleware.go
package auth

import (
	"context"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type ctxKey string
const UserIDKey ctxKey = "userID"

// Middleware извлекает userID из Bearer JWT и кладёт в контекст.
func Middleware(secret []byte) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if !strings.HasPrefix(authHeader, "Bearer ") {
				httpErr(w, "missing token", 401)
				return
			}
			tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
			token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
				if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, jwt.ErrSignatureInvalid
				}
				return secret, nil
			})
			if err != nil || !token.Valid {
				httpErr(w, "invalid token", 401)
				return
			}
			claims, ok := token.Claims.(jwt.MapClaims)
			if !ok {
				httpErr(w, "invalid claims", 401)
				return
			}
			userID, _ := claims["sub"].(string)
			ctx := context.WithValue(r.Context(), UserIDKey, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// UserIDFromCtx возвращает userID из контекста запроса.
func UserIDFromCtx(r *http.Request) string {
	id, _ := r.Context().Value(UserIDKey).(string)
	return id
}
```

- [ ] **Step 2: Убедиться что компилируется**

```bash
cd /Users/dim/vscodeproject/messenger/server
go build ./...
```
Ожидаем: нет ошибок.

---

## Task 2: Users Search Handler (Backend)

**Files:**
- Create: `server/internal/users/handler.go`

- [ ] **Step 1: Создать пакет users**

```go
// server/internal/users/handler.go
package users

import (
	"database/sql"
	"net/http"

	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/auth"
)

type Handler struct {
	DB *sql.DB
}

// GET /api/users/search?q=<query>
// Возвращает до 20 пользователей, чьё имя содержит q.
// Текущий пользователь исключается из результатов.
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if len(q) < 2 {
		jsonReply(w, 200, map[string]any{"users": []any{}})
		return
	}

	callerID := auth.UserIDFromCtx(r)

	users, err := db.SearchUsers(h.DB, q, 21)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}

	type userDTO struct {
		ID          string `json:"id"`
		Username    string `json:"username"`
		DisplayName string `json:"displayName"`
	}

	result := make([]userDTO, 0, len(users))
	for _, u := range users {
		if u.ID == callerID {
			continue // не показываем самого себя
		}
		result = append(result, userDTO{
			ID:          u.ID,
			Username:    u.Username,
			DisplayName: u.DisplayName,
		})
		if len(result) == 20 {
			break
		}
	}

	jsonReply(w, 200, map[string]any{"users": result})
}

func httpErr(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = jsonEncode(w, map[string]string{"error": msg})
}

func jsonReply(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = jsonEncode(w, v)
}

func jsonEncode(w http.ResponseWriter, v any) error {
	import_enc := func() {
		// placeholder — see below
	}
	_ = import_enc
	return nil
}
```

Нет, это неверно. Вот правильная версия без вспомогательных функций-дубликатов — используем `encoding/json` напрямую:

```go
// server/internal/users/handler.go
package users

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/auth"
)

type Handler struct {
	DB *sql.DB
}

type UserDTO struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

// GET /api/users/search?q=<query>
func (h *Handler) Search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if len(q) < 2 {
		reply(w, 200, map[string]any{"users": []UserDTO{}})
		return
	}

	callerID := auth.UserIDFromCtx(r)
	users, err := db.SearchUsers(h.DB, q, 21)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}

	result := make([]UserDTO, 0, len(users))
	for _, u := range users {
		if u.ID == callerID {
			continue
		}
		result = append(result, UserDTO{ID: u.ID, Username: u.Username, DisplayName: u.DisplayName})
		if len(result) == 20 {
			break
		}
	}
	reply(w, 200, map[string]any{"users": result})
}

func httpErr(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func reply(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
```

- [ ] **Step 2: Проверить компиляцию**

```bash
cd /Users/dim/vscodeproject/messenger/server && go build ./...
```
Ожидаем: нет ошибок.

---

## Task 3: Chats Handler (Backend)

**Files:**
- Create: `server/internal/chat/handler.go`

- [ ] **Step 1: Создать handler чатов**

```go
// server/internal/chat/handler.go
package chat

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/go-chi/chi/v5"
	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/auth"
)

type Handler struct {
	DB *sql.DB
}

type ChatDTO struct {
	ID        string   `json:"id"`
	Type      string   `json:"type"`
	Name      string   `json:"name"`
	Members   []string `json:"members"`
	CreatedAt int64    `json:"createdAt"`
}

type MessageDTO struct {
	ID               string `json:"id"`
	ConversationID   string `json:"chatId"`
	SenderID         string `json:"senderId"`
	EncryptedPayload string `json:"encryptedPayload"` // base64
	SenderKeyID      int64  `json:"senderKeyId"`
	Timestamp        int64  `json:"timestamp"`
	Delivered        bool   `json:"delivered"`
	Read             bool   `json:"read"`
}

// GET /api/chats — список чатов текущего пользователя
func (h *Handler) ListChats(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromCtx(r)
	convs, err := db.GetUserConversations(h.DB, userID)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}

	result := make([]ChatDTO, 0, len(convs))
	for _, c := range convs {
		members, _ := db.GetConversationMembers(h.DB, c.ID)
		name := ""
		if c.Name.Valid {
			name = c.Name.String
		} else if c.Type == "direct" {
			// Для прямого чата — имя собеседника
			for _, uid := range members {
				if uid != userID {
					u, _ := db.GetUserByID(h.DB, uid)
					if u != nil {
						name = u.DisplayName
					}
					break
				}
			}
		}
		result = append(result, ChatDTO{
			ID:        c.ID,
			Type:      c.Type,
			Name:      name,
			Members:   members,
			CreatedAt: c.CreatedAt,
		})
	}
	reply(w, 200, map[string]any{"chats": result})
}

// POST /api/chats — создать чат
// Body: {"type":"direct","memberIds":["<userID>"],"name":""}
func (h *Handler) CreateChat(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromCtx(r)

	var req struct {
		Type      string   `json:"type"`
		MemberIDs []string `json:"memberIds"`
		Name      string   `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpErr(w, "invalid body", 400)
		return
	}
	if req.Type != "direct" && req.Type != "group" {
		httpErr(w, "type must be direct or group", 400)
		return
	}

	// Добавляем текущего пользователя в участники
	memberSet := map[string]struct{}{userID: {}}
	for _, id := range req.MemberIDs {
		memberSet[id] = struct{}{}
	}
	members := make([]string, 0, len(memberSet))
	for id := range memberSet {
		members = append(members, id)
	}

	// Для direct: проверить не существует ли уже чат между этими двумя
	if req.Type == "direct" && len(members) == 2 {
		convs, _ := db.GetUserConversations(h.DB, userID)
		for _, c := range convs {
			if c.Type != "direct" {
				continue
			}
			m, _ := db.GetConversationMembers(h.DB, c.ID)
			if len(m) == 2 {
				otherID := req.MemberIDs[0]
				if (m[0] == userID && m[1] == otherID) || (m[1] == userID && m[0] == otherID) {
					// Чат уже существует — вернуть его
					u, _ := db.GetUserByID(h.DB, otherID)
					name := ""
					if u != nil { name = u.DisplayName }
					reply(w, 200, map[string]any{"chat": ChatDTO{
						ID: c.ID, Type: c.Type, Name: name, Members: m, CreatedAt: c.CreatedAt,
					}})
					return
				}
			}
		}
	}

	conv := db.Conversation{
		ID:        uuid.New().String(),
		Type:      req.Type,
		CreatedAt: time.Now().UnixMilli(),
	}
	if req.Name != "" {
		conv.Name = sql.NullString{String: req.Name, Valid: true}
	}

	if err := db.CreateConversation(h.DB, conv, members); err != nil {
		httpErr(w, "server error", 500)
		return
	}

	name := req.Name
	if name == "" && req.Type == "direct" && len(req.MemberIDs) > 0 {
		u, _ := db.GetUserByID(h.DB, req.MemberIDs[0])
		if u != nil { name = u.DisplayName }
	}

	reply(w, 201, map[string]any{"chat": ChatDTO{
		ID: conv.ID, Type: conv.Type, Name: name, Members: members, CreatedAt: conv.CreatedAt,
	}})
}

// GET /api/chats/{chatId}/messages?before=<ts>&limit=<n>
func (h *Handler) ListMessages(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromCtx(r)
	chatID := chi.URLParam(r, "chatId")

	// Проверить что пользователь — участник чата
	member, err := db.IsConversationMember(h.DB, chatID, userID)
	if err != nil || !member {
		httpErr(w, "not found", 404)
		return
	}

	var before int64
	var limit int = 50
	if s := r.URL.Query().Get("before"); s != "" {
		before, _ = strconv.ParseInt(s, 10, 64)
	}
	if s := r.URL.Query().Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}

	msgs, err := db.GetMessages(h.DB, chatID, before, limit)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}

	import_b64 := "encoding/base64"
	_ = import_b64

	result := make([]MessageDTO, 0, len(msgs))
	for _, m := range msgs {
		result = append(result, MessageDTO{
			ID:               m.ID,
			ConversationID:   m.ConversationID,
			SenderID:         m.SenderID,
			EncryptedPayload: encodeBase64(m.Ciphertext),
			SenderKeyID:      m.SenderKeyID,
			Timestamp:        m.CreatedAt,
			Delivered:        m.DeliveredAt.Valid,
			Read:             m.ReadAt.Valid,
		})
	}
	reply(w, 200, map[string]any{"messages": result, "nextCursor": nextCursor(msgs)})
}

func nextCursor(msgs []db.Message) *int64 {
	if len(msgs) == 0 {
		return nil
	}
	ts := msgs[len(msgs)-1].CreatedAt
	return &ts
}

func httpErr(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func reply(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
```

- [ ] **Step 2: Добавить encodeBase64 и import**

В начале файла `server/internal/chat/handler.go` добавить импорт `"encoding/base64"` и функцию:

```go
import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/auth"
)

func encodeBase64(b []byte) string {
	return base64.StdEncoding.EncodeToString(b)
}
```

(Убрать строки `import_b64` из ListMessages — они placeholder)

- [ ] **Step 3: Проверить компиляцию**

```bash
cd /Users/dim/vscodeproject/messenger/server && go build ./...
```

---

## Task 4: Подключить роуты в main.go (Backend)

**Files:**
- Modify: `server/cmd/server/main.go`

- [ ] **Step 1: Обновить main.go**

Добавить импорты и роуты. Заменить блок `r.Route("/api", ...)` на:

```go
import (
	// ... существующие импорты ...
	"github.com/messenger/server/internal/auth"
	"github.com/messenger/server/internal/chat"
	"github.com/messenger/server/internal/users"
)

// В функции main():
chatHandler := &chat.Handler{DB: database}
usersHandler := &users.Handler{DB: database}
jwtMiddleware := auth.Middleware([]byte(jwtSecret))

r.Route("/api", func(r chi.Router) {
	// Публичные маршруты (без JWT)
	r.Post("/auth/register", authHandler.Register)
	r.Post("/auth/login",    authHandler.Login)
	r.Post("/auth/refresh",  authHandler.Refresh)
	r.Post("/auth/logout",   authHandler.Logout)

	// Защищённые маршруты (требуют JWT)
	r.Group(func(r chi.Router) {
		r.Use(jwtMiddleware)

		r.Get("/users/search", usersHandler.Search)

		r.Get("/chats",                          chatHandler.ListChats)
		r.Post("/chats",                         chatHandler.CreateChat)
		r.Get("/chats/{chatId}/messages",        chatHandler.ListMessages)
	})
})
```

- [ ] **Step 2: Проверить компиляцию**

```bash
cd /Users/dim/vscodeproject/messenger/server && go build ./...
```

- [ ] **Step 3: Проверить роуты вручную**

```bash
# Зарегистрировать тестового пользователя
curl -s -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"password123","display_name":"Alice"}' | jq .

# Сохранить токен
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"password123"}' | jq -r .accessToken)

# Поиск пользователей
curl -s "http://localhost:8080/api/users/search?q=ali" \
  -H "Authorization: Bearer $TOKEN" | jq .

# Список чатов (пустой)
curl -s "http://localhost:8080/api/chats" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Ожидаем: `{"chats":[]}` и список пользователей.

---

## Task 5: Пересборка Docker-контейнера (Backend завершён)

- [ ] **Step 1: Пересобрать и перезапустить**

```bash
cd /Users/dim/vscodeproject/messenger
docker compose up --build -d
```

Ожидаем: `messenger | listening on :8080`

---

## Task 6: Login форма (Frontend)

**Files:**
- Modify: `client/src/pages/AuthPage.tsx`

- [ ] **Step 1: Добавить состояние режима и форму входа**

Заменить содержимое `AuthPage.tsx` на:

```tsx
import { useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { initSodium, generateIdentityKeyPair, generateDHKeyPair, signData, toBase64 } from '@/crypto/x3dh'
import { saveIdentityKey, saveSignedPreKey, saveOneTimePreKeys } from '@/crypto/keystore'
import { api, setAccessToken } from '@/api/client'
import type { User } from '@/types'
import s from './pages.module.css'

const OPK_COUNT = 10

export default function AuthPage() {
  const login = useAuthStore((st) => st.login)
  const [mode, setMode] = useState<'register' | 'login'>('register')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password || !displayName.trim()) { setError('Заполните все поля'); return }
    if (username.trim().length < 3) { setError('Логин минимум 3 символа'); return }
    if (password.length < 8) { setError('Пароль минимум 8 символов'); return }

    setLoading(true); setError('')
    try {
      await initSodium()
      const identityKey = generateIdentityKeyPair()
      const signedPreKey = generateDHKeyPair(1)
      const opks = Array.from({ length: OPK_COUNT }, (_, i) => generateDHKeyPair(i + 1))
      const spkSignature = signData(signedPreKey.publicKey, identityKey.privateKey)
      await saveIdentityKey(identityKey)
      await saveSignedPreKey(signedPreKey)
      await saveOneTimePreKeys(opks)
      const { userId, accessToken } = await api.register({
        username: username.trim(), password, displayName: displayName.trim(),
        ikPublic: toBase64(identityKey.publicKey),
        spkId: signedPreKey.id, spkPublic: toBase64(signedPreKey.publicKey),
        spkSignature: toBase64(spkSignature),
        opkPublics: opks.map((k) => ({ id: k.id, key: toBase64(k.publicKey) })),
      })
      setAccessToken(accessToken)
      login({ id: userId, username: username.trim(), displayName: displayName.trim(),
        identityKeyPublic: toBase64(identityKey.publicKey) }, accessToken)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка регистрации')
    } finally { setLoading(false) }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) { setError('Заполните все поля'); return }
    setLoading(true); setError('')
    try {
      const res = await api.login({ username: username.trim(), password })
      setAccessToken(res.accessToken)
      login({
        id: res.user.id, username: res.user.username,
        displayName: res.user.displayName,
        identityKeyPublic: res.user.ikPublic ?? '',
      }, res.accessToken)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неверный логин или пароль')
    } finally { setLoading(false) }
  }

  return (
    <div className={s.authPage}>
      <div className={s.card}>
        <h1 className={s.logo}>Messenger</h1>
        <p className={s.sub}>Безопасный мессенджер с E2E шифрованием</p>

        <div className={s.tabs}>
          <button className={`${s.tab} ${mode === 'register' ? s.tabActive : ''}`}
            onClick={() => { setMode('register'); setError('') }}>
            Регистрация
          </button>
          <button className={`${s.tab} ${mode === 'login' ? s.tabActive : ''}`}
            onClick={() => { setMode('login'); setError('') }}>
            Войти
          </button>
        </div>

        {mode === 'register' ? (
          <form onSubmit={handleRegister} className={s.form}>
            <input className={s.input} type="text" placeholder="Логин (username)"
              value={username} onChange={(e) => setUsername(e.target.value)}
              autoComplete="username" autoCapitalize="none" />
            <input className={s.input} type="password" placeholder="Пароль (минимум 8 символов)"
              value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password" />
            <input className={s.input} type="text" placeholder="Отображаемое имя"
              value={displayName} onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name" />
            {error && <p className={s.error} role="alert">{error}</p>}
            <button type="submit" className={s.btn} disabled={loading}>
              {loading ? 'Генерация ключей…' : 'Зарегистрироваться'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin} className={s.form}>
            <input className={s.input} type="text" placeholder="Логин"
              value={username} onChange={(e) => setUsername(e.target.value)}
              autoComplete="username" autoCapitalize="none" />
            <input className={s.input} type="password" placeholder="Пароль"
              value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password" />
            {error && <p className={s.error} role="alert">{error}</p>}
            <button type="submit" className={s.btn} disabled={loading}>
              {loading ? 'Вход…' : 'Войти'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Добавить стили tabs в pages.module.css**

Добавить в конец файла `client/src/pages/pages.module.css`:

```css
.tabs {
  display: flex;
  gap: 0;
  margin-bottom: 16px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #2a3942;
}

.tab {
  flex: 1;
  padding: 10px;
  background: transparent;
  border: none;
  color: #8696a0;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.tab:hover { background: #2a3942; color: #e9edef; }

.tabActive {
  background: #2a3942;
  color: #00a884;
  font-weight: 600;
}
```

---

## Task 7: Обновить api/client.ts — login и searchUsers

**Files:**
- Modify: `client/src/api/client.ts`

- [ ] **Step 1: Исправить AuthLoginReq — убрать challenge/signature, добавить password**

Заменить интерфейс `AuthLoginReq`:

```ts
export interface AuthLoginReq {
  username: string
  password: string
}
```

Заменить интерфейс `AuthLoginRes`:

```ts
export interface AuthLoginRes {
  accessToken: string
  user: {
    id: string
    username: string
    displayName: string
    ikPublic?: string
  }
}
```

- [ ] **Step 2: Добавить searchUsers в api объект**

В секцию `// ── Public API` добавить после `logout`:

```ts
searchUsers: (q: string) =>
  req<{ users: Array<{ id: string; username: string; displayName: string }> }>(
    `/api/users/search?q=${encodeURIComponent(q)}`
  ),
```

---

## Task 8: Загрузка чатов после входа (Frontend)

**Files:**
- Modify: `client/src/store/authStore.ts`

- [ ] **Step 1: Прочитать текущий authStore**

```bash
cat /Users/dim/vscodeproject/messenger/client/src/store/authStore.ts
```

- [ ] **Step 2: Загружать чаты после login**

В `authStore.ts` в экшене `login` после сохранения пользователя добавить вызов загрузки чатов. Для этого нужен прямой вызов API (не через хук). Добавить в конец файла после экспорта store:

```ts
// Загружает список чатов в chatStore — вызывается после login
export async function loadChats() {
  const { setChats } = useChatStore.getState()
  try {
    const res = await api.getChats()
    const chats = res.chats.map((c: any) => ({
      id: c.id,
      type: c.type as 'direct' | 'group',
      name: c.name ?? '',
      members: c.members ?? [],
      unreadCount: 0,
      updatedAt: c.createdAt ?? Date.now(),
    }))
    setChats(chats)
  } catch {
    // Игнорируем ошибку загрузки чатов при старте
  }
}
```

Добавить импорты в начало файла:
```ts
import { api } from '@/api/client'
import { useChatStore } from '@/store/chatStore'
```

- [ ] **Step 3: Вызвать loadChats в App.tsx при монтировании**

В `client/src/App.tsx` в компоненте `AppRoutes` добавить:

```tsx
import { loadChats } from '@/store/authStore'

// Внутри AppRoutes, после useMessengerWS():
useEffect(() => {
  if (isAuthenticated) loadChats()
}, [isAuthenticated])
```

И добавить `useEffect` в импорты React:
```ts
import { useEffect } from 'react'
```

---

## Task 9: NewChatDialog — поиск и создание чата (Frontend)

**Files:**
- Create: `client/src/components/NewChatDialog/NewChatDialog.tsx`
- Create: `client/src/components/NewChatDialog/NewChatDialog.module.css`

- [ ] **Step 1: Создать компонент диалога**

```tsx
// client/src/components/NewChatDialog/NewChatDialog.tsx
import { useState, useCallback } from 'react'
import { api } from '@/api/client'
import { useChatStore } from '@/store/chatStore'
import type { Chat } from '@/types'
import s from './NewChatDialog.module.css'

interface Props {
  onClose: () => void
  onChatCreated: (chatId: string) => void
}

interface UserResult {
  id: string
  username: string
  displayName: string
}

export default function NewChatDialog({ onClose, onChatCreated }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserResult[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState<string | null>(null)
  const upsertChat = useChatStore((s) => s.upsertChat)

  const search = useCallback(async (q: string) => {
    setQuery(q)
    if (q.length < 2) { setResults([]); return }
    setLoading(true)
    try {
      const res = await api.searchUsers(q)
      setResults(res.users)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  const startChat = async (user: UserResult) => {
    setCreating(user.id)
    try {
      const res = await api.createChat({ type: 'direct', memberIds: [user.id] })
      const chat: Chat = {
        id: res.chat.id,
        type: res.chat.type as 'direct' | 'group',
        name: res.chat.name ?? user.displayName,
        members: res.chat.members ?? [user.id],
        unreadCount: 0,
        updatedAt: res.chat.createdAt ?? Date.now(),
      }
      upsertChat(chat)
      onChatCreated(chat.id)
    } catch {
      // ошибка — тихо игнорируем, пользователь может попробовать снова
    } finally {
      setCreating(null)
    }
  }

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={s.header}>
          <h2 className={s.title}>Новый чат</h2>
          <button className={s.closeBtn} onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        <input
          className={s.search}
          type="search"
          placeholder="Поиск по имени пользователя…"
          value={query}
          onChange={(e) => search(e.target.value)}
          autoFocus
        />
        <ul className={s.list}>
          {loading && <li className={s.hint}>Поиск…</li>}
          {!loading && query.length >= 2 && results.length === 0 && (
            <li className={s.hint}>Пользователи не найдены</li>
          )}
          {!loading && query.length < 2 && (
            <li className={s.hint}>Введите минимум 2 символа</li>
          )}
          {results.map((u) => (
            <li key={u.id}>
              <button
                className={s.userItem}
                onClick={() => startChat(u)}
                disabled={creating === u.id}
              >
                <div className={s.avatar}>{u.displayName.charAt(0).toUpperCase()}</div>
                <div className={s.info}>
                  <span className={s.name}>{u.displayName}</span>
                  <span className={s.username}>@{u.username}</span>
                </div>
                {creating === u.id && <span className={s.spinner}>…</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Создать стили**

```css
/* client/src/components/NewChatDialog/NewChatDialog.module.css */

.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 16px;
}

.dialog {
  background: #1f2c34;
  border-radius: 12px;
  width: 100%;
  max-width: 400px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 8px;
}

.title {
  font-size: 18px;
  font-weight: 600;
  color: #e9edef;
  margin: 0;
}

.closeBtn {
  background: none;
  border: none;
  color: #8696a0;
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}
.closeBtn:hover { background: #2a3942; color: #e9edef; }

.search {
  margin: 0 16px 8px;
  padding: 10px 14px;
  background: #2a3942;
  border: none;
  border-radius: 8px;
  color: #e9edef;
  font-size: 15px;
  outline: none;
}
.search::placeholder { color: #8696a0; }

.list {
  list-style: none;
  margin: 0;
  padding: 0 8px 8px;
  overflow-y: auto;
  flex: 1;
}

.hint {
  padding: 16px;
  color: #8696a0;
  font-size: 14px;
  text-align: center;
}

.userItem {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 8px;
  background: none;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s;
}
.userItem:hover { background: #2a3942; }
.userItem:disabled { opacity: 0.6; cursor: default; }

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #00a884;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 600;
  flex-shrink: 0;
}

.info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.name {
  color: #e9edef;
  font-size: 15px;
  font-weight: 500;
}

.username {
  color: #8696a0;
  font-size: 13px;
}

.spinner {
  color: #8696a0;
  font-size: 18px;
}
```

---

## Task 10: Кнопка «+» в ChatListPage (Frontend)

**Files:**
- Modify: `client/src/pages/ChatListPage.tsx`

- [ ] **Step 1: Добавить диалог и кнопку**

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ChatList from '@/components/ChatList/ChatList'
import NewChatDialog from '@/components/NewChatDialog/NewChatDialog'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { useEffect } from 'react'
import s from './pages.module.css'

export default function ChatListPage() {
  const navigate = useNavigate()
  const { subscribe } = usePushNotifications()
  const [showNewChat, setShowNewChat] = useState(false)

  useEffect(() => { subscribe() }, [subscribe])

  return (
    <div className={s.page}>
      <header className={s.topBar}>
        <h1 className={s.appTitle}>Messenger</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={s.iconBtn} onClick={() => setShowNewChat(true)} aria-label="Новый чат">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
          </button>
          <button className={s.iconBtn} onClick={() => navigate('/profile')} aria-label="Профиль">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
            </svg>
          </button>
        </div>
      </header>

      <ChatList onSelect={(id) => navigate(`/chat/${id}`)} />

      {showNewChat && (
        <NewChatDialog
          onClose={() => setShowNewChat(false)}
          onChatCreated={(id) => { setShowNewChat(false); navigate(`/chat/${id}`) }}
        />
      )}
    </div>
  )
}
```

---

## Task 11: ChatWindow — загрузка и отправка сообщений (Frontend)

**Files:**
- Modify: `client/src/components/ChatWindow/ChatWindow.tsx`

- [ ] **Step 1: Прочитать текущий ChatWindow.tsx**

```bash
cat /Users/dim/vscodeproject/messenger/client/src/components/ChatWindow/ChatWindow.tsx
```

- [ ] **Step 2: Переписать компонент**

```tsx
// client/src/components/ChatWindow/ChatWindow.tsx
import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '@/store/chatStore'
import { useAuthStore } from '@/store/authStore'
import { api, setAccessToken } from '@/api/client'
import type { Message } from '@/types'
import { useMessengerWS } from '@/hooks/useMessengerWS'
import s from './ChatWindow.module.css'

interface Props {
  chatId: string
  onBack: () => void
}

export default function ChatWindow({ chatId, onBack }: Props) {
  const messages = useChatStore((st) => st.messages[chatId] ?? [])
  const chat = useChatStore((st) => st.chats.find((c) => c.id === chatId))
  const prependMessages = useChatStore((st) => st.prependMessages)
  const user = useAuthStore((st) => st.user)
  const accessToken = useAuthStore((st) => st.accessToken)
  const wsRef = useMessengerWS()
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Загрузить историю сообщений при открытии чата
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.getMessages(chatId).then((res) => {
      if (cancelled) return
      const msgs: Message[] = (res.messages ?? []).map((m: any) => ({
        id: m.id,
        chatId: m.chatId,
        senderId: m.senderId,
        encryptedPayload: m.encryptedPayload,
        senderKeyId: m.senderKeyId,
        text: m.encryptedPayload, // TODO: расшифровать через Double Ratchet
        timestamp: m.timestamp,
        status: m.read ? 'read' : m.delivered ? 'delivered' : 'sent',
        type: 'text',
      }))
      prependMessages(chatId, msgs.reverse())
    }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [chatId, prependMessages])

  // Скролл вниз при новых сообщениях
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const send = () => {
    const trimmed = text.trim()
    if (!trimmed || !wsRef.current) return
    // Отправить через WebSocket (ciphertext = plaintext пока не реализовано E2E)
    wsRef.current.sendMessage(chatId, [{
      userId: chat?.members.find((id) => id !== user?.id) ?? '',
      encryptedPayload: btoa(trimmed),
    }])
    setText('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <div className={s.root}>
      <header className={s.header}>
        <button className={s.backBtn} onClick={onBack} aria-label="Назад">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
          </svg>
        </button>
        <div className={s.info}>
          <span className={s.name}>{chat?.name ?? '...'}</span>
        </div>
      </header>

      <div className={s.messages}>
        {loading && <p className={s.hint}>Загрузка…</p>}
        {!loading && messages.length === 0 && (
          <p className={s.hint}>Нет сообщений. Напишите первым!</p>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} isMine={msg.senderId === user?.id} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className={s.inputRow}>
        <textarea
          className={s.input}
          placeholder="Сообщение…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button className={s.sendBtn} onClick={send} aria-label="Отправить" disabled={!text.trim()}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

function MessageBubble({ msg, isMine }: { msg: Message; isMine: boolean }) {
  const text = msg.text ?? msg.encryptedPayload
  return (
    <div className={`${s.bubble} ${isMine ? s.mine : s.theirs}`}>
      <span className={s.bubbleText}>{text}</span>
      <span className={s.bubbleTime}>
        {new Date(msg.timestamp).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  )
}
```

- [ ] **Step 3: Добавить sendMessage в MessengerWS**

В `client/src/api/websocket.ts` найти класс `MessengerWS` и убедиться что есть метод `sendMessage`. Если нет — добавить:

```ts
sendMessage(chatId: string, recipients: Array<{ userId: string; encryptedPayload: string }>) {
  this.send({ type: 'message', chatId, recipients })
}
```

- [ ] **Step 4: Обновить ChatWindow.module.css**

Добавить стили (или заменить если они не подходят):

```css
.root {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  background: #0b141a;
}

.header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: #1f2c34;
  flex-shrink: 0;
}

.backBtn {
  background: none;
  border: none;
  color: #8696a0;
  cursor: pointer;
  padding: 4px;
  display: flex;
}

.info { flex: 1; }
.name { color: #e9edef; font-size: 16px; font-weight: 600; }

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hint { color: #8696a0; text-align: center; font-size: 14px; margin: auto; }

.bubble {
  max-width: 75%;
  padding: 7px 12px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  word-break: break-word;
}

.mine {
  align-self: flex-end;
  background: #005c4b;
  border-bottom-right-radius: 2px;
}

.theirs {
  align-self: flex-start;
  background: #1f2c34;
  border-bottom-left-radius: 2px;
}

.bubbleText { color: #e9edef; font-size: 15px; line-height: 1.4; }

.bubbleTime {
  color: #8696a0;
  font-size: 11px;
  align-self: flex-end;
}

.inputRow {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 12px;
  background: #1f2c34;
  flex-shrink: 0;
}

.input {
  flex: 1;
  padding: 10px 14px;
  background: #2a3942;
  border: none;
  border-radius: 20px;
  color: #e9edef;
  font-size: 15px;
  resize: none;
  outline: none;
  max-height: 120px;
  line-height: 1.4;
}
.input::placeholder { color: #8696a0; }

.sendBtn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #00a884;
  border: none;
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s;
}
.sendBtn:hover { background: #06cf9c; }
.sendBtn:disabled { background: #2a3942; color: #8696a0; cursor: default; }
```

---

## Task 12: Финальная пересборка и проверка

- [ ] **Step 1: Пересобрать Docker-образ**

```bash
cd /Users/dim/vscodeproject/messenger
docker compose up --build -d
```

- [ ] **Step 2: Проверить что сервер запустился**

```bash
docker logs messenger --tail=5
```
Ожидаем: `listening on :8080`

- [ ] **Step 3: Сценарий проверки**

1. Открыть `http://192.168.1.80:8080` в браузере
2. Зарегистрировать двух пользователей (alice / password123 / Алиса) и (bob / password123 / Боб) в двух вкладках
3. У Алисы нажать «+» → ввести «bob» → нажать на Боба → открылся чат
4. Написать сообщение → оно появилось у Алисы
5. В вкладке Боба нажать «+» → открыть чат с Алисой → видит то же сообщение

---

## Порядок выполнения

```
Task 1  → Task 2 → Task 3 → Task 4 → Task 5   (Backend — можно параллельно 1-3)
Task 6  → Task 7 → Task 8 → Task 9 → Task 10  (Frontend)
Task 11 → Task 12                               (UI чата + финальная сборка)
```

Tasks 1–3 независимы между собой и могут быть выполнены параллельно тремя агентами.
