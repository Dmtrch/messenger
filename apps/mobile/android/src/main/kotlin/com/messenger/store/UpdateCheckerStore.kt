// apps/mobile/android/src/main/kotlin/com/messenger/store/UpdateCheckerStore.kt
package com.messenger.store

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Environment
import androidx.core.content.FileProvider
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

data class UpdateInfo(
    val hasUpdate: Boolean,
    val latestVersion: String,
    val isForced: Boolean,
    val downloadUrl: String? = null,
)

@Serializable
private data class VersionResponse(
    @SerialName("version") val version: String,
    @SerialName("minClientVersion") val minClientVersion: String = "0.0",
)

private val json = Json { ignoreUnknownKeys = true }

class UpdateCheckerStore(private val serverUrl: String, private val currentVersion: String = "1.0") {
    private val _updateInfo = MutableStateFlow<UpdateInfo?>(null)
    val updateInfo: StateFlow<UpdateInfo?> = _updateInfo.asStateFlow()

    suspend fun startPolling() {
        while (true) {
            _updateInfo.value = checkNow()
            delay(24 * 60 * 60 * 1000L) // 24 часа
        }
    }

    suspend fun checkNow(): UpdateInfo? {
        return try {
            val url = URL("$serverUrl/api/version")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "GET"
            conn.connectTimeout = 10_000
            conn.readTimeout = 10_000
            val code = conn.responseCode
            if (code != 200) return null
            val body = conn.inputStream.bufferedReader().readText()
            conn.disconnect()
            val resp = json.decodeFromString<VersionResponse>(body)
            val current = currentVersion
            val hasUpdate = compareVersions(resp.version, current) > 0
            val isForced = compareVersions(current, resp.minClientVersion) < 0
            val downloadUrl = if (hasUpdate) "$serverUrl/api/downloads/messenger-android.apk" else null
            UpdateInfo(
                hasUpdate = hasUpdate,
                latestVersion = resp.version,
                isForced = isForced,
                downloadUrl = downloadUrl,
            )
        } catch (_: Exception) {
            null
        }
    }

    fun downloadAndInstall(context: Context, apkUrl: String) {
        val fileName = "messenger-update.apk"
        val file = File(
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
            fileName
        )
        if (file.exists()) file.delete()

        val request = DownloadManager.Request(Uri.parse(apkUrl))
            .setTitle("Messenger Update")
            .setDescription("Downloading update…")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
            .setMimeType("application/vnd.android.package-archive")

        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val downloadId = dm.enqueue(request)

        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
                if (id != downloadId) return
                ctx.unregisterReceiver(this)
                val uri: Uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                    FileProvider.getUriForFile(
                        ctx,
                        "${ctx.packageName}.fileprovider",
                        file,
                    )
                } else {
                    Uri.fromFile(file)
                }
                val installIntent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/vnd.android.package-archive")
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                }
                ctx.startActivity(installIntent)
            }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(
                receiver,
                IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                Context.RECEIVER_NOT_EXPORTED,
            )
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            context.registerReceiver(
                receiver,
                IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
            )
        }
    }

    /** Сравнивает версии в формате major.minor[.patch]. Возвращает >0 если a > b. */
    private fun compareVersions(a: String, b: String): Int {
        val partsA = a.trim().split(".").map { it.toIntOrNull() ?: 0 }
        val partsB = b.trim().split(".").map { it.toIntOrNull() ?: 0 }
        val len = maxOf(partsA.size, partsB.size)
        for (i in 0 until len) {
            val diff = (partsA.getOrElse(i) { 0 }) - (partsB.getOrElse(i) { 0 })
            if (diff != 0) return diff
        }
        return 0
    }
}
