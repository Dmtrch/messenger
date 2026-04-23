package ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import service.ApiClient
import service.DownloadArtifactDto
import service.DownloadsManifestDto
import java.awt.Desktop
import java.nio.file.Path
import java.nio.file.Paths

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DownloadsScreen(
    apiClient: ApiClient?,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var manifest by remember { mutableStateOf<DownloadsManifestDto?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var busyFilename by remember { mutableStateOf<String?>(null) }
    var resultText by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(apiClient) {
        if (apiClient == null) { loadError = "Не авторизован"; return@LaunchedEffect }
        try {
            manifest = apiClient.getDownloadsManifest()
        } catch (e: Throwable) {
            loadError = e.message ?: "Не удалось загрузить манифест"
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Загрузки") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val m = manifest
            when {
                loadError != null -> Text(
                    "Ошибка: $loadError",
                    color = MaterialTheme.colorScheme.error,
                )
                m == null -> CircularProgressIndicator()
                m.artifacts.isEmpty() -> Text("Артефакты не опубликованы")
                else -> {
                    Text("Версия ${m.version}", style = MaterialTheme.typography.titleMedium)
                    if (m.changelog.isNotBlank()) {
                        Text(
                            m.changelog,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.outline,
                        )
                    }
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(m.artifacts, key = { it.filename }) { art ->
                            ArtifactRow(
                                art = art,
                                busy = busyFilename == art.filename,
                                onDownload = {
                                    busyFilename = art.filename
                                    resultText = null
                                    scope.launch {
                                        try {
                                            val targetDir = userDownloadsDir()
                                            val path = withContext(Dispatchers.IO) {
                                                apiClient!!.downloadArtifact(art.filename, targetDir)
                                            }
                                            resultText = "Сохранено: $path"
                                            openInFileManager(path)
                                        } catch (e: Throwable) {
                                            resultText = "Ошибка: ${e.message}"
                                        } finally {
                                            busyFilename = null
                                        }
                                    }
                                },
                            )
                        }
                    }
                    resultText?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                }
            }
        }
    }
}

@Composable
private fun ArtifactRow(
    art: DownloadArtifactDto,
    busy: Boolean,
    onDownload: () -> Unit,
) {
    ElevatedCard(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Text(art.filename, style = MaterialTheme.typography.titleSmall)
            Spacer(Modifier.height(4.dp))
            Text(
                "${art.platform.ifEmpty { "-" }} · ${art.arch.ifEmpty { "-" }} · ${art.format} · ${formatSize(art.sizeBytes)}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.outline,
            )
            if (art.sha256.isNotBlank()) {
                Text(
                    "SHA-256 ${art.sha256.take(16)}…",
                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                    color = MaterialTheme.colorScheme.outline,
                )
            }
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = onDownload, enabled = !busy) {
                    if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    else Text("Скачать")
                }
            }
        }
    }
}

private fun formatSize(bytes: Long): String {
    if (bytes <= 0) return "—"
    val kb = bytes / 1024.0
    val mb = kb / 1024.0
    return if (mb >= 1) "%.1f МБ".format(mb) else "%.0f КБ".format(kb)
}

private fun userDownloadsDir(): Path {
    val home = System.getProperty("user.home") ?: "."
    return Paths.get(home, "Downloads")
}

private fun openInFileManager(path: Path) {
    runCatching {
        if (Desktop.isDesktopSupported()) {
            Desktop.getDesktop().open(path.parent.toFile())
        }
    }
}
