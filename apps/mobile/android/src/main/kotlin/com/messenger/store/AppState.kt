// apps/mobile/android/src/main/kotlin/com/messenger/store/AppState.kt
package com.messenger.store

data class ChatItem(
    val id: String,
    val name: String,
    val isGroup: Boolean,
    val lastMessage: String?,
    val updatedAt: Long,
    val unreadCount: Int = 0,
)

data class MessageItem(
    val id: String,
    val clientMsgId: String,
    val chatId: String,
    val senderId: String,
    val plaintext: String,
    val timestamp: Long,
    val status: String,
    val isDeleted: Boolean,
)

data class AuthState(
    val isAuthenticated: Boolean = false,
    val userId: String = "",
    val username: String = "",
    val accessToken: String = "",
)
