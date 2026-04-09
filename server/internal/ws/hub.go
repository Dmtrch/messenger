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
	calls         map[string]*callSession // callID → активная сессия звонка
	callsMu       sync.Mutex
}

// callSession хранит состояние 1-на-1 звонка между двумя пользователями.
type callSession struct {
	callID      string
	chatID      string
	initiatorID string
	targetID    string
	state       string // "ringing" | "active"
	timer       *time.Timer
}

// NewHub создаёт Hub. allowedOrigin — разрешённый Origin заголовок для WS,
// например "https://messenger.example.com". Пустая строка разрешает все origin.
func NewHub(jwtSecret string, database *sql.DB, vapidPrivate, vapidPublic, allowedOrigin string) *Hub {
	return &Hub{
		byUser:        make(map[string]map[*client]struct{}),
		calls:         make(map[string]*callSession),
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
	// Проверяем запас одноразовых ключей — уведомляем если мало
	go h.checkAndNotifyPrekeys(userID)
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

// checkAndNotifyPrekeys проверяет запас OPK и уведомляет клиент если < 10.
func (h *Hub) checkAndNotifyPrekeys(userID string) {
	count, err := db.CountFreePreKeys(h.db, userID)
	if err != nil || count >= 10 {
		return
	}
	msg, _ := json.Marshal(map[string]any{
		"type":  "prekey_low",
		"count": count,
	})
	h.Deliver(userID, msg)
}

// NotifyPreKeyLow sends a prekey_low event to all devices of a user.
func (h *Hub) NotifyPreKeyLow(userID string) {
	h.checkAndNotifyPrekeys(userID)
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

	// type:"call_*"
	CallID    string          `json:"callId"`
	TargetID  string          `json:"targetId"`
	SDP       string          `json:"sdp"`
	IsVideo   bool            `json:"isVideo"`
	Candidate json.RawMessage `json:"candidate"`
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
		case "skdm":
			h.handleSKDM(c, msg)
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

// handleSKDM доставляет Sender Key Distribution Message получателям (точка-точка).
func (h *Hub) handleSKDM(c *client, msg inMsg) {
	if msg.ChatID == "" || len(msg.Recipients) == 0 {
		h.errMsg(c, "chatId and recipients required for skdm")
		return
	}
	// Проверяем что отправитель является участником чата
	ok, err := db.IsConversationMember(h.db, msg.ChatID, c.userID)
	if err != nil || !ok {
		h.errMsg(c, "forbidden")
		return
	}
	for _, r := range msg.Recipients {
		payload, _ := json.Marshal(map[string]any{
			"type":       "skdm",
			"chatId":     msg.ChatID,
			"senderId":   c.userID,
			"ciphertext": r.Ciphertext,
		})
		h.Deliver(r.UserID, payload)
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
	now := time.Now().UnixMilli()

	// Ищем сообщение для получения контекста (conversationID, senderID)
	m, err := db.GetMessageByID(h.db, msg.MessageID)
	if err != nil || m == nil {
		return
	}

	// Отмечаем конкретное сообщение прочитанным
	db.MarkRead(h.db, msg.MessageID, now) //nolint:errcheck

	// Обновляем позицию прочитанности пользователя в чате (монотонно)
	db.UpsertChatUserState(h.db, m.ConversationID, c.userID, msg.MessageID, m.CreatedAt) //nolint:errcheck

	// Уведомляем отправителя о прочтении (если не сам читает своё сообщение)
	if m.SenderID != c.userID {
		payload, _ := json.Marshal(map[string]any{
			"type":      "read",
			"chatId":    m.ConversationID,
			"messageId": msg.MessageID,
			"userId":    c.userID,
			"readAt":    now,
		})
		h.Deliver(m.SenderID, payload)
	}
}

// handleCallOffer обрабатывает входящий запрос на звонок от инициатора.
// Проверяет членство в чате, занятость цели и создаёт сессию с 30-секундным таймером.
func (h *Hub) handleCallOffer(c *client, msg inMsg) {
	if msg.CallID == "" || msg.TargetID == "" || msg.SDP == "" || msg.ChatID == "" {
		h.errMsg(c, "callId, targetId, chatId and sdp required")
		return
	}
	// Проверяем, что инициатор является участником чата
	ok, err := db.IsConversationMember(h.db, msg.ChatID, c.userID)
	if err != nil || !ok {
		h.errMsg(c, "forbidden")
		return
	}

	// Проверяем, не занят ли целевой пользователь в другом звонке
	h.callsMu.Lock()
	for _, s := range h.calls {
		if s.initiatorID == msg.TargetID || s.targetID == msg.TargetID {
			h.callsMu.Unlock()
			busy, _ := json.Marshal(map[string]any{
				"type":   "call_busy",
				"callId": msg.CallID,
			})
			h.Deliver(c.userID, busy)
			return
		}
	}

	// Создаём сессию и запускаем 30-секундный таймер ожидания ответа
	callID := msg.CallID
	initiatorID := c.userID
	targetID := msg.TargetID
	sess := &callSession{
		callID:      callID,
		chatID:      msg.ChatID,
		initiatorID: initiatorID,
		targetID:    targetID,
		state:       "ringing",
	}
	sess.timer = time.AfterFunc(30*time.Second, func() {
		h.callsMu.Lock()
		delete(h.calls, callID)
		h.callsMu.Unlock()
		timeout, _ := json.Marshal(map[string]any{
			"type":   "call_end",
			"callId": callID,
			"reason": "timeout",
		})
		h.Deliver(initiatorID, timeout)
		h.Deliver(targetID, timeout)
	})
	h.calls[callID] = sess
	h.callsMu.Unlock()

	// Передаём offer целевому пользователю
	offer, _ := json.Marshal(map[string]any{
		"type":     "call_offer",
		"callId":   callID,
		"chatId":   msg.ChatID,
		"callerId": initiatorID,
		"sdp":      msg.SDP,
		"isVideo":  msg.IsVideo,
	})
	h.Deliver(targetID, offer)
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
