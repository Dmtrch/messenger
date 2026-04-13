package viewmodel

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.StateFlow
import store.ChatItem
import store.ChatStore

class ChatListViewModel(
    private val chatStore: ChatStore,
    private val scope: CoroutineScope = CoroutineScope(Dispatchers.Main),
) {
    val chats: StateFlow<List<ChatItem>> = chatStore.chats
}
