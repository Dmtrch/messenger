// src/main/kotlin/com/messenger/ui/screens/ChatListScreen.kt
package com.messenger.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.messenger.store.ChatItem

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatListScreen(
    chats: List<ChatItem>,
    onChatClick: (String) -> Unit,
    onProfileClick: () -> Unit,
    onNewChatClick: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Чаты") },
                actions = { TextButton(onClick = onProfileClick) { Text("Профиль") } },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = onNewChatClick) {
                Icon(Icons.Default.Add, contentDescription = "Новый чат")
            }
        }
    ) { padding ->
        LazyColumn(modifier = Modifier.padding(padding)) {
            items(chats, key = { it.id }) { chat ->
                ListItem(
                    headlineContent = { Text(chat.name) },
                    supportingContent = { chat.lastMessage?.let { Text(it, maxLines = 1) } },
                    modifier = Modifier.clickable { onChatClick(chat.id) },
                )
                HorizontalDivider()
            }
        }
    }
}
