// DatabaseManager.swift — локальная SQLite база данных через GRDB.
// Зеркало schema v2 из Android (4 media-колонки в message).
// Схема версионируется через DatabaseMigrator.

import GRDB
import Foundation

// MARK: - Record types

struct ChatRecord: Codable, FetchableRecord, MutablePersistableRecord {
    static let databaseTableName = "chat"
    var id: String
    var name: String
    var isGroup: Bool
    var updatedAt: Int64
    var members: String   // JSON: ["userId1", "userId2"]

    enum CodingKeys: String, CodingKey {
        case id, name, members
        case isGroup   = "is_group"
        case updatedAt = "updated_at"
    }
}

struct MessageRecord: Codable, FetchableRecord, MutablePersistableRecord {
    static let databaseTableName = "message"
    var id: String
    var clientMsgId: String
    var chatId: String
    var senderId: String
    var plaintext: String
    var timestamp: Int64
    var status: String
    var isDeleted: Bool
    var mediaId: String?
    var mediaKey: String?
    var originalName: String?
    var contentType: String?

    enum CodingKeys: String, CodingKey {
        case id, plaintext, timestamp, status
        case clientMsgId  = "client_msg_id"
        case chatId       = "chat_id"
        case senderId     = "sender_id"
        case isDeleted    = "is_deleted"
        case mediaId      = "media_id"
        case mediaKey     = "media_key"
        case originalName = "original_name"
        case contentType  = "content_type"
    }
}

struct RatchetSessionRecord: Codable, FetchableRecord, MutablePersistableRecord {
    static let databaseTableName = "ratchet_session"
    var sessionKey: String
    var chainKeyBlob: Data

    enum CodingKeys: String, CodingKey {
        case chainKeyBlob = "chain_key_blob"
        case sessionKey   = "session_key"
    }
}

struct OutboxRecord: Codable, FetchableRecord, MutablePersistableRecord {
    static let databaseTableName = "outbox"
    var clientMsgId: String
    var chatId: String
    var payload: String  // JSON
    var createdAt: Int64

    enum CodingKeys: String, CodingKey {
        case payload
        case clientMsgId = "client_msg_id"
        case chatId      = "chat_id"
        case createdAt   = "created_at"
    }
}

// MARK: - DatabaseManager

final class DatabaseManager {
    let dbQueue: DatabaseQueue

    init() throws {
        let docDir = try FileManager.default.url(
            for: .documentDirectory, in: .userDomainMask,
            appropriateFor: nil, create: true
        )
        let dbPath = docDir.appendingPathComponent("messenger.sqlite").path
        dbQueue = try DatabaseQueue(path: dbPath)
        try migrate()
    }

    private func migrate() throws {
        var migrator = DatabaseMigrator()

        migrator.registerMigration("v1") { db in
            try db.create(table: "chat", ifNotExists: true) { t in
                t.column("id", .text).primaryKey()
                t.column("name", .text).notNull()
                t.column("is_group", .integer).notNull().defaults(to: 0)
                t.column("updated_at", .integer).notNull().defaults(to: 0)
                t.column("members", .text).notNull().defaults(to: "[]")
            }
            try db.create(table: "message", ifNotExists: true) { t in
                t.column("id", .text).primaryKey()
                t.column("client_msg_id", .text).notNull()
                t.column("chat_id", .text).notNull()
                t.column("sender_id", .text).notNull()
                t.column("plaintext", .text).notNull()
                t.column("timestamp", .integer).notNull()
                t.column("status", .text).notNull().defaults(to: "sending")
                t.column("is_deleted", .integer).notNull().defaults(to: 0)
                t.column("media_id", .text)
                t.column("media_key", .text)
                t.column("original_name", .text)
                t.column("content_type", .text)
            }
            try db.create(table: "ratchet_session", ifNotExists: true) { t in
                t.column("session_key", .text).primaryKey()
                t.column("chain_key_blob", .blob).notNull()
            }
            try db.create(table: "outbox", ifNotExists: true) { t in
                t.column("client_msg_id", .text).primaryKey()
                t.column("chat_id", .text).notNull()
                t.column("payload", .text).notNull()
                t.column("created_at", .integer).notNull()
            }
        }

        try migrator.migrate(dbQueue)
    }

    // MARK: - Chat queries

    func upsertChat(_ chat: ChatRecord) throws {
        try dbQueue.write { db in
            try chat.save(db)
        }
    }

    func loadChats() throws -> [ChatRecord] {
        try dbQueue.read { db in
            try ChatRecord.order(Column("updated_at").desc).fetchAll(db)
        }
    }

    // MARK: - Message queries

    func insertMessage(_ msg: MessageRecord) throws {
        try dbQueue.write { db in
            try msg.insert(db, onConflict: .ignore)
        }
    }

    func loadMessages(chatId: String, limit: Int = 50) throws -> [MessageRecord] {
        try dbQueue.read { db in
            try MessageRecord
                .filter(Column("chat_id") == chatId)
                .filter(Column("is_deleted") == false)
                .order(Column("timestamp").asc)
                .limit(limit)
                .fetchAll(db)
        }
    }

    func updateMessageStatus(clientMsgId: String, status: String) throws {
        try dbQueue.write { db in
            try db.execute(
                sql: "UPDATE message SET status = ? WHERE client_msg_id = ?",
                arguments: [status, clientMsgId]
            )
        }
    }

    func softDeleteMessage(clientMsgId: String) throws {
        try dbQueue.write { db in
            try db.execute(
                sql: "UPDATE message SET is_deleted = 1 WHERE client_msg_id = ?",
                arguments: [clientMsgId]
            )
        }
    }

    // MARK: - Ratchet session queries

    func saveRatchetSession(sessionKey: String, chainKeyBlob: Data) throws {
        try dbQueue.write { db in
            let rec = RatchetSessionRecord(sessionKey: sessionKey, chainKeyBlob: chainKeyBlob)
            try rec.save(db)
        }
    }

    func loadRatchetSession(sessionKey: String) throws -> Data? {
        try dbQueue.read { db in
            try RatchetSessionRecord.fetchOne(db, key: sessionKey)?.chainKeyBlob
        }
    }

    // MARK: - Outbox queries

    func addOutboxItem(clientMsgId: String, chatId: String, payload: String) throws {
        try dbQueue.write { db in
            let rec = OutboxRecord(
                clientMsgId: clientMsgId, chatId: chatId,
                payload: payload, createdAt: Int64(Date().timeIntervalSince1970 * 1000)
            )
            try rec.save(db)
        }
    }

    func removeOutboxItem(clientMsgId: String) throws {
        try dbQueue.write { db in
            try db.execute(
                sql: "DELETE FROM outbox WHERE client_msg_id = ?",
                arguments: [clientMsgId]
            )
        }
    }

    func loadOutbox() throws -> [OutboxRecord] {
        try dbQueue.read { db in
            try OutboxRecord.order(Column("created_at").asc).fetchAll(db)
        }
    }
}
