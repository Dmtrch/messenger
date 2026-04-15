package store

data class ChatItem(
    val id: String,
    val name: String,
    val isGroup: Boolean,
    val lastMessage: String?,
    val updatedAt: Long,
    val unreadCount: Int = 0,
    val members: List<String> = emptyList(),
)

enum class CallStatus { IDLE, RINGING_IN, RINGING_OUT, ACTIVE }

data class CallState(
    val status: CallStatus = CallStatus.IDLE,
    val callId: String = "",
    val chatId: String = "",
    val remoteUserId: String = "",
    val isVideo: Boolean = false,
    val hasLocalVideo: Boolean = false,
    val hasRemoteVideo: Boolean = false,
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
    val mediaId: String? = null,
    val mediaKey: String? = null,
    val originalName: String? = null,
    val contentType: String? = null,
)

data class AuthState(
    val isAuthenticated: Boolean = false,
    val userId: String = "",
    val username: String = "",
    val accessToken: String = "",
)
