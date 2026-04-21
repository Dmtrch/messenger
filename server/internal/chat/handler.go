package chat

import (
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/auth"
)

// Broadcaster — минимальный интерфейс хаба, нужный обработчику чатов.
type Broadcaster interface {
	Deliver(userID string, payload []byte)
	BroadcastToConversation(convID string, payload []byte)
}

type Handler struct {
	DB                     *sql.DB
	Hub                    Broadcaster
	MediaDir               string // для удаления файлов при удалении сообщения
	MaxGroupMembers        int    // глобальный лимит участников группы (default 50)
	AllowUsersCreateGroups bool   // разрешить обычным пользователям создавать группы (P3-ADM-6)
}

type ChatDTO struct {
	ID          string          `json:"id"`
	Type        string          `json:"type"`
	Name        string          `json:"name"`
	Members     []string        `json:"members"`
	CreatedAt   int64           `json:"createdAt"`
	UpdatedAt   int64           `json:"updatedAt"`
	UnreadCount int64           `json:"unreadCount"`
	LastMessage *LastMessageDTO `json:"lastMessage,omitempty"`
}

// LastMessageDTO — последнее сообщение чата (зашифровано, клиент расшифрует сам).
type LastMessageDTO struct {
	ID               string `json:"id"`
	SenderID         string `json:"senderId"`
	EncryptedPayload string `json:"encryptedPayload"`
	Timestamp        int64  `json:"timestamp"`
}

type MessageDTO struct {
	ID               string `json:"id"`
	ChatID           string `json:"chatId"`
	SenderID         string `json:"senderId"`
	EncryptedPayload string `json:"encryptedPayload"`
	SenderKeyID      int64  `json:"senderKeyId"`
	Timestamp        int64  `json:"timestamp"`
	Delivered        bool   `json:"delivered"`
	Read             bool   `json:"read"`
	ReplyToID        string `json:"replyToId,omitempty"`
	ExpiresAt        *int64 `json:"expiresAt,omitempty"`
}

// GET /api/chats — список чатов текущего пользователя
func (h *Handler) ListChats(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromCtx(r)
	summaries, err := db.GetUserConversationSummaries(h.DB, userID)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}

	result := make([]ChatDTO, 0, len(summaries))
	for _, s := range summaries {
		members, _ := db.GetConversationMembers(h.DB, s.ID)
		name := ""
		if s.Name.Valid {
			name = s.Name.String
		} else if s.Type == "direct" {
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

		dto := ChatDTO{
			ID:          s.ID,
			Type:        s.Type,
			Name:        name,
			Members:     members,
			CreatedAt:   s.CreatedAt,
			UpdatedAt:   s.UpdatedAt,
			UnreadCount: s.UnreadCount,
		}

		// Прикладываем последнее сообщение (зашифровано — клиент расшифрует)
		if s.LastMsgID != "" {
			if m, err := db.GetMessageByID(h.DB, s.LastMsgID); err == nil && m != nil {
				dto.LastMessage = &LastMessageDTO{
					ID:               m.ID,
					SenderID:         m.SenderID,
					EncryptedPayload: base64.StdEncoding.EncodeToString(m.Ciphertext),
					Timestamp:        m.CreatedAt,
				}
			}
		}

		result = append(result, dto)
	}
	reply(w, 200, map[string]any{"chats": result})
}

// POST /api/chats — создать чат
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

	// P3-ADM-6: если создание групп отключено — разрешаем только admin/moderator
	if req.Type == "group" && !h.AllowUsersCreateGroups {
		role := auth.RoleFromCtx(r)
		if role != "admin" && role != "moderator" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(403)
			json.NewEncoder(w).Encode(map[string]string{"error": "groups_creation_disabled"}) //nolint:errcheck
			return
		}
	}

	memberSet := map[string]struct{}{userID: {}}
	for _, id := range req.MemberIDs {
		memberSet[id] = struct{}{}
	}
	members := make([]string, 0, len(memberSet))
	for id := range memberSet {
		members = append(members, id)
	}

	// Для group: проверить лимит участников
	if req.Type == "group" {
		limit := h.MaxGroupMembers
		if limit <= 0 {
			limit = 50
		}
		if len(members) > limit {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(422)
			json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
				"error":      "group_member_limit_reached",
				"maxMembers": limit,
			})
			return
		}
	}

	// Для direct: проверить не существует ли уже чат между этими двумя
	if req.Type == "direct" && len(members) == 2 {
		convs, _ := db.GetUserConversations(h.DB, userID)
		for _, c := range convs {
			if c.Type != "direct" {
				continue
			}
			m, _ := db.GetConversationMembers(h.DB, c.ID)
			if len(m) == 2 && len(req.MemberIDs) > 0 {
				otherID := req.MemberIDs[0]
				if (m[0] == userID && m[1] == otherID) || (m[1] == userID && m[0] == otherID) {
					u, _ := db.GetUserByID(h.DB, otherID)
					name := ""
					if u != nil {
						name = u.DisplayName
					}
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
		if u != nil {
			name = u.DisplayName
		}
	}

	reply(w, 201, map[string]any{"chat": ChatDTO{
		ID: conv.ID, Type: conv.Type, Name: name, Members: members, CreatedAt: conv.CreatedAt,
	}})
}

// GET /api/chats/{chatId}/messages?before=<messageId>&limit=<n>
// before — opaque cursor: messageId (UUID) последнего полученного сообщения.
func (h *Handler) ListMessages(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromCtx(r)
	chatID := chi.URLParam(r, "chatId")

	member, err := db.IsConversationMember(h.DB, chatID, userID)
	if err != nil || !member {
		httpErr(w, "not found", 404)
		return
	}

	beforeMsgID := r.URL.Query().Get("before")
	limit := 50
	if s := r.URL.Query().Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}

	msgs, err := db.GetMessages(h.DB, chatID, userID, beforeMsgID, limit)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}

	result := make([]MessageDTO, 0, len(msgs))
	for _, m := range msgs {
		dto := MessageDTO{
			ID:               m.ID,
			ChatID:           m.ConversationID,
			SenderID:         m.SenderID,
			EncryptedPayload: base64.StdEncoding.EncodeToString(m.Ciphertext),
			SenderKeyID:      m.SenderKeyID,
			Timestamp:        m.CreatedAt,
			Delivered:        m.DeliveredAt.Valid,
			Read:             m.ReadAt.Valid,
			ReplyToID:        m.ReplyToID,
		}
		if m.ExpiresAt.Valid {
			dto.ExpiresAt = &m.ExpiresAt.Int64
		}
		result = append(result, dto)
	}
	reply(w, 200, map[string]any{"messages": result, "nextCursor": nextCursorID(msgs)})
}

// POST /api/chats/{chatId}/read — отметить сообщения в чате прочитанными.
// Тело (необязательно): {"messageId": "<uuid>"} — если не указан, берётся последнее сообщение.
func (h *Handler) MarkChatRead(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromCtx(r)
	chatID := chi.URLParam(r, "chatId")

	member, err := db.IsConversationMember(h.DB, chatID, userID)
	if err != nil || !member {
		httpErr(w, "not found", 404)
		return
	}

	var req struct {
		MessageID string `json:"messageId"`
	}
	json.NewDecoder(r.Body).Decode(&req) //nolint:errcheck

	var target *db.Message
	if req.MessageID != "" {
		target, _ = db.GetMessageByID(h.DB, req.MessageID)
	}
	if target == nil {
		// Нет явного messageId — берём последнее сообщение пользователя в чате
		msgs, _ := db.GetMessages(h.DB, chatID, userID, "", 1)
		if len(msgs) > 0 {
			target = &msgs[0]
		}
	}

	if target == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	now := time.Now().UnixMilli()
	db.UpsertChatUserState(h.DB, chatID, userID, target.ID, target.CreatedAt) //nolint:errcheck

	// Уведомляем всех участников о прочтении (отправители узнают о доставке)
	if h.Hub != nil {
		payload, _ := json.Marshal(map[string]any{
			"type":      "read",
			"chatId":    chatID,
			"messageId": target.ID,
			"userId":    userID,
			"readAt":    now,
		})
		h.Hub.BroadcastToConversation(chatID, payload)
	}

	w.WriteHeader(http.StatusNoContent)
}

// DELETE /api/messages/{clientMsgId}
func (h *Handler) DeleteMessage(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromCtx(r)
	callerRole := auth.RoleFromCtx(r)
	clientMsgID := chi.URLParam(r, "clientMsgId")

	// Получаем все копии, чтобы узнать chatId и проверить авторство
	copies, err := db.GetMessagesByClientMsgID(h.DB, clientMsgID)
	if err != nil || len(copies) == 0 {
		httpErr(w, "not found", 404)
		return
	}
	if copies[0].SenderID != userID && callerRole != "admin" && callerRole != "moderator" {
		httpErr(w, "forbidden", 403)
		return
	}
	chatID := copies[0].ConversationID

	if err := db.DeleteMessages(h.DB, clientMsgID, userID); err != nil {
		httpErr(w, "server error", 500)
		return
	}

	// Удаляем связанные медиафайлы (если загружались с msg_id)
	if h.MediaDir != "" {
		if filenames, err := db.DeleteMediaByMsgID(h.DB, clientMsgID); err == nil {
			for _, name := range filenames {
				path := filepath.Join(h.MediaDir, filepath.Clean(name))
				os.Remove(path) //nolint:errcheck
			}
		}
	}

	// Уведомляем всех участников чата
	if h.Hub != nil {
		payload, _ := json.Marshal(map[string]any{
			"type":        "message_deleted",
			"chatId":      chatID,
			"clientMsgId": clientMsgID,
		})
		h.Hub.BroadcastToConversation(chatID, payload)
	}

	w.WriteHeader(http.StatusNoContent)
}

// PATCH /api/messages/{clientMsgId}
func (h *Handler) EditMessage(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromCtx(r)
	clientMsgID := chi.URLParam(r, "clientMsgId")

	var req struct {
		Recipients []struct {
			UserID     string `json:"userId"`
			Ciphertext []byte `json:"ciphertext"`
		} `json:"recipients"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Recipients) == 0 {
		httpErr(w, "invalid body", 400)
		return
	}

	// Проверяем авторство по первой копии
	copies, err := db.GetMessagesByClientMsgID(h.DB, clientMsgID)
	if err != nil || len(copies) == 0 {
		httpErr(w, "not found", 404)
		return
	}
	if copies[0].SenderID != userID {
		httpErr(w, "forbidden", 403)
		return
	}
	chatID := copies[0].ConversationID
	now := time.Now().UnixMilli()

	// Обновляем шифртекст для каждого получателя и доставляем через WS
	for _, rec := range req.Recipients {
		if err := db.UpdateMessageCiphertext(h.DB, clientMsgID, userID, rec.UserID, rec.Ciphertext, now); err != nil {
			continue
		}
		if h.Hub != nil {
			payload, _ := json.Marshal(map[string]any{
				"type":        "message_edited",
				"chatId":      chatID,
				"clientMsgId": clientMsgID,
				"ciphertext":  rec.Ciphertext,
				"editedAt":    now,
			})
			h.Hub.Deliver(rec.UserID, payload)
		}
	}

	reply(w, http.StatusOK, map[string]any{"editedAt": now})
}

const (
	ttlMin int64 = 5       // 5 секунд — минимальный TTL
	ttlMax int64 = 604800  // 7 дней — максимальный TTL
)

// POST /api/chats/{chatId}/ttl — установить TTL по умолчанию для чата.
// ttlSeconds=0 отключает автоудаление. Диапазон: [5..604800].
func (h *Handler) SetChatTTL(w http.ResponseWriter, r *http.Request) {
	userID := auth.UserIDFromCtx(r)
	chatID := chi.URLParam(r, "chatId")

	member, err := db.IsConversationMember(h.DB, chatID, userID)
	if err != nil || !member {
		httpErr(w, "not found", 404)
		return
	}

	var req struct {
		TTLSeconds int64 `json:"ttlSeconds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpErr(w, "invalid body", 400)
		return
	}
	if req.TTLSeconds != 0 && (req.TTLSeconds < ttlMin || req.TTLSeconds > ttlMax) {
		httpErr(w, "ttlSeconds must be 0 or in range [5..604800]", 422)
		return
	}

	if err := db.SetConversationTTL(h.DB, chatID, req.TTLSeconds); err != nil {
		httpErr(w, "server error", 500)
		return
	}

	if h.Hub != nil {
		payload, _ := json.Marshal(map[string]any{
			"type":       "chat_ttl_updated",
			"chatId":     chatID,
			"ttlSeconds": req.TTLSeconds,
		})
		h.Hub.BroadcastToConversation(chatID, payload)
	}

	w.WriteHeader(http.StatusNoContent)
}

// POST /api/chats/{chatId}/members — добавить участника в групповой чат.
// Тело: {"userId": "<uuid>"}
func (h *Handler) AddMember(w http.ResponseWriter, r *http.Request) {
	callerID := auth.UserIDFromCtx(r)
	chatID := chi.URLParam(r, "chatId")

	member, err := db.IsConversationMember(h.DB, chatID, callerID)
	if err != nil || !member {
		httpErr(w, "not found", 404)
		return
	}

	var req struct {
		UserID string `json:"userId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.UserID == "" {
		httpErr(w, "invalid body", 400)
		return
	}

	// Проверить лимит
	limit := h.MaxGroupMembers
	if limit <= 0 {
		limit = 50
	}
	if convMax, ok, _ := db.GetConversationMaxMembers(h.DB, chatID); ok && convMax > 0 {
		limit = convMax
	}
	count, err := db.CountConversationMembers(h.DB, chatID)
	if err != nil {
		httpErr(w, "server error", 500)
		return
	}
	if count >= limit {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(422)
		json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
			"error":      "group_member_limit_reached",
			"maxMembers": limit,
		})
		return
	}

	if err := db.AddConversationMember(h.DB, chatID, req.UserID, time.Now().UnixMilli()); err != nil {
		httpErr(w, "server error", 500)
		return
	}

	if h.Hub != nil {
		payload, _ := json.Marshal(map[string]any{
			"type":   "member_added",
			"chatId": chatID,
			"userId": req.UserID,
		})
		h.Hub.BroadcastToConversation(chatID, payload)
	}

	w.WriteHeader(http.StatusNoContent)
}

// nextCursorID возвращает ID последнего сообщения как opaque cursor для пагинации.
func nextCursorID(msgs []db.Message) *string {
	if len(msgs) == 0 {
		return nil
	}
	id := msgs[len(msgs)-1].ID
	return &id
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
