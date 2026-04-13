package viewmodel

import db.DatabaseProvider
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import service.ApiClient
import store.ChatStore
import store.MessageItem

class ChatWindowViewModel(
    val chatId: String,
    private val chatStore: ChatStore,
    private val apiClient: ApiClient?,
    private val currentUserId: String,
    private val scope: CoroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob()),
) {
    private val _messages = MutableStateFlow<List<MessageItem>>(emptyList())
    val messages: StateFlow<List<MessageItem>> = _messages.asStateFlow()

    private val _typingUsers = MutableStateFlow<Set<String>>(emptySet())
    val typingUsers: StateFlow<Set<String>> = _typingUsers.asStateFlow()

    init {
        scope.launch {
            val rows = DatabaseProvider.database.messengerQueries
                .getMessagesForChat(chatId).executeAsList()
            val dbMessages = rows.map { row ->
                MessageItem(
                    id = row.id,
                    clientMsgId = row.client_msg_id,
                    chatId = row.chat_id,
                    senderId = row.sender_id,
                    plaintext = row.plaintext,
                    timestamp = row.timestamp,
                    status = row.status,
                    isDeleted = row.is_deleted != 0L,
                )
            }
            // Merge: keep in-memory messages not in DB (newly received via WS)
            val existing = chatStore.messages.value[chatId] ?: emptyList()
            val dbIds = dbMessages.map { it.clientMsgId }.toSet()
            val merged = (dbMessages + existing.filter { it.clientMsgId !in dbIds })
                .sortedBy { it.timestamp }
            chatStore.setMessages(chatId, merged)
        }
        scope.launch {
            chatStore.messages.collect { allMessages ->
                _messages.value = allMessages[chatId] ?: emptyList()
            }
        }
        scope.launch {
            chatStore.typing.collect { typingMap ->
                _typingUsers.value = typingMap[chatId] ?: emptySet()
            }
        }
    }

    fun sendTyping() { }

    fun cancel() { scope.cancel() }
}
