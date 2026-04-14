// src/main/kotlin/com/messenger/ui/screens/ChatWindowScreen.kt
package com.messenger.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import coil.ImageLoader
import com.messenger.store.MessageItem
import com.messenger.ui.components.MessageBubble
import com.messenger.ui.components.TypingIndicator

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatWindowScreen(
    chatName: String,
    messages: List<MessageItem>,
    typingUsers: Set<String>,
    currentUserId: String,
    uploadError: String?,
    imageLoader: ImageLoader,
    onBack: () -> Unit,
    onSend: (String) -> Unit,
    onSendFile: (Uri) -> Unit,
    onClearUploadError: () -> Unit,
    onDownloadFile: suspend (mediaId: String, mediaKey: String, originalName: String) -> Unit = { _, _, _ -> },
) {
    var text by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val snackbarHostState = remember { SnackbarHostState() }

    val fileLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri -> uri?.let { onSendFile(it) } }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
    }

    LaunchedEffect(uploadError) {
        if (uploadError != null) {
            snackbarHostState.showSnackbar(uploadError)
            onClearUploadError()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(chatName) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад")
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            LazyColumn(
                modifier = Modifier.weight(1f).padding(horizontal = 8.dp),
                state = listState,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                items(messages, key = { it.clientMsgId }) { msg ->
                    MessageBubble(
                        message = msg,
                        isOwn = msg.senderId == currentUserId,
                        imageLoader = imageLoader,
                        onDownloadFile = onDownloadFile,
                    )
                }
            }
            TypingIndicator(typingUsers)
            Row(
                modifier = Modifier.fillMaxWidth().padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { fileLauncher.launch("*/*") }) {
                    Icon(Icons.Default.AttachFile, "Прикрепить файл")
                }
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Сообщение...") },
                    maxLines = 4,
                )
                Spacer(Modifier.width(8.dp))
                IconButton(
                    onClick = { if (text.isNotBlank()) { onSend(text.trim()); text = "" } },
                ) {
                    Icon(Icons.AutoMirrored.Filled.Send, "Отправить")
                }
            }
        }
    }
}
