package ui.components

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.awt.FileDialog
import java.awt.Frame
import java.io.File

@Composable
fun FileCard(
    name: String,
    onDownload: suspend () -> ByteArray?,
) {
    val scope = rememberCoroutineScope()
    var downloading by remember { mutableStateOf(false) }

    Row(
        modifier = Modifier
            .widthIn(max = 320.dp)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(8.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Text(
            text = name,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.weight(1f),
            maxLines = 2,
        )
        Spacer(Modifier.width(8.dp))
        if (downloading) {
            CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
        } else {
            TextButton(
                onClick = {
                    scope.launch {
                        downloading = true
                        val bytes = onDownload()
                        downloading = false
                        if (bytes != null) {
                            withContext(Dispatchers.Main) {
                                val dialog = FileDialog(Frame(), "Сохранить файл", FileDialog.SAVE)
                                dialog.file = name
                                dialog.isVisible = true
                                if (dialog.file != null) {
                                    File(dialog.directory, dialog.file).writeBytes(bytes)
                                }
                            }
                        }
                    }
                },
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
            ) {
                Text("Скачать", style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}
