package ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Call
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import store.MessageItem
import ui.components.MessageBubble
import ui.components.TypingIndicator
import java.awt.FileDialog
import java.awt.Frame
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatWindowScreen(
    chatName: String,
    messages: List<MessageItem>,
    typingUsers: Set<String>,
    currentUserId: String,
    onBack: () -> Unit,
    onSend: (String) -> Unit,
    onSendFile: (File) -> Unit = {},
    onFetchMedia: (suspend (mediaId: String, mediaKey: String) -> ByteArray?)? = null,
    onCall: (() -> Unit)? = null,
) {
    var text by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
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
                actions = {
                    if (onCall != null) {
                        IconButton(onClick = onCall) {
                            Icon(Icons.Default.Call, contentDescription = "Позвонить")
                        }
                    }
                },
            )
        },
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
                        onFetchMedia = onFetchMedia,
                    )
                }
            }
            TypingIndicator(typingUsers)
            Row(
                modifier = Modifier.fillMaxWidth().padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(
                    onClick = {
                        scope.launch {
                            withContext(Dispatchers.Main) {
                                val dialog = FileDialog(Frame(), "Выбрать файл", FileDialog.LOAD)
                                dialog.isVisible = true
                                if (dialog.file != null) {
                                    onSendFile(File(dialog.directory, dialog.file))
                                }
                            }
                        }
                    },
                ) {
                    Icon(Icons.Default.Add, contentDescription = "Прикрепить файл")
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
