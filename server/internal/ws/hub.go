package ws

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/messenger/server/db"
	"github.com/messenger/server/internal/bots"
	"github.com/messenger/server/internal/push"
)

// client is one WebSocket connection (one device).
type client struct {
	userID   string
	deviceID string // ID устройства из таблицы devices; пустая строка для старых клиентов
	conn     *websocket.Conn
	send     chan []byte
}

// Hub tracks all active connections.
type Hub struct {
	mu            sync.RWMutex
	byUser        map[string]map[*client]struct{} // userID → set of clients
	jwtSecret     []byte
	db            *sql.DB
	vapidPrivate  string
	vapidPublic   string
	nativePush    push.NativePushConfig
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

// SetNativePushConfig задаёт учётные данные для FCM / APNs после создания Hub.
func (h *Hub) SetNativePushConfig(cfg push.NativePushConfig) {
	h.nativePush = cfg
}

// checkOrigin проверяет Origin при WS-апгрейде.
func (h *Hub) checkOrigin(r *http.Request) bool {
	if h.allowedOrigin == "" {
		return true // dev-режим: принимаем любой origin
	}
	return r.Header.Get("Origin") == h.allowedOrigin
}

// ServeWS upgrades HTTP → WebSocket. Auth via ?token=<JWT>&deviceId=<id>.
// Апгрейд выполняется всегда — при невалидном токене закрываем с кодом 4001,
// чтобы клиент мог отличить auth failure от сетевой ошибки.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	tokenStr := r.URL.Query().Get("token")
	deviceIDParam := r.URL.Query().Get("deviceId")
	userID, authErr := h.verifyJWT(tokenStr)

	// Fallback: если JWT отсутствует — пробуем Bot-аутентификацию.
	if authErr != nil {
		authHeader := r.Header.Get("Authorization")
		if strings.HasPrefix(authHeader, "Bot ") {
			plaintext := strings.TrimPrefix(authHeader, "Bot ")
			sum := sha256.Sum256([]byte(plaintext))
			hash := hex.EncodeToString(sum[:])
			bot, err := db.GetBotByTokenHash(h.db, hash)
			if err == nil && bot != nil && bot.Active {
				userID = "bot:" + bot.ID
				authErr = nil
			}
		}
	}

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

	// Валидируем deviceId если передан: должен принадлежать аутентифицированному пользователю.
	deviceID := ""
	if deviceIDParam != "" {
		dev, err := db.GetDeviceByID(h.db, deviceIDParam)
		if err == nil && dev != nil && dev.UserID == userID {
			deviceID = dev.ID
		}
		// Неверный deviceId игнорируем (не разрываем соединение — обратная совместимость)
	}

	c := &client{userID: userID, deviceID: deviceID, conn: conn, send: make(chan []byte, 256)}
	h.register(c)
	go c.writePump(h)
	// Проверяем запас одноразовых ключей — уведомляем если мало
	go h.checkAndNotifyPrekeys(userID)
	h.readPump(c)
}

func (h *Hub) register(c *client) {
	h.mu.Lock()
	firstConn := h.byUser[c.userID] == nil
	if h.byUser[c.userID] == nil {
		h.byUser[c.userID] = make(map[*client]struct{})
	}
	h.byUser[c.userID][c] = struct{}{}
	h.mu.Unlock()
	if firstConn {
		go h.broadcastPresence(c.userID, true)
	}
}

func (h *Hub) unregister(c *client) {
	h.mu.Lock()
	wentOffline := false
	if set, ok := h.byUser[c.userID]; ok {
		delete(set, c)
		if len(set) == 0 {
			delete(h.byUser, c.userID)
			wentOffline = true
		}
	}
	h.mu.Unlock()
	close(c.send)
	h.cleanupCallsForUser(c.userID)
	if wentOffline {
		go h.broadcastPresence(c.userID, false)
	}
}

// broadcastPresence рассылает статус online/offline всем контактам пользователя.
func (h *Hub) broadcastPresence(userID string, online bool) {
	peers, err := db.GetConversationPeers(h.db, userID)
	if err != nil || len(peers) == 0 {
		return
	}
	status := "offline"
	if online {
		status = "online"
	}
	payload, _ := json.Marshal(map[string]any{
		"type":   "presence",
		"userId": userID,
		"status": status,
	})
	for _, peerID := range peers {
		h.Deliver(peerID, payload)
	}
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

// DeliverToDevice отправляет payload только конкретному устройству пользователя.
// Если устройство не подключено — payload игнорируется (клиент заберёт при reconnect через REST).
func (h *Hub) DeliverToDevice(userID, deviceID string, payload []byte) {
	h.mu.RLock()
	set := h.byUser[userID]
	h.mu.RUnlock()
	for c := range set {
		if c.deviceID == deviceID {
			select {
			case c.send <- payload:
			default:
				go h.unregister(c)
			}
			return
		}
	}
}

// IsOnline returns true if the user has at least one active connection.
func (h *Hub) IsOnline(userID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.byUser[userID]) > 0
}

// DisconnectUser closes all WebSocket connections for a user (used by admin on ban/suspend).
func (h *Hub) DisconnectUser(userID string) {
	h.mu.RLock()
	set := h.byUser[userID]
	conns := make([]*websocket.Conn, 0, len(set))
	for c := range set {
		conns = append(conns, c.conn)
	}
	h.mu.RUnlock()
	for _, conn := range conns {
		conn.Close()
	}
}

// DisconnectDeviceOnly закрывает WS-соединение конкретного устройства пользователя.
func (h *Hub) DisconnectDeviceOnly(userID, deviceID string) {
	h.mu.RLock()
	set := h.byUser[userID]
	var toClose []*websocket.Conn
	for c := range set {
		if c.deviceID == deviceID {
			toClose = append(toClose, c.conn)
		}
	}
	h.mu.RUnlock()
	for _, conn := range toClose {
		conn.Close()
	}
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
	// deviceID="" — проверяем суммарный запас по всем устройствам пользователя
	count, err := db.CountFreePreKeys(h.db, userID, "")
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

// StartCleaner запускает фоновую горутину, которая каждые 30 секунд удаляет
// просроченные сообщения и рассылает участникам WS-фрейм message_expired.
func (h *Hub) StartCleaner() {
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			nowMs := time.Now().UnixMilli()
			expired, err := db.DeleteExpiredMessages(h.db, nowMs)
			if err != nil {
				log.Printf("cleaner: delete expired: %v", err)
				continue
			}
			for _, e := range expired {
				payload, _ := json.Marshal(map[string]any{
					"type":      "message_expired",
					"messageId": e.ID,
					"chatId":    e.ConversationID,
				})
				h.BroadcastToConversation(e.ConversationID, payload)
			}
		}
	}()
}

// ─── Incoming message types ───────────────────────────────────────────────────

type inMsg struct {
	Type string `json:"type"`

	// type:"message"
	ChatID      string      `json:"chatId"`
	Recipients  []recipient `json:"recipients"` // per-user encrypted payload
	SenderKeyID int64       `json:"senderKeyId"`
	ClientMsgID string      `json:"clientMsgId"`
	ReplyToID   string      `json:"replyToId,omitempty"`
	TtlSeconds  int64       `json:"ttlSeconds,omitempty"` // 0 = использовать default_ttl чата

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
	DeviceID   string `json:"deviceId"` // пустая строка = доставить всем устройствам пользователя
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
		case "call_offer":
			h.handleCallOffer(c, msg)
		case "call_answer":
			h.handleCallAnswer(c, msg)
		case "call_end":
			h.handleCallEnd(c, msg)
		case "call_reject":
			h.handleCallReject(c, msg)
		case "ice_candidate":
			h.handleIceCandidate(c, msg)
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

	// Вычисляем expires_at: явный ttlSeconds из сообщения > default_ttl чата > nil.
	var expiresAt sql.NullInt64
	ttl := msg.TtlSeconds
	if ttl == 0 {
		if defTTL, ok, _ := db.GetConversationDefaultTTL(h.db, msg.ChatID); ok {
			ttl = defTTL
		}
	}
	if ttl >= 5 && ttl <= 604800 {
		expiresAt = sql.NullInt64{Int64: now + ttl*1000, Valid: true}
	}

	for _, r := range msg.Recipients {
		if r.UserID != c.userID {
			member, err := db.IsConversationMember(h.db, msg.ChatID, r.UserID)
			if err != nil || !member {
				continue
			}
		}
		msgID := uuid.New().String()
		if err := db.SaveMessage(h.db, db.Message{
			ID:                  msgID,
			ClientMsgID:         msg.ClientMsgID,
			ConversationID:      msg.ChatID,
			SenderID:            c.userID,
			RecipientID:         r.UserID,
			DestinationDeviceID: r.DeviceID,
			Ciphertext:          r.Ciphertext,
			SenderKeyID:         msg.SenderKeyID,
			ReplyToID:           msg.ReplyToID,
			CreatedAt:           now,
			ExpiresAt:           expiresAt,
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

		frame := map[string]any{
			"type":           "message",
			"messageId":      deliveredMsgID,
			"clientMsgId":    msg.ClientMsgID,
			"chatId":         msg.ChatID,
			"senderId":       c.userID,
			"senderDeviceId": c.deviceID,
			"ciphertext":     r.Ciphertext,
			"senderKeyId":    msg.SenderKeyID,
			"timestamp":      now,
			"replyToId":      msg.ReplyToID,
		}
		if expiresAt.Valid {
			frame["expiresAt"] = expiresAt.Int64
		}
		payload, _ := json.Marshal(frame)
		// Если задан deviceId получателя — доставляем только на это устройство
		if r.DeviceID != "" {
			h.DeliverToDevice(r.UserID, r.DeviceID, payload)
		} else {
			h.Deliver(r.UserID, payload)
		}

		if h.IsOnline(r.UserID) {
			db.MarkDelivered(h.db, msgID, now)
		} else if r.UserID != c.userID {
			// Получатель offline — отправляем push-уведомление (web + native)
			pushPayload, _ := json.Marshal(map[string]any{
				"type":   "message",
				"chatId": msg.ChatID,
			})
			go push.SendNotification(h.db, h.vapidPrivate, h.vapidPublic, r.UserID, pushPayload)
			go push.SendNativeNotification(h.db, h.nativePush, r.UserID, "New message", "You have a new message")
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

	// Доставляем webhook всем ботам-участникам чата.
	go h.deliverBotWebhooks(msg.ChatID, c.userID, msg.ClientMsgID, now)
}

// deliverBotWebhooks находит активных ботов чата и отправляет им webhook с метаданными сообщения.
func (h *Hub) deliverBotWebhooks(chatID, senderID, clientMsgID string, timestamp int64) {
	activeBots, err := db.GetActiveBotsByConversation(h.db, chatID)
	if err != nil {
		log.Printf("deliverBotWebhooks: get bots: %v", err)
		return
	}
	for _, b := range activeBots {
		if b.WebhookURL == "" {
			continue
		}
		payload, _ := json.Marshal(map[string]any{
			"event":     "message",
			"chatId":    chatID,
			"senderId":  senderID,
			"messageId": clientMsgID,
			"timestamp": timestamp,
		})
		go bots.DeliverWebhook(b.WebhookURL, payload, b.TokenHash[:16])
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
		member, err := db.IsConversationMember(h.db, msg.ChatID, r.UserID)
		if err != nil || !member {
			continue
		}
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
	ok, err := db.IsConversationMember(h.db, msg.ChatID, c.userID)
	if err != nil || !ok {
		return
	}
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
	// Проверяем, что цель звонка также является участником чата
	okTarget, errTarget := db.IsConversationMember(h.db, msg.ChatID, msg.TargetID)
	if errTarget != nil || !okTarget {
		h.errMsg(c, "forbidden")
		return
	}

	// Создаём сессию заранее (до блокировки) — timer пока nil
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

	// Проверяем занятость цели и атомарно регистрируем сессию в одном lock-блоке,
	// чтобы исключить гонку между time.AfterFunc и вставкой в map.
	busy := false
	h.callsMu.Lock()
	if _, dup := h.calls[callID]; dup {
		busy = true
	}
	for _, s := range h.calls {
		if s.initiatorID == msg.TargetID || s.targetID == msg.TargetID ||
			s.initiatorID == c.userID || s.targetID == c.userID {
			busy = true
			break
		}
	}
	if !busy {
		h.calls[callID] = sess
		sess.timer = time.AfterFunc(30*time.Second, func() {
			h.callsMu.Lock()
			// Проверяем состояние сессии перед действием: если сессия уже
			// завершена или перешла в "active" (ответ поступил прямо перед
			// срабатыванием таймера), игнорируем таймаут.
			cur, ok := h.calls[callID]
			if !ok || cur.state == "active" {
				h.callsMu.Unlock()
				return
			}
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
	}
	h.callsMu.Unlock()

	if busy {
		busyMsg, _ := json.Marshal(map[string]any{
			"type":   "call_busy",
			"callId": msg.CallID,
		})
		h.Deliver(c.userID, busyMsg)
		return
	}

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

// handleCallAnswer обрабатывает ответ на звонок от целевого пользователя.
// Останавливает таймер ожидания, переводит сессию в "active" и пересылает SDP инициатору.
func (h *Hub) handleCallAnswer(c *client, msg inMsg) {
	if msg.CallID == "" || msg.SDP == "" {
		h.errMsg(c, "callId and sdp required")
		return
	}
	h.callsMu.Lock()
	sess, ok := h.calls[msg.CallID]
	if !ok || sess.targetID != c.userID {
		h.callsMu.Unlock()
		h.errMsg(c, "call not found")
		return
	}
	if sess.timer != nil {
		sess.timer.Stop()
	}
	sess.state = "active"
	initiatorID := sess.initiatorID
	callID := msg.CallID
	// Таймер максимальной длительности активного звонка (4 часа).
	// Защищает от утечки сессии при одновременном разрыве соединений обоих участников.
	sess.timer = time.AfterFunc(4*time.Hour, func() {
		h.callsMu.Lock()
		cur, ok := h.calls[callID]
		if !ok {
			h.callsMu.Unlock()
			return
		}
		delete(h.calls, callID)
		h.callsMu.Unlock()
		expired, _ := json.Marshal(map[string]any{
			"type":   "call_end",
			"callId": callID,
			"reason": "max_duration",
		})
		h.Deliver(cur.initiatorID, expired)
		h.Deliver(cur.targetID, expired)
	})
	h.callsMu.Unlock()

	answer, _ := json.Marshal(map[string]any{
		"type":   "call_answer",
		"callId": msg.CallID,
		"sdp":    msg.SDP,
	})
	h.Deliver(initiatorID, answer)
}

// handleCallEnd завершает активный звонок. Уведомляет обоих участников (кроме отправителя)
// и удаляет сессию из map.
func (h *Hub) handleCallEnd(c *client, msg inMsg) {
	if msg.CallID == "" {
		h.errMsg(c, "callId required")
		return
	}
	h.callsMu.Lock()
	sess, ok := h.calls[msg.CallID]
	if !ok {
		h.callsMu.Unlock()
		return
	}
	if sess.initiatorID != c.userID && sess.targetID != c.userID {
		h.callsMu.Unlock()
		h.errMsg(c, "call not found")
		return
	}
	if sess.timer != nil {
		sess.timer.Stop()
	}
	delete(h.calls, msg.CallID)
	initiatorID := sess.initiatorID
	targetID := sess.targetID
	h.callsMu.Unlock()

	end, _ := json.Marshal(map[string]any{
		"type":   "call_end",
		"callId": msg.CallID,
		"reason": "hangup",
	})
	if c.userID != initiatorID {
		h.Deliver(initiatorID, end)
	}
	if c.userID != targetID {
		h.Deliver(targetID, end)
	}
}

// handleCallReject обрабатывает отклонение звонка целевым пользователем.
// Уведомляет только инициатора и удаляет сессию.
func (h *Hub) handleCallReject(c *client, msg inMsg) {
	if msg.CallID == "" {
		h.errMsg(c, "callId required")
		return
	}
	h.callsMu.Lock()
	sess, ok := h.calls[msg.CallID]
	if !ok {
		h.callsMu.Unlock()
		return
	}
	if sess.targetID != c.userID {
		h.callsMu.Unlock()
		h.errMsg(c, "call not found")
		return
	}
	if sess.timer != nil {
		sess.timer.Stop()
	}
	initiatorID := sess.initiatorID
	delete(h.calls, msg.CallID)
	h.callsMu.Unlock()

	reject, _ := json.Marshal(map[string]any{
		"type":   "call_reject",
		"callId": msg.CallID,
	})
	h.Deliver(initiatorID, reject)
}

// handleIceCandidate ретранслирует ICE-кандидата собеседнику в звонке.
func (h *Hub) handleIceCandidate(c *client, msg inMsg) {
	if msg.CallID == "" || len(msg.Candidate) == 0 {
		h.errMsg(c, "callId and candidate required")
		return
	}
	h.callsMu.Lock()
	sess, ok := h.calls[msg.CallID]
	if !ok {
		h.callsMu.Unlock()
		return
	}
	var peerID string
	if c.userID == sess.initiatorID {
		peerID = sess.targetID
	} else if c.userID == sess.targetID {
		peerID = sess.initiatorID
	} else {
		h.callsMu.Unlock()
		h.errMsg(c, "not a participant")
		return
	}
	h.callsMu.Unlock()

	payload, _ := json.Marshal(map[string]any{
		"type":      "ice_candidate",
		"callId":    msg.CallID,
		"candidate": msg.Candidate,
	})
	h.Deliver(peerID, payload)
}

// cleanupCallsForUser завершает все звонки пользователя при разрыве соединения.
func (h *Hub) cleanupCallsForUser(userID string) {
	h.callsMu.Lock()
	type callCleanup struct {
		callID string
		peerID string
	}
	var toClean []callCleanup
	for id, s := range h.calls {
		if s.initiatorID == userID || s.targetID == userID {
			if s.timer != nil {
				s.timer.Stop()
			}
			peer := s.targetID
			if s.initiatorID != userID {
				peer = s.initiatorID
			}
			toClean = append(toClean, callCleanup{callID: id, peerID: peer})
			delete(h.calls, id)
		}
	}
	h.callsMu.Unlock()

	for _, cc := range toClean {
		end, _ := json.Marshal(map[string]any{
			"type":   "call_end",
			"callId": cc.callID,
			"reason": "hangup",
		})
		h.Deliver(cc.peerID, end)
	}
}

// ─── GroupCall WS frames ──────────────────────────────────────────────────────

type callRoomCreatedMsg struct {
	Type      string `json:"type"`
	RoomID    string `json:"roomId"`
	ChatID    string `json:"chatId"`
	CreatorID string `json:"creatorId"`
}

type callParticipantJoinedMsg struct {
	Type     string `json:"type"`
	RoomID   string `json:"roomId"`
	ChatID   string `json:"chatId"`
	UserID   string `json:"userId"`
	DeviceID string `json:"deviceId,omitempty"`
}

type callParticipantLeftMsg struct {
	Type   string `json:"type"`
	RoomID string `json:"roomId"`
	ChatID string `json:"chatId"`
	UserID string `json:"userId"`
}

type callTrackAddedMsg struct {
	Type   string `json:"type"`
	RoomID string `json:"roomId"`
	ChatID string `json:"chatId"`
	UserID string `json:"userId"`
	Kind   string `json:"kind"` // "audio" | "video"
}

// BroadcastRoomCreated рассылает всем участникам чата событие создания комнаты группового звонка.
func (h *Hub) BroadcastRoomCreated(chatID, roomID, creatorID string) {
	payload, _ := json.Marshal(callRoomCreatedMsg{
		Type:      "call_room_created",
		RoomID:    roomID,
		ChatID:    chatID,
		CreatorID: creatorID,
	})
	h.BroadcastToConversation(chatID, payload)
}

// BroadcastParticipantJoined рассылает всем участникам чата событие входа в групповой звонок.
func (h *Hub) BroadcastParticipantJoined(chatID, roomID, userID, deviceID string) {
	payload, _ := json.Marshal(callParticipantJoinedMsg{
		Type:     "call_participant_joined",
		RoomID:   roomID,
		ChatID:   chatID,
		UserID:   userID,
		DeviceID: deviceID,
	})
	h.BroadcastToConversation(chatID, payload)
}

// BroadcastParticipantLeft рассылает всем участникам чата событие выхода из группового звонка.
func (h *Hub) BroadcastParticipantLeft(chatID, roomID, userID string) {
	payload, _ := json.Marshal(callParticipantLeftMsg{
		Type:   "call_participant_left",
		RoomID: roomID,
		ChatID: chatID,
		UserID: userID,
	})
	h.BroadcastToConversation(chatID, payload)
}

// BroadcastTrackAdded рассылает всем участникам чата событие добавления медиа-трека.
func (h *Hub) BroadcastTrackAdded(chatID, roomID, userID, kind string) {
	payload, _ := json.Marshal(callTrackAddedMsg{
		Type:   "call_track_added",
		RoomID: roomID,
		ChatID: chatID,
		UserID: userID,
		Kind:   kind,
	})
	h.BroadcastToConversation(chatID, payload)
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
