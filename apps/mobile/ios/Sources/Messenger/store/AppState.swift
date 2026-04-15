// AppState.swift — доменные типы состояния приложения.
// Зеркало AppState.kt (Android) и AppState.kt (Desktop).

import Foundation

// MARK: - Auth

struct AuthState {
    var isAuthenticated: Bool = false
    var userId: String = ""
    var username: String = ""
    var accessToken: String = ""
}

// MARK: - Chat

struct ChatItem: Identifiable, Hashable {
    let id: String
    var name: String
    var isGroup: Bool
    var lastMessage: String?
    var updatedAt: Int64
    var unreadCount: Int = 0
    var members: [String] = []
}

// MARK: - Message

struct MessageItem: Identifiable {
    let id: String
    var clientMsgId: String
    var chatId: String
    var senderId: String
    var plaintext: String
    var timestamp: Int64
    var status: String
    var isDeleted: Bool
    var mediaId: String? = nil
    var mediaKey: String? = nil
    var originalName: String? = nil
    var contentType: String? = nil
}

// MARK: - Calls

enum CallStatus: Equatable {
    case idle
    case ringingIn
    case ringingOut
    case active
}

struct CallState: Equatable {
    var status: CallStatus = .idle
    var callId: String = ""
    var chatId: String = ""
    var remoteUserId: String = ""
    var isVideo: Bool = false
    var hasLocalVideo: Bool = false
    var hasRemoteVideo: Bool = false
    var errorText: String? = nil
}
