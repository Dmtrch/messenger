package ws

import (
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/push"
)

// client is one WebSocket connection (one device).
type client struct {
	userID string
	conn   *websocket.Conn
	send   chan []byte
}

// Hub tracks all active connections.
type Hub struct {
	mu            sync.RWMutex
	byUser        map[string]map[*client]struct{} // userID → set of clients
	jwtSecret     []byte
	db            *sql.DB
	vapidPrivate  string
	vapidPublic   string
	allowedOrigin string // пустая строка = любой origin (dev-режим)
}

// NewHub создаёт Hub. allowedOrigin — разрешённый Origin заголовок для WS,
// например "https://messenger.example.com". Пустая строка разрешает все origin.
func NewHub(jwtSecret string, database *sql.DB, vapidPrivate, vapidPublic, allowedOrigin string) *Hub {
	return &Hub{
		byUser:        make(map[string]map[*client]struct{}),
		jwtSecret:     []byte(jwtSecret),
		db:            database,
		vapidPrivate:  vapidPrivate,
		vapidPublic:   vapidPublic,
		allowedOrigin: allowedOrigin,
	}
}

// checkOrigin проверяет Origin при WS-апгрейде.
func (h *Hub) checkOrigin(r *http.Request) bool {
	if h.allowedOrigin == "" {
		return true // dev-режим: принимаем любой origin
	}
	return r.Header.Get("Origin") == h.allowedOrigin
}

// ServeWS upgrades HTTP → WebSocket. Auth via ?token=<JWT>.
// Апгрейд выполняется всегда — при невалидном токене закрываем с кодом 4001,
// чтобы клиент мог отличить auth failure от сетевой ошибки.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	tokenStr := r.URL.Query().Get("token")
	userID, authErr := h.verifyJWT(tokenStr)

	upgrader := websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		CheckOrigin:     h.checkOrigin,
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade: %v", err)
		return
	}

	if authErr != nil {
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(4001, "unauthorized"))
		conn.Close()
		return
	}

	c := &client{userID: userID, conn: conn, send: make(chan []byte, 256)}
	h.register(c)
	go c.writePump(h)
	h.readPump(c)
}

func (h *Hub) register(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.byUser[c.userID] == nil {
		h.byUser[c.userID] = make(map[*client]struct{})
	}
	h.byUser[c.userID][c] = struct{}{}
}

func (h *Hub) unregister(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if set, ok := h.byUser[c.userID]; ok {
		delete(set, c)
		if len(set) == 0 {
			delete(h.byUser, c.userID)
		}
	}
	close(c.send)
}

// Deliver sends a JSON payload to every connection of a user.
func (h *Hub) Deliver(userID string, payload []byte) {
	h.mu.RLock()
	set := h.byUser[userID]
	h.mu.RUnlock()
	for c := range set {
		select {
		case c.send <- payload:
		default:
			go h.unregister(c)
		}
	}
}

// IsOnline returns true if the user has at least one active connection.
func (h *Hub) IsOnline(userID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.byUser[userID]) > 0
}

// BroadcastToConversation отправляет одинаковый payload всем участникам чата.
func (h *Hub) BroadcastToConversation(convID string, payload []byte) {
	members, err := db.GetConversationMembers(h.db, convID)
	if err != nil {
		return
	}
	for _, uid := range members {
		h.Deliver(uid, payload)
	}
}

// NotifyPreKeyLow sends a prekey_request event to all devices of a user.
func (h *Hub) NotifyPreKeyLow(userID string) {
	msg, _ := json.Marshal(map[string]string{"type": "prekey_request"})
	h.Deliver(userID, msg)
}

// ─── Incoming message types ───────────────────────────────────────────────────

type inMsg struct {
	Type string `json:"type"`

	// type:"message"
	ChatID      string      `json:"chatId"`
	Recipients  []recipient `json:"recipients"` // per-user encrypted payload
	SenderKeyID int64       `json:"senderKeyId"`
	ClientMsgID string      `json:"clientMsgId"`

	// type:"read"
	MessageID string `json:"messageId"`
}

type recipient struct {
	UserID     string `json:"userId"`
	Ciphertext []byte `json:"ciphertext"`
}

func (h *Hub) readPump(c *client) {
	defer func() {
		h.unregister(c)
		c.conn.Close()
	}()

	c.conn.SetReadLimit(512 * 1024)
	resetDeadline := func() { c.conn.SetReadDeadline(time.Now().Add(60 * time.Second)) }
	resetDeadline()
	c.conn.SetPongHandler(func(string) error { resetDeadline(); return nil })

	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway) {
				log.Printf("ws read (user %s): %v", c.userID, err)
			}
			return
		}

		var msg inMsg
		if err := json.Unmarshal(raw, &msg); err != nil {
			h.errMsg(c, "invalid json")
			continue
		}

		switch msg.Type {
		case "message":
			h.handleMessage(c, msg)
		case "typing":
			h.handleTyping(c, msg)
		case "read":
			h.handleRead(c, msg)
		default:
			h.errMsg(c, "unknown type: "+msg.Type)
		}
	}
}

func (h *Hub) handleMessage(c *client, msg inMsg) {
	if msg.ChatID == "" || len(msg.Recipients) == 0 {
		h.errMsg(c, "chatId and recipients required")
		return
	}
	ok, err := db.IsConversationMember(h.db, msg.ChatID, c.userID)
	if err != nil || !ok {
		h.errMsg(c, "forbidden")
		return
	}

	now := time.Now().UnixMilli()

	for _, r := range msg.Recipients {
		msgID := uuid.New().String()
		if err := db.SaveMessage(h.db, db.Message{
			ID:             msgID,
			ClientMsgID:    msg.ClientMsgID,
			ConversationID: msg.ChatID,
			SenderID:       c.userID,
			RecipientID:    r.UserID,
			Ciphertext:     r.Ciphertext,
			SenderKeyID:    msg.SenderKeyID,
			CreatedAt:      now,
		}); err != nil {
			log.Printf("save message: %v", err)
			continue
		}

		// Для копии отправителя используем clientMsgId как messageId,
		// чтобы клиент мог дедублировать с оптимистично добавленным сообщением.
		deliveredMsgID := msgID
		if r.UserID == c.userID {
			deliveredMsgID = msg.ClientMsgID
		}

		payload, _ := json.Marshal(map[string]any{
			"type":         "message",
			"messageId":    deliveredMsgID,
			"clientMsgId":  msg.ClientMsgID,
			"chatId":       msg.ChatID,
			"senderId":     c.userID,
			"ciphertext":   r.Ciphertext,
			"senderKeyId":  msg.SenderKeyID,
			"timestamp":    now,
		})
		h.Deliver(r.UserID, payload)

		if h.IsOnline(r.UserID) {
			db.MarkDelivered(h.db, msgID, now)
		} else if r.UserID != c.userID {
			// Получатель offline — отправляем push-уведомление
			pushPayload, _ := json.Marshal(map[string]any{
				"type":   "message",
				"chatId": msg.ChatID,
			})
			go push.SendNotification(h.db, h.vapidPrivate, h.vapidPublic, r.UserID, pushPayload)
		}
	}

	ack, _ := json.Marshal(map[string]any{
		"type":        "ack",
		"clientMsgId": msg.ClientMsgID,
		"timestamp":   now,
	})
	select {
	case c.send <- ack:
	default:
	}
}

func (h *Hub) handleTyping(c *client, msg inMsg) {
	members, err := db.GetConversationMembers(h.db, msg.ChatID)
	if err != nil {
		return
	}
	payload, _ := json.Marshal(map[string]any{
		"type":   "typing",
		"chatId": msg.ChatID,
		"userId": c.userID,
	})
	for _, uid := range members {
		if uid != c.userID {
			h.Deliver(uid, payload)
		}
	}
}

func (h *Hub) handleRead(c *client, msg inMsg) {
	if msg.MessageID == "" {
		return
	}
	db.MarkRead(h.db, msg.MessageID, time.Now().UnixMilli())
}

func (h *Hub) errMsg(c *client, reason string) {
	b, _ := json.Marshal(map[string]string{"type": "error", "error": reason})
	select {
	case c.send <- b:
	default:
	}
}

func (c *client) writePump(h *Hub) {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, nil)
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (h *Hub) verifyJWT(tokenStr string) (string, error) {
	if tokenStr == "" {
		return "", jwt.ErrTokenMalformed
	}
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return h.jwtSecret, nil
	})
	if err != nil || !token.Valid {
		return "", err
	}
	claims, _ := token.Claims.(jwt.MapClaims)
	userID, _ := claims["sub"].(string)
	return userID, nil
}
