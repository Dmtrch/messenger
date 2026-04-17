package admin_test

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/admin"
)

func createAdminFixture(t *testing.T, database *sql.DB, id string) {
	t.Helper()
	if err := db.CreateUser(database, db.User{
		ID:           id,
		Username:     id,
		DisplayName:  id,
		PasswordHash: "x",
		Role:         "admin",
		CreatedAt:    time.Now().UnixMilli(),
	}); err != nil {
		t.Fatalf("create admin fixture %s: %v", id, err)
	}
}

func postJSON(t *testing.T, handler http.HandlerFunc, body any, adminID string) *httptest.ResponseRecorder {
	t.Helper()
	buf := &bytes.Buffer{}
	if body != nil {
		_ = json.NewEncoder(buf).Encode(body)
	}
	req := httptest.NewRequest(http.MethodPost, "/", buf)
	req = withUserID(req, adminID)
	rr := httptest.NewRecorder()
	handler(rr, req)
	return rr
}

// TestCreateInviteCode_DefaultTTL — TTL по умолчанию 180с.
func TestCreateInviteCode_DefaultTTL(t *testing.T) {
	database := newTestDB(t)
	h := &admin.Handler{DB: database}
	createAdminFixture(t, database, "admin-ttl-default")

	before := time.Now().UnixMilli()
	rr := postJSON(t, h.CreateInviteCode, map[string]any{}, "admin-ttl-default")
	if rr.Code != 201 {
		t.Fatalf("want 201, got %d: %s", rr.Code, rr.Body)
	}

	var resp map[string]any
	_ = json.NewDecoder(rr.Body).Decode(&resp)
	ttl, _ := resp["ttlSeconds"].(float64)
	if int(ttl) != admin.InviteTTLDefault {
		t.Errorf("ttlSeconds: want %d, got %v", admin.InviteTTLDefault, ttl)
	}
	exp, _ := resp["expiresAt"].(float64)
	delta := int64(exp) - before
	if delta < int64(admin.InviteTTLDefault*1000)-500 || delta > int64(admin.InviteTTLDefault*1000)+5000 {
		t.Errorf("expiresAt delta out of range: %d ms", delta)
	}
}

// TestCreateInviteCode_TTLBounds — валидация диапазона TTL.
func TestCreateInviteCode_TTLBounds(t *testing.T) {
	database := newTestDB(t)
	h := &admin.Handler{DB: database}
	createAdminFixture(t, database, "admin-ttl-bounds")

	cases := []struct {
		ttl    int
		status int
	}{
		{30, 422},
		{59, 422},
		{60, 201},
		{180, 201},
		{600, 201},
		{601, 422},
		{900, 422},
	}
	for _, c := range cases {
		rr := postJSON(t, h.CreateInviteCode, map[string]any{"ttlSeconds": c.ttl}, "admin-ttl-bounds")
		if rr.Code != c.status {
			t.Errorf("ttl=%d: want %d, got %d (body=%s)", c.ttl, c.status, rr.Code, rr.Body.String())
		}
	}
}

// TestRevokeInviteCode — RevokeInviteCode помечает код отозванным;
// повторный revoke возвращает 404.
func TestRevokeInviteCode(t *testing.T) {
	database := newTestDB(t)
	h := &admin.Handler{DB: database}
	createAdminFixture(t, database, "admin-revoke")

	rr := postJSON(t, h.CreateInviteCode, map[string]any{"ttlSeconds": 180}, "admin-revoke")
	if rr.Code != 201 {
		t.Fatalf("create invite: %d %s", rr.Code, rr.Body)
	}
	var created map[string]any
	_ = json.NewDecoder(rr.Body).Decode(&created)
	code := created["code"].(string)

	req := httptest.NewRequest(http.MethodDelete, "/", nil)
	req = withChiParam(req, "code", code)
	req = withUserID(req, "admin-revoke")
	del := httptest.NewRecorder()
	h.RevokeInviteCode(del, req)
	if del.Code != 204 {
		t.Fatalf("revoke: want 204, got %d: %s", del.Code, del.Body)
	}

	got, err := db.GetInviteCode(database, code)
	if err != nil || got == nil {
		t.Fatalf("get invite: %v", err)
	}
	if got.RevokedAt == 0 {
		t.Errorf("revoked_at should be set")
	}

	req2 := httptest.NewRequest(http.MethodDelete, "/", nil)
	req2 = withChiParam(req2, "code", code)
	req2 = withUserID(req2, "admin-revoke")
	del2 := httptest.NewRecorder()
	h.RevokeInviteCode(del2, req2)
	if del2.Code != 404 {
		t.Errorf("second revoke: want 404, got %d", del2.Code)
	}
}

// TestUseInviteCode_ErrorPaths — типизированные ошибки
// (not found, already used, revoked, expired).
func TestUseInviteCode_ErrorPaths(t *testing.T) {
	database := newTestDB(t)
	createAdminFixture(t, database, "admin-usecheck")
	if err := db.CreateUser(database, db.User{
		ID: "user-usecheck", Username: "ucheck", DisplayName: "U",
		PasswordHash: "h", Role: "user", CreatedAt: time.Now().UnixMilli(),
	}); err != nil {
		t.Fatalf("create user: %v", err)
	}

	now := time.Now().UnixMilli()

	if err := db.UseInviteCode(database, "NOPE", "user-usecheck", now); err != db.ErrInviteNotFound {
		t.Errorf("want ErrInviteNotFound, got %v", err)
	}

	if err := db.CreateInviteCode(database, db.InviteCode{
		Code: "EXP1", CreatedBy: "admin-usecheck", ExpiresAt: now - 1, CreatedAt: now - 200_000,
	}); err != nil {
		t.Fatalf("create expired: %v", err)
	}
	if err := db.UseInviteCode(database, "EXP1", "user-usecheck", now); err != db.ErrInviteExpired {
		t.Errorf("want ErrInviteExpired, got %v", err)
	}

	if err := db.CreateInviteCode(database, db.InviteCode{
		Code: "REV1", CreatedBy: "admin-usecheck", ExpiresAt: now + 100_000, CreatedAt: now,
	}); err != nil {
		t.Fatalf("create revoked fixture: %v", err)
	}
	if err := db.RevokeInviteCode(database, "REV1", now); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if err := db.UseInviteCode(database, "REV1", "user-usecheck", now); err != db.ErrInviteRevoked {
		t.Errorf("want ErrInviteRevoked, got %v", err)
	}

	if err := db.CreateInviteCode(database, db.InviteCode{
		Code: "OK1", CreatedBy: "admin-usecheck", ExpiresAt: now + 100_000, CreatedAt: now,
	}); err != nil {
		t.Fatalf("create ok fixture: %v", err)
	}
	if err := db.UseInviteCode(database, "OK1", "user-usecheck", now); err != nil {
		t.Errorf("first use: want nil, got %v", err)
	}
	if err := db.UseInviteCode(database, "OK1", "user-usecheck", now+1); err != db.ErrInviteAlreadyUsed {
		t.Errorf("want ErrInviteAlreadyUsed, got %v", err)
	}
}

// TestListInviteActivations — журнал возвращает записанную строку.
func TestListInviteActivations(t *testing.T) {
	database := newTestDB(t)
	h := &admin.Handler{DB: database}
	createAdminFixture(t, database, "admin-act")

	if err := db.CreateUser(database, db.User{
		ID: "u-act", Username: "uact", DisplayName: "U", PasswordHash: "h",
		Role: "user", CreatedAt: time.Now().UnixMilli(),
	}); err != nil {
		t.Fatalf("create user: %v", err)
	}

	rr := postJSON(t, h.CreateInviteCode, map[string]any{}, "admin-act")
	if rr.Code != 201 {
		t.Fatalf("create: %d", rr.Code)
	}
	var created map[string]any
	_ = json.NewDecoder(rr.Body).Decode(&created)
	code := created["code"].(string)

	if err := db.CreateInviteActivation(database, db.InviteActivation{
		Code: code, UserID: "u-act", IP: "203.0.113.10",
		UserAgent: "UA/1.0", ActivatedAt: time.Now().UnixMilli(),
	}); err != nil {
		t.Fatalf("create activation: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = withChiParam(req, "code", code)
	req = withUserID(req, "admin-act")
	out := httptest.NewRecorder()
	h.ListInviteActivations(out, req)
	if out.Code != 200 {
		t.Fatalf("list: %d %s", out.Code, out.Body)
	}
	if !strings.Contains(out.Body.String(), "203.0.113.10") {
		t.Errorf("activation IP not returned: %s", out.Body.String())
	}
	if !strings.Contains(out.Body.String(), "UA/1.0") {
		t.Errorf("activation UA not returned: %s", out.Body.String())
	}
}
