// src/main/kotlin/com/messenger/ui/screens/DownloadsScreen.kt
package com.messenger.ui.screens

import android.content.Context
import android.content.Intent
import android.os.Environment
import android.widget.Toast
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.messenger.service.ApiClient
import com.messenger.service.DownloadArtifactDto
import com.messenger.service.DownloadsManifestDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DownloadsScreen(
    apiClient: ApiClient?,
    onBack: () -> Unit,
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var manifest by remember { mutableStateOf<DownloadsManifestDto?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var busyFilename by remember { mutableStateOf<String?>(null) }
    var resultText by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(apiClient) {
        if (apiClient == null) { loadError = "Не авторизован"; return@LaunchedEffect }
        try { manifest = apiClient.getDownloadsManifest() }
        catch (e: Throwable) { loadError = e.message ?: "Не удалось загрузить манифест" }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Загрузки") },
                navigationIcon = {
                    TextButton(onClick = onBack) { Text("Назад") }
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
                loadError != null -> Text("Ошибка: $loadError", color = MaterialTheme.colorScheme.error)
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
                            ArtifactCard(
                                art = art,
                                busy = busyFilename == art.filename,
                                onDownload = {
                                    busyFilename = art.filename
                                    resultText = null
                                    scope.launch {
                                        try {
                                            val bytes = withContext(Dispatchers.IO) {
                                                apiClient!!.downloadArtifactBytes(art.filename)
                                            }
                                            val file = writeToDownloads(ctx, art.filename, bytes)
                                            resultText = "Сохранено: ${file.absolutePath}"
                                            offerInstallOrOpen(ctx, file)
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
private fun ArtifactCard(
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

/**
 * Сохраняет в app-specific Downloads (не требует runtime permissions).
 * Директория: Android/data/<pkg>/files/Download/
 */
private fun writeToDownloads(ctx: Context, filename: String, bytes: ByteArray): File {
    val dir = ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
        ?: File(ctx.filesDir, "Downloads").apply { mkdirs() }
    if (!dir.exists()) dir.mkdirs()
    val file = File(dir, filename)
    file.writeBytes(bytes)
    return file
}

/** Предлагает установить APK или открыть файл через системный viewer. */
private fun offerInstallOrOpen(ctx: Context, file: File) {
    val authority = "${ctx.packageName}.fileprovider"
    val uri = runCatching { FileProvider.getUriForFile(ctx, authority, file) }.getOrNull()
    if (uri == null) {
        Toast.makeText(ctx, "Файл сохранён в ${file.parent}", Toast.LENGTH_LONG).show()
        return
    }
    val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, mimeTypeFor(file.name))
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    runCatching { ctx.startActivity(intent) }.onFailure {
        Toast.makeText(ctx, "Файл сохранён: ${file.name}", Toast.LENGTH_LONG).show()
    }
}

private fun mimeTypeFor(name: String): String = when {
    name.endsWith(".apk", true) -> "application/vnd.android.package-archive"
    name.endsWith(".ipa", true) -> "application/octet-stream"
    name.endsWith(".dmg", true) -> "application/octet-stream"
    name.endsWith(".deb", true) -> "application/vnd.debian.binary-package"
    name.endsWith(".msi", true) -> "application/octet-stream"
    name.endsWith(".exe", true) -> "application/octet-stream"
    else -> "application/octet-stream"
}
