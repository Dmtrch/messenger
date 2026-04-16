package keys_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/auth"
	"github.com/messenger/server/internal/keys"
)

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

// createUser создаёт минимального пользователя в БД напрямую.
func createUser(t *testing.T, database *sql.DB, username string) string {
	t.Helper()
	user := db.User{
		ID:           "user-" + username,
		Username:     username,
		DisplayName:  username,
		PasswordHash: "$2a$12$testhash",
		Role:         "user",
		CreatedAt:    1000000,
	}
	if err := db.CreateUser(database, user); err != nil {
		t.Fatalf("create user: %v", err)
	}
	return user.ID
}

func withUserID(r *http.Request, userID string) *http.Request {
	ctx := context.WithValue(r.Context(), auth.UserIDKey, userID)
	return r.WithContext(ctx)
}

func withChiParam(r *http.Request, key, value string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add(key, value)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

func postJSON(handler http.HandlerFunc, body any) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	handler(rr, req)
	return rr
}

// makeKeyMaterial возвращает 32 случайных байта закодированных в base64.
func b64(n int) string {
	buf := make([]byte, n)
	for i := range buf {
		buf[i] = byte(i % 256)
	}
	return base64.StdEncoding.EncodeToString(buf)
}

func registerDeviceReq(userID string, h *keys.Handler, ikPublic string) *httptest.ResponseRecorder {
	b, _ := json.Marshal(map[string]any{
		"deviceName":   "TestDevice",
		"ikPublic":     ikPublic,
		"spkId":        1,
		"spkPublic":    b64(32),
		"spkSignature": b64(64),
		"opkPublics":   []string{b64(32), b64(32)},
	})
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req = withUserID(req, userID)
	rr := httptest.NewRecorder()
	h.RegisterDevice(rr, req)
	return rr
}

// ── RegisterDevice ───────────────────────────────────────────────────────────

func TestRegisterDevice_Success(t *testing.T) {
	database := newTestDB(t)
	userID := createUser(t, database, "alice")
	h := &keys.Handler{DB: database}

	rr := registerDeviceReq(userID, h, b64(32))
	if rr.Code != 200 {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]string
	json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp["deviceId"] == "" {
		t.Fatal("deviceId missing in response")
	}
}

func TestRegisterDevice_Idempotent(t *testing.T) {
	// Повторная регистрация с тем же IK → тот же device_id.
	database := newTestDB(t)
	userID := createUser(t, database, "alice")
	h := &keys.Handler{DB: database}

	ikPublic := b64(32)
	rr1 := registerDeviceReq(userID, h, ikPublic)
	rr2 := registerDeviceReq(userID, h, ikPublic)

	if rr1.Code != 200 || rr2.Code != 200 {
		t.Fatalf("want 200+200, got %d+%d", rr1.Code, rr2.Code)
	}

	var resp1, resp2 map[string]string
	json.Unmarshal(rr1.Body.Bytes(), &resp1)
	json.Unmarshal(rr2.Body.Bytes(), &resp2)

	if resp1["deviceId"] != resp2["deviceId"] {
		t.Fatalf("idempotency violated: %q != %q", resp1["deviceId"], resp2["deviceId"])
	}
}

func TestRegisterDevice_NewIK_NewDevice(t *testing.T) {
	// Разные IK → разные device_id.
	database := newTestDB(t)
	userID := createUser(t, database, "alice")
	h := &keys.Handler{DB: database}

	rr1 := registerDeviceReq(userID, h, b64(32))
	// Другой IK (разные байты)
	rr2 := registerDeviceReq(userID, h, base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0xFF}, 32)))

	if rr1.Code != 200 || rr2.Code != 200 {
		t.Fatalf("want 200+200, got %d+%d", rr1.Code, rr2.Code)
	}

	var resp1, resp2 map[string]string
	json.Unmarshal(rr1.Body.Bytes(), &resp1)
	json.Unmarshal(rr2.Body.Bytes(), &resp2)

	if resp1["deviceId"] == resp2["deviceId"] {
		t.Fatal("different IK should produce different deviceId")
	}
}

func TestRegisterDevice_MissingFields(t *testing.T) {
	database := newTestDB(t)
	userID := createUser(t, database, "alice")
	h := &keys.Handler{DB: database}

	b, _ := json.Marshal(map[string]any{
		"deviceName": "Test",
		// ikPublic, spkPublic, spkSignature отсутствуют
	})
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req = withUserID(req, userID)
	rr := httptest.NewRecorder()
	h.RegisterDevice(rr, req)

	if rr.Code != 400 {
		t.Fatalf("want 400, got %d", rr.Code)
	}
}

// ── GetBundle ────────────────────────────────────────────────────────────────

// firstDeviceBundle извлекает первый device bundle из ответа GetBundle.
func firstDeviceBundle(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var resp map[string]any
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("unmarshal bundle response: %v", err)
	}
	devicesRaw, ok := resp["devices"]
	if !ok {
		t.Fatal("devices key missing in bundle response")
	}
	devices, ok := devicesRaw.([]any)
	if !ok || len(devices) == 0 {
		t.Fatal("devices array empty in bundle response")
	}
	d, ok := devices[0].(map[string]any)
	if !ok {
		t.Fatal("first device entry is not a map")
	}
	return d
}

func TestGetBundle_Success(t *testing.T) {
	database := newTestDB(t)
	userID := createUser(t, database, "alice")
	h := &keys.Handler{DB: database}

	// Регистрируем устройство
	registerDeviceReq(userID, h, b64(32))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = withChiParam(req, "userId", userID)
	rr := httptest.NewRecorder()
	h.GetBundle(rr, req)

	if rr.Code != 200 {
		t.Fatalf("want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	d := firstDeviceBundle(t, rr.Body.Bytes())
	if d["ikPublic"] == nil {
		t.Fatal("ikPublic missing in bundle")
	}
	if d["spkPublic"] == nil {
		t.Fatal("spkPublic missing in bundle")
	}
}

func TestGetBundle_NoKeys(t *testing.T) {
	database := newTestDB(t)
	userID := createUser(t, database, "alice")
	h := &keys.Handler{DB: database}

	// Не регистрируем ключи
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = withChiParam(req, "userId", userID)
	rr := httptest.NewRecorder()
	h.GetBundle(rr, req)

	if rr.Code != 404 {
		t.Fatalf("want 404, got %d", rr.Code)
	}
}

func TestGetBundle_OPKPopped(t *testing.T) {
	// После GetBundle одноразовый prekey должен быть извлечён (использован).
	database := newTestDB(t)
	userID := createUser(t, database, "alice")
	h := &keys.Handler{DB: database}

	registerDeviceReq(userID, h, b64(32))

	get := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req = withChiParam(req, "userId", userID)
		rr := httptest.NewRecorder()
		h.GetBundle(rr, req)
		return rr
	}

	rr1 := get()
	rr2 := get()

	if rr1.Code != 200 || rr2.Code != 200 {
		t.Fatalf("both calls should succeed: %d, %d", rr1.Code, rr2.Code)
	}

	d1 := firstDeviceBundle(t, rr1.Body.Bytes())
	d2 := firstDeviceBundle(t, rr2.Body.Bytes())

	// Оба могут вернуть opkId — они должны быть разными (из набора 2 ключей)
	opk1, has1 := d1["opkId"]
	opk2, has2 := d2["opkId"]
	if has1 && has2 && opk1 == opk2 {
		t.Fatal("same OPK popped twice — prekey rotation broken")
	}
}

// TestGetBundle_SelfDoesNotPopOPK проверяет что запрос bundle для самого себя
// не расходует одноразовые prekey (OPK).
func TestGetBundle_SelfDoesNotPopOPK(t *testing.T) {
	database := newTestDB(t)
	userID := createUser(t, database, "alice")
	h := &keys.Handler{DB: database}

	registerDeviceReq(userID, h, b64(32)) // регистрирует 2 OPK

	getSelf := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req = withChiParam(req, "userId", userID)
		req = withUserID(req, userID) // caller == owner
		rr := httptest.NewRecorder()
		h.GetBundle(rr, req)
		return rr
	}

	// Запрашиваем bundle 3 раза как сам владелец
	for i := 0; i < 3; i++ {
		rr := getSelf()
		if rr.Code != 200 {
			t.Fatalf("self get bundle #%d: want 200, got %d: %s", i+1, rr.Code, rr.Body)
		}
		d := firstDeviceBundle(t, rr.Body.Bytes())
		if _, hasOPK := d["opkId"]; hasOPK {
			t.Errorf("self get bundle #%d: opkId should NOT be present when caller==owner", i+1)
		}
	}

	// Теперь другой пользователь запрашивает bundle — должен получить OPK
	other := createUser(t, database, "bob")
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req = withChiParam(req, "userId", userID)
	req = withUserID(req, other)
	rr := httptest.NewRecorder()
	h.GetBundle(rr, req)

	if rr.Code != 200 {
		t.Fatalf("other get bundle: want 200, got %d: %s", rr.Code, rr.Body)
	}
	d := firstDeviceBundle(t, rr.Body.Bytes())
	if _, hasOPK := d["opkId"]; !hasOPK {
		t.Error("other user should receive OPK in bundle, but opkId is missing")
	}
}
