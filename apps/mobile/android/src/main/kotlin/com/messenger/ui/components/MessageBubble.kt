// src/main/kotlin/com/messenger/ui/components/MessageBubble.kt
package com.messenger.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.InsertDriveFile
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil.ImageLoader
import coil.compose.AsyncImage
import com.messenger.store.MessageItem
import com.messenger.ui.coil.EncryptedMediaRequest
import kotlinx.coroutines.launch

@Composable
fun MessageBubble(
    message: MessageItem,
    isOwn: Boolean,
    imageLoader: ImageLoader,
    onDownloadFile: suspend (mediaId: String, mediaKey: String, originalName: String) -> Unit = { _, _, _ -> },
) {
    val alignment = if (isOwn) Alignment.End else Alignment.Start
    val bubbleColor = if (isOwn) MaterialTheme.colorScheme.primaryContainer
                      else MaterialTheme.colorScheme.surfaceVariant

    Column(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp),
        horizontalAlignment = alignment,
    ) {
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = bubbleColor,
            modifier = Modifier.widthIn(max = 280.dp),
        ) {
            Box(modifier = Modifier.padding(8.dp)) {
                when {
                    message.isDeleted -> Text(
                        "Сообщение удалено",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f),
                    )

                    message.mediaId != null &&
                    message.contentType?.startsWith("image/") == true ->
                        AsyncImage(
                            model = EncryptedMediaRequest(message.mediaId, message.mediaKey!!),
                            imageLoader = imageLoader,
                            contentDescription = message.originalName,
                            contentScale = ContentScale.FillWidth,
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(max = 240.dp)
                                .clip(RoundedCornerShape(8.dp)),
                        )

                    message.mediaId != null ->
                        FileCard(
                            originalName = message.originalName ?: "файл",
                            onDownload = {
                                onDownloadFile(
                                    message.mediaId,
                                    message.mediaKey!!,
                                    message.originalName ?: "file",
                                )
                            },
                        )

                    else -> Text(
                        message.plaintext,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}

@Composable
private fun FileCard(originalName: String, onDownload: suspend () -> Unit) {
    var downloading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.padding(4.dp),
    ) {
        Icon(
            Icons.Default.InsertDriveFile,
            contentDescription = null,
            modifier = Modifier.size(32.dp),
        )
        Spacer(Modifier.width(8.dp))
        Text(
            originalName,
            modifier = Modifier.weight(1f),
            maxLines = 2,
            style = MaterialTheme.typography.bodyMedium,
        )
        if (downloading) {
            CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
        } else {
            TextButton(onClick = {
                downloading = true
                scope.launch {
                    try { onDownload() } finally { downloading = false }
                }
            }) { Text("Скачать") }
        }
    }
}
