// ErrorLogger.kt — централизованное логирование ошибок Android.
//
// Записывает структурированные JSON-строки в filesDir/logs/errors.log.
// При превышении 5 МБ ротирует файл (→ errors.log.old).
// Перехватывает непойманные исключения через UncaughtExceptionHandler.
// При старте приложения отправляет накопленные логи на /api/client-errors.
package com.messenger.logger

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object ErrorLogger {

    private const val TAG = "ErrorLogger"
    private const val MAX_SIZE = 5 * 1024 * 1024L // 5 МБ
    private const val FLUSH_LINES = 100            // строк за один запрос

    private val scope = CoroutineScope(Dispatchers.IO)
    private val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)

    private var logFile: File? = null

    // ─── Инициализация ─────────────────────────────────────────────────────────

    fun init(context: Context) {
        val logsDir = File(context.filesDir, "logs").also { it.mkdirs() }
        logFile = File(logsDir, "errors.log")
        installCrashHandler()
    }

    // ─── Публичный API ──────────────────────────────────────────────────────────

    fun error(tag: String, message: String, throwable: Throwable? = null) {
        Log.e(tag, message, throwable)
        append("error", tag, message, throwable?.stackTraceToString())
    }

    fun warn(tag: String, message: String, throwable: Throwable? = null) {
        Log.w(tag, message, throwable)
        append("warn", tag, message, throwable?.stackTraceToString())
    }

    fun info(tag: String, message: String) {
        Log.i(tag, message)
        append("info", tag, message, null)
    }

    /** Отправить накопленные логи на сервер (вызвать при старте приложения). */
    fun flushToServer(serverUrl: String) {
        if (serverUrl.isBlank()) return
        val file = logFile ?: return
        if (!file.exists() || file.length() == 0L) return
        scope.launch { doFlush(file, serverUrl) }
    }

    // ─── Внутренние методы ──────────────────────────────────────────────────────

    private fun append(level: String, tag: String, message: String, stack: String?) {
        val file = logFile ?: return
        try {
            // Ротация при превышении лимита.
            if (file.length() > MAX_SIZE) {
                file.renameTo(File(file.parentFile, "errors.log.old"))
                logFile = File(file.parentFile, "errors.log")
            }
            val ts = synchronized(fmt) { fmt.format(Date()) }
            val obj = JSONObject().apply {
                put("timestamp", ts)
                put("level", level)
                put("tag", tag)
                put("message", message)
                if (stack != null) put("stack", stack)
            }
            (logFile ?: file).appendText(obj.toString() + "\n")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to write log", e)
        }
    }

    private fun installCrashHandler() {
        val prev = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            append(
                "error",
                "UncaughtException",
                "Crash in thread '${thread.name}': ${throwable.message}",
                throwable.stackTraceToString()
            )
            prev?.uncaughtException(thread, throwable)
        }
    }

    private fun doFlush(file: File, serverUrl: String) {
        try {
            val lines = file.readLines().filter { it.isNotBlank() }.take(FLUSH_LINES)
            if (lines.isEmpty()) return

            val entries = JSONArray()
            for (line in lines) {
                runCatching {
                    val obj = JSONObject(line)
                    entries.put(JSONObject().apply {
                        put("timestamp", obj.optString("timestamp"))
                        put("level", obj.optString("level", "error"))
                        put("userId", "")
                        put("route", "android")
                        put("message", "[${obj.optString("tag")}] ${obj.optString("message")}")
                        val stack = obj.optString("stack")
                        if (stack.isNotEmpty()) put("details", stack)
                    })
                }
            }
            if (entries.length() == 0) return

            val body = JSONObject().put("entries", entries).toString().toByteArray()
            val conn = URL("$serverUrl/api/client-errors").openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            conn.outputStream.use { it.write(body) }

            if (conn.responseCode == HttpURLConnection.HTTP_NO_CONTENT) {
                // Удалить отправленные строки, сохранить остаток.
                val remaining = file.readLines().filter { it.isNotBlank() }.drop(lines.size)
                file.writeText(remaining.joinToString("\n") + if (remaining.isNotEmpty()) "\n" else "")
            }
            conn.disconnect()
        } catch (_: Exception) {
            // Сеть недоступна — логи сохранены, попытка при следующем старте.
        }
    }
}
