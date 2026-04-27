package admin

import (
	"database/sql"
	"fmt"
	"html/template"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/monitoring"
	"github.com/messenger/server/internal/password"
)

// UIHandler serves the server-side rendered admin panel (no JS framework).
type UIHandler struct {
	DB                    *sql.DB
	Sessions              *Store
	RegistrationMode      string // "open" | "invite" | "approval"
	DBPath                string
	StartTime             time.Time
	DefaultMaxGroupMembers int
}

// ── helpers ──────────────────────────────────────────────────────────────────

func redirectTo(w http.ResponseWriter, r *http.Request, target string) {
	http.Redirect(w, r, target, http.StatusSeeOther)
}

func flashRedirect(w http.ResponseWriter, r *http.Request, target, msg, flashType string) {
	u, _ := url.Parse(target)
	q := u.Query()
	q.Set("flash", msg)
	q.Set("flash_type", flashType)
	u.RawQuery = q.Encode()
	http.Redirect(w, r, u.String(), http.StatusSeeOther)
}

const alphanum = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

func randomPassword(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = alphanum[rand.Intn(len(alphanum))]
	}
	return string(b)
}

func msToTime(ms int64) time.Time {
	if ms == 0 {
		return time.Time{}
	}
	return time.UnixMilli(ms)
}

func fmtTime(ms int64) string {
	if ms == 0 {
		return "—"
	}
	return time.UnixMilli(ms).UTC().Format("2006-01-02 15:04")
}

func formatUptime(d time.Duration) string {
	h := int(d.Hours())
	m := int(d.Minutes()) % 60
	if h > 0 {
		return fmt.Sprintf("%dч %dм", h, m)
	}
	return fmt.Sprintf("%dм", m)
}

// ── middleware ────────────────────────────────────────────────────────────────

// RequireUIAuth is an http.Handler middleware that redirects unauthenticated
// requests to /admin/login.
func (h *UIHandler) RequireUIAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if has, _ := db.HasAdminUser(h.DB); !has {
			redirectTo(w, r, "/admin/setup")
			return
		}
		if _, ok := h.Sessions.Get(r); !ok {
			redirectTo(w, r, "/admin/login")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ── setup ─────────────────────────────────────────────────────────────────────

var setupTmpl = template.Must(template.New("setup").Parse(`<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><title>Первый запуск</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0f172a;color:#f1f5f9;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#1e293b;border-radius:12px;padding:2rem;width:400px}
h1{font-size:1.2rem;margin-bottom:1.5rem;color:#f1f5f9}
label{display:block;font-size:.85rem;margin-bottom:.3rem;color:#94a3b8}
input{width:100%;padding:.55rem .75rem;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#f1f5f9;font-size:.95rem;margin-bottom:1rem}
input:focus{outline:none;border-color:#3b82f6}
.btn{width:100%;padding:.65rem;background:#3b82f6;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer}
.btn:hover{background:#2563eb}
.err{background:#7f1d1d;color:#fca5a5;border-radius:8px;padding:.6rem 1rem;margin-bottom:1rem;font-size:.9rem}
</style>
</head>
<body>
<div class="card">
  <h1>Первый запуск — создание администратора</h1>
  {{if .Error}}<div class="err">{{.Error}}</div>{{end}}
  <form method="POST" action="/admin/setup">
    <label>Логин</label>
    <input type="text" name="username" autocomplete="username" required minlength="3" value="{{.Username}}">
    <label>Пароль</label>
    <input type="password" name="password" autocomplete="new-password" required minlength="8">
    <label>Подтвердить пароль</label>
    <input type="password" name="password_confirm" autocomplete="new-password" required minlength="8">
    <button class="btn" type="submit">Создать аккаунт</button>
  </form>
</div>
</body>
</html>`))

func (h *UIHandler) Setup(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		has, err := db.HasAdminUser(h.DB)
		if err != nil || has {
			redirectTo(w, r, "/admin/login")
			return
		}
		setupTmpl.Execute(w, map[string]any{"Error": "", "Username": ""})

	case http.MethodPost:
		has, _ := db.HasAdminUser(h.DB)
		if has {
			redirectTo(w, r, "/admin/login")
			return
		}
		username := strings.TrimSpace(r.FormValue("username"))
		pass := r.FormValue("password")
		confirm := r.FormValue("password_confirm")

		renderErr := func(msg string) {
			w.WriteHeader(http.StatusUnprocessableEntity)
			setupTmpl.Execute(w, map[string]any{"Error": msg, "Username": username})
		}

		if len(username) < 3 {
			renderErr("Логин должен быть не менее 3 символов.")
			return
		}
		if len(pass) < 8 {
			renderErr("Пароль должен быть не менее 8 символов.")
			return
		}
		if pass != confirm {
			renderErr("Пароли не совпадают.")
			return
		}

		hash, err := password.Hash(pass)
		if err != nil {
			renderErr("Внутренняя ошибка сервера.")
			return
		}
		if err := db.EnsureAdminUser(h.DB, username, hash); err != nil {
			renderErr("Не удалось создать аккаунт: " + err.Error())
			return
		}
		redirectTo(w, r, "/admin/login")
	}
}

// ── login / logout ────────────────────────────────────────────────────────────

var loginTmpl = template.Must(template.New("login").Parse(`<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><title>Вход — Messenger Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0f172a;color:#f1f5f9;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#1e293b;border-radius:12px;padding:2rem;width:360px}
h1{font-size:1.15rem;margin-bottom:1.5rem;color:#f1f5f9}
label{display:block;font-size:.85rem;margin-bottom:.3rem;color:#94a3b8}
input{width:100%;padding:.55rem .75rem;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#f1f5f9;font-size:.95rem;margin-bottom:1rem}
input:focus{outline:none;border-color:#3b82f6}
.btn{width:100%;padding:.65rem;background:#3b82f6;color:#fff;border:none;border-radius:8px;font-size:1rem;cursor:pointer}
.btn:hover{background:#2563eb}
.err{background:#7f1d1d;color:#fca5a5;border-radius:8px;padding:.6rem 1rem;margin-bottom:1rem;font-size:.9rem}
</style>
</head>
<body>
<div class="card">
  <h1>Панель администратора</h1>
  {{if .Error}}<div class="err">{{.Error}}</div>{{end}}
  <form method="POST" action="/admin/login">
    <label>Логин</label>
    <input type="text" name="username" autocomplete="username" required value="{{.Username}}">
    <label>Пароль</label>
    <input type="password" name="password" autocomplete="current-password" required>
    <button class="btn" type="submit">Войти</button>
  </form>
</div>
</body>
</html>`))

func (h *UIHandler) Login(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		if has, _ := db.HasAdminUser(h.DB); !has {
			redirectTo(w, r, "/admin/setup")
			return
		}
		if _, ok := h.Sessions.Get(r); ok {
			redirectTo(w, r, "/admin/")
			return
		}
		loginTmpl.Execute(w, map[string]any{"Error": "", "Username": ""})

	case http.MethodPost:
		username := strings.TrimSpace(r.FormValue("username"))
		pass := r.FormValue("password")

		renderErr := func(msg string) {
			w.WriteHeader(http.StatusUnauthorized)
			loginTmpl.Execute(w, map[string]any{"Error": msg, "Username": username})
		}

		user, err := db.GetUserByUsername(h.DB, username)
		if err != nil || user == nil || user.Role != "admin" {
			renderErr("Неверный логин или пароль.")
			return
		}
		if err := password.Verify(user.PasswordHash, pass); err != nil {
			renderErr("Неверный логин или пароль.")
			return
		}
		if err := h.Sessions.Create(w, user.ID); err != nil {
			renderErr("Внутренняя ошибка сервера.")
			return
		}
		redirectTo(w, r, "/admin/")
	}
}

func (h *UIHandler) Logout(w http.ResponseWriter, r *http.Request) {
	h.Sessions.Delete(w)
	redirectTo(w, r, "/admin/login")
}

// ── dashboard ─────────────────────────────────────────────────────────────────

var dashTmpl = template.Must(template.New("dash").Funcs(template.FuncMap{
	"fmtTime": fmtTime,
	"add":     func(a, b int) int { return a + b },
	"div": func(a, b, mult float64) float64 {
		if b == 0 {
			return 0
		}
		return a / b * mult
	},
}).Parse(`<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><title>Messenger Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0f172a;color:#f1f5f9;font-family:system-ui,sans-serif;min-height:100vh}
a{color:#3b82f6;text-decoration:none}
/* navbar */
.nav{background:#1e293b;padding:.75rem 2rem;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #334155}
.nav-brand{font-weight:700;font-size:1.1rem}
.nav-right{display:flex;align-items:center;gap:1rem;font-size:.9rem;color:#94a3b8}
.nav-right strong{color:#f1f5f9}
/* tabs */
.tabs{display:flex;gap:.25rem;padding:1.5rem 2rem .5rem}
.tab{padding:.5rem 1.25rem;border-radius:8px;font-size:.9rem;cursor:pointer;color:#94a3b8;border:1px solid transparent}
.tab.active{background:#1e293b;color:#f1f5f9;border-color:#334155}
.tab:hover:not(.active){color:#f1f5f9}
/* content */
.content{padding:1.5rem 2rem}
/* cards */
.cards{display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:2rem}
.card{background:#1e293b;border-radius:12px;padding:1.25rem 1.5rem;min-width:160px}
.card-label{font-size:.8rem;color:#94a3b8;margin-bottom:.4rem}
.card-value{font-size:2rem;font-weight:700;color:#f1f5f9}
/* flash */
.flash{padding:.6rem 1rem;border-radius:8px;margin-bottom:1rem;font-size:.9rem}
.flash.success{background:#14532d;color:#86efac}
.flash.error{background:#7f1d1d;color:#fca5a5}
/* table */
.tbl-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.88rem}
th{text-align:left;padding:.6rem .75rem;color:#94a3b8;border-bottom:1px solid #334155;font-weight:500}
td{padding:.6rem .75rem;border-bottom:1px solid #1e293b;vertical-align:middle}
tr:hover td{background:#1e293b}
/* buttons */
.btn{display:inline-block;padding:.35rem .75rem;border-radius:6px;font-size:.82rem;cursor:pointer;border:none}
.btn-primary{background:#3b82f6;color:#fff}
.btn-primary:hover{background:#2563eb}
.btn-danger{background:#ef4444;color:#fff}
.btn-danger:hover{background:#dc2626}
.btn-warn{background:#f59e0b;color:#0f172a}
.btn-warn:hover{background:#d97706}
.btn-ghost{background:#334155;color:#f1f5f9}
.btn-ghost:hover{background:#475569}
/* form inline */
.form-inline{display:inline}
/* invite form */
.invite-form{background:#1e293b;border-radius:10px;padding:1.25rem;margin-bottom:1.5rem;display:flex;align-items:flex-end;gap:1rem;flex-wrap:wrap}
.invite-form label{font-size:.85rem;color:#94a3b8;display:block;margin-bottom:.3rem}
.invite-form input{padding:.5rem .75rem;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#f1f5f9;font-size:.9rem}
.invite-form input:focus{outline:none;border-color:#3b82f6}
/* new invite banner */
.new-invite{background:#0f2d1f;border:1px solid #22c55e;border-radius:10px;padding:1rem 1.25rem;margin-bottom:1.5rem}
.new-invite .code{font-family:monospace;font-size:1.1rem;color:#22c55e;word-break:break-all}
.new-invite img{display:block;margin-top:.75rem;border-radius:6px}
/* badge */
.badge{display:inline-block;padding:.2rem .5rem;border-radius:4px;font-size:.78rem;font-weight:600}
.badge-admin{background:#1d4ed8;color:#bfdbfe}
.badge-user{background:#334155;color:#94a3b8}
.badge-active{background:#14532d;color:#86efac}
.badge-banned{background:#7f1d1d;color:#fca5a5}
.badge-suspended{background:#78350f;color:#fde68a}
.badge-used{background:#334155;color:#94a3b8}
.badge-revoked{background:#7f1d1d;color:#fca5a5}
.badge-expired{background:#78350f;color:#fde68a}
.badge-active-inv{background:#14532d;color:#86efac}
.badge-count{background:#ef4444;color:#fff;border-radius:9999px;padding:.1rem .45rem;font-size:.7rem;margin-left:.3rem}
.sys-stats{background:#1e293b;border-radius:12px;padding:1.25rem 1.5rem;max-width:500px}
.sys-stat-row{display:flex;align-items:center;gap:.75rem;margin-bottom:.75rem}
.sys-stat-row:last-child{margin-bottom:0}
.sys-label{width:40px;font-size:.85rem;color:#94a3b8}
.sys-val{width:120px;font-size:.85rem;color:#94a3b8;text-align:right}
.progress{flex:1;height:8px;background:#0f172a;border-radius:4px;overflow:hidden}
.progress-bar{height:100%;background:#3b82f6;border-radius:4px;transition:width .3s}
</style>
</head>
<body>
<nav class="nav">
  <span class="nav-brand">Messenger Admin</span>
  <div class="nav-right">
    <strong>{{.AdminUsername}}</strong>
    <a href="/admin/logout" class="btn btn-ghost" style="padding:.3rem .75rem">Выйти</a>
  </div>
</nav>

<div class="tabs">
  <a href="/admin/?tab=overview" class="tab {{if eq .Tab "overview"}}active{{end}}">Обзор</a>
  <a href="/admin/?tab=users"    class="tab {{if eq .Tab "users"}}active{{end}}">Пользователи</a>
  <a href="/admin/?tab=invites"  class="tab {{if eq .Tab "invites"}}active{{end}}">Приглашения</a>
  {{if eq .RegistrationMode "approval"}}
  <a href="/admin/?tab=requests" class="tab {{if eq .Tab "requests"}}active{{end}}">Заявки <span class="badge-count">{{.PendingApprovals}}</span></a>
  {{end}}
  <a href="/admin/?tab=settings" class="tab {{if eq .Tab "settings"}}active{{end}}">Настройки</a>
</div>

<div class="content">
{{if .Flash}}
<div class="flash {{.FlashType}}">{{.Flash}}</div>
{{end}}

{{if eq .Tab "overview"}}
  <div class="cards">
    <div class="card">
      <div class="card-label">Всего пользователей</div>
      <div class="card-value">{{.TotalUsers}}</div>
    </div>
    <div class="card">
      <div class="card-label">Активных приглашений</div>
      <div class="card-value">{{.ActiveInvites}}</div>
    </div>
    {{if eq .RegistrationMode "approval"}}
    <div class="card">
      <div class="card-label">Ожидают подтверждения</div>
      <div class="card-value">{{.PendingApprovals}}</div>
    </div>
    {{end}}
    <div class="card">
      <div class="card-label">Версия сервера</div>
      <div class="card-value" style="font-size:1.3rem">{{.ServerVersion}}</div>
    </div>
    <div class="card">
      <div class="card-label">Сообщений</div>
      <div class="card-value">{{.TotalMessages}}</div>
    </div>
    <div class="card">
      <div class="card-label">Чатов</div>
      <div class="card-value">{{.TotalChats}}</div>
    </div>
    <div class="card">
      <div class="card-label">База данных</div>
      <div class="card-value" style="font-size:1.3rem">{{printf "%.1f" .DBSizeMB}} МБ</div>
    </div>
    <div class="card">
      <div class="card-label">Аптайм</div>
      <div class="card-value" style="font-size:1.3rem">{{.UptimeStr}}</div>
    </div>
  </div>
  <div class="sys-stats">
    <div class="sys-stat-row">
      <span class="sys-label">CPU</span>
      <div class="progress"><div class="progress-bar" style="width:{{printf "%.0f" .CPUPercent}}%"></div></div>
      <span class="sys-val">{{printf "%.1f" .CPUPercent}}%</span>
    </div>
    <div class="sys-stat-row">
      <span class="sys-label">RAM</span>
      <div class="progress"><div class="progress-bar" style="width:{{if .RAMTotalMB}}{{printf "%.0f" (div .RAMUsedMB .RAMTotalMB 100)}}{{else}}0{{end}}%"></div></div>
      <span class="sys-val">{{printf "%.0f" .RAMUsedMB}} / {{printf "%.0f" .RAMTotalMB}} МБ</span>
    </div>
    <div class="sys-stat-row">
      <span class="sys-label">Диск</span>
      <div class="progress"><div class="progress-bar" style="width:{{if .DiskTotalGB}}{{printf "%.0f" (div .DiskUsedGB .DiskTotalGB 100)}}{{else}}0{{end}}%"></div></div>
      <span class="sys-val">{{printf "%.1f" .DiskUsedGB}} / {{printf "%.1f" .DiskTotalGB}} ГБ</span>
    </div>
  </div>
{{end}}

{{if eq .Tab "users"}}
  <div class="tbl-wrap">
  <table>
    <thead>
      <tr>
        <th>Логин</th>
        <th>Имя</th>
        <th>Роль</th>
        <th>Статус</th>
        <th>Дата регистрации</th>
        <th>Действия</th>
      </tr>
    </thead>
    <tbody>
    {{range .Users}}
    <tr>
      <td>{{.Username}}</td>
      <td>{{.DisplayName}}</td>
      <td><span class="badge badge-{{.Role}}">{{.Role}}</span></td>
      <td>
        {{if eq .Status "active"}}<span class="badge badge-active">активен</span>
        {{else if eq .Status "banned"}}<span class="badge badge-banned">забанен</span>
        {{else if eq .Status "suspended"}}<span class="badge badge-suspended">приостановлен</span>
        {{else}}<span class="badge badge-user">{{.Status}}</span>{{end}}
      </td>
      <td>{{fmtTime .CreatedAt}}</td>
      <td style="display:flex;gap:.4rem;flex-wrap:wrap">
        {{if ne .ID $.AdminID}}
          <form class="form-inline" method="POST" action="/admin/ui/users/{{.ID}}/reset-password">
            <button class="btn btn-ghost" type="submit">Сбросить пароль</button>
          </form>
          {{if eq .Status "banned"}}
          <form class="form-inline" method="POST" action="/admin/ui/users/{{.ID}}/unban">
            <button class="btn btn-primary" type="submit">Разбанить</button>
          </form>
          {{else}}
          <form class="form-inline" method="POST" action="/admin/ui/users/{{.ID}}/ban">
            <button class="btn btn-warn" type="submit">Бан</button>
          </form>
          {{end}}
          <form class="form-inline" method="POST" action="/admin/ui/users/{{.ID}}/delete"
                onsubmit="return confirm('Удалить пользователя {{.Username}}?')">
            <button class="btn btn-danger" type="submit">Удалить</button>
          </form>
        {{else}}
          <span style="color:#475569;font-size:.82rem">текущий аккаунт</span>
        {{end}}
      </td>
    </tr>
    {{end}}
    </tbody>
  </table>
  </div>
{{end}}

{{if eq .Tab "invites"}}
  {{if .NewInvite}}
  <div class="new-invite">
    <div style="color:#86efac;font-size:.85rem;margin-bottom:.4rem">Новый инвайт создан</div>
    <div class="code">{{.NewInvite.URL}}</div>
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data={{.NewInvite.URLEncoded}}" alt="QR" width="150" height="150">
  </div>
  {{end}}

  <div class="invite-form">
    <div>
      <label>TTL (секунды, {{.InviteTTLMin}}–{{.InviteTTLMax}})</label>
      <input type="number" name="ttl" value="{{.InviteTTLDefault}}" min="{{.InviteTTLMin}}" max="{{.InviteTTLMax}}" form="create-invite-form">
    </div>
    <form id="create-invite-form" method="POST" action="/admin/ui/invites/create">
      <input type="hidden" name="ttl" value="">
      <button class="btn btn-primary" type="submit">Создать инвайт</button>
    </form>
  </div>

  <div class="tbl-wrap">
  <table>
    <thead>
      <tr>
        <th>Код</th>
        <th>Создан</th>
        <th>Истекает</th>
        <th>Использован</th>
        <th>Статус</th>
        <th>Действие</th>
      </tr>
    </thead>
    <tbody>
    {{range .Invites}}
    <tr>
      <td style="font-family:monospace">{{.Code}}</td>
      <td>{{fmtTime .CreatedAt}}</td>
      <td>{{fmtTime .ExpiresAt}}</td>
      <td>{{if .UsedBy}}{{.UsedBy}}{{else}}—{{end}}</td>
      <td>
        {{if .UsedBy}}<span class="badge badge-used">использован</span>
        {{else if ne .RevokedAt 0}}<span class="badge badge-revoked">отозван</span>
        {{else if .Expired}}<span class="badge badge-expired">истёк</span>
        {{else}}<span class="badge badge-active-inv">активен</span>{{end}}
      </td>
      <td>
        {{if and (not .UsedBy) (eq .RevokedAt 0) (not .Expired)}}
        <form class="form-inline" method="POST" action="/admin/ui/invites/{{.Code}}/revoke">
          <button class="btn btn-danger" type="submit">Отозвать</button>
        </form>
        {{else}}—{{end}}
      </td>
    </tr>
    {{end}}
    </tbody>
  </table>
  </div>
{{end}}

{{if eq .Tab "requests"}}
  {{if not .RegRequests}}
  <p style="color:#94a3b8">Нет ожидающих заявок.</p>
  {{else}}
  <div class="tbl-wrap">
  <table>
    <thead><tr><th>Логин</th><th>Имя</th><th>Дата</th><th>Действия</th></tr></thead>
    <tbody>
    {{range .RegRequests}}
    <tr>
      <td>{{.Username}}</td>
      <td>{{.DisplayName}}</td>
      <td>{{fmtTime .CreatedAt}}</td>
      <td>
        <form class="form-inline" method="POST" action="/admin/ui/requests/{{.ID}}/approve">
          <button class="btn btn-primary" type="submit">Принять</button>
        </form>
        <form class="form-inline" method="POST" action="/admin/ui/requests/{{.ID}}/reject">
          <button class="btn btn-danger" type="submit">Отклонить</button>
        </form>
      </td>
    </tr>
    {{end}}
    </tbody>
  </table>
  </div>
  {{end}}
{{end}}

{{if eq .Tab "settings"}}
  <div style="max-width:480px">
    <h2 style="font-size:1.05rem;margin-bottom:1.25rem;color:#f1f5f9">Настройки сервера</h2>
    <form method="POST" action="/admin/ui/settings">
      <div style="margin-bottom:1.25rem">
        <label style="display:block;font-size:.85rem;color:#94a3b8;margin-bottom:.4rem">
          Хранение медиафайлов (дней, 0 = бессрочно)
        </label>
        <input type="number" name="retention_days" value="{{.RetentionDays}}" min="0"
               style="width:100%;padding:.55rem .75rem;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#f1f5f9;font-size:.95rem">
      </div>
      <div style="margin-bottom:1.5rem">
        <label style="display:block;font-size:.85rem;color:#94a3b8;margin-bottom:.4rem">
          Максимум участников в группе
        </label>
        <input type="number" name="max_group_members" value="{{.MaxGroupMembers}}" min="2" max="1000"
               style="width:100%;padding:.55rem .75rem;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#f1f5f9;font-size:.95rem">
      </div>
      <button class="btn btn-primary" type="submit">Сохранить</button>
    </form>
    <div style="margin-top:1.5rem;padding-top:1.25rem;border-top:1px solid #334155;color:#94a3b8;font-size:.85rem">
      <div>Режим регистрации: <strong style="color:#f1f5f9">{{.RegistrationMode}}</strong></div>
    </div>
  </div>
{{end}}

</div>
</body>
</html>`))

// inviteRow wraps db.InviteCode with a computed Expired flag and display URL.
type inviteRow struct {
	db.InviteCode
	Expired bool
}

type newInviteInfo struct {
	URL        string
	URLEncoded string
}

type dashData struct {
	Tab              string
	AdminID          string
	AdminUsername    string
	Flash            string
	FlashType        string
	// overview
	TotalUsers       int
	ActiveInvites    int
	PendingApprovals int
	RegistrationMode string
	ServerVersion    string
	// overview system stats
	TotalMessages  int64
	TotalChats     int64
	DBSizeMB       float64
	UptimeStr      string
	CPUPercent     float64
	RAMUsedMB      float64
	RAMTotalMB     float64
	DiskUsedGB     float64
	DiskTotalGB    float64
	// users tab
	Users []db.User
	// invites tab
	Invites          []inviteRow
	NewInvite        *newInviteInfo
	InviteTTLMin     int
	InviteTTLMax     int
	InviteTTLDefault int
	// requests tab
	RegRequests []db.RegistrationRequest
	// settings tab
	RetentionDays   int
	MaxGroupMembers int
}

func (h *UIHandler) Dashboard(w http.ResponseWriter, r *http.Request) {
	adminID, _ := h.Sessions.Get(r)

	// Resolve admin username for display.
	adminUser, _ := db.GetUserByID(h.DB, adminID)
	adminUsername := adminID
	if adminUser != nil {
		adminUsername = adminUser.Username
	}

	tab := r.URL.Query().Get("tab")
	if tab == "" {
		tab = "overview"
	}

	flash := r.URL.Query().Get("flash")
	flashType := r.URL.Query().Get("flash_type")
	if flashType == "" {
		flashType = "success"
	}

	// Determine server base for invite URLs.
	scheme := "https"
	if r.TLS == nil {
		scheme = "http"
	}
	serverBase := fmt.Sprintf("%s://%s", scheme, r.Host)

	data := dashData{
		Tab:              tab,
		AdminID:          adminID,
		AdminUsername:    adminUsername,
		Flash:            flash,
		FlashType:        flashType,
		RegistrationMode: h.RegistrationMode,
		ServerVersion:    "1.0.0",
		InviteTTLMin:     InviteTTLMin,
		InviteTTLMax:     InviteTTLMax,
		InviteTTLDefault: InviteTTLDefault,
	}

	// Overview stats are always needed.
	users, _ := db.ListUsers(h.DB)
	data.TotalUsers = len(users)
	data.Users = users

	codes, _ := db.ListInviteCodes(h.DB)
	now := time.Now().UnixMilli()
	var rows []inviteRow
	activeCount := 0
	for _, c := range codes {
		expired := c.ExpiresAt > 0 && c.ExpiresAt < now
		rows = append(rows, inviteRow{InviteCode: c, Expired: expired})
		if c.UsedBy == "" && c.RevokedAt == 0 && !expired {
			activeCount++
		}
	}
	data.Invites = rows
	data.ActiveInvites = activeCount

	// Message/chat counts
	data.TotalMessages, _ = db.CountMessages(h.DB)
	data.TotalChats, _ = db.CountConversations(h.DB)

	// DB file size
	if h.DBPath != "" {
		if fi, err := os.Stat(h.DBPath); err == nil {
			data.DBSizeMB = float64(fi.Size()) / 1024 / 1024
		}
	}

	// Uptime
	data.UptimeStr = formatUptime(time.Since(h.StartTime))

	// System stats via monitoring.CollectStats()
	if sys, err := monitoring.CollectStats(); err == nil {
		data.CPUPercent = sys.CPUPercent
		data.RAMUsedMB = float64(sys.RAMUsed) / 1024 / 1024
		data.RAMTotalMB = float64(sys.RAMTotal) / 1024 / 1024
		data.DiskUsedGB = float64(sys.DiskUsed) / 1024 / 1024 / 1024
		data.DiskTotalGB = float64(sys.DiskTotal) / 1024 / 1024 / 1024
	}

	// Registration requests (for approval mode)
	if h.RegistrationMode == "approval" {
		reqs, _ := db.ListRegistrationRequests(h.DB, "pending")
		data.RegRequests = reqs
		data.PendingApprovals = len(reqs)
	}

	// Settings
	if val, err := db.GetSetting(h.DB, "media_retention_days"); err == nil && val != "" {
		data.RetentionDays, _ = strconv.Atoi(val)
	}
	if val, err := db.GetSetting(h.DB, "max_group_members"); err == nil && val != "" {
		data.MaxGroupMembers, _ = strconv.Atoi(val)
	} else {
		data.MaxGroupMembers = h.DefaultMaxGroupMembers
	}

	// Check for a newly-created invite passed via flash param.
	if newCode := r.URL.Query().Get("new_invite"); newCode != "" {
		invURL := fmt.Sprintf("%s/register?invite=%s", serverBase, newCode)
		data.NewInvite = &newInviteInfo{
			URL:        invURL,
			URLEncoded: url.QueryEscape(invURL),
		}
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := dashTmpl.Execute(w, data); err != nil {
		http.Error(w, "template error: "+err.Error(), 500)
	}
}

// ── action handlers ───────────────────────────────────────────────────────────

// POST /admin/ui/invites/create
func (h *UIHandler) CreateInvite(w http.ResponseWriter, r *http.Request) {
	adminID, _ := h.Sessions.Get(r)

	ttl := InviteTTLDefault
	if v := r.FormValue("ttl"); v != "" {
		n := 0
		fmt.Sscanf(v, "%d", &n)
		if n >= InviteTTLMin && n <= InviteTTLMax {
			ttl = n
		}
	}

	nowT := time.Now()
	code := db.InviteCode{
		Code:      uuid.New().String()[:8],
		CreatedBy: adminID,
		ExpiresAt: nowT.Add(time.Duration(ttl) * time.Second).UnixMilli(),
		CreatedAt: nowT.UnixMilli(),
	}
	if err := db.CreateInviteCode(h.DB, code); err != nil {
		flashRedirect(w, r, "/admin/?tab=invites", "Ошибка создания инвайта: "+err.Error(), "error")
		return
	}

	u, _ := url.Parse("/admin/")
	q := u.Query()
	q.Set("tab", "invites")
	q.Set("new_invite", code.Code)
	u.RawQuery = q.Encode()
	http.Redirect(w, r, u.String(), http.StatusSeeOther)
}

// POST /admin/ui/invites/{code}/revoke
func (h *UIHandler) RevokeInvite(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	err := db.RevokeInviteCode(h.DB, code, time.Now().UnixMilli())
	if err != nil {
		flashRedirect(w, r, "/admin/?tab=invites", "Ошибка: "+err.Error(), "error")
		return
	}
	flashRedirect(w, r, "/admin/?tab=invites", "Инвайт отозван.", "success")
}

// POST /admin/ui/users/{id}/reset-password
func (h *UIHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	newPass := randomPassword(12)
	hash, err := password.Hash(newPass)
	if err != nil {
		flashRedirect(w, r, "/admin/?tab=users", "Внутренняя ошибка.", "error")
		return
	}
	if err := db.UpdateUserPassword(h.DB, userID, hash); err != nil {
		flashRedirect(w, r, "/admin/?tab=users", "Ошибка обновления пароля: "+err.Error(), "error")
		return
	}
	flashRedirect(w, r, "/admin/?tab=users", "Новый пароль: "+newPass, "success")
}

// POST /admin/ui/users/{id}/delete
func (h *UIHandler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	adminID, _ := h.Sessions.Get(r)
	if userID == adminID {
		flashRedirect(w, r, "/admin/?tab=users", "Нельзя удалить собственный аккаунт.", "error")
		return
	}
	_, err := h.DB.Exec("DELETE FROM users WHERE id=?", userID)
	if err != nil {
		flashRedirect(w, r, "/admin/?tab=users", "Ошибка удаления: "+err.Error(), "error")
		return
	}
	flashRedirect(w, r, "/admin/?tab=users", "Пользователь удалён.", "success")
}

// POST /admin/ui/users/{id}/ban
func (h *UIHandler) BanUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	if err := db.SetUserStatus(h.DB, userID, "banned"); err != nil {
		flashRedirect(w, r, "/admin/?tab=users", "Ошибка: "+err.Error(), "error")
		return
	}
	flashRedirect(w, r, "/admin/?tab=users", "Пользователь заблокирован.", "success")
}

// POST /admin/ui/users/{id}/unban
func (h *UIHandler) UnbanUser(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "id")
	if err := db.SetUserStatus(h.DB, userID, "active"); err != nil {
		flashRedirect(w, r, "/admin/?tab=users", "Ошибка: "+err.Error(), "error")
		return
	}
	flashRedirect(w, r, "/admin/?tab=users", "Пользователь разблокирован.", "success")
}

// POST /admin/ui/requests/{id}/approve
func (h *UIHandler) ApproveRequest(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	adminID, _ := h.Sessions.Get(r)
	req, _ := db.GetRegistrationRequest(h.DB, id)
	if req == nil {
		flashRedirect(w, r, "/admin/?tab=requests", "Заявка не найдена", "error")
		return
	}
	u := db.User{
		ID:           uuid.New().String(),
		Username:     req.Username,
		DisplayName:  req.DisplayName,
		PasswordHash: req.PasswordHash,
		Role:         "user",
		CreatedAt:    time.Now().UnixMilli(),
	}
	if err := db.CreateUser(h.DB, u); err != nil {
		flashRedirect(w, r, "/admin/?tab=requests", "Ошибка создания пользователя", "error")
		return
	}
	_ = db.UpdateRegistrationRequestStatus(h.DB, id, "approved", adminID, time.Now().UnixMilli())
	flashRedirect(w, r, "/admin/?tab=requests", "Заявка одобрена", "success")
}

// POST /admin/ui/requests/{id}/reject
func (h *UIHandler) RejectRequest(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	adminID, _ := h.Sessions.Get(r)
	_ = db.UpdateRegistrationRequestStatus(h.DB, id, "rejected", adminID, time.Now().UnixMilli())
	flashRedirect(w, r, "/admin/?tab=requests", "Заявка отклонена", "success")
}

// GET+POST /admin/ui/settings
func (h *UIHandler) Settings(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		redirectTo(w, r, "/admin/?tab=settings")
		return
	}
	retDays := r.FormValue("retention_days")
	maxMembers := r.FormValue("max_group_members")
	if retDays != "" {
		_ = db.SetSetting(h.DB, "media_retention_days", retDays)
	}
	if maxMembers != "" {
		_ = db.SetSetting(h.DB, "max_group_members", maxMembers)
	}
	flashRedirect(w, r, "/admin/?tab=settings", "Настройки сохранены", "success")
}
