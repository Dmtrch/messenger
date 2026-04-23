// ChatStore.swift — реактивное хранилище состояния чатов.
// Зеркало ChatStore.kt (Android).
// @MainActor гарантирует обновление @Published только на главном потоке.

import Foundation
import Combine

@MainActor
final class ChatStore: ObservableObject {

    @Published private(set) var chats: [ChatItem] = []
    @Published private(set) var messages: [String: [MessageItem]] = [:]
    @Published private(set) var typing: [String: Set<String>] = [:]
    @Published private(set) var callState = CallState()
    @Published var callError: String? = nil

    func setCallError(_ message: String) { callError = message }
    func clearCallError() { callError = nil }

    // MARK: - Chats

    func setChats(_ list: [ChatItem]) { chats = list }

    func isGroup(_ chatId: String) -> Bool {
        chats.first(where: { $0.id == chatId })?.isGroup ?? false
    }

    // MARK: - Messages

    func setMessages(chatId: String, msgs: [MessageItem]) {
        messages[chatId] = msgs
    }

    func addMessage(chatId: String, item: MessageItem) {
        var list = messages[chatId] ?? []
        list.append(item)
        list.sort { $0.timestamp < $1.timestamp }
        messages[chatId] = list
    }

    func onMessageReceived(chatId: String, clientMsgId: String, plaintext: String,
                           senderId: String, timestamp: Int64) {
        let msg = MessageItem(
            id: clientMsgId, clientMsgId: clientMsgId, chatId: chatId,
            senderId: senderId, plaintext: plaintext, timestamp: timestamp,
            status: "delivered", isDeleted: false
        )
        addMessage(chatId: chatId, item: msg)

        // Обновить последнее сообщение в списке чатов
        if let idx = chats.firstIndex(where: { $0.id == chatId }) {
            var chat = chats[idx]
            chat.lastMessage = plaintext
            chat.updatedAt = timestamp
            chats[idx] = chat
            chats.sort { $0.updatedAt > $1.updatedAt }
        }
    }

    func onMessageStatusUpdate(clientMsgId: String, status: String) {
        messages = messages.mapValues { msgs in
            msgs.map { $0.clientMsgId == clientMsgId ? MessageItem(
                id: $0.id, clientMsgId: $0.clientMsgId, chatId: $0.chatId,
                senderId: $0.senderId, plaintext: $0.plaintext, timestamp: $0.timestamp,
                status: status, isDeleted: $0.isDeleted,
                mediaId: $0.mediaId, mediaKey: $0.mediaKey,
                originalName: $0.originalName, contentType: $0.contentType
            ) : $0 }
        }
    }

    func onMessageDeleted(clientMsgId: String) {
        messages = messages.mapValues { msgs in
            msgs.filter { $0.clientMsgId != clientMsgId }
        }
    }

    func onMessageEdited(clientMsgId: String, newPlaintext: String) {
        messages = messages.mapValues { msgs in
            msgs.map { m in
                guard m.clientMsgId == clientMsgId else { return m }
                return MessageItem(
                    id: m.id, clientMsgId: m.clientMsgId, chatId: m.chatId,
                    senderId: m.senderId, plaintext: newPlaintext, timestamp: m.timestamp,
                    status: m.status, isDeleted: m.isDeleted,
                    mediaId: m.mediaId, mediaKey: m.mediaKey,
                    originalName: m.originalName, contentType: m.contentType
                )
            }
        }
    }

    // MARK: - Typing

    func onTyping(chatId: String, userId: String) {
        var t = typing[chatId] ?? []
        t.insert(userId)
        typing[chatId] = t
    }

    func onTypingStop(chatId: String, userId: String) {
        var t = typing[chatId] ?? []
        t.remove(userId)
        typing[chatId] = t.isEmpty ? nil : t
    }

    // MARK: - Calls

    func onCallOffer(callId: String, chatId: String, fromUserId: String, isVideo: Bool = false) {
        callState = CallState(status: .ringingIn, callId: callId, chatId: chatId,
                              remoteUserId: fromUserId, isVideo: isVideo)
    }

    func onCallAnswer(callId: String) {
        guard callState.callId == callId else { return }
        callState = CallState(status: .active, callId: callId, chatId: callState.chatId,
                              remoteUserId: callState.remoteUserId, isVideo: callState.isVideo)
    }

    func setOutgoingCall(callId: String, chatId: String, targetId: String, isVideo: Bool) {
        callState = CallState(status: .ringingOut, callId: callId, chatId: chatId,
                              remoteUserId: targetId, isVideo: isVideo)
    }

    func onCallEnd(callId: String) {
        if callState.callId == callId { callState = CallState() }
    }

    func markLocalVideoReady()  { callState.hasLocalVideo  = true }
    func markRemoteVideoReady() { callState.hasRemoteVideo = true }

    func clearCall() { callState = CallState() }

    func onRead(chatId: String, messageId: String) {
        onMessageStatusUpdate(clientMsgId: messageId, status: "read")
    }
}
