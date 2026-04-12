# Multi-Server Support & Admin Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить настраиваемый URL сервера в клиент (браузер + standalone), систему инвайтов и одобрения регистрации, панель администратора для управления пользователями и сброса паролей.

**Architecture:** Bootstrap-администратор задаётся в config.yaml при установке. Роль (`admin`/`user`) хранится в таблице `users` и встраивается в JWT-claims. Клиент хранит URL сервера в localStorage; при первом запуске показывает экран `/setup`. Панель администратора — отдельный роут `/admin`, защищён проверкой роли на клиенте и на сервере (middleware).

**Tech Stack:** Go 1.21, chi router, SQLite (modernc), golang-jwt/v5, bcrypt; React 18, Zustand, React Router v6, Vite/TypeScript.

---

## Карта файлов

### Создаются
| Файл | Ответственность |
|------|----------------|
| `server/internal/serverinfo/handler.go` | GET /api/server/info |
| `server/internal/admin/handler.go` | Все /api/admin/* хендлеры |
| `server/internal/admin/middleware.go` | requireAdmin middleware |
| `client/src/config/serverConfig.ts` | Хранение URL сервера в localStorage |
| `client/src/pages/ServerSetupPage.tsx` | Экран ввода адреса сервера |
| `client/src/pages/AdminPage.tsx` | Панель администратора (4 вкладки) |

### Изменяются
| Файл | Что меняется |
|------|-------------|
| `server/db/schema.go` | 3 новые таблицы + `role` в `users` |
| `server/db/migrate.go` | Миграции 9–12 для существующих БД |
| `server/db/queries.go` | `User.Role`, новые запросы |
| `server/cmd/server/config.go` | 5 новых полей конфига |
| `server/cmd/server/main.go` | Bootstrap admin, новые роуты |
| `server/internal/auth/middleware.go` | Роль в контексте |
| `server/internal/auth/handler.go` | Роль в JWT, инвайты, request-register, password-reset-request |
| `client/src/types/index.ts` | `User.role`, `ServerInfo` |
| `client/src/store/authStore.ts` | Поле `role` |
| `client/src/api/client.ts` | `BASE` через `getServerUrl()` |
| `client/src/api/websocket.ts` | WS base через `getServerUrl()` |
| `client/src/App.tsx` | Роут `/setup`, `/admin` |
| `client/src/pages/AuthPage.tsx` | Invite / approval / forgot-password |
| `client/src/components/Profile/Profile.tsx` | Кнопка "Сменить сервер", ссылка "Админ-панель" |

---

### Task 1: DB schema — новые таблицы и поле role

**Files:**
- Modify: `server/db/schema.go`
- Modify: `server/db/migrate.go`

- [ ] **Step 1: Добавить новые таблицы в schema.go**

В `server/db/schema.go` добавить в конец константы `schema` (перед закрывающим backtick):

```go
-- Роль пользователя: admin/user (DEFAULT 'user')
-- Также добавляется через миграцию 9 для существующих БД

CREATE TABLE IF NOT EXISTS invite_codes (
    code        TEXT PRIMARY KEY,
    created_by  TEXT NOT NULL REFERENCES users(id),
    used_by     TEXT REFERENCES users(id),
    used_at     INTEGER,
    expires_at  INTEGER,
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS registration_requests (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    ik_public     TEXT NOT NULL,
    spk_id        INTEGER NOT NULL,
    spk_public    TEXT NOT NULL,
    spk_signature TEXT NOT NULL,
    opk_publics   TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',
    created_at    INTEGER NOT NULL,
    reviewed_at   INTEGER,
    reviewed_by   TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS password_reset_requests (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id),
    status       TEXT NOT NULL DEFAULT 'pending',
    temp_password TEXT,
    created_at   INTEGER NOT NULL,
    resolved_at  INTEGER,
    resolved_by  TEXT REFERENCES users(id)
);
```

А в объявление таблицы `users` добавить строку `role TEXT NOT NULL DEFAULT 'user',` после `password_hash`:

```go
const schema = `
CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    username     TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role         TEXT NOT NULL DEFAULT 'user',
    created_at   INTEGER NOT NULL
);
// ... остальное без изменений
```

- [ ] **Step 2: Добавить миграции в migrate.go**

В `server/db/migrate.go` добавить в конец слайса `migrations`:

```go
// Migration 9: роль пользователя
{ID: 9, SQL: `ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`},
// Migration 10-12: новые таблицы (CREATE IF NOT EXISTS — идемпотентны)
{ID: 10, SQL: `CREATE TABLE IF NOT EXISTS invite_codes (
    code        TEXT PRIMARY KEY,
    created_by  TEXT NOT NULL REFERENCES users(id),
    used_by     TEXT REFERENCES users(id),
    used_at     INTEGER,
    expires_at  INTEGER,
    created_at  INTEGER NOT NULL
)`},
{ID: 11, SQL: `CREATE TABLE IF NOT EXISTS registration_requests (
    id            TEXT PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    ik_public     TEXT NOT NULL,
    spk_id        INTEGER NOT NULL,
    spk_public    TEXT NOT NULL,
    spk_signature TEXT NOT NULL,
    opk_publics   TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',
    created_at    INTEGER NOT NULL,
    reviewed_at   INTEGER,
    reviewed_by   TEXT REFERENCES users(id)
)`},
{ID: 12, SQL: `CREATE TABLE IF NOT EXISTS password_reset_requests (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id),
    status       TEXT NOT NULL DEFAULT 'pending',
    temp_password TEXT,
    created_at   INTEGER NOT NULL,
    resolved_at  INTEGER,
    resolved_by  TEXT REFERENCES users(id)
)`},
```

- [ ] **Step 3: Проверить что сервер собирается**

```bash
cd server && go build ./...
```
Ожидается: успешная сборка, нет ошибок.

- [ ] **Step 4: Commit**

```bash
git add server/db/schema.go server/db/migrate.go
git commit -m "feat(db): add role column and admin tables (migrations 9-12)"
```

---

### Task 2: DB queries — обновить User и добавить новые запросы

**Files:**
- Modify: `server/db/queries.go`

- [ ] **Step 1: Добавить Role к структуре User и обновить SELECT**

В `server/db/queries.go` обновить структуру `User`:

```go
type User struct {
    ID           string
    Username     string
    DisplayName  string
    PasswordHash string
    Role         string
    CreatedAt    int64
}
```

Обновить `CreateUser`:

```go
func CreateUser(db *sql.DB, u User) error {
    _, err := db.Exec(
        `INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?,?)`,
        u.ID, u.Username, u.DisplayName, u.PasswordHash, u.Role, u.CreatedAt,
    )
    return err
}
```

Обновить `GetUserByUsername` и `GetUserByID` — добавить `role` в SELECT и Scan:

```go
func GetUserByUsername(db *sql.DB, username string) (*User, error) {
    u := &User{}
    err := db.QueryRow(
        `SELECT id, username, display_name, password_hash, role, created_at FROM users WHERE username=?`, username,
    ).Scan(&u.ID, &u.Username, &u.DisplayName, &u.PasswordHash, &u.Role, &u.CreatedAt)
    if err == sql.ErrNoRows {
        return nil, nil
    }
    return u, err
}

func GetUserByID(db *sql.DB, id string) (*User, error) {
    u := &User{}
    err := db.QueryRow(
        `SELECT id, username, display_name, password_hash, role, created_at FROM users WHERE id=?`, id,
    ).Scan(&u.ID, &u.Username, &u.DisplayName, &u.PasswordHash, &u.Role, &u.CreatedAt)
    if err == sql.ErrNoRows {
        return nil, nil
    }
    return u, err
}
```

- [ ] **Step 2: Добавить запросы для InviteCode**

В конец `server/db/queries.go` добавить:

```go
// ─── InviteCodes ─────────────────────────────────────────────────────────────

type InviteCode struct {
    Code      string
    CreatedBy string
    UsedBy    string
    UsedAt    int64
    ExpiresAt int64
    CreatedAt int64
}

func CreateInviteCode(db *sql.DB, code InviteCode) error {
    _, err := db.Exec(
        `INSERT INTO invite_codes (code, created_by, expires_at, created_at) VALUES (?,?,?,?)`,
        code.Code, code.CreatedBy, code.ExpiresAt, code.CreatedAt,
    )
    return err
}

func GetInviteCode(db *sql.DB, code string) (*InviteCode, error) {
    c := &InviteCode{}
    err := db.QueryRow(
        `SELECT code, created_by, COALESCE(used_by,''), COALESCE(used_at,0), COALESCE(expires_at,0), created_at FROM invite_codes WHERE code=?`, code,
    ).Scan(&c.Code, &c.CreatedBy, &c.UsedBy, &c.UsedAt, &c.ExpiresAt, &c.CreatedAt)
    if err == sql.ErrNoRows {
        return nil, nil
    }
    return c, err
}

func UseInviteCode(db *sql.DB, code, usedBy string, usedAt int64) error {
    _, err := db.Exec(
        `UPDATE invite_codes SET used_by=?, used_at=? WHERE code=? AND used_by IS NULL`,
        usedBy, usedAt, code,
    )
    return err
}

func ListInviteCodes(db *sql.DB) ([]InviteCode, error) {
    rows, err := db.Query(
        `SELECT code, created_by, COALESCE(used_by,''), COALESCE(used_at,0), COALESCE(expires_at,0), created_at FROM invite_codes ORDER BY created_at DESC`,
    )
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    var codes []InviteCode
    for rows.Next() {
        var c InviteCode
        if err := rows.Scan(&c.Code, &c.CreatedBy, &c.UsedBy, &c.UsedAt, &c.ExpiresAt, &c.CreatedAt); err != nil {
            return nil, err
        }
        codes = append(codes, c)
    }
    return codes, rows.Err()
}
```

- [ ] **Step 3: Добавить запросы для RegistrationRequest**

```go
// ─── RegistrationRequests ────────────────────────────────────────────────────

type RegistrationRequest struct {
    ID           string
    Username     string
    DisplayName  string
    IKPublic     string
    SPKId        int
    SPKPublic    string
    SPKSignature string
    OPKPublics   string // JSON array
    PasswordHash string
    Status       string
    CreatedAt    int64
    ReviewedAt   int64
    ReviewedBy   string
}

func CreateRegistrationRequest(db *sql.DB, r RegistrationRequest) error {
    _, err := db.Exec(
        `INSERT INTO registration_requests (id, username, display_name, ik_public, spk_id, spk_public, spk_signature, opk_publics, password_hash, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        r.ID, r.Username, r.DisplayName, r.IKPublic, r.SPKId, r.SPKPublic, r.SPKSignature, r.OPKPublics, r.PasswordHash, r.Status, r.CreatedAt,
    )
    return err
}

func GetRegistrationRequest(db *sql.DB, id string) (*RegistrationRequest, error) {
    r := &RegistrationRequest{}
    err := db.QueryRow(
        `SELECT id, username, display_name, ik_public, spk_id, spk_public, spk_signature, opk_publics, password_hash, status, created_at, COALESCE(reviewed_at,0), COALESCE(reviewed_by,'') FROM registration_requests WHERE id=?`, id,
    ).Scan(&r.ID, &r.Username, &r.DisplayName, &r.IKPublic, &r.SPKId, &r.SPKPublic, &r.SPKSignature, &r.OPKPublics, &r.PasswordHash, &r.Status, &r.CreatedAt, &r.ReviewedAt, &r.ReviewedBy)
    if err == sql.ErrNoRows {
        return nil, nil
    }
    return r, err
}

func ListRegistrationRequests(db *sql.DB, status string) ([]RegistrationRequest, error) {
    var rows *sql.Rows
    var err error
    if status == "" {
        rows, err = db.Query(`SELECT id, username, display_name, status, created_at FROM registration_requests ORDER BY created_at DESC`)
    } else {
        rows, err = db.Query(`SELECT id, username, display_name, status, created_at FROM registration_requests WHERE status=? ORDER BY created_at DESC`, status)
    }
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    var reqs []RegistrationRequest
    for rows.Next() {
        var r RegistrationRequest
        if err := rows.Scan(&r.ID, &r.Username, &r.DisplayName, &r.Status, &r.CreatedAt); err != nil {
            return nil, err
        }
        reqs = append(reqs, r)
    }
    return reqs, rows.Err()
}

func UpdateRegistrationRequestStatus(db *sql.DB, id, status, reviewedBy string, reviewedAt int64) error {
    _, err := db.Exec(
        `UPDATE registration_requests SET status=?, reviewed_by=?, reviewed_at=? WHERE id=?`,
        status, reviewedBy, reviewedAt, id,
    )
    return err
}
```

- [ ] **Step 4: Добавить запросы для PasswordResetRequest и ListUsers**

```go
// ─── PasswordResetRequests ───────────────────────────────────────────────────

type PasswordResetRequest struct {
    ID           string
    UserID       string
    Username     string // JOIN из users
    Status       string
    TempPassword string
    CreatedAt    int64
    ResolvedAt   int64
    ResolvedBy   string
}

func CreatePasswordResetRequest(db *sql.DB, id, userID string, createdAt int64) error {
    _, err := db.Exec(
        `INSERT INTO password_reset_requests (id, user_id, status, created_at) VALUES (?,?,'pending',?)`,
        id, userID, createdAt,
    )
    return err
}

func ListPasswordResetRequests(db *sql.DB, status string) ([]PasswordResetRequest, error) {
    query := `SELECT p.id, p.user_id, u.username, p.status, COALESCE(p.temp_password,''), p.created_at, COALESCE(p.resolved_at,0), COALESCE(p.resolved_by,'')
              FROM password_reset_requests p JOIN users u ON u.id=p.user_id`
    var args []any
    if status != "" {
        query += ` WHERE p.status=?`
        args = append(args, status)
    }
    query += ` ORDER BY p.created_at DESC`
    rows, err := db.Query(query, args...)
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    var reqs []PasswordResetRequest
    for rows.Next() {
        var r PasswordResetRequest
        if err := rows.Scan(&r.ID, &r.UserID, &r.Username, &r.Status, &r.TempPassword, &r.CreatedAt, &r.ResolvedAt, &r.ResolvedBy); err != nil {
            return nil, err
        }
        reqs = append(reqs, r)
    }
    return reqs, rows.Err()
}

func ResolvePasswordResetRequest(db *sql.DB, id, tempPassword, resolvedBy string, resolvedAt int64) error {
    _, err := db.Exec(
        `UPDATE password_reset_requests SET status='completed', temp_password=?, resolved_by=?, resolved_at=? WHERE id=?`,
        tempPassword, resolvedBy, resolvedAt, id,
    )
    return err
}

// ─── Admin user list ─────────────────────────────────────────────────────────

func ListUsers(db *sql.DB) ([]User, error) {
    rows, err := db.Query(`SELECT id, username, display_name, role, created_at FROM users ORDER BY created_at DESC`)
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    var users []User
    for rows.Next() {
        var u User
        if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.Role, &u.CreatedAt); err != nil {
            return nil, err
        }
        users = append(users, u)
    }
    return users, rows.Err()
}

func EnsureAdminUser(database *sql.DB, username, passwordHash string) error {
    existing, _ := GetUserByUsername(database, username)
    if existing != nil {
        return nil // уже существует, не перезаписываем
    }
    u := User{
        ID:           newUUID(),
        Username:     username,
        DisplayName:  username,
        PasswordHash: passwordHash,
        Role:         "admin",
        CreatedAt:    timeNowMilli(),
    }
    return CreateUser(database, u)
}
```

Для `newUUID()` и `timeNowMilli()` — добавить в конец `queries.go`:

```go
// ─── helpers ─────────────────────────────────────────────────────────────────

import (
    "github.com/google/uuid"
    "time"
)

func newUUID() string { return uuid.New().String() }
func timeNowMilli() int64 { return time.Now().UnixMilli() }
```

**Важно:** эти импорты добавить в блок `import` в начале файла, а не в конец:

```go
import (
    "database/sql"
    "fmt"
    "time"

    "github.com/google/uuid"
)
```

- [ ] **Step 5: Проверить сборку**

```bash
cd server && go build ./...
```
Ожидается: успешная сборка.

- [ ] **Step 6: Commit**

```bash
git add server/db/queries.go
git commit -m "feat(db): add User.Role, InviteCode, RegistrationRequest, PasswordReset queries"
```

---

### Task 3: Config — новые поля и bootstrap admin

**Files:**
- Modify: `server/cmd/server/config.go`
- Modify: `server/cmd/server/main.go`

- [ ] **Step 1: Добавить новые поля в Config**

В `server/cmd/server/config.go` добавить в структуру `Config`:

```go
type Config struct {
    // ... существующие поля ...
    ServerName        string `yaml:"server_name"`
    ServerDescription string `yaml:"server_description"`
    RegistrationMode  string `yaml:"registration_mode"` // open|invite|approval
    AdminUsername     string `yaml:"admin_username"`
    AdminPassword     string `yaml:"admin_password"`
}
```

В функции `defaults()` добавить:

```go
func defaults() Config {
    return Config{
        Port:             "8080",
        DBPath:           "./messenger.db",
        MediaDir:         "./media",
        STUNUrl:          "stun:stun.l.google.com:19302",
        TURNCredTTL:      86400,
        ServerName:       "Messenger",
        RegistrationMode: "open",
    }
}
```

В функции `loadConfig` добавить в конец блока env-переменных:

```go
if v := os.Getenv("SERVER_NAME"); v != "" {
    cfg.ServerName = v
}
if v := os.Getenv("SERVER_DESCRIPTION"); v != "" {
    cfg.ServerDescription = v
}
if v := os.Getenv("REGISTRATION_MODE"); v != "" {
    cfg.RegistrationMode = v
}
if v := os.Getenv("ADMIN_USERNAME"); v != "" {
    cfg.AdminUsername = v
}
if v := os.Getenv("ADMIN_PASSWORD"); v != "" {
    cfg.AdminPassword = v
}
```

- [ ] **Step 2: Bootstrap admin в main.go**

В `server/cmd/server/main.go` после строки `database, err := db.Open(cfg.DBPath)` добавить:

```go
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
```

Добавить импорт `"golang.org/x/crypto/bcrypt"` в блок импортов `main.go`.

- [ ] **Step 3: Обновить config.yaml.example**

В `server/config.yaml.example` добавить:

```yaml
# Метаданные сервера (отображаются клиентам при подключении)
server_name: "My Messenger"
server_description: "Корпоративный мессенджер"
registration_mode: "open"   # open | invite | approval

# Начальный администратор (создаётся при первом запуске)
# После создания учётной записи эти строки можно удалить или оставить пустыми
admin_username: "admin"
admin_password: "changeme"
```

- [ ] **Step 4: Сборка и проверка**

```bash
cd server && go build ./...
```

- [ ] **Step 5: Commit**

```bash
git add server/cmd/server/config.go server/cmd/server/main.go server/config.yaml.example
git commit -m "feat(config): server metadata, registration mode, bootstrap admin"
```

---

### Task 4: Server info endpoint

**Files:**
- Create: `server/internal/serverinfo/handler.go`
- Modify: `server/cmd/server/main.go`

- [ ] **Step 1: Создать handler**

Создать файл `server/internal/serverinfo/handler.go`:

```go
package serverinfo

import (
    "encoding/json"
    "net/http"
)

type Handler struct {
    Name             string
    Description      string
    RegistrationMode string
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]string{
        "name":             h.Name,
        "description":      h.Description,
        "registrationMode": h.RegistrationMode,
    })
}
```

- [ ] **Step 2: Зарегистрировать роут в main.go**

В `server/cmd/server/main.go` добавить импорт:

```go
"github.com/messenger/server/internal/serverinfo"
```

Добавить инициализацию хендлера после других хендлеров:

```go
serverInfoHandler := &serverinfo.Handler{
    Name:             cfg.ServerName,
    Description:      cfg.ServerDescription,
    RegistrationMode: cfg.RegistrationMode,
}
```

В блоке `r.Route("/api", ...)`, до закрывающей скобки, добавить:

```go
r.Get("/server/info", serverInfoHandler.ServeHTTP)
```

- [ ] **Step 3: Проверить сборку**

```bash
cd server && go build ./...
```

- [ ] **Step 4: Запустить сервер и проверить эндпоинт**

```bash
cd server && JWT_SECRET=test ADMIN_USERNAME=admin ADMIN_PASSWORD=test123 go run ./cmd/server &
sleep 1
curl -s http://localhost:8080/api/server/info | python3 -m json.tool
kill %1
```

Ожидается: JSON с `name`, `description`, `registrationMode`.

- [ ] **Step 5: Commit**

```bash
git add server/internal/serverinfo/ server/cmd/server/main.go
git commit -m "feat(server): GET /api/server/info endpoint"
```

---

### Task 5: Auth — роль в JWT, инвайты, request-register, password-reset-request

**Files:**
- Modify: `server/internal/auth/middleware.go`
- Modify: `server/internal/auth/handler.go`

- [ ] **Step 1: Добавить RoleKey и RoleFromCtx в middleware.go**

В `server/internal/auth/middleware.go` добавить после `UserIDKey`:

```go
const RoleKey ctxKey = "role"

// RoleFromCtx возвращает роль пользователя из контекста запроса.
func RoleFromCtx(r *http.Request) string {
    role, _ := r.Context().Value(RoleKey).(string)
    if role == "" {
        return "user"
    }
    return role
}
```

В функции `Middleware` после строки `userID, _ := claims["sub"].(string)` добавить:

```go
role, _ := claims["role"].(string)
if role == "" {
    role = "user"
}
ctx := context.WithValue(r.Context(), UserIDKey, userID)
ctx = context.WithValue(ctx, RoleKey, role)
next.ServeHTTP(w, r.WithContext(ctx))
```

(Удалить старую строку `ctx := context.WithValue(r.Context(), UserIDKey, userID)`)

- [ ] **Step 2: Добавить role в issueTokens**

В `server/internal/auth/handler.go` изменить сигнатуру `issueTokens`:

```go
func (h *Handler) issueTokens(w http.ResponseWriter, r *http.Request, userID, username, displayName, role string) (map[string]any, error) {
```

В теле функции добавить `"role": role` в JWT claims:

```go
access, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
    "sub":  userID,
    "name": username,
    "role": role,
    "exp":  time.Now().Add(15 * time.Minute).Unix(),
    "iat":  time.Now().Unix(),
}).SignedString(h.JWTSecret)
```

Также обновить возвращаемый map для включения роли:

```go
return map[string]any{
    "accessToken": access,
    "userId":      userID,
    "username":    username,
    "displayName": displayName,
    "role":        role,
}, nil
```

- [ ] **Step 3: Обновить вызовы issueTokens**

В методе `Register` изменить вызов:

```go
resp, err := h.issueTokens(w, r, user.ID, user.Username, user.DisplayName, "user")
```

В методе `Login` — сначала получаем роль пользователя (она уже есть в `user.Role`), затем:

```go
resp, err := h.issueTokens(w, r, user.ID, user.Username, user.DisplayName, user.Role)
```

В методе `Refresh` после `user, _ := db.GetUserByID(...)`:

```go
resp, err := h.issueTokens(w, r, user.ID, user.Username, user.DisplayName, user.Role)
```

- [ ] **Step 4: Добавить поле RegistrationMode в Handler и InviteCode валидацию в Register**

Добавить `RegistrationMode` и `JWTSecret` в `Handler`:

```go
type Handler struct {
    DB               *sql.DB
    JWTSecret        []byte
    RegistrationMode string // open|invite|approval
}
```

В начале метода `Register` добавить проверку режима регистрации:

```go
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
    var req struct {
        Username     string `json:"username"`
        DisplayName  string `json:"displayName"`
        Password     string `json:"password"`
        InviteCode   string `json:"inviteCode"`
        IKPublic     string `json:"ikPublic"`
        SPKId        int    `json:"spkId"`
        SPKPublic    string `json:"spkPublic"`
        SPKSignature string `json:"spkSignature"`
        OPKPublics   []struct {
            ID  int    `json:"id"`
            Key string `json:"key"`
        } `json:"opkPublics"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        httpErr(w, "invalid body", 400)
        return
    }
    if len(req.Username) < 3 || len(req.Password) < 8 {
        httpErr(w, "username>=3 chars, password>=8 chars", 400)
        return
    }

    // Проверка режима регистрации
    switch h.RegistrationMode {
    case "invite":
        if req.InviteCode == "" {
            httpErr(w, "invite code required", 403)
            return
        }
        code, _ := db.GetInviteCode(h.DB, req.InviteCode)
        if code == nil || code.UsedBy != "" {
            httpErr(w, "invalid or already used invite code", 403)
            return
        }
        if code.ExpiresAt > 0 && time.Now().UnixMilli() > code.ExpiresAt {
            httpErr(w, "invite code expired", 403)
            return
        }
    case "approval":
        httpErr(w, "registration requires admin approval, use /api/auth/request-register", 403)
        return
    }
    // "open" — без ограничений, продолжаем
```

После успешного создания пользователя, если был инвайт-код, отметить как использованный:

```go
    // После создания пользователя (после db.CreateUser)
    if h.RegistrationMode == "invite" && req.InviteCode != "" {
        _ = db.UseInviteCode(h.DB, req.InviteCode, user.ID, time.Now().UnixMilli())
    }
```

- [ ] **Step 5: Добавить хендлер RequestRegister**

```go
// RequestRegister принимает заявку на регистрацию (режим approval).
func (h *Handler) RequestRegister(w http.ResponseWriter, r *http.Request) {
    if h.RegistrationMode != "approval" {
        httpErr(w, "server does not use approval mode", 400)
        return
    }
    var req struct {
        Username     string `json:"username"`
        DisplayName  string `json:"displayName"`
        Password     string `json:"password"`
        IKPublic     string `json:"ikPublic"`
        SPKId        int    `json:"spkId"`
        SPKPublic    string `json:"spkPublic"`
        SPKSignature string `json:"spkSignature"`
        OPKPublics   []struct {
            ID  int    `json:"id"`
            Key string `json:"key"`
        } `json:"opkPublics"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        httpErr(w, "invalid body", 400)
        return
    }
    if len(req.Username) < 3 || len(req.Password) < 8 {
        httpErr(w, "username>=3 chars, password>=8 chars", 400)
        return
    }

    existing, _ := db.GetUserByUsername(h.DB, req.Username)
    if existing != nil {
        httpErr(w, "username taken", 409)
        return
    }

    hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
    if err != nil {
        httpErr(w, "server error", 500)
        return
    }

    opkJSON, _ := json.Marshal(req.OPKPublics)
    regReq := db.RegistrationRequest{
        ID:           uuid.New().String(),
        Username:     req.Username,
        DisplayName:  req.DisplayName,
        IKPublic:     req.IKPublic,
        SPKId:        req.SPKId,
        SPKPublic:    req.SPKPublic,
        SPKSignature: req.SPKSignature,
        OPKPublics:   string(opkJSON),
        PasswordHash: string(hash),
        Status:       "pending",
        CreatedAt:    time.Now().UnixMilli(),
    }
    if err := db.CreateRegistrationRequest(h.DB, regReq); err != nil {
        httpErr(w, "server error", 500)
        return
    }
    jsonReply(w, 202, map[string]string{"status": "pending", "message": "Registration request submitted, awaiting admin approval"})
}
```

- [ ] **Step 6: Добавить хендлер PasswordResetRequest**

```go
// PasswordResetRequest позволяет пользователю запросить сброс пароля через администратора.
func (h *Handler) PasswordResetRequest(w http.ResponseWriter, r *http.Request) {
    var req struct {
        Username string `json:"username"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        httpErr(w, "invalid body", 400)
        return
    }

    user, _ := db.GetUserByUsername(h.DB, req.Username)
    if user == nil {
        // Не раскрываем существование пользователя
        jsonReply(w, 202, map[string]string{"status": "pending"})
        return
    }

    if err := db.CreatePasswordResetRequest(h.DB, uuid.New().String(), user.ID, time.Now().UnixMilli()); err != nil {
        httpErr(w, "server error", 500)
        return
    }
    jsonReply(w, 202, map[string]string{"status": "pending"})
}
```

- [ ] **Step 7: Обновить инициализацию Handler в main.go**

В `server/cmd/server/main.go` изменить:

```go
authHandler := &auth.Handler{
    DB:               database,
    JWTSecret:        []byte(cfg.JWTSecret),
    RegistrationMode: cfg.RegistrationMode,
}
```

- [ ] **Step 8: Проверить сборку**

```bash
cd server && go build ./...
```

- [ ] **Step 9: Commit**

```bash
git add server/internal/auth/middleware.go server/internal/auth/handler.go server/cmd/server/main.go
git commit -m "feat(auth): role in JWT, invite validation, request-register, password-reset-request"
```

---

### Task 6: Admin package — middleware и хендлеры

**Files:**
- Create: `server/internal/admin/middleware.go`
- Create: `server/internal/admin/handler.go`

- [ ] **Step 1: Создать middleware requireAdmin**

Создать `server/internal/admin/middleware.go`:

```go
package admin

import (
    "encoding/json"
    "net/http"

    "github.com/messenger/server/internal/auth"
)

// RequireAdmin проверяет роль из JWT-контекста. Должен применяться после auth.Middleware.
func RequireAdmin(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        role := auth.RoleFromCtx(r)
        if role != "admin" {
            w.Header().Set("Content-Type", "application/json")
            w.WriteHeader(http.StatusForbidden)
            json.NewEncoder(w).Encode(map[string]string{"error": "forbidden"})
            return
        }
        next.ServeHTTP(w, r)
    })
}
```

- [ ] **Step 2: Создать admin handler**

Создать `server/internal/admin/handler.go`:

```go
package admin

import (
    "database/sql"
    "encoding/json"
    "net/http"
    "time"

    "github.com/go-chi/chi/v5"
    "github.com/google/uuid"
    "github.com/messenger/server/db"
    "github.com/messenger/server/internal/auth"
    "golang.org/x/crypto/bcrypt"
)

type Handler struct {
    DB *sql.DB
}

// ListRegistrationRequests — GET /api/admin/registration-requests?status=pending
func (h *Handler) ListRegistrationRequests(w http.ResponseWriter, r *http.Request) {
    status := r.URL.Query().Get("status")
    reqs, err := db.ListRegistrationRequests(h.DB, status)
    if err != nil {
        httpErr(w, "server error", 500)
        return
    }
    if reqs == nil {
        reqs = []db.RegistrationRequest{}
    }
    jsonReply(w, 200, map[string]any{"requests": reqs})
}

// ApproveRegistrationRequest — POST /api/admin/registration-requests/{id}/approve
func (h *Handler) ApproveRegistrationRequest(w http.ResponseWriter, r *http.Request) {
    id := chi.URLParam(r, "id")
    adminID := auth.UserIDFromCtx(r)

    req, _ := db.GetRegistrationRequest(h.DB, id)
    if req == nil {
        httpErr(w, "not found", 404)
        return
    }
    if req.Status != "pending" {
        httpErr(w, "request already reviewed", 409)
        return
    }

    // Создаём пользователя из заявки
    user := db.User{
        ID:           uuid.New().String(),
        Username:     req.Username,
        DisplayName:  req.DisplayName,
        PasswordHash: req.PasswordHash,
        Role:         "user",
        CreatedAt:    time.Now().UnixMilli(),
    }
    if err := db.CreateUser(h.DB, user); err != nil {
        httpErr(w, "server error", 500)
        return
    }

    _ = db.UpdateRegistrationRequestStatus(h.DB, id, "approved", adminID, time.Now().UnixMilli())
    jsonReply(w, 200, map[string]string{"status": "approved"})
}

// RejectRegistrationRequest — POST /api/admin/registration-requests/{id}/reject
func (h *Handler) RejectRegistrationRequest(w http.ResponseWriter, r *http.Request) {
    id := chi.URLParam(r, "id")
    adminID := auth.UserIDFromCtx(r)

    req, _ := db.GetRegistrationRequest(h.DB, id)
    if req == nil {
        httpErr(w, "not found", 404)
        return
    }
    _ = db.UpdateRegistrationRequestStatus(h.DB, id, "rejected", adminID, time.Now().UnixMilli())
    jsonReply(w, 200, map[string]string{"status": "rejected"})
}

// CreateInviteCode — POST /api/admin/invite-codes
func (h *Handler) CreateInviteCode(w http.ResponseWriter, r *http.Request) {
    adminID := auth.UserIDFromCtx(r)
    var body struct {
        ExpiresAt int64 `json:"expiresAt"` // Unix ms, 0 = no expiry
    }
    _ = json.NewDecoder(r.Body).Decode(&body)

    code := db.InviteCode{
        Code:      uuid.New().String()[:8],
        CreatedBy: adminID,
        ExpiresAt: body.ExpiresAt,
        CreatedAt: time.Now().UnixMilli(),
    }
    if err := db.CreateInviteCode(h.DB, code); err != nil {
        httpErr(w, "server error", 500)
        return
    }
    jsonReply(w, 201, map[string]any{"code": code.Code, "expiresAt": code.ExpiresAt})
}

// ListInviteCodes — GET /api/admin/invite-codes
func (h *Handler) ListInviteCodes(w http.ResponseWriter, r *http.Request) {
    codes, err := db.ListInviteCodes(h.DB)
    if err != nil {
        httpErr(w, "server error", 500)
        return
    }
    if codes == nil {
        codes = []db.InviteCode{}
    }
    jsonReply(w, 200, map[string]any{"codes": codes})
}

// ListUsers — GET /api/admin/users
func (h *Handler) ListUsers(w http.ResponseWriter, r *http.Request) {
    users, err := db.ListUsers(h.DB)
    if err != nil {
        httpErr(w, "server error", 500)
        return
    }
    if users == nil {
        users = []db.User{}
    }
    jsonReply(w, 200, map[string]any{"users": users})
}

// ResetUserPassword — POST /api/admin/users/{id}/reset-password
func (h *Handler) ResetUserPassword(w http.ResponseWriter, r *http.Request) {
    userID := chi.URLParam(r, "id")
    var body struct {
        NewPassword string `json:"newPassword"`
    }
    if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.NewPassword) < 8 {
        httpErr(w, "newPassword must be at least 8 characters", 400)
        return
    }

    hash, err := bcrypt.GenerateFromPassword([]byte(body.NewPassword), 12)
    if err != nil {
        httpErr(w, "server error", 500)
        return
    }
    if err := db.UpdateUserPassword(h.DB, userID, string(hash)); err != nil {
        httpErr(w, "server error", 500)
        return
    }
    w.WriteHeader(204)
}

// ListPasswordResetRequests — GET /api/admin/password-reset-requests?status=pending
func (h *Handler) ListPasswordResetRequests(w http.ResponseWriter, r *http.Request) {
    status := r.URL.Query().Get("status")
    reqs, err := db.ListPasswordResetRequests(h.DB, status)
    if err != nil {
        httpErr(w, "server error", 500)
        return
    }
    if reqs == nil {
        reqs = []db.PasswordResetRequest{}
    }
    jsonReply(w, 200, map[string]any{"requests": reqs})
}

// ResolvePasswordResetRequest — POST /api/admin/password-reset-requests/{id}/resolve
func (h *Handler) ResolvePasswordResetRequest(w http.ResponseWriter, r *http.Request) {
    id := chi.URLParam(r, "id")
    adminID := auth.UserIDFromCtx(r)
    var body struct {
        TempPassword string `json:"tempPassword"`
    }
    if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.TempPassword) < 8 {
        httpErr(w, "tempPassword must be at least 8 characters", 400)
        return
    }

    // Обновляем пароль в таблице users через PasswordResetRequests JOIN
    reqs, _ := db.ListPasswordResetRequests(h.DB, "")
    var targetUserID string
    for _, req := range reqs {
        if req.ID == id {
            targetUserID = req.UserID
            break
        }
    }
    if targetUserID == "" {
        httpErr(w, "not found", 404)
        return
    }

    hash, err := bcrypt.GenerateFromPassword([]byte(body.TempPassword), 12)
    if err != nil {
        httpErr(w, "server error", 500)
        return
    }
    _ = db.UpdateUserPassword(h.DB, targetUserID, string(hash))
    _ = db.ResolvePasswordResetRequest(h.DB, id, body.TempPassword, adminID, time.Now().UnixMilli())
    w.WriteHeader(204)
}

// ── helpers ───────────────────────────────────────────────────────────────────

func httpErr(w http.ResponseWriter, msg string, code int) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(code)
    json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func jsonReply(w http.ResponseWriter, code int, v any) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(code)
    json.NewEncoder(w).Encode(v)
}
```

- [ ] **Step 3: Зарегистрировать admin роуты в main.go**

В `server/cmd/server/main.go` добавить импорты:

```go
"github.com/messenger/server/internal/admin"
```

Добавить хендлер после других хендлеров:

```go
adminHandler := &admin.Handler{DB: database}
```

В блоке `r.Group(func(r chi.Router) {...})` (за `auth.Middleware`) добавить:

```go
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
```

Также добавить публичные роуты (до auth group):

```go
r.With(authLimiter.Middleware()).Post("/auth/request-register", authHandler.RequestRegister)
r.With(authLimiter.Middleware()).Post("/auth/password-reset-request", authHandler.PasswordResetRequest)
```

- [ ] **Step 4: Проверить сборку**

```bash
cd server && go build ./...
```

- [ ] **Step 5: Commit**

```bash
git add server/internal/admin/ server/cmd/server/main.go
git commit -m "feat(admin): admin middleware + all /api/admin/* handlers"
```

---

### Task 7: Client — types, serverConfig, authStore

**Files:**
- Modify: `client/src/types/index.ts`
- Create: `client/src/config/serverConfig.ts`
- Modify: `client/src/store/authStore.ts`

- [ ] **Step 1: Добавить role в User и тип ServerInfo**

В `client/src/types/index.ts` изменить интерфейс `User`:

```ts
export interface User {
  id: string
  username: string
  displayName: string
  avatarPath?: string
  identityKeyPublic: string
  role?: 'admin' | 'user'
  lastSeen?: number
  online?: boolean
}
```

Добавить новый интерфейс:

```ts
export interface ServerInfo {
  name: string
  description: string
  registrationMode: 'open' | 'invite' | 'approval'
}
```

- [ ] **Step 2: Создать serverConfig.ts**

Создать `client/src/config/serverConfig.ts`:

```ts
const STORAGE_KEY = 'serverUrl'

/** Нормализует URL: убирает trailing slash, приводит к строке. */
function normalize(url: string): string {
  return url.trim().replace(/\/$/, '')
}

export function getServerUrl(): string {
  return localStorage.getItem(STORAGE_KEY) ?? ''
}

export function setServerUrl(url: string): void {
  localStorage.setItem(STORAGE_KEY, normalize(url))
}

export function clearServerUrl(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function hasServerUrl(): boolean {
  return !!localStorage.getItem(STORAGE_KEY)
}

/**
 * При запуске из браузера (не standalone) автоматически устанавливает
 * текущий origin как адрес сервера.
 */
export function initServerUrl(): void {
  if (!hasServerUrl()) {
    setServerUrl(window.location.origin)
  }
}
```

- [ ] **Step 3: Обновить authStore.ts**

В `client/src/store/authStore.ts` изменить:

```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types'

interface AuthState {
  isAuthenticated: boolean
  currentUser: User | null
  accessToken: string | null
  role: 'admin' | 'user' | null
  login: (user: User, token: string) => void
  logout: () => void
  updateUser: (patch: Partial<User>) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      currentUser: null,
      accessToken: null,
      role: null,
      login: (user, token) =>
        set({ isAuthenticated: true, currentUser: user, accessToken: token, role: user.role ?? 'user' }),
      logout: () =>
        set({ isAuthenticated: false, currentUser: null, accessToken: null, role: null }),
      updateUser: (patch) =>
        set((s) =>
          s.currentUser ? { currentUser: { ...s.currentUser, ...patch } } : {}
        ),
    }),
    {
      name: 'auth',
      partialize: (s) => ({
        isAuthenticated: s.isAuthenticated,
        currentUser: s.currentUser,
        accessToken: s.accessToken,
        role: s.role,
      }),
    }
  )
)
```

- [ ] **Step 4: Type-check**

```bash
cd client && npm run type-check 2>&1 | head -30
```
Ожидается: 0 ошибок или только несвязанные.

- [ ] **Step 5: Commit**

```bash
git add client/src/types/index.ts client/src/config/serverConfig.ts client/src/store/authStore.ts
git commit -m "feat(client): ServerInfo type, serverConfig module, role in authStore"
```

---

### Task 8: Client API — BASE и WS через serverConfig

**Files:**
- Modify: `client/src/api/client.ts`
- Modify: `client/src/api/websocket.ts`

- [ ] **Step 1: Обновить client.ts**

В `client/src/api/client.ts` заменить строку:

```ts
const BASE = ''  // относительный путь — браузер подставляет текущий host автоматически
```

на:

```ts
import { getServerUrl } from '@/config/serverConfig'

function getBase(): string {
  const url = getServerUrl()
  // Если пустой (ещё не настроен) — используем относительный путь (fallback для браузера)
  return url || ''
}
```

Все вхождения `${BASE}` в файле заменить на `${getBase()}`. Поиск: строки `${BASE}/api/` и `${BASE}${path}`.

В функции `doRefresh`:

```ts
const res = await fetch(`${getBase()}/api/auth/refresh`, {
```

В функции `req`:

```ts
const response = await fetch(`${getBase()}${path}`, {
```

В функции `fetchMediaBlobUrl` и `fetchEncryptedMediaBlobUrl`:

```ts
let response = await fetch(`${getBase()}${path}`, { headers, credentials: 'include' })
// ...
response = await fetch(`${getBase()}${path}`, {
```

- [ ] **Step 2: Обновить websocket.ts**

В `client/src/api/websocket.ts` заменить функцию `getWsBase`:

```ts
import { getServerUrl } from '@/config/serverConfig'

function getWsBase(): string {
  const serverUrl = getServerUrl()
  if (!serverUrl) {
    // Fallback: текущий хост браузера
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}`
  }
  const url = new URL(serverUrl)
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${url.host}`
}
```

- [ ] **Step 3: Type-check**

```bash
cd client && npm run type-check 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add client/src/api/client.ts client/src/api/websocket.ts
git commit -m "feat(client): use serverConfig URL for API and WebSocket base"
```

---

### Task 9: App routing + ServerSetupPage

**Files:**
- Modify: `client/src/App.tsx`
- Create: `client/src/pages/ServerSetupPage.tsx`

- [ ] **Step 1: Создать ServerSetupPage.tsx**

Создать `client/src/pages/ServerSetupPage.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { setServerUrl, hasServerUrl } from '@/config/serverConfig'
import type { ServerInfo } from '@/types'
import s from './pages.module.css'

export default function ServerSetupPage() {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState<ServerInfo | null>(null)

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) { setError('Введите адрес сервера'); return }
    setLoading(true)
    setError('')
    setInfo(null)
    try {
      const normalized = url.trim().replace(/\/$/, '')
      const res = await fetch(`${normalized}/api/server/info`)
      if (!res.ok) throw new Error('Сервер не отвечает')
      const data = await res.json() as ServerInfo
      setInfo(data)
      setServerUrl(normalized)
    } catch {
      setError('Не удалось подключиться. Проверьте адрес сервера.')
    } finally {
      setLoading(false)
    }
  }

  const handleProceed = () => {
    navigate('/auth', { replace: true })
  }

  return (
    <div className={s.authPage}>
      <div className={s.card}>
        <h1 className={s.logo}>Messenger</h1>
        <p className={s.sub}>Введите адрес вашего сервера</p>

        <form onSubmit={handleConnect} className={s.form}>
          <input
            className={s.input}
            type="url"
            placeholder="https://myserver.com или http://192.168.1.10:8080"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoComplete="url"
          />
          {error && <p className={s.error} role="alert">{error}</p>}
          <button type="submit" className={s.btn} disabled={loading}>
            {loading ? 'Подключение…' : 'Подключиться'}
          </button>
        </form>

        {info && (
          <div className={s.serverCard}>
            <div className={s.serverName}>{info.name}</div>
            {info.description && <div className={s.serverDesc}>{info.description}</div>}
            <div className={s.serverMode}>
              Регистрация: {info.registrationMode === 'open' ? 'открытая' :
                            info.registrationMode === 'invite' ? 'по приглашению' : 'по заявке'}
            </div>
            <button className={s.btn} onClick={handleProceed}>
              Войти / Зарегистрироваться
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Добавить CSS классы в pages.module.css**

В `client/src/pages/pages.module.css` добавить:

```css
.serverCard {
  margin-top: 1rem;
  padding: 1rem;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  background: var(--surface-2, #f8fafc);
}

.serverName {
  font-weight: 600;
  font-size: 1rem;
  margin-bottom: 0.25rem;
}

.serverDesc {
  font-size: 0.875rem;
  color: var(--text-secondary, #64748b);
  margin-bottom: 0.5rem;
}

.serverMode {
  font-size: 0.75rem;
  color: var(--text-muted, #94a3b8);
  margin-bottom: 0.75rem;
}
```

- [ ] **Step 3: Обновить App.tsx**

В `client/src/App.tsx` добавить импорты:

```tsx
import { useEffect } from 'react'
import { initServerUrl, hasServerUrl } from '@/config/serverConfig'
import ServerSetupPage from '@/pages/ServerSetupPage'
import AdminPage from '@/pages/AdminPage'
```

Изменить функцию `AppRoutes`:

```tsx
function AppRoutes() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const role = useAuthStore((s) => s.role)

  useEffect(() => { initServerUrl() }, [])

  useMessengerWS()
  useOfflineSync()
  const initiateCall = useCallStore((s) => s._initiateCall) ?? undefined

  // Если URL сервера не задан — показываем setup
  if (!hasServerUrl()) {
    return (
      <Routes>
        <Route path="/setup" element={<ServerSetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    )
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/setup" element={<ServerSetupPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="*" element={<Navigate to="/auth" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/" element={<ChatListPage />} />
      <Route path="/chat/:chatId" element={<ChatWindowPage initiateCall={initiateCall} />} />
      <Route path="/profile" element={<ProfilePage />} />
      {role === 'admin' && <Route path="/admin" element={<AdminPage />} />}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
```

**Примечание:** `hasServerUrl()` в рендере работает синхронно из localStorage, поэтому `useEffect` для `initServerUrl` не вызывает перерендер после первого рендера — нужно проверить начальное состояние. Безопаснее вызвать `initServerUrl()` перед рендером (вне компонента):

```tsx
// В начале файла App.tsx (вне компонентов):
import { initServerUrl } from '@/config/serverConfig'
initServerUrl() // вызывается один раз при загрузке модуля
```

И убрать `useEffect` с `initServerUrl` из `AppRoutes`.

- [ ] **Step 4: Type-check**

```bash
cd client && npm run type-check 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/ServerSetupPage.tsx client/src/App.tsx client/src/pages/pages.module.css
git commit -m "feat(client): /setup route and ServerSetupPage"
```

---

### Task 10: AuthPage — invite, approval, forgot password

**Files:**
- Modify: `client/src/pages/AuthPage.tsx`

- [ ] **Step 1: Добавить чтение параметров URL и режима сервера**

В начале функции `AuthPage` добавить считывание `invite` из query params и получение режима сервера из authStore (или отдельного стора). Для простоты — запрашиваем `/api/server/info` при монтировании:

```tsx
import { useSearchParams } from 'react-router-dom'
import type { ServerInfo } from '@/types'
import { getServerUrl } from '@/config/serverConfig'

export default function AuthPage() {
  const login = useAuthStore((st) => st.login)
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<'login' | 'register' | 'forgot'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [inviteCode, setInviteCode] = useState(searchParams.get('invite') ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null)

  useEffect(() => {
    fetch(`${getServerUrl()}/api/server/info`)
      .then(r => r.json())
      .then(data => setServerInfo(data as ServerInfo))
      .catch(() => {})
  }, [])
```

- [ ] **Step 2: Добавить хендлер для режима approval**

Добавить функцию `handleRequestRegister`:

```tsx
const handleRequestRegister = async (e: React.FormEvent) => {
  e.preventDefault()
  if (!username.trim() || !password.trim() || !displayName.trim()) {
    setError('Заполните все поля')
    return
  }
  if (username.trim().length < 3) { setError('Логин минимум 3 символа'); return }
  if (password.length < 8) { setError('Пароль минимум 8 символов'); return }

  setLoading(true)
  setError('')

  try {
    await initSodium()

    const identityKey = generateIdentityKeyPair()
    const signedPreKey = generateDHKeyPair(1)
    const opks = Array.from({ length: OPK_COUNT }, (_, i) => generateDHKeyPair(i + 1))
    const spkSignature = signData(signedPreKey.publicKey, identityKey.privateKey)

    await saveIdentityKey(identityKey)
    await saveSignedPreKey(signedPreKey)
    await saveOneTimePreKeys(opks)

    const res = await fetch(`${getServerUrl()}/api/auth/request-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username.trim(),
        password,
        displayName: displayName.trim(),
        ikPublic: toBase64(identityKey.publicKey),
        spkId: signedPreKey.id,
        spkPublic: toBase64(signedPreKey.publicKey),
        spkSignature: toBase64(spkSignature),
        opkPublics: opks.map((k) => ({ id: k.id, key: toBase64(k.publicKey) })),
      }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Ошибка'); return }
    setSuccess('Заявка отправлена. Ожидайте одобрения администратора — войдите после получения уведомления.')
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Ошибка')
  } finally {
    setLoading(false)
  }
}
```

- [ ] **Step 3: Добавить хендлер forgot password**

```tsx
const handleForgotPassword = async (e: React.FormEvent) => {
  e.preventDefault()
  if (!username.trim()) { setError('Введите логин'); return }
  setLoading(true)
  setError('')
  try {
    await fetch(`${getServerUrl()}/api/auth/password-reset-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim() }),
    })
    setSuccess('Запрос отправлен администратору. Получите временный пароль и войдите.')
  } catch {
    setError('Ошибка соединения')
  } finally {
    setLoading(false)
  }
}
```

- [ ] **Step 4: Обновить форму регистрации для invite режима**

В форме регистрации добавить поле инвайт-кода когда `serverInfo?.registrationMode === 'invite'`:

```tsx
{serverInfo?.registrationMode === 'invite' && (
  <input
    className={s.input}
    type="text"
    placeholder="Инвайт-код"
    value={inviteCode}
    onChange={(e) => setInviteCode(e.target.value)}
  />
)}
```

В `handleRegister` добавить `inviteCode` в тело запроса к `/api/auth/register`:

```tsx
const { userId, accessToken } = await api.register({
  username: username.trim(),
  password,
  displayName: displayName.trim(),
  ikPublic: toBase64(identityKey.publicKey),
  spkId: signedPreKey.id,
  spkPublic: toBase64(signedPreKey.publicKey),
  spkSignature: toBase64(spkSignature),
  opkPublics: opks.map((k) => ({ id: k.id, key: toBase64(k.publicKey) })),
  // @ts-ignore — временно до обновления типов api
  inviteCode: inviteCode || undefined,
})
```

Также добавить тип `inviteCode?: string` в `AuthRegisterReq` в `client/src/api/client.ts`.

- [ ] **Step 5: Обновить JSX рендер**

Изменить секцию регистрации в JSX — вместо прямой формы выбирать поведение по режиму:

```tsx
{tab === 'register' && serverInfo?.registrationMode === 'approval' ? (
  // Форма заявки
  success ? (
    <p className={s.success}>{success}</p>
  ) : (
    <form onSubmit={handleRequestRegister} className={s.form}>
      {/* поля: username, password, displayName */}
      ...
      <button type="submit" className={s.btn} disabled={loading}>
        {loading ? 'Отправка…' : 'Отправить заявку'}
      </button>
    </form>
  )
) : tab === 'forgot' ? (
  success ? (
    <p className={s.success}>{success}</p>
  ) : (
    <form onSubmit={handleForgotPassword} className={s.form}>
      <input className={s.input} type="text" placeholder="Логин (username)"
        value={username} onChange={(e) => setUsername(e.target.value)} />
      {error && <p className={s.error} role="alert">{error}</p>}
      <button type="submit" className={s.btn} disabled={loading}>
        {loading ? 'Отправка…' : 'Запросить сброс пароля'}
      </button>
      <button type="button" className={s.link} onClick={() => { setTab('login'); setError(''); setSuccess('') }}>
        Назад к входу
      </button>
    </form>
  )
) : (
  // tab === 'login' — существующая форма входа без изменений (из исходного AuthPage.tsx)
  // tab === 'register' в режиме open/invite — существующая форма handleRegister,
  // добавить только поле inviteCode из Step 4 когда registrationMode === 'invite'
  // Вставить сюда соответствующий JSX из текущего AuthPage.tsx (строки ~118-196)
)}
```

Добавить вкладку "Забыл пароль" в список вкладок:

```tsx
<div className={s.tabs}>
  <button className={...} onClick={() => { setTab('login'); setError('') }}>Войти</button>
  <button className={...} onClick={() => { setTab('register'); setError('') }}>Регистрация</button>
</div>
// Под формой входа добавить:
{tab === 'login' && (
  <button type="button" className={s.link}
    onClick={() => { setTab('forgot'); setError(''); setSuccess('') }}>
    Забыл пароль
  </button>
)}
```

В `pages.module.css` добавить:

```css
.link {
  background: none;
  border: none;
  color: var(--primary, #3b82f6);
  cursor: pointer;
  font-size: 0.875rem;
  padding: 0.25rem;
  text-decoration: underline;
}

.success {
  color: var(--success, #22c55e);
  font-size: 0.875rem;
  text-align: center;
  padding: 0.5rem;
}
```

- [ ] **Step 6: Обновить тип AuthRegisterReq в client.ts**

```ts
export interface AuthRegisterReq {
  username: string
  password: string
  displayName: string
  ikPublic: string
  spkId: number
  spkPublic: string
  spkSignature: string
  opkPublics: Array<{ id: number; key: string }>
  inviteCode?: string
}
```

- [ ] **Step 7: Type-check + lint**

```bash
cd client && npm run type-check 2>&1 | head -30
npm run lint 2>&1 | head -30
```

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/AuthPage.tsx client/src/api/client.ts client/src/pages/pages.module.css
git commit -m "feat(client): invite code, approval request, forgot password in AuthPage"
```

---

### Task 11: AdminPage — панель администратора

**Files:**
- Create: `client/src/pages/AdminPage.tsx`

- [ ] **Step 1: Создать AdminPage.tsx**

Создать `client/src/pages/AdminPage.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import s from './pages.module.css'

type Tab = 'requests' | 'users' | 'invites' | 'resets'

interface RegRequest { id: string; username: string; display_name: string; status: string; created_at: number }
interface AdminUser { id: string; username: string; display_name: string; role: string }
interface InviteCode { code: string; used_by: string; expires_at: number; created_at: number }
interface ResetRequest { id: string; user_id: string; username: string; status: string; created_at: number }

export default function AdminPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('requests')
  const [regRequests, setRegRequests] = useState<RegRequest[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [invites, setInvites] = useState<InviteCode[]>([])
  const [resets, setResets] = useState<ResetRequest[]>([])
  const [newPassword, setNewPassword] = useState<Record<string, string>>({})
  const [tempPasswords, setTempPasswords] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (tab === 'requests') {
        const data = await apiGet<{ requests: RegRequest[] }>('/api/admin/registration-requests?status=pending')
        setRegRequests(data.requests)
      } else if (tab === 'users') {
        const data = await apiGet<{ users: AdminUser[] }>('/api/admin/users')
        setUsers(data.users)
      } else if (tab === 'invites') {
        const data = await apiGet<{ codes: InviteCode[] }>('/api/admin/invite-codes')
        setInvites(data.codes)
      } else if (tab === 'resets') {
        const data = await apiGet<{ requests: ResetRequest[] }>('/api/admin/password-reset-requests?status=pending')
        setResets(data.requests)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { void load() }, [load])

  const approveRequest = async (id: string) => {
    await apiPost(`/api/admin/registration-requests/${id}/approve`, {})
    void load()
  }

  const rejectRequest = async (id: string) => {
    await apiPost(`/api/admin/registration-requests/${id}/reject`, {})
    void load()
  }

  const createInvite = async () => {
    await apiPost('/api/admin/invite-codes', {})
    void load()
  }

  const resetPassword = async (userId: string) => {
    const pwd = newPassword[userId]
    if (!pwd || pwd.length < 8) { alert('Пароль минимум 8 символов'); return }
    await apiPost(`/api/admin/users/${userId}/reset-password`, { newPassword: pwd })
    setNewPassword(p => ({ ...p, [userId]: '' }))
    alert('Пароль изменён')
  }

  const resolveReset = async (id: string) => {
    const tmp = tempPasswords[id]
    if (!tmp || tmp.length < 8) { alert('Временный пароль минимум 8 символов'); return }
    await apiPost(`/api/admin/password-reset-requests/${id}/resolve`, { tempPassword: tmp })
    setTempPasswords(p => ({ ...p, [id]: '' }))
    void load()
  }

  return (
    <div className={s.adminPage}>
      <div className={s.adminHeader}>
        <button className={s.backBtn} onClick={() => navigate('/')}>← Назад</button>
        <h2>Панель администратора</h2>
      </div>

      <div className={s.tabs}>
        {(['requests', 'users', 'invites', 'resets'] as Tab[]).map(t => (
          <button key={t} className={`${s.tab} ${tab === t ? s.tabActive : ''}`}
            onClick={() => setTab(t)}>
            {t === 'requests' ? 'Заявки' : t === 'users' ? 'Пользователи' : t === 'invites' ? 'Инвайты' : 'Сброс паролей'}
          </button>
        ))}
      </div>

      {error && <p className={s.error}>{error}</p>}
      {loading && <p>Загрузка…</p>}

      {!loading && tab === 'requests' && (
        <div className={s.adminList}>
          {regRequests.length === 0 && <p>Нет ожидающих заявок</p>}
          {regRequests.map(r => (
            <div key={r.id} className={s.adminItem}>
              <div><strong>{r.username}</strong> ({r.display_name})</div>
              <div className={s.adminItemDate}>{new Date(r.created_at).toLocaleString()}</div>
              <div className={s.adminItemActions}>
                <button className={s.btnSuccess} onClick={() => approveRequest(r.id)}>Одобрить</button>
                <button className={s.btnDanger} onClick={() => rejectRequest(r.id)}>Отклонить</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'users' && (
        <div className={s.adminList}>
          {users.map(u => (
            <div key={u.id} className={s.adminItem}>
              <div><strong>{u.username}</strong> <span className={s.badge}>{u.role}</span></div>
              <div className={s.adminItemActions}>
                <input className={s.inputSmall} type="password" placeholder="Новый пароль (мин. 8)"
                  value={newPassword[u.id] ?? ''}
                  onChange={e => setNewPassword(p => ({ ...p, [u.id]: e.target.value }))} />
                <button className={s.btnDanger} onClick={() => resetPassword(u.id)}>Сбросить пароль</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'invites' && (
        <div className={s.adminList}>
          <button className={s.btn} onClick={createInvite}>Создать инвайт-код</button>
          {invites.map(c => (
            <div key={c.code} className={`${s.adminItem} ${c.used_by ? s.used : ''}`}>
              <div><code>{c.code}</code> {c.used_by ? '✓ использован' : '⏳ активен'}</div>
              {!c.used_by && (
                <button className={s.btnSmall} onClick={() => {
                  const link = `${window.location.origin}/auth?invite=${c.code}`
                  void navigator.clipboard.writeText(link)
                  alert('Ссылка скопирована')
                }}>Копировать ссылку</button>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && tab === 'resets' && (
        <div className={s.adminList}>
          {resets.length === 0 && <p>Нет ожидающих запросов</p>}
          {resets.map(r => (
            <div key={r.id} className={s.adminItem}>
              <div><strong>{r.username}</strong></div>
              <div className={s.adminItemDate}>{new Date(r.created_at).toLocaleString()}</div>
              <div className={s.adminItemActions}>
                <input className={s.inputSmall} type="text" placeholder="Временный пароль (мин. 8)"
                  value={tempPasswords[r.id] ?? ''}
                  onChange={e => setTempPasswords(p => ({ ...p, [r.id]: e.target.value }))} />
                <button className={s.btnSuccess} onClick={() => resolveReset(r.id)}>Выдать пароль</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Вспомогательные функции (используют существующий fetch с токеном)
import { useAuthStore } from '@/store/authStore'
import { getServerUrl } from '@/config/serverConfig'

async function apiGet<T>(path: string): Promise<T> {
  const token = useAuthStore.getState().accessToken
  const res = await fetch(`${getServerUrl()}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    credentials: 'include',
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as {error?: string}).error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const token = useAuthStore.getState().accessToken
  const res = await fetch(`${getServerUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: 'include',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as {error?: string}).error ?? res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
```

**Примечание:** `apiGet`/`apiPost` используют прямой `fetch` вместо `api.ts` чтобы не создавать зависимость. В будущем можно вынести в `client.ts`.

- [ ] **Step 2: Добавить CSS для AdminPage в pages.module.css**

```css
.adminPage {
  max-width: 800px;
  margin: 0 auto;
  padding: 1rem;
}

.adminHeader {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.backBtn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--primary, #3b82f6);
}

.adminList {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 1rem;
}

.adminItem {
  padding: 0.75rem 1rem;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  background: var(--surface, #fff);
}

.adminItem.used {
  opacity: 0.5;
}

.adminItemDate {
  font-size: 0.75rem;
  color: var(--text-muted, #94a3b8);
  margin: 0.25rem 0;
}

.adminItemActions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-top: 0.5rem;
  flex-wrap: wrap;
}

.btnSuccess {
  background: var(--success, #22c55e);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 0.375rem 0.75rem;
  cursor: pointer;
  font-size: 0.875rem;
}

.btnDanger {
  background: var(--danger, #ef4444);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 0.375rem 0.75rem;
  cursor: pointer;
  font-size: 0.875rem;
}

.btnSmall {
  background: none;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 6px;
  padding: 0.25rem 0.5rem;
  cursor: pointer;
  font-size: 0.75rem;
}

.inputSmall {
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 6px;
  padding: 0.375rem 0.5rem;
  font-size: 0.875rem;
  flex: 1;
  min-width: 160px;
}

.badge {
  background: var(--primary, #3b82f6);
  color: #fff;
  border-radius: 4px;
  padding: 0.125rem 0.375rem;
  font-size: 0.75rem;
}
```

- [ ] **Step 3: Type-check**

```bash
cd client && npm run type-check 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/AdminPage.tsx client/src/pages/pages.module.css
git commit -m "feat(client): AdminPage with 4 tabs (requests, users, invites, resets)"
```

---

### Task 12: ProfilePage — кнопка смены сервера и ссылка на админ-панель

**Files:**
- Modify: `client/src/components/Profile/Profile.tsx`

- [ ] **Step 1: Прочитать текущий Profile.tsx**

Убедиться в структуре компонента:

```bash
head -80 client/src/components/Profile/Profile.tsx
```

- [ ] **Step 2: Добавить импорты и кнопки**

В `client/src/components/Profile/Profile.tsx` добавить импорты:

```tsx
import { useNavigate } from 'react-router-dom'
import { clearServerUrl } from '@/config/serverConfig'
import { useAuthStore } from '@/store/authStore'
import { api } from '@/api/client'
import { setAccessToken } from '@/api/client'
```

Добавить кнопку "Сменить сервер" (в секцию настроек профиля):

```tsx
const navigate = useNavigate()
const logout = useAuthStore((s) => s.logout)
const role = useAuthStore((s) => s.role)

const handleChangeServer = async () => {
  try { await api.logout() } catch { /* игнорируем */ }
  setAccessToken(null)
  logout()
  clearServerUrl()
  navigate('/setup', { replace: true })
}
```

В JSX добавить кнопки (в конце компонента, до закрывающего тега):

```tsx
{role === 'admin' && (
  <button className={s.adminLink} onClick={() => navigate('/admin')}>
    Панель администратора
  </button>
)}
<button className={s.changeServer} onClick={handleChangeServer}>
  Сменить сервер
</button>
```

- [ ] **Step 3: Добавить CSS в Profile.module.css**

В `client/src/components/Profile/Profile.module.css` добавить:

```css
.adminLink {
  display: block;
  width: 100%;
  padding: 0.625rem;
  background: var(--primary, #3b82f6);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.9rem;
  margin-top: 0.5rem;
  text-align: center;
}

.changeServer {
  display: block;
  width: 100%;
  padding: 0.625rem;
  background: none;
  color: var(--text-secondary, #64748b);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.875rem;
  margin-top: 0.5rem;
  text-align: center;
}
```

- [ ] **Step 4: Type-check + lint**

```bash
cd client && npm run type-check 2>&1 | head -30 && npm run lint 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add client/src/components/Profile/Profile.tsx client/src/components/Profile/Profile.module.css
git commit -m "feat(client): change server button and admin panel link in Profile"
```

---

### Task 13: E2E smoke test — запустить сервер и клиент, проверить golden path

**Files:** нет изменений — только проверка

- [ ] **Step 1: Запустить сервер**

```bash
cd server && cat > /tmp/test.yaml << 'EOF'
jwt_secret: "test-secret-12345"
server_name: "Test Server"
registration_mode: "open"
admin_username: "admin"
admin_password: "admin123"
EOF
go run ./cmd/server -config /tmp/test.yaml &
SERVER_PID=$!
sleep 1
```

- [ ] **Step 2: Проверить /api/server/info**

```bash
curl -s http://localhost:8080/api/server/info | python3 -m json.tool
```

Ожидается:
```json
{
  "name": "Test Server",
  "description": "",
  "registrationMode": "open"
}
```

- [ ] **Step 3: Проверить bootstrap admin login**

```bash
curl -s -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | python3 -m json.tool
```

Ожидается: JSON с `accessToken` и `role: "admin"`.

- [ ] **Step 4: Проверить /api/admin/users с токеном**

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")
curl -s http://localhost:8080/api/admin/users -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

Ожидается: JSON с массивом `users`, включающим admin.

- [ ] **Step 5: Запустить клиент**

```bash
kill $SERVER_PID 2>/dev/null
cd client && npm run dev &
```

Открыть http://localhost:5173 — должен показаться экран `/setup` (если localStorage пуст).

- [ ] **Step 6: Финальная проверка сборок**

```bash
cd server && go build ./...
cd ../client && npm run type-check && npm run build
```

Ожидается: обе сборки без ошибок.

- [ ] **Step 7: Остановить dev сервер и commit**

```bash
kill %% 2>/dev/null
git add -A
git commit -m "feat: multi-server support + admin panel — complete implementation"
```

---

## Известные ограничения

**CORS для standalone клиента:** Браузерные `fetch` с `credentials: 'include'` при кросс-оригин запросах требуют cookie с `SameSite=None; Secure`. Текущий сервер устанавливает `SameSite=Strict`. Для standalone PWA, подключающегося к серверу на другом домене, требуется:
1. TLS на сервере (`tls_cert` + `tls_key` в config.yaml)
2. Изменить cookie в `server/internal/auth/handler.go`:
   ```go
   SameSite: func() http.SameSite {
       if isHTTPS && cfg.AllowedOrigin != "" {
           return http.SameSiteNoneMode
       }
       return http.SameSiteStrictMode
   }(),
   ```
Для развёртывания на одном домене (браузер открывает URL сервера) — текущие настройки cookie работают корректно без изменений.
