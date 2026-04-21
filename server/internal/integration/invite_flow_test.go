package integration_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/admin"
	"github.com/messenger/server/internal/auth"
)

// TestInviteFlow_CreateActivateRegister: admin создаёт инвайт → регистрация с кодом → код помечен использованным.
func TestInviteFlow_CreateActivateRegister(t *testing.T) {
	database := newTestDB(t)

	// 1. Создать admin-пользователя напрямую в БД.
	adminUser := db.User{
		ID:           uuid.New().String(),
		Username:     "admin",
		DisplayName:  "Admin",
		PasswordHash: "dummy-hash",
		Role:         "admin",
		CreatedAt:    time.Now().UnixMilli(),
	}
	if err := db.CreateUser(database, adminUser); err != nil {
		t.Fatalf("create admin user: %v", err)
	}

	// 2. Создать инвайт через admin.Handler.CreateInviteCode (с adminID в контексте).
	adminHandler := &admin.Handler{DB: database}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/invite-codes", nil)
	ctx := context.WithValue(req.Context(), auth.UserIDKey, adminUser.ID)
	req = req.WithContext(ctx)
	rrInvite := httptest.NewRecorder()
	adminHandler.CreateInviteCode(rrInvite, req)

	if rrInvite.Code != 201 {
		t.Fatalf("create invite: want 201, got %d: %s", rrInvite.Code, rrInvite.Body.String())
	}

	// 3. Получить список кодов и взять первый.
	codes, err := db.ListInviteCodes(database)
	if err != nil || len(codes) == 0 {
		t.Fatalf("list invite codes: err=%v, count=%d", err, len(codes))
	}
	inviteCode := codes[0].Code

	// 4. Регистрация с инвайт-кодом через auth.Handler.
	authHandler := &auth.Handler{
		DB:               database,
		JWTSecret:        []byte(testJWTSecret),
		RegistrationMode: "invite",
	}
	rrReg := doPost(authHandler.Register, map[string]any{
		"username":    "newuser",
		"displayName": "New User",
		"password":    "password123",
		"inviteCode":  inviteCode,
	})
	if rrReg.Code != 201 {
		t.Fatalf("register with invite: want 201, got %d: %s", rrReg.Code, rrReg.Body.String())
	}

	// 5. Проверить что код помечен как использованный.
	code, err := db.GetInviteCode(database, inviteCode)
	if err != nil {
		t.Fatalf("get invite code: %v", err)
	}
	if code == nil {
		t.Fatal("invite code not found after use")
	}
	if code.UsedBy == "" {
		t.Fatal("invite code UsedBy is empty — code not marked as used")
	}
}

// TestInviteFlow_RegisterWithoutCode: в режиме invite регистрация без кода → 400.
func TestInviteFlow_RegisterWithoutCode(t *testing.T) {
	database := newTestDB(t)
	h := &auth.Handler{
		DB:               database,
		JWTSecret:        []byte(testJWTSecret),
		RegistrationMode: "invite",
	}
	rr := doPost(h.Register, map[string]any{
		"username":    "nocode",
		"displayName": "No Code",
		"password":    "password123",
	})
	if rr.Code != 400 {
		t.Fatalf("want 400 without invite code, got %d: %s", rr.Code, rr.Body.String())
	}
}

// TestInviteFlow_ReuseCode: повторное использование уже использованного кода → 409.
func TestInviteFlow_ReuseCode(t *testing.T) {
	database := newTestDB(t)

	adminUser := db.User{
		ID:           uuid.New().String(),
		Username:     "admin2",
		DisplayName:  "Admin2",
		PasswordHash: "dummy",
		Role:         "admin",
		CreatedAt:    time.Now().UnixMilli(),
	}
	if err := db.CreateUser(database, adminUser); err != nil {
		t.Fatalf("create admin: %v", err)
	}

	// Создать инвайт
	adminHandler := &admin.Handler{DB: database}
	req := httptest.NewRequest(http.MethodPost, "/api/admin/invite-codes", nil)
	ctx := context.WithValue(req.Context(), auth.UserIDKey, adminUser.ID)
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()
	adminHandler.CreateInviteCode(rr, req)
	if rr.Code != 201 {
		t.Fatalf("create invite: want 201, got %d", rr.Code)
	}

	codes, _ := db.ListInviteCodes(database)
	inviteCode := codes[0].Code

	h := &auth.Handler{
		DB:               database,
		JWTSecret:        []byte(testJWTSecret),
		RegistrationMode: "invite",
	}

	// Первая регистрация — успех
	rrFirst := doPost(h.Register, map[string]any{
		"username": "first", "displayName": "First", "password": "password123",
		"inviteCode": inviteCode,
	})
	if rrFirst.Code != 201 {
		t.Fatalf("first register: want 201, got %d: %s", rrFirst.Code, rrFirst.Body.String())
	}

	// Вторая попытка с тем же кодом — 409
	rrSecond := doPost(h.Register, map[string]any{
		"username": "second", "displayName": "Second", "password": "password123",
		"inviteCode": inviteCode,
	})
	if rrSecond.Code != 409 {
		t.Fatalf("reuse invite: want 409, got %d: %s", rrSecond.Code, rrSecond.Body.String())
	}
}
