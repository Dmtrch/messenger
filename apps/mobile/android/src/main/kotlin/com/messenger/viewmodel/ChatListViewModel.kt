// src/main/kotlin/com/messenger/viewmodel/ChatListViewModel.kt
package com.messenger.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import com.messenger.store.ChatItem
import com.messenger.store.ChatStore
import kotlinx.coroutines.flow.StateFlow

class ChatListViewModel(
    application: Application,
    private val chatStore: ChatStore,
) : AndroidViewModel(application) {
    val chats: StateFlow<List<ChatItem>> = chatStore.chats
}
