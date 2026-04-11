# Multi-Server Support & Admin Panel — Design Spec

**Date:** 2026-04-11  
**Status:** Approved  
**Branch:** feature/stage9-multi-device (target: new feature branch)

---

## Overview

Add the ability for a single client build to connect to any self-hosted server instance by URL. Each physical server remains fully isolated (separate SQLite DB). Add an admin system with invite codes, registration approval queue, and password reset management.

---

## 1. Server Configuration Changes

### New `config.yaml` fields

```yaml
server_name: "My Messenger"
server_description: "Корпоративный мессенджер"
registration_mode: "approval"   # open | invite | approval

# Bootstrap admin — created on first server start if not exists in DB
# Can be removed from config after first run
admin_username: "admin"
admin_password: "changeme123"
```

### New `Config` struct fields (Go)

```go
ServerName       string `yaml:"server_name"`
ServerDescription string `yaml:"server_description"`
RegistrationMode string `yaml:"registration_mode"`  // open|invite|approval
AdminUsername    string `yaml:"admin_username"`
AdminPassword    string `yaml:"admin_password"`
```

### Bootstrap admin on startup

`main.go` — after DB init, before starting HTTP server:

```go
if cfg.AdminUsername != "" {
    ensureBootstrapAdmin(db, cfg.AdminUsername, cfg.AdminPassword)
}
```

`ensureBootstrapAdmin` checks if user with that username exists; if not, creates with `role=admin` and hashed password. Does NOT overwrite existing user on subsequent starts.

---

## 2. Database Schema Changes

```sql
-- Add role to existing users table
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

-- Invite codes
CREATE TABLE invite_codes (
  code        TEXT PRIMARY KEY,
  created_by  TEXT NOT NULL REFERENCES users(id),
  used_by     TEXT REFERENCES users(id),
  used_at     INTEGER,
  expires_at  INTEGER,        -- NULL = no expiry
  created_at  INTEGER NOT NULL
);

-- Registration requests (approval mode)
CREATE TABLE registration_requests (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  ik_public     TEXT NOT NULL,
  spk_id        INTEGER NOT NULL,
  spk_public    TEXT NOT NULL,
  spk_signature TEXT NOT NULL,
  opk_publics   TEXT NOT NULL,  -- JSON array
  password_hash TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected
  created_at    INTEGER NOT NULL,
  reviewed_at   INTEGER,
  reviewed_by   TEXT REFERENCES users(id)
);

-- Password reset requests
CREATE TABLE password_reset_requests (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  status       TEXT NOT NULL DEFAULT 'pending', -- pending|completed|rejected
  temp_password TEXT,         -- set by admin when resolving
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER,
  resolved_by  TEXT REFERENCES users(id)
);
```

Schema is applied via existing auto-migration in `db/schema.go`.

---

## 3. New API Endpoints

### Public (no auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/server/info` | Server metadata + registration mode |
| `POST` | `/api/auth/request-register` | Submit registration request (approval mode) |
| `POST` | `/api/auth/password-reset-request` | Request password reset (by username) |

#### `GET /api/server/info` response

```json
{
  "name": "My Messenger",
  "description": "Корпоративный мессенджер",
  "registrationMode": "approval"
}
```

### Admin only (require `role=admin` in JWT)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/registration-requests` | List pending/all requests |
| `POST` | `/api/admin/registration-requests/:id/approve` | Approve request → create user |
| `POST` | `/api/admin/registration-requests/:id/reject` | Reject request |
| `POST` | `/api/admin/invite-codes` | Generate invite code |
| `GET` | `/api/admin/invite-codes` | List invite codes |
| `GET` | `/api/admin/users` | List all users |
| `POST` | `/api/admin/users/:id/reset-password` | Force password reset |
| `GET` | `/api/admin/password-reset-requests` | List pending reset requests |
| `POST` | `/api/admin/password-reset-requests/:id/resolve` | Set temp password |

### Modified existing endpoints

- `POST /api/auth/register` — now accepts optional `inviteCode` field; validates code if `registration_mode=invite`
- JWT payload now includes `role` claim: `{ "sub": "user_id", "role": "admin", "exp": ... }`

---

## 4. Go Implementation Structure

```
server/internal/
├── auth/handler.go         — modified: invite validation, JWT role claim
├── admin/
│   ├── handler.go          — новый пакет: все /api/admin/* роуты
│   └── middleware.go       — requireAdmin middleware
└── serverinfo/
    └── handler.go          — GET /api/server/info
```

`requireAdmin` middleware:

```go
func RequireAdmin(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        claims := r.Context().Value(ctxKeyClaims).(*Claims)
        if claims.Role != "admin" {
            http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
            return
        }
        next.ServeHTTP(w, r)
    })
}
```

---

## 5. Client Changes

### New module: `client/src/config/serverConfig.ts`

```ts
const STORAGE_KEY = 'serverUrl'

export function getServerUrl(): string {
  return localStorage.getItem(STORAGE_KEY) ?? ''
}

export function setServerUrl(url: string): void {
  // Normalize: strip trailing slash
  localStorage.setItem(STORAGE_KEY, url.replace(/\/$/, ''))
}

export function clearServerUrl(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function hasServerUrl(): boolean {
  return !!localStorage.getItem(STORAGE_KEY)
}

/** Auto-init from window.location when served directly from server */
export function initServerUrl(): void {
  if (!hasServerUrl()) {
    setServerUrl(window.location.origin)
  }
}
```

### Modified: `client/src/api/client.ts`

```ts
// Before:
const BASE = ''
// After:
import { getServerUrl } from '@/config/serverConfig'
const BASE = getServerUrl()
```

`doRefresh` and media fetch calls all use `BASE` already — no other changes needed.

### Modified: `client/src/api/websocket.ts`

```ts
// Before:
function getWsBase(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  return `${protocol}//${host}`
}
// After:
import { getServerUrl } from '@/config/serverConfig'
function getWsBase(): string {
  const url = new URL(getServerUrl())
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${url.host}`
}
```

### New routes

| Path | Component | Guard |
|------|-----------|-------|
| `/setup` | `ServerSetupPage` | показывается если нет `serverUrl` |
| `/auth` | `AuthPage` (modified) | требует `serverUrl` |
| `/auth?invite=CODE` | `AuthPage` | код вставляется автоматически |
| `/` | `ChatListPage` | требует auth |
| `/admin` | `AdminPage` | требует `role=admin` |

### App startup logic (`App.tsx` / router)

```
1. initServerUrl()          — auto-set from window.location if standalone
2. if !hasServerUrl()       → redirect to /setup
3. GET /api/server/info     — validate server, store registrationMode in state
4. if !accessToken          → redirect to /auth
5. else                     → load chats
```

### New pages/components

**`ServerSetupPage`** (`client/src/pages/ServerSetupPage.tsx`):
- Input для URL сервера
- Кнопка "Подключиться" → `GET /api/server/info`
- Карточка сервера (название, описание, режим регистрации)
- Кнопка "Войти / Зарегистрироваться" → `/auth`

**`AdminPage`** (`client/src/pages/AdminPage.tsx`):
- Четыре вкладки: Заявки | Пользователи | Инвайты | Сброс паролей
- Защищён проверкой `role=admin` из `authStore`

**Modified `AuthPage`**:
- Режим `approval`: форма регистрации → `POST /api/auth/request-register` → сообщение об ожидании
- Режим `invite`: поле для инвайт-кода (предзаполняется из `?invite=` query param)
- Режим `open`: текущее поведение без изменений
- Ссылка "Забыл пароль" → форма ввода username → `POST /api/auth/password-reset-request`

**Modified `ProfilePage`**:
- Кнопка "Сменить сервер" → `clearServerUrl()` + logout + redirect `/setup`
- Ссылка "Панель администратора" (только если `role=admin`)

---

## 6. Registration Flows

### Flow A: Invite code

```
Admin creates code → copies link https://server.com/?invite=XXXX
User opens link → client reads ?invite= from URL
Registration form with pre-filled code
POST /api/auth/register { ...keys, inviteCode: "XXXX" }
Server validates code → registers user immediately (active)
User is authenticated
```

### Flow B: Approval request

```
User fills registration form
POST /api/auth/request-register { username, passwordHash, displayName, keys... }
Server saves to registration_requests (status=pending)
Client shows: "Заявка отправлена, ожидайте одобрения администратора"
Admin sees request in panel → approves
POST /api/admin/registration-requests/:id/approve
Server creates user from request data, status=approved
User logs in normally
```

### Flow C: User-initiated password reset

```
User clicks "Забыл пароль" on login screen
User enters username
POST /api/auth/password-reset-request { username }
Client: "Запрос отправлен администратору"
Admin sees request in panel → enters temp password → clicks "Выдать"
POST /api/admin/password-reset-requests/:id/resolve { tempPassword }
Server hashes and sets new password
User logs in with temp password → changes in settings
```

### Flow D: Admin force-reset password

```
Admin opens Users tab → finds user → clicks "Сбросить пароль"
Admin enters new password
POST /api/admin/users/:id/reset-password { newPassword }
Server hashes and sets password
Admin communicates new password to user out-of-band
```

---

## 7. Security Considerations

- `admin_password` в `config.yaml` — только начальный bootstrap. После первого запуска рекомендуется удалить из конфига или оставить пустым (сервер не перезапишет существующего пользователя).
- `registration_requests` хранит `password_hash` (сервер хэширует при приёме, как в обычной регистрации — клиент передаёт plaintext пароль по TLS).
- `registration_mode: open` — `POST /api/auth/register` работает как прежде, без inviteCode и без approval.
- `temp_password` в `password_reset_requests` хранится в plaintext до использования — допустимо для MVP, т.к. отображается только администратору и должно быть немедленно сменено пользователем.
- Инвайт-коды — одноразовые (используются один раз, затем `used_by` заполнен).
- `requireAdmin` middleware проверяет роль из JWT-claims — не делает запрос к БД на каждый вызов.
- CORS: `AllowedOrigin` в конфиге должен учитывать что клиент может быть на другом origin (standalone PWA).

---

## 8. Files to Create / Modify

### Server (Go)

| File | Action |
|------|--------|
| `server/cmd/server/config.go` | Add 5 new config fields |
| `server/cmd/server/main.go` | Bootstrap admin, register new routes |
| `server/db/schema.go` | Add 3 new tables + `role` column migration |
| `server/db/queries.go` | New queries for all new tables |
| `server/internal/auth/handler.go` | Invite validation, role in JWT, request-register, password-reset-request |
| `server/internal/admin/handler.go` | NEW — all /api/admin/* handlers |
| `server/internal/admin/middleware.go` | NEW — requireAdmin middleware |
| `server/internal/serverinfo/handler.go` | NEW — GET /api/server/info |

### Client (TypeScript/React)

| File | Action |
|------|--------|
| `client/src/config/serverConfig.ts` | NEW |
| `client/src/api/client.ts` | Use `getServerUrl()` for BASE |
| `client/src/api/websocket.ts` | Use `getServerUrl()` for WS base |
| `client/src/pages/ServerSetupPage.tsx` | NEW |
| `client/src/pages/AdminPage.tsx` | NEW |
| `client/src/pages/AuthPage.tsx` | Add invite/approval/forgot-password flows |
| `client/src/pages/ProfilePage.tsx` | Add server change + admin link |
| `client/src/store/authStore.ts` | Store `role` field |
| `client/src/App.tsx` (or router) | Add /setup guard, /admin route |
| `client/src/types/index.ts` | Add User.role, ServerInfo type |

---

## 9. Out of Scope

- Email notifications (admin communicates temp passwords out-of-band)
- Cross-server federation
- Multiple simultaneous server connections
- Admin audit log
- 2FA
