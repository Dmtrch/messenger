package ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.jetbrains.skia.Image as SkiaImage
import store.MessageItem
import java.text.SimpleDateFormat
import java.util.*

@Composable
fun MessageBubble(
    message: MessageItem,
    isOwn: Boolean,
    onFetchMedia: (suspend (mediaId: String, mediaKey: String) -> ByteArray?)? = null,
) {
    val bubbleColor = if (isOwn)
        MaterialTheme.colorScheme.primaryContainer
    else
        MaterialTheme.colorScheme.surfaceVariant

    Box(
        modifier = Modifier.fillMaxWidth(),
        contentAlignment = if (isOwn) Alignment.CenterEnd else Alignment.CenterStart
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 480.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(bubbleColor)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalAlignment = if (isOwn) Alignment.End else Alignment.Start,
        ) {
            when {
                message.mediaId != null && message.contentType?.startsWith("image/") == true -> {
                    InlineImage(
                        mediaId = message.mediaId,
                        mediaKey = message.mediaKey ?: "",
                        onFetchMedia = onFetchMedia,
                    )
                }
                message.mediaId != null -> {
                    FileCard(
                        name = message.originalName ?: "файл",
                        onDownload = {
                            onFetchMedia?.invoke(message.mediaId, message.mediaKey ?: "")
                        },
                    )
                }
                else -> {
                    Text(text = message.plaintext, style = MaterialTheme.typography.bodyMedium)
                }
            }
            Spacer(Modifier.height(2.dp))
            Text(
                text = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(message.timestamp)),
                fontSize = 10.sp,
                color = MaterialTheme.colorScheme.outline,
            )
        }
    }
}

@Composable
private fun InlineImage(
    mediaId: String,
    mediaKey: String,
    onFetchMedia: (suspend (String, String) -> ByteArray?)?,
) {
    var bitmap by remember(mediaId) { mutableStateOf<ImageBitmap?>(null) }
    var loading by remember(mediaId) { mutableStateOf(true) }

    LaunchedEffect(mediaId) {
        bitmap = withContext(Dispatchers.IO) {
            runCatching {
                val bytes = onFetchMedia?.invoke(mediaId, mediaKey) ?: return@withContext null
                SkiaImage.makeFromEncoded(bytes).toComposeImageBitmap()
            }.getOrNull()
        }
        loading = false
    }

    if (loading) {
        CircularProgressIndicator(
            modifier = Modifier.size(40.dp).padding(4.dp),
            strokeWidth = 2.dp,
        )
    } else if (bitmap != null) {
        Image(
            bitmap = bitmap!!,
            contentDescription = null,
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 240.dp)
                .clip(RoundedCornerShape(8.dp)),
            contentScale = ContentScale.Fit,
        )
    }
}
