package store

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class ChatStore {
    private val _chats = MutableStateFlow<List<ChatItem>>(emptyList())
    val chats: StateFlow<List<ChatItem>> = _chats.asStateFlow()

    private val _messages = MutableStateFlow<Map<String, List<MessageItem>>>(emptyMap())
    val messages: StateFlow<Map<String, List<MessageItem>>> = _messages.asStateFlow()

    private val _typing = MutableStateFlow<Map<String, Set<String>>>(emptyMap())
    val typing: StateFlow<Map<String, Set<String>>> = _typing.asStateFlow()

    fun setChats(list: List<ChatItem>) { _chats.value = list }

    fun isGroup(chatId: String): Boolean =
        _chats.value.find { it.id == chatId }?.isGroup ?: false

    fun onMessageReceived(chatId: String, clientMsgId: String, plaintext: String, senderId: String, timestamp: Long) {
        val msg = MessageItem(
            id = clientMsgId, clientMsgId = clientMsgId, chatId = chatId,
            senderId = senderId, plaintext = plaintext, timestamp = timestamp,
            status = "delivered", isDeleted = false,
        )
        val current = _messages.value.toMutableMap()
        current[chatId] = (current[chatId] ?: emptyList()) + msg
        _messages.value = current

        val chats = _chats.value.toMutableList()
        val idx = chats.indexOfFirst { it.id == chatId }
        if (idx >= 0) {
            chats[idx] = chats[idx].copy(lastMessage = plaintext, updatedAt = timestamp)
            _chats.value = chats.sortedByDescending { it.updatedAt }
        }
    }

    fun onMessageStatusUpdate(clientMsgId: String, status: String) {
        val updated = _messages.value.mapValues { (_, msgs) ->
            msgs.map { if (it.clientMsgId == clientMsgId) it.copy(status = status) else it }
        }
        _messages.value = updated
    }

    fun onTyping(chatId: String, userId: String) {
        val current = _typing.value.toMutableMap()
        current[chatId] = (current[chatId] ?: emptySet()) + userId
        _typing.value = current
    }

    fun onRead(chatId: String, messageId: String) {
        onMessageStatusUpdate(messageId, "read")
    }

    fun onMessageDeleted(clientMsgId: String) {
        val updated = _messages.value.mapValues { (_, msgs) ->
            msgs.map { if (it.clientMsgId == clientMsgId) it.copy(isDeleted = true) else it }
                .filter { !it.isDeleted }
        }
        _messages.value = updated
    }

    fun onMessageEdited(clientMsgId: String, newPlaintext: String) {
        val updated = _messages.value.mapValues { (_, msgs) ->
            msgs.map { if (it.clientMsgId == clientMsgId) it.copy(plaintext = newPlaintext) else it }
        }
        _messages.value = updated
    }

    fun setMessages(chatId: String, msgs: List<MessageItem>) {
        val current = _messages.value.toMutableMap()
        current[chatId] = msgs
        _messages.value = current
    }
}
