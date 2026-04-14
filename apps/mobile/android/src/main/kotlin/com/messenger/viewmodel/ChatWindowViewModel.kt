// src/main/kotlin/com/messenger/viewmodel/ChatWindowViewModel.kt
package com.messenger.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.messenger.db.MessengerDatabase
import com.messenger.store.ChatStore
import com.messenger.store.MessageItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class ChatWindowViewModel(
    application: Application,
    val chatId: String,
    private val chatStore: ChatStore,
    private val db: MessengerDatabase,
    private val currentUserId: String,
) : AndroidViewModel(application) {
    private val _messages = MutableStateFlow<List<MessageItem>>(emptyList())
    val messages: StateFlow<List<MessageItem>> = _messages.asStateFlow()

    private val _typingUsers = MutableStateFlow<Set<String>>(emptySet())
    val typingUsers: StateFlow<Set<String>> = _typingUsers.asStateFlow()

    init {
        viewModelScope.launch(Dispatchers.IO) {
            val rows = db.messengerQueries.getMessagesForChat(chatId).executeAsList()
            val dbMessages = rows.map { row ->
                MessageItem(
                    id = row.id, clientMsgId = row.client_msg_id, chatId = row.chat_id,
                    senderId = row.sender_id, plaintext = row.plaintext,
                    timestamp = row.timestamp, status = row.status, isDeleted = row.is_deleted != 0L,
                )
            }
            val existing = chatStore.messages.value[chatId] ?: emptyList()
            val dbIds = dbMessages.map { it.clientMsgId }.toSet()
            val merged = (dbMessages + existing.filter { it.clientMsgId !in dbIds })
                .sortedBy { it.timestamp }
            chatStore.setMessages(chatId, merged)
        }
        viewModelScope.launch {
            chatStore.messages.collect { allMessages ->
                _messages.value = allMessages[chatId] ?: emptyList()
            }
        }
        viewModelScope.launch {
            chatStore.typing.collect { typingMap ->
                _typingUsers.value = typingMap[chatId] ?: emptySet()
            }
        }
    }
}
