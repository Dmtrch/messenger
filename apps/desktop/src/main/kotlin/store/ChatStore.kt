package store

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

// Stub — полная реализация в Task 9
class ChatStore {
    private val _chats = MutableStateFlow<List<ChatItem>>(emptyList())
    val chats: StateFlow<List<ChatItem>> = _chats

    private val _messages = MutableStateFlow<Map<String, List<MessageItem>>>(emptyMap())

    fun isGroup(chatId: String): Boolean =
        _chats.value.find { it.id == chatId }?.isGroup ?: false

    fun onMessageReceived(chatId: String, clientMsgId: String, plaintext: String, senderId: String, timestamp: Long) {
        val newMsg = MessageItem(
            id = clientMsgId,
            clientMsgId = clientMsgId,
            chatId = chatId,
            senderId = senderId,
            plaintext = plaintext,
            timestamp = timestamp,
            status = "delivered",
            isDeleted = false,
        )
        val current = _messages.value.toMutableMap()
        current[chatId] = (current[chatId] ?: emptyList()) + newMsg
        _messages.value = current
    }

    fun onMessageStatusUpdate(clientMsgId: String, status: String) {}
    fun onTyping(chatId: String, userId: String) {}
    fun onRead(chatId: String, messageId: String) {}
    fun onMessageDeleted(clientMsgId: String) {}
    fun onMessageEdited(clientMsgId: String, newPlaintext: String) {}
}
