package db

import (
	"database/sql"
)

// ─── User ────────────────────────────────────────────────────────────────────

type User struct {
	ID           string
	Username     string
	DisplayName  string
	PasswordHash string
	CreatedAt    int64
}

func CreateUser(db *sql.DB, u User) error {
	_, err := db.Exec(
		`INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (?,?,?,?,?)`,
		u.ID, u.Username, u.DisplayName, u.PasswordHash, u.CreatedAt,
	)
	return err
}

func GetUserByUsername(db *sql.DB, username string) (*User, error) {
	u := &User{}
	err := db.QueryRow(
		`SELECT id, username, display_name, password_hash, created_at FROM users WHERE username=?`, username,
	).Scan(&u.ID, &u.Username, &u.DisplayName, &u.PasswordHash, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return u, err
}

func GetUserByID(db *sql.DB, id string) (*User, error) {
	u := &User{}
	err := db.QueryRow(
		`SELECT id, username, display_name, password_hash, created_at FROM users WHERE id=?`, id,
	).Scan(&u.ID, &u.Username, &u.DisplayName, &u.PasswordHash, &u.CreatedAt)
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
	ID             string
	ClientMsgID    string
	ConversationID string
	SenderID       string
	RecipientID    string
	Ciphertext     []byte
	SenderKeyID    int64
	IsDeleted      bool
	EditedAt       sql.NullInt64
	CreatedAt      int64
	DeliveredAt    sql.NullInt64
	ReadAt         sql.NullInt64
}

func SaveMessage(db *sql.DB, m Message) error {
	_, err := db.Exec(`
		INSERT INTO messages (id, client_msg_id, conversation_id, sender_id, recipient_id, ciphertext, sender_key_id, created_at)
		VALUES (?,?,?,?,?,?,?,?)`,
		m.ID, m.ClientMsgID, m.ConversationID, m.SenderID, m.RecipientID, m.Ciphertext, m.SenderKeyID, m.CreatedAt,
	)
	return err
}

// GetMessages возвращает сообщения чата для конкретного получателя (не удалённые).
func GetMessages(db *sql.DB, conversationID, recipientID string, before int64, limit int) ([]Message, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	args := []any{conversationID, recipientID}
	q := `SELECT id, COALESCE(client_msg_id,''), conversation_id, sender_id, COALESCE(recipient_id,''),
	             ciphertext, sender_key_id, COALESCE(is_deleted,0), edited_at, created_at, delivered_at, read_at
	      FROM messages
	      WHERE conversation_id=? AND (recipient_id=? OR recipient_id='') AND COALESCE(is_deleted,0)=0`
	if before > 0 {
		q += ` AND created_at < ?`
		args = append(args, before)
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
			&m.Ciphertext, &m.SenderKeyID, &isDeleted, &m.EditedAt, &m.CreatedAt, &m.DeliveredAt, &m.ReadAt); err != nil {
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
		       ciphertext, sender_key_id, COALESCE(is_deleted,0), edited_at, created_at, delivered_at, read_at
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
			&m.Ciphertext, &m.SenderKeyID, &isDeleted, &m.EditedAt, &m.CreatedAt, &m.DeliveredAt, &m.ReadAt); err != nil {
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

// ─── Identity Keys (Signal Protocol) ─────────────────────────────────────────

type IdentityKey struct {
	UserID       string
	IKPublic     []byte
	SPKPublic    []byte
	SPKSignature []byte
	SPKId        int
	UpdatedAt    int64
}

func UpsertIdentityKey(db *sql.DB, k IdentityKey) error {
	_, err := db.Exec(`
		INSERT INTO identity_keys (user_id, ik_public, spk_public, spk_signature, spk_id, updated_at)
		VALUES (?,?,?,?,?,?)
		ON CONFLICT(user_id) DO UPDATE SET
			ik_public=excluded.ik_public,
			spk_public=excluded.spk_public,
			spk_signature=excluded.spk_signature,
			spk_id=excluded.spk_id,
			updated_at=excluded.updated_at`,
		k.UserID, k.IKPublic, k.SPKPublic, k.SPKSignature, k.SPKId, k.UpdatedAt,
	)
	return err
}

func GetIdentityKey(db *sql.DB, userID string) (*IdentityKey, error) {
	k := &IdentityKey{}
	err := db.QueryRow(
		`SELECT user_id, ik_public, spk_public, spk_signature, spk_id, updated_at
		 FROM identity_keys WHERE user_id=?`, userID,
	).Scan(&k.UserID, &k.IKPublic, &k.SPKPublic, &k.SPKSignature, &k.SPKId, &k.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return k, err
}

func InsertPreKeys(db *sql.DB, userID string, keys [][]byte) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(`INSERT INTO pre_keys (user_id, key_public) VALUES (?,?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, k := range keys {
		if _, err := stmt.Exec(userID, k); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// PopPreKey atomically returns and marks used one unused pre-key.
func PopPreKey(db *sql.DB, userID string) (id int64, pub []byte, err error) {
	tx, err := db.Begin()
	if err != nil {
		return 0, nil, err
	}
	defer tx.Rollback()

	err = tx.QueryRow(
		`SELECT id, key_public FROM pre_keys WHERE user_id=? AND used=0 LIMIT 1`, userID,
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

func CountFreePreKeys(db *sql.DB, userID string) (int, error) {
	var n int
	err := db.QueryRow(`SELECT COUNT(*) FROM pre_keys WHERE user_id=? AND used=0`, userID).Scan(&n)
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
