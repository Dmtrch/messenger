package db

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ─── User ────────────────────────────────────────────────────────────────────

type User struct {
	ID           string
	Username     string
	DisplayName  string
	PasswordHash string
	Role         string
	CreatedAt    int64
}

func CreateUser(db *sql.DB, u User) error {
	_, err := db.Exec(
		`INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES (?,?,?,?,?,?)`,
		u.ID, u.Username, u.DisplayName, u.PasswordHash, u.Role, u.CreatedAt,
	)
	return err
}

func GetUserByUsername(db *sql.DB, username string) (*User, error) {
	u := &User{}
	err := db.QueryRow(
		`SELECT id, username, display_name, password_hash, role, created_at FROM users WHERE username=?`, username,
	).Scan(&u.ID, &u.Username, &u.DisplayName, &u.PasswordHash, &u.Role, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return u, err
}

func GetUserByID(db *sql.DB, id string) (*User, error) {
	u := &User{}
	err := db.QueryRow(
		`SELECT id, username, display_name, password_hash, role, created_at FROM users WHERE id=?`, id,
	).Scan(&u.ID, &u.Username, &u.DisplayName, &u.PasswordHash, &u.Role, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return u, err
}

func SearchUsers(db *sql.DB, query string, limit int) ([]User, error) {
	rows, err := db.Query(
		`SELECT id, username, display_name, created_at FROM users WHERE username LIKE ? LIMIT ?`,
		"%"+query+"%", limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.CreatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

// ─── Sessions (refresh tokens) ───────────────────────────────────────────────

func SaveSession(db *sql.DB, id, userID, tokenHash string, expiresAt int64) error {
	_, err := db.Exec(
		`INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?,?,?,?)`,
		id, userID, tokenHash, expiresAt,
	)
	return err
}

func GetSession(db *sql.DB, tokenHash string) (userID string, expiresAt int64, err error) {
	err = db.QueryRow(
		`SELECT user_id, expires_at FROM sessions WHERE token_hash=?`, tokenHash,
	).Scan(&userID, &expiresAt)
	return
}

func DeleteSession(db *sql.DB, tokenHash string) error {
	_, err := db.Exec(`DELETE FROM sessions WHERE token_hash=?`, tokenHash)
	return err
}

// DeleteUserSessionsExcept удаляет все сессии пользователя кроме текущей.
func DeleteUserSessionsExcept(db *sql.DB, userID, keepTokenHash string) error {
	_, err := db.Exec(`DELETE FROM sessions WHERE user_id=? AND token_hash!=?`, userID, keepTokenHash)
	return err
}

// UpdateUserPassword обновляет bcrypt-хэш пароля пользователя.
func UpdateUserPassword(db *sql.DB, userID, passwordHash string) error {
	_, err := db.Exec(`UPDATE users SET password_hash=? WHERE id=?`, passwordHash, userID)
	return err
}

// ─── Contacts ────────────────────────────────────────────────────────────────

func AddContact(db *sql.DB, userID, contactID string, createdAt int64) error {
	_, err := db.Exec(
		`INSERT OR IGNORE INTO contacts (user_id, contact_id, created_at) VALUES (?,?,?)`,
		userID, contactID, createdAt,
	)
	return err
}

func GetContacts(db *sql.DB, userID string) ([]User, error) {
	rows, err := db.Query(`
		SELECT u.id, u.username, u.display_name, u.created_at
		FROM contacts c
		JOIN users u ON u.id = c.contact_id
		WHERE c.user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var contacts []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.CreatedAt); err != nil {
			return nil, err
		}
		contacts = append(contacts, u)
	}
	return contacts, rows.Err()
}

func DeleteContact(db *sql.DB, userID, contactID string) error {
	_, err := db.Exec(`DELETE FROM contacts WHERE user_id=? AND contact_id=?`, userID, contactID)
	return err
}

// ─── Conversations ───────────────────────────────────────────────────────────

type Conversation struct {
	ID        string
	Type      string
	Name      sql.NullString
	CreatedAt int64
}

func CreateConversation(db *sql.DB, c Conversation, memberIDs []string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(
		`INSERT INTO conversations (id, type, name, created_at) VALUES (?,?,?,?)`,
		c.ID, c.Type, c.Name, c.CreatedAt,
	); err != nil {
		return err
	}

	for _, uid := range memberIDs {
		if _, err := tx.Exec(
			`INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?,?,?)`,
			c.ID, uid, c.CreatedAt,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func GetUserConversations(db *sql.DB, userID string) ([]Conversation, error) {
	rows, err := db.Query(`
		SELECT c.id, c.type, c.name, c.created_at
		FROM conversations c
		JOIN conversation_members cm ON cm.conversation_id = c.id
		WHERE cm.user_id = ?
		ORDER BY c.created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var convs []Conversation
	for rows.Next() {
		var c Conversation
		if err := rows.Scan(&c.ID, &c.Type, &c.Name, &c.CreatedAt); err != nil {
			return nil, err
		}
		convs = append(convs, c)
	}
	return convs, rows.Err()
}

// ConversationSummary — чат с серверными метриками для списка чатов.
type ConversationSummary struct {
	ID          string
	Type        string
	Name        sql.NullString
	CreatedAt   int64
	UpdatedAt   int64  // max created_at сообщений (или CreatedAt если нет сообщений)
	LastMsgID   string // ID последнего сообщения для данного пользователя
	UnreadCount int64  // непрочитанные сообщения от других участников
}

// GetUserConversationSummaries возвращает список чатов с серверными unreadCount и updatedAt.
func GetUserConversationSummaries(db *sql.DB, userID string) ([]ConversationSummary, error) {
	rows, err := db.Query(`
		SELECT
		    c.id, c.type, c.name, c.created_at,
		    COALESCE((
		        SELECT MAX(m_all.created_at) FROM messages m_all
		        WHERE m_all.conversation_id = c.id
		          AND COALESCE(m_all.is_deleted,0) = 0
		    ), c.created_at) AS updated_at,
		    COALESCE((
		        SELECT m_last.id FROM messages m_last
		        WHERE m_last.conversation_id = c.id
		          AND (m_last.recipient_id = ? OR m_last.recipient_id = '')
		          AND COALESCE(m_last.is_deleted,0) = 0
		        ORDER BY m_last.created_at DESC LIMIT 1
		    ), '') AS last_msg_id,
		    (
		        SELECT COUNT(*) FROM messages m_unread
		        WHERE m_unread.conversation_id = c.id
		          AND (m_unread.recipient_id = ? OR m_unread.recipient_id = '')
		          AND COALESCE(m_unread.is_deleted,0) = 0
		          AND m_unread.sender_id != ?
		          AND m_unread.created_at > COALESCE((
		              SELECT cus.last_read_at FROM chat_user_state cus
		              WHERE cus.conversation_id = c.id AND cus.user_id = ?
		          ), 0)
		    ) AS unread_count
		FROM conversations c
		JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ?
		ORDER BY updated_at DESC`,
		userID, userID, userID, userID, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []ConversationSummary
	for rows.Next() {
		var s ConversationSummary
		if err := rows.Scan(&s.ID, &s.Type, &s.Name, &s.CreatedAt, &s.UpdatedAt, &s.LastMsgID, &s.UnreadCount); err != nil {
			return nil, err
		}
		result = append(result, s)
	}
	return result, rows.Err()
}

// UpsertChatUserState обновляет позицию прочитанности пользователя в чате.
// Монотонно: указатель никогда не откатывается назад.
func UpsertChatUserState(db *sql.DB, convID, userID, lastReadMsgID string, lastReadAt int64) error {
	_, err := db.Exec(`
		INSERT INTO chat_user_state (conversation_id, user_id, last_read_msg_id, last_read_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(conversation_id, user_id) DO UPDATE SET
		    last_read_msg_id = CASE WHEN excluded.last_read_at > last_read_at
		                            THEN excluded.last_read_msg_id
		                            ELSE last_read_msg_id END,
		    last_read_at = MAX(last_read_at, excluded.last_read_at)`,
		convID, userID, lastReadMsgID, lastReadAt,
	)
	return err
}

func GetConversationMembers(db *sql.DB, conversationID string) ([]string, error) {
	rows, err := db.Query(
		`SELECT user_id FROM conversation_members WHERE conversation_id=?`, conversationID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func IsConversationMember(db *sql.DB, conversationID, userID string) (bool, error) {
	var n int
	err := db.QueryRow(
		`SELECT COUNT(*) FROM conversation_members WHERE conversation_id=? AND user_id=?`,
		conversationID, userID,
	).Scan(&n)
	return n > 0, err
}

// ─── Messages ────────────────────────────────────────────────────────────────

type Message struct {
	ID                   string
	ClientMsgID          string
	ConversationID       string
	SenderID             string
	RecipientID          string
	DestinationDeviceID  string // пустая строка = доставить всем устройствам
	Ciphertext           []byte
	SenderKeyID          int64
	IsDeleted            bool
	EditedAt             sql.NullInt64
	CreatedAt            int64
	DeliveredAt          sql.NullInt64
	ReadAt               sql.NullInt64
}

func SaveMessage(db *sql.DB, m Message) error {
	_, err := db.Exec(`
		INSERT INTO messages (id, client_msg_id, conversation_id, sender_id, recipient_id, destination_device_id, ciphertext, sender_key_id, created_at)
		VALUES (?,?,?,?,?,?,?,?,?)`,
		m.ID, m.ClientMsgID, m.ConversationID, m.SenderID, m.RecipientID, m.DestinationDeviceID, m.Ciphertext, m.SenderKeyID, m.CreatedAt,
	)
	return err
}

// GetMessageByID возвращает одно сообщение по серверному ID.
func GetMessageByID(db *sql.DB, id string) (*Message, error) {
	m := &Message{}
	var isDeleted int
	err := db.QueryRow(`
		SELECT id, COALESCE(client_msg_id,''), conversation_id, sender_id, COALESCE(recipient_id,''),
		       COALESCE(destination_device_id,''), ciphertext, sender_key_id, COALESCE(is_deleted,0),
		       edited_at, created_at, delivered_at, read_at
		FROM messages WHERE id=?`, id,
	).Scan(&m.ID, &m.ClientMsgID, &m.ConversationID, &m.SenderID, &m.RecipientID,
		&m.DestinationDeviceID, &m.Ciphertext, &m.SenderKeyID, &isDeleted, &m.EditedAt, &m.CreatedAt, &m.DeliveredAt, &m.ReadAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	m.IsDeleted = isDeleted == 1
	return m, nil
}

// GetMessages возвращает сообщения чата для конкретного получателя (не удалённые).
// beforeMsgID — opaque cursor: если задан, возвращаются сообщения строго до этого сообщения.
func GetMessages(db *sql.DB, conversationID, recipientID, beforeMsgID string, limit int) ([]Message, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	args := []any{conversationID, recipientID}
	q := `SELECT id, COALESCE(client_msg_id,''), conversation_id, sender_id, COALESCE(recipient_id,''),
	             COALESCE(destination_device_id,''), ciphertext, sender_key_id, COALESCE(is_deleted,0),
	             edited_at, created_at, delivered_at, read_at
	      FROM messages
	      WHERE conversation_id=? AND (recipient_id=? OR recipient_id='') AND COALESCE(is_deleted,0)=0`
	if beforeMsgID != "" {
		q += ` AND created_at < (SELECT created_at FROM messages WHERE id = ?)`
		args = append(args, beforeMsgID)
	}
	q += ` ORDER BY created_at DESC LIMIT ?`
	args = append(args, limit)

	rows, err := db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var msgs []Message
	for rows.Next() {
		var m Message
		var isDeleted int
		if err := rows.Scan(&m.ID, &m.ClientMsgID, &m.ConversationID, &m.SenderID, &m.RecipientID,
			&m.DestinationDeviceID, &m.Ciphertext, &m.SenderKeyID, &isDeleted, &m.EditedAt, &m.CreatedAt, &m.DeliveredAt, &m.ReadAt); err != nil {
			return nil, err
		}
		m.IsDeleted = isDeleted == 1
		msgs = append(msgs, m)
	}
	return msgs, rows.Err()
}

// GetMessagesByClientMsgID возвращает все копии сообщения (по одной на получателя).
func GetMessagesByClientMsgID(db *sql.DB, clientMsgID string) ([]Message, error) {
	rows, err := db.Query(`
		SELECT id, COALESCE(client_msg_id,''), conversation_id, sender_id, COALESCE(recipient_id,''),
		       COALESCE(destination_device_id,''), ciphertext, sender_key_id, COALESCE(is_deleted,0),
		       edited_at, created_at, delivered_at, read_at
		FROM messages WHERE client_msg_id=?`, clientMsgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var msgs []Message
	for rows.Next() {
		var m Message
		var isDeleted int
		if err := rows.Scan(&m.ID, &m.ClientMsgID, &m.ConversationID, &m.SenderID, &m.RecipientID,
			&m.DestinationDeviceID, &m.Ciphertext, &m.SenderKeyID, &isDeleted, &m.EditedAt, &m.CreatedAt, &m.DeliveredAt, &m.ReadAt); err != nil {
			return nil, err
		}
		m.IsDeleted = isDeleted == 1
		msgs = append(msgs, m)
	}
	return msgs, rows.Err()
}

// DeleteMessages мягко удаляет все копии сообщения. Только отправитель может удалять.
func DeleteMessages(db *sql.DB, clientMsgID, senderID string) error {
	_, err := db.Exec(
		`UPDATE messages SET is_deleted=1 WHERE client_msg_id=? AND sender_id=?`,
		clientMsgID, senderID,
	)
	return err
}

// UpdateMessageCiphertext обновляет шифртекст конкретной копии (для редактирования).
func UpdateMessageCiphertext(db *sql.DB, clientMsgID, senderID, recipientID string, ciphertext []byte, editedAt int64) error {
	_, err := db.Exec(
		`UPDATE messages SET ciphertext=?, edited_at=? WHERE client_msg_id=? AND sender_id=? AND recipient_id=?`,
		ciphertext, editedAt, clientMsgID, senderID, recipientID,
	)
	return err
}

func MarkDelivered(db *sql.DB, msgID string, ts int64) error {
	_, err := db.Exec(`UPDATE messages SET delivered_at=? WHERE id=?`, ts, msgID)
	return err
}

func MarkRead(db *sql.DB, msgID string, ts int64) error {
	_, err := db.Exec(`UPDATE messages SET read_at=? WHERE id=?`, ts, msgID)
	return err
}

// ─── Devices ──────────────────────────────────────────────────────────────────

// Device представляет зарегистрированное устройство пользователя.
type Device struct {
	ID         string
	UserID     string
	DeviceName string
	CreatedAt  int64
	LastSeenAt int64
}

// UpsertDevice создаёт или обновляет запись устройства.
func UpsertDevice(db *sql.DB, d Device) error {
	_, err := db.Exec(`
		INSERT INTO devices (id, user_id, device_name, created_at, last_seen_at)
		VALUES (?,?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET
			device_name=excluded.device_name,
			last_seen_at=excluded.last_seen_at`,
		d.ID, d.UserID, d.DeviceName, d.CreatedAt, d.LastSeenAt,
	)
	return err
}

// GetDeviceByID возвращает устройство по его ID.
func GetDeviceByID(db *sql.DB, id string) (*Device, error) {
	d := &Device{}
	err := db.QueryRow(
		`SELECT id, user_id, device_name, created_at, last_seen_at FROM devices WHERE id=?`, id,
	).Scan(&d.ID, &d.UserID, &d.DeviceName, &d.CreatedAt, &d.LastSeenAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return d, err
}

// GetDevicesByUserID возвращает все устройства пользователя.
func GetDevicesByUserID(db *sql.DB, userID string) ([]Device, error) {
	rows, err := db.Query(
		`SELECT id, user_id, device_name, created_at, last_seen_at FROM devices WHERE user_id=? ORDER BY created_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var devices []Device
	for rows.Next() {
		var d Device
		if err := rows.Scan(&d.ID, &d.UserID, &d.DeviceName, &d.CreatedAt, &d.LastSeenAt); err != nil {
			return nil, err
		}
		devices = append(devices, d)
	}
	return devices, rows.Err()
}

// ─── Identity Keys (Signal Protocol) ─────────────────────────────────────────

type IdentityKey struct {
	UserID       string
	DeviceID     string // ID устройства (пустая строка для старых записей)
	IKPublic     []byte
	SPKPublic    []byte
	SPKSignature []byte
	SPKId        int
	UpdatedAt    int64
}

func UpsertIdentityKey(db *sql.DB, k IdentityKey) error {
	_, err := db.Exec(`
		INSERT INTO identity_keys (user_id, device_id, ik_public, spk_public, spk_signature, spk_id, updated_at)
		VALUES (?,?,?,?,?,?,?)
		ON CONFLICT(user_id, device_id) DO UPDATE SET
			ik_public=excluded.ik_public,
			spk_public=excluded.spk_public,
			spk_signature=excluded.spk_signature,
			spk_id=excluded.spk_id,
			updated_at=excluded.updated_at`,
		k.UserID, nullableString(k.DeviceID), k.IKPublic, k.SPKPublic, k.SPKSignature, k.SPKId, k.UpdatedAt,
	)
	return err
}

// GetIdentityKeysByUserID возвращает все identity keys для всех устройств пользователя.
func GetIdentityKeysByUserID(db *sql.DB, userID string) ([]IdentityKey, error) {
	rows, err := db.Query(
		`SELECT user_id, COALESCE(device_id,''), ik_public, spk_public, spk_signature, spk_id, updated_at
		 FROM identity_keys WHERE user_id=? ORDER BY updated_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []IdentityKey
	for rows.Next() {
		var k IdentityKey
		if err := rows.Scan(&k.UserID, &k.DeviceID, &k.IKPublic, &k.SPKPublic, &k.SPKSignature, &k.SPKId, &k.UpdatedAt); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

func GetIdentityKey(db *sql.DB, userID string) (*IdentityKey, error) {
	k := &IdentityKey{}
	var deviceID sql.NullString
	err := db.QueryRow(
		`SELECT user_id, COALESCE(device_id,''), ik_public, spk_public, spk_signature, spk_id, updated_at
		 FROM identity_keys WHERE user_id=?`, userID,
	).Scan(&k.UserID, &deviceID, &k.IKPublic, &k.SPKPublic, &k.SPKSignature, &k.SPKId, &k.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if deviceID.Valid {
		k.DeviceID = deviceID.String
	}
	return k, err
}

// GetIdentityKeyByIKPublic ищет запись identity_key по публичному ключу устройства.
// Используется для идемпотентной регистрации: один и тот же IK = то же устройство.
func GetIdentityKeyByIKPublic(db *sql.DB, userID string, ikPublic []byte) (*IdentityKey, error) {
	k := &IdentityKey{}
	err := db.QueryRow(
		`SELECT user_id, COALESCE(device_id,''), ik_public, spk_public, spk_signature, spk_id, updated_at
		 FROM identity_keys WHERE user_id=? AND ik_public=?`,
		userID, ikPublic,
	).Scan(&k.UserID, &k.DeviceID, &k.IKPublic, &k.SPKPublic, &k.SPKSignature, &k.SPKId, &k.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return k, nil
}

// nullableString возвращает nil если строка пустая (для SQL NULL).
func nullableString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func InsertPreKeys(db *sql.DB, userID string, keys [][]byte) error {
	return insertPreKeysWithDevice(db, userID, "", keys)
}

// InsertPreKeysForDevice сохраняет одноразовые ключи с привязкой к устройству.
func InsertPreKeysForDevice(db *sql.DB, userID, deviceID string, keys [][]byte) error {
	return insertPreKeysWithDevice(db, userID, deviceID, keys)
}

func insertPreKeysWithDevice(db *sql.DB, userID, deviceID string, keys [][]byte) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(`INSERT INTO pre_keys (user_id, device_id, key_public) VALUES (?,?,?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, k := range keys {
		if _, err := stmt.Exec(userID, nullableString(deviceID), k); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// PopPreKey atomically возвращает и помечает использованным один свободный OPK.
// deviceID должен соответствовать устройству, чей identity_key был выдан GetBundle,
// чтобы не выдать OPK от другого устройства того же пользователя.
func PopPreKey(db *sql.DB, userID, deviceID string) (id int64, pub []byte, err error) {
	tx, err := db.Begin()
	if err != nil {
		return 0, nil, err
	}
	defer tx.Rollback()

	err = tx.QueryRow(
		`SELECT id, key_public FROM pre_keys WHERE user_id=? AND device_id=? AND used=0 LIMIT 1`,
		userID, deviceID,
	).Scan(&id, &pub)
	if err == sql.ErrNoRows {
		return 0, nil, nil
	}
	if err != nil {
		return 0, nil, err
	}
	if _, err := tx.Exec(`UPDATE pre_keys SET used=1 WHERE id=?`, id); err != nil {
		return 0, nil, err
	}
	return id, pub, tx.Commit()
}

// CountFreePreKeys возвращает число неиспользованных OPK.
// Если deviceID непустой — только для данного устройства; иначе — сумма по всем устройствам пользователя.
func CountFreePreKeys(db *sql.DB, userID, deviceID string) (int, error) {
	var n int
	var err error
	if deviceID != "" {
		err = db.QueryRow(
			`SELECT COUNT(*) FROM pre_keys WHERE user_id=? AND device_id=? AND used=0`,
			userID, deviceID,
		).Scan(&n)
	} else {
		err = db.QueryRow(
			`SELECT COUNT(*) FROM pre_keys WHERE user_id=? AND used=0`, userID,
		).Scan(&n)
	}
	return n, err
}

// ─── Push subscriptions ───────────────────────────────────────────────────────

type PushSub struct {
	ID       string
	UserID   string
	Endpoint string
	P256DH   []byte
	Auth     []byte
}

func UpsertPushSub(db *sql.DB, s PushSub) error {
	_, err := db.Exec(`
		INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
		VALUES (?,?,?,?,?)
		ON CONFLICT(id) DO UPDATE SET endpoint=excluded.endpoint, p256dh=excluded.p256dh, auth=excluded.auth`,
		s.ID, s.UserID, s.Endpoint, s.P256DH, s.Auth,
	)
	return err
}

func GetPushSubs(db *sql.DB, userID string) ([]PushSub, error) {
	rows, err := db.Query(
		`SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id=?`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var subs []PushSub
	for rows.Next() {
		var s PushSub
		if err := rows.Scan(&s.ID, &s.UserID, &s.Endpoint, &s.P256DH, &s.Auth); err != nil {
			return nil, err
		}
		subs = append(subs, s)
	}
	return subs, rows.Err()
}

// ─── Media objects ────────────────────────────────────────────────────────────

type MediaObject struct {
	ID             string
	UploaderID     string
	ConversationID string // пустая строка = не привязан к чату
	Filename       string // имя файла на диске
	OriginalName   string
	ContentType    string
	Size           int64
	CreatedAt      int64
}

func InsertMediaObject(db *sql.DB, m MediaObject) error {
	var convID any
	if m.ConversationID != "" {
		convID = m.ConversationID
	}
	_, err := db.Exec(`
		INSERT INTO media_objects (id, uploader_id, conversation_id, filename, original_name, content_type, size, created_at)
		VALUES (?,?,?,?,?,?,?,?)`,
		m.ID, m.UploaderID, convID, m.Filename, m.OriginalName, m.ContentType, m.Size, m.CreatedAt,
	)
	return err
}

func GetMediaObject(db *sql.DB, id string) (*MediaObject, error) {
	m := &MediaObject{}
	err := db.QueryRow(`
		SELECT id, uploader_id, COALESCE(conversation_id,''), filename, original_name, content_type, size, created_at
		FROM media_objects WHERE id=?`, id,
	).Scan(&m.ID, &m.UploaderID, &m.ConversationID, &m.Filename, &m.OriginalName, &m.ContentType, &m.Size, &m.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return m, err
}

// DeleteOrphanedMedia удаляет записи media_objects без привязки к чату
// (conversation_id = ''), созданные раньше olderThanUnixMs.
// Возвращает имена файлов на диске для последующего удаления.
func DeleteOrphanedMedia(db *sql.DB, olderThanUnixMs int64) ([]string, error) {
	rows, err := db.Query(`
		SELECT filename FROM media_objects
		WHERE COALESCE(conversation_id,'') = '' AND created_at < ?`,
		olderThanUnixMs,
	)
	if err != nil {
		return nil, fmt.Errorf("query orphaned media: %w", err)
	}
	defer rows.Close()

	var filenames []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("scan orphaned media: %w", err)
		}
		filenames = append(filenames, name)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate orphaned media: %w", err)
	}

	if len(filenames) == 0 {
		return nil, nil
	}

	if _, err := db.Exec(`
		DELETE FROM media_objects
		WHERE COALESCE(conversation_id,'') = '' AND created_at < ?`,
		olderThanUnixMs,
	); err != nil {
		return nil, fmt.Errorf("delete orphaned media: %w", err)
	}

	return filenames, nil
}

// ─── InviteCodes ─────────────────────────────────────────────────────────────

type InviteCode struct {
	Code      string
	CreatedBy string
	UsedBy    string
	UsedAt    int64
	ExpiresAt int64
	CreatedAt int64
}

func CreateInviteCode(db *sql.DB, code InviteCode) error {
	_, err := db.Exec(
		`INSERT INTO invite_codes (code, created_by, expires_at, created_at) VALUES (?,?,?,?)`,
		code.Code, code.CreatedBy, code.ExpiresAt, code.CreatedAt,
	)
	return err
}

func GetInviteCode(db *sql.DB, code string) (*InviteCode, error) {
	c := &InviteCode{}
	err := db.QueryRow(
		`SELECT code, created_by, COALESCE(used_by,''), COALESCE(used_at,0), COALESCE(expires_at,0), created_at FROM invite_codes WHERE code=?`, code,
	).Scan(&c.Code, &c.CreatedBy, &c.UsedBy, &c.UsedAt, &c.ExpiresAt, &c.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return c, err
}

func UseInviteCode(db *sql.DB, code, usedBy string, usedAt int64) error {
	_, err := db.Exec(
		`UPDATE invite_codes SET used_by=?, used_at=? WHERE code=? AND used_by IS NULL`,
		usedBy, usedAt, code,
	)
	return err
}

func ListInviteCodes(db *sql.DB) ([]InviteCode, error) {
	rows, err := db.Query(
		`SELECT code, created_by, COALESCE(used_by,''), COALESCE(used_at,0), COALESCE(expires_at,0), created_at FROM invite_codes ORDER BY created_at DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var codes []InviteCode
	for rows.Next() {
		var c InviteCode
		if err := rows.Scan(&c.Code, &c.CreatedBy, &c.UsedBy, &c.UsedAt, &c.ExpiresAt, &c.CreatedAt); err != nil {
			return nil, err
		}
		codes = append(codes, c)
	}
	return codes, rows.Err()
}

// ─── RegistrationRequests ────────────────────────────────────────────────────

type RegistrationRequest struct {
	ID           string
	Username     string
	DisplayName  string
	IKPublic     string
	SPKId        int
	SPKPublic    string
	SPKSignature string
	OPKPublics   string // JSON array
	PasswordHash string
	Status       string
	CreatedAt    int64
	ReviewedAt   int64
	ReviewedBy   string
}

func CreateRegistrationRequest(db *sql.DB, r RegistrationRequest) error {
	_, err := db.Exec(
		`INSERT INTO registration_requests (id, username, display_name, ik_public, spk_id, spk_public, spk_signature, opk_publics, password_hash, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
		r.ID, r.Username, r.DisplayName, r.IKPublic, r.SPKId, r.SPKPublic, r.SPKSignature, r.OPKPublics, r.PasswordHash, r.Status, r.CreatedAt,
	)
	return err
}

func GetRegistrationRequest(db *sql.DB, id string) (*RegistrationRequest, error) {
	r := &RegistrationRequest{}
	err := db.QueryRow(
		`SELECT id, username, display_name, ik_public, spk_id, spk_public, spk_signature, opk_publics, password_hash, status, created_at, COALESCE(reviewed_at,0), COALESCE(reviewed_by,'') FROM registration_requests WHERE id=?`, id,
	).Scan(&r.ID, &r.Username, &r.DisplayName, &r.IKPublic, &r.SPKId, &r.SPKPublic, &r.SPKSignature, &r.OPKPublics, &r.PasswordHash, &r.Status, &r.CreatedAt, &r.ReviewedAt, &r.ReviewedBy)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return r, err
}

func ListRegistrationRequests(db *sql.DB, status string) ([]RegistrationRequest, error) {
	var rows *sql.Rows
	var err error
	if status == "" {
		rows, err = db.Query(`SELECT id, username, display_name, status, created_at FROM registration_requests ORDER BY created_at DESC`)
	} else {
		rows, err = db.Query(`SELECT id, username, display_name, status, created_at FROM registration_requests WHERE status=? ORDER BY created_at DESC`, status)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var reqs []RegistrationRequest
	for rows.Next() {
		var r RegistrationRequest
		if err := rows.Scan(&r.ID, &r.Username, &r.DisplayName, &r.Status, &r.CreatedAt); err != nil {
			return nil, err
		}
		reqs = append(reqs, r)
	}
	return reqs, rows.Err()
}

func UpdateRegistrationRequestStatus(db *sql.DB, id, status, reviewedBy string, reviewedAt int64) error {
	_, err := db.Exec(
		`UPDATE registration_requests SET status=?, reviewed_by=?, reviewed_at=? WHERE id=?`,
		status, reviewedBy, reviewedAt, id,
	)
	return err
}

// ─── PasswordResetRequests ───────────────────────────────────────────────────

type PasswordResetRequest struct {
	ID           string
	UserID       string
	Username     string // JOIN из users
	Status       string
	TempPassword string
	CreatedAt    int64
	ResolvedAt   int64
	ResolvedBy   string
}

func CreatePasswordResetRequest(db *sql.DB, id, userID string, createdAt int64) error {
	_, err := db.Exec(
		`INSERT INTO password_reset_requests (id, user_id, status, created_at) VALUES (?,?,'pending',?)`,
		id, userID, createdAt,
	)
	return err
}

func ListPasswordResetRequests(db *sql.DB, status string) ([]PasswordResetRequest, error) {
	query := `SELECT p.id, p.user_id, u.username, p.status, COALESCE(p.temp_password,''), p.created_at, COALESCE(p.resolved_at,0), COALESCE(p.resolved_by,'')
              FROM password_reset_requests p JOIN users u ON u.id=p.user_id`
	var args []any
	if status != "" {
		query += ` WHERE p.status=?`
		args = append(args, status)
	}
	query += ` ORDER BY p.created_at DESC`
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var reqs []PasswordResetRequest
	for rows.Next() {
		var r PasswordResetRequest
		if err := rows.Scan(&r.ID, &r.UserID, &r.Username, &r.Status, &r.TempPassword, &r.CreatedAt, &r.ResolvedAt, &r.ResolvedBy); err != nil {
			return nil, err
		}
		reqs = append(reqs, r)
	}
	return reqs, rows.Err()
}

func ResolvePasswordResetRequest(db *sql.DB, id, tempPassword, resolvedBy string, resolvedAt int64) error {
	_, err := db.Exec(
		`UPDATE password_reset_requests SET status='completed', temp_password=?, resolved_by=?, resolved_at=? WHERE id=?`,
		tempPassword, resolvedBy, resolvedAt, id,
	)
	return err
}

// ─── Admin user list ─────────────────────────────────────────────────────────

func ListUsers(db *sql.DB) ([]User, error) {
	rows, err := db.Query(`SELECT id, username, display_name, role, created_at FROM users ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.Role, &u.CreatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

// EnsureAdminUser создаёт пользователя-администратора если он не существует.
// Вызывается при старте сервера из main.go. Безопасно вызывать многократно.
func EnsureAdminUser(database *sql.DB, username, passwordHash string) error {
	existing, _ := GetUserByUsername(database, username)
	if existing != nil {
		return nil // уже существует — не перезаписываем
	}
	u := User{
		ID:           uuid.New().String(),
		Username:     username,
		DisplayName:  username,
		PasswordHash: passwordHash,
		Role:         "admin",
		CreatedAt:    time.Now().UnixMilli(),
	}
	return CreateUser(database, u)
}
