// WSOrchestrator.swift — WebSocket на URLSessionWebSocketTask с reconnect.
// Зеркало WSOrchestrator.kt (Android).
// Парсит входящие WS-фреймы и обновляет ChatStore.

import Foundation

final class WSOrchestrator {
    private let sessionManager: SessionManager
    private let chatStore: ChatStore
    private let db: DatabaseManager
    private let currentUserId: String

    // Call callbacks
    var onCallOffer:     ((String, String, String, Bool, String) -> Void)?  // callId, chatId, fromUserId, isVideo, sdp
    var onCallAnswer:    ((String, String) -> Void)?                         // callId, sdp
    var onIceCandidate:  ((String, String, String, Int) -> Void)?            // callId, candidate, sdpMid, sdpMLineIndex
    var onCallEnd:       ((String) -> Void)?                                 // callId

    // Замыкание для отправки фрейма через WebSocket (устанавливает AppViewModel)
    var sendFrame: ((String) -> Void)?

    init(sessionManager: SessionManager, chatStore: ChatStore,
         db: DatabaseManager, currentUserId: String) {
        self.sessionManager = sessionManager
        self.chatStore      = chatStore
        self.db             = db
        self.currentUserId  = currentUserId
    }

    // MARK: - Frame dispatch

    func onFrame(_ text: String) {
        guard let data = text.data(using: .utf8),
              let obj  = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = obj["type"] as? String else { return }

        switch type {
        case "message":         handleMessage(obj)
        case "ack":             handleAck(obj)
        case "typing":          handleTyping(obj)
        case "read":            handleRead(obj)
        case "message_deleted": handleDeleted(obj)
        case "message_edited":  handleEdited(obj)
        case "skdm":            handleSKDM(obj)
        case "call_offer":      handleCallOffer(obj)
        case "call_answer":     handleCallAnswer(obj)
        case "ice_candidate":   handleIceCandidate(obj)
        case "call_end",
             "call_reject":     handleCallEnd(obj)
        default:                break
        }
    }

    // MARK: - Message handlers

    private func handleMessage(_ obj: [String: Any]) {
        guard let chatId      = obj["chatId"]      as? String,
              let senderId    = obj["senderId"]    as? String,
              let ciphertext  = obj["ciphertext"]  as? String,
              let messageId   = obj["messageId"]   as? String else { return }

        let clientMsgId    = (obj["clientMsgId"]    as? String) ?? messageId
        let senderDeviceId = (obj["senderDeviceId"] as? String) ?? senderId
        let timestamp      = (obj["timestamp"]      as? Int64) ?? Int64(Date().timeIntervalSince1970 * 1000)
        let isGroup        = chatStore.isGroup(chatId)

        guard let plaintext = decrypt(ciphertext: ciphertext, chatId: chatId,
                                      senderId: senderId, senderDeviceId: senderDeviceId,
                                      isGroup: isGroup) else { return }

        let msg = MessageRecord(
            id: messageId, clientMsgId: clientMsgId, chatId: chatId,
            senderId: senderId, plaintext: plaintext, timestamp: timestamp,
            status: "delivered", isDeleted: false
        )
        try? db.insertMessage(msg)

        Task { @MainActor in
            self.chatStore.onMessageReceived(chatId: chatId, clientMsgId: clientMsgId,
                                             plaintext: plaintext, senderId: senderId,
                                             timestamp: timestamp)
        }
    }

    private func handleAck(_ obj: [String: Any]) {
        guard let clientMsgId = obj["clientMsgId"] as? String else { return }
        try? db.updateMessageStatus(clientMsgId: clientMsgId, status: "sent")
        Task { @MainActor in self.chatStore.onMessageStatusUpdate(clientMsgId: clientMsgId, status: "sent") }
    }

    private func handleTyping(_ obj: [String: Any]) {
        guard let chatId = obj["chatId"] as? String,
              let userId = obj["userId"] as? String else { return }
        Task { @MainActor in self.chatStore.onTyping(chatId: chatId, userId: userId) }
    }

    private func handleRead(_ obj: [String: Any]) {
        guard let chatId    = obj["chatId"]    as? String,
              let messageId = obj["messageId"] as? String else { return }
        Task { @MainActor in self.chatStore.onRead(chatId: chatId, messageId: messageId) }
    }

    private func handleDeleted(_ obj: [String: Any]) {
        guard let clientMsgId = obj["clientMsgId"] as? String else { return }
        try? db.softDeleteMessage(clientMsgId: clientMsgId)
        Task { @MainActor in self.chatStore.onMessageDeleted(clientMsgId: clientMsgId) }
    }

    private func handleEdited(_ obj: [String: Any]) {
        guard let clientMsgId  = obj["clientMsgId"]  as? String,
              let ciphertext   = obj["ciphertext"]   as? String,
              let senderId     = obj["senderId"]     as? String,
              let senderDevId  = (obj["senderDeviceId"] as? String) ?? (obj["senderId"] as? String),
              let chatId       = obj["chatId"]       as? String else { return }
        let isGroup = chatStore.isGroup(chatId)
        guard let plaintext = decrypt(ciphertext: ciphertext, chatId: chatId,
                                      senderId: senderId, senderDeviceId: senderDevId,
                                      isGroup: isGroup) else { return }
        Task { @MainActor in self.chatStore.onMessageEdited(clientMsgId: clientMsgId, newPlaintext: plaintext) }
    }

    // MARK: - Call handlers

    private func handleCallOffer(_ obj: [String: Any]) {
        guard let callId   = obj["callId"]   as? String,
              let chatId   = obj["chatId"]   as? String,
              let senderId = (obj["senderId"] ?? obj["senderDeviceId"]) as? String,
              let sdp      = obj["sdp"]      as? String else { return }
        let isVideo = (obj["isVideo"] as? Bool) ?? false
        Task { @MainActor in self.chatStore.onCallOffer(callId: callId, chatId: chatId, fromUserId: senderId, isVideo: isVideo) }
        onCallOffer?(callId, chatId, senderId, isVideo, sdp)
    }

    private func handleCallAnswer(_ obj: [String: Any]) {
        guard let callId = obj["callId"] as? String,
              let sdp    = obj["sdp"]    as? String else { return }
        Task { @MainActor in self.chatStore.onCallAnswer(callId: callId) }
        onCallAnswer?(callId, sdp)
    }

    private func handleIceCandidate(_ obj: [String: Any]) {
        guard let callId       = obj["callId"]       as? String,
              let candidate    = obj["candidate"]    as? String,
              let sdpMid       = obj["sdpMid"]       as? String,
              let sdpMLineIdx  = obj["sdpMLineIndex"] as? Int else { return }
        onIceCandidate?(callId, candidate, sdpMid, sdpMLineIdx)
    }

    private func handleSKDM(_ obj: [String: Any]) {
        guard let chatId         = obj["chatId"]         as? String,
              let senderId       = obj["senderId"]       as? String,
              let senderDeviceId = obj["senderDeviceId"] as? String,
              let ciphertext     = obj["ciphertext"]     as? String else { return }
        try? sessionManager.handleIncomingSKDM(chatId: chatId, senderId: senderId,
                                               senderDeviceId: senderDeviceId,
                                               encodedSkdm: ciphertext)
    }

    private func handleCallEnd(_ obj: [String: Any]) {
        guard let callId = obj["callId"] as? String else { return }
        Task { @MainActor in self.chatStore.onCallEnd(callId: callId) }
        onCallEnd?(callId)
    }

    // MARK: - Decrypt helper (uses SessionManager — web-client compatible)

    private func decrypt(ciphertext: String, chatId: String,
                         senderId: String, senderDeviceId: String, isGroup: Bool) -> String? {
        do {
            if isGroup {
                return try sessionManager.decryptGroupMessage(
                    chatId: chatId, senderId: senderId, encodedPayload: ciphertext)
            } else {
                return try sessionManager.decryptFromDevice(
                    senderId: senderId, senderDeviceId: senderDeviceId, encodedPayload: ciphertext)
            }
        } catch {
            return nil
        }
    }
}
