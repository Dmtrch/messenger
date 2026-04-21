package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/messenger/server/internal/auth"
	"github.com/messenger/server/internal/chat"
)

// newChatHandler создаёт chat.Handler без Hub (nil-safe в тестах).
func newChatHandler(h *auth.Handler) (*chat.Handler, *auth.Handler) {
	return &chat.Handler{
		DB:                     h.DB,
		Hub:                    nil,
		AllowUsersCreateGroups: true,
	}, h
}

// doPostWithUserCtx вызывает handler с заданным userID в контексте.
func doPostWithUserCtx(handler http.HandlerFunc, body any, userID string) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	ctx := context.WithValue(req.Context(), auth.UserIDKey, userID)
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()
	handler(rr, req)
	return rr
}

// doGetWithUserCtx вызывает handler с заданным userID в контексте.
func doGetWithUserCtx(handler http.HandlerFunc, userID string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	ctx := context.WithValue(req.Context(), auth.UserIDKey, userID)
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()
	handler(rr, req)
	return rr
}

// TestChatFlow_CreateAndList: регистрация → создать чат → получить список.
func TestChatFlow_CreateAndList(t *testing.T) {
	database := newTestDB(t)
	authH := newAuthHandler(database)
	chatH := &chat.Handler{
		DB:                     database,
		Hub:                    nil,
		AllowUsersCreateGroups: true,
	}

	// Регистрируем двух пользователей
	_, _, userID1 := registerAndLogin(t, authH, "user1", "password123")
	_, _, userID2 := registerAndLogin(t, authH, "user2", "password123")

	// Создаём direct чат
	rrCreate := doPostWithUserCtx(chatH.CreateChat, map[string]any{
		"type":      "direct",
		"memberIds": []string{userID2},
	}, userID1)

	if rrCreate.Code != 201 {
		t.Fatalf("create chat: want 201, got %d: %s", rrCreate.Code, rrCreate.Body.String())
	}

	var createResp map[string]any
	json.Unmarshal(rrCreate.Body.Bytes(), &createResp) //nolint:errcheck
	chatObj, ok := createResp["chat"].(map[string]any)
	if !ok {
		t.Fatalf("create chat: 'chat' field missing in response: %s", rrCreate.Body.String())
	}
	chatID, _ := chatObj["id"].(string)
	if chatID == "" {
		t.Fatal("chat ID missing in response")
	}

	// Получаем список чатов для user1
	rrList := doGetWithUserCtx(chatH.ListChats, userID1)
	if rrList.Code != 200 {
		t.Fatalf("list chats: want 200, got %d: %s", rrList.Code, rrList.Body.String())
	}

	var listResp map[string]any
	json.Unmarshal(rrList.Body.Bytes(), &listResp) //nolint:errcheck
	chats, ok := listResp["chats"].([]any)
	if !ok || len(chats) == 0 {
		t.Fatalf("list chats: expected at least 1 chat, got: %s", rrList.Body.String())
	}

	// Проверяем что созданный чат есть в списке
	found := false
	for _, c := range chats {
		cm, ok := c.(map[string]any)
		if !ok {
			continue
		}
		if cm["id"] == chatID {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("created chat %s not found in list", chatID)
	}
}

// TestChatFlow_CreateGroupChat: создание группового чата.
func TestChatFlow_CreateGroupChat(t *testing.T) {
	database := newTestDB(t)
	authH := newAuthHandler(database)
	chatH := &chat.Handler{
		DB:                     database,
		Hub:                    nil,
		AllowUsersCreateGroups: true,
	}

	_, _, userID1 := registerAndLogin(t, authH, "guser1", "password123")
	_, _, userID2 := registerAndLogin(t, authH, "guser2", "password123")
	_, _, userID3 := registerAndLogin(t, authH, "guser3", "password123")

	rrCreate := doPostWithUserCtx(chatH.CreateChat, map[string]any{
		"type":      "group",
		"name":      "Test Group",
		"memberIds": []string{userID2, userID3},
	}, userID1)

	if rrCreate.Code != 201 {
		t.Fatalf("create group chat: want 201, got %d: %s", rrCreate.Code, rrCreate.Body.String())
	}
}

// TestChatFlow_DuplicateDirect: повторное создание direct чата возвращает 200 с существующим чатом.
func TestChatFlow_DuplicateDirect(t *testing.T) {
	database := newTestDB(t)
	authH := newAuthHandler(database)
	chatH := &chat.Handler{
		DB:  database,
		Hub: nil,
		AllowUsersCreateGroups: true,
	}

	_, _, userID1 := registerAndLogin(t, authH, "dup1", "password123")
	_, _, userID2 := registerAndLogin(t, authH, "dup2", "password123")

	body := map[string]any{
		"type":      "direct",
		"memberIds": []string{userID2},
	}

	rr1 := doPostWithUserCtx(chatH.CreateChat, body, userID1)
	if rr1.Code != 201 {
		t.Fatalf("first create: want 201, got %d: %s", rr1.Code, rr1.Body.String())
	}

	// Повторный запрос — должен вернуть 200 с тем же чатом
	rr2 := doPostWithUserCtx(chatH.CreateChat, body, userID1)
	if rr2.Code != 200 {
		t.Fatalf("duplicate direct: want 200, got %d: %s", rr2.Code, rr2.Body.String())
	}
}
