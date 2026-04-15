// AppErrorLogger.kt — централизованное логирование ошибок Desktop.
//
// Записывает структурированные JSON-строки в ~/.messenger/logs/errors.log
// (macOS/Linux) или %APPDATA%\Messenger\logs\errors.log (Windows).
// При превышении 5 МБ ротирует файл (→ errors.log.old).
// Перехватывает непойманные исключения через UncaughtExceptionHandler.
// При старте приложения отправляет накопленные логи на /api/client-errors.
package logger

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.logging.Logger

object AppErrorLogger {

    private const val MAX_SIZE = 5 * 1024 * 1024L // 5 МБ
    private const val FLUSH_LINES = 100            // строк за один запрос

    private val scope = CoroutineScope(Dispatchers.IO)
    private val fmt   = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
    private val jul   = Logger.getLogger("AppErrorLogger")
    private val json  = Json { ignoreUnknownKeys = true }

    private var logFile: File? = null

    // ─── Инициализация ─────────────────────────────────────────────────────────

    fun init() {
        val logsDir = resolveLogsDir().also { it.mkdirs() }
        logFile = File(logsDir, "errors.log")
        installCrashHandler()
    }

    // ─── Публичный API ──────────────────────────────────────────────────────────

    fun error(tag: String, message: String, throwable: Throwable? = null) {
        jul.severe("[$tag] $message${throwable?.let { "\n${it.stackTraceToString()}" } ?: ""}")
        append("error", tag, message, throwable?.stackTraceToString())
    }

    fun warn(tag: String, message: String) {
        jul.warning("[$tag] $message")
        append("warn", tag, message, null)
    }

    fun info(tag: String, message: String) {
        jul.info("[$tag] $message")
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

    private fun resolveLogsDir(): File {
        val os = System.getProperty("os.name", "").lowercase()
        val base = when {
            os.contains("win") -> {
                val appData = System.getenv("APPDATA") ?: System.getProperty("user.home")
                File(appData, "Messenger")
            }
            else -> File(System.getProperty("user.home"), ".messenger")
        }
        return File(base, "logs")
    }

    private fun append(level: String, tag: String, message: String, stack: String?) {
        val file = logFile ?: return
        try {
            if (file.length() > MAX_SIZE) {
                file.renameTo(File(file.parentFile, "errors.log.old"))
                logFile = File(file.parentFile!!, "errors.log")
            }
            val ts = synchronized(fmt) { fmt.format(Date()) }
            val obj = buildJsonObject {
                put("timestamp", ts)
                put("level", level)
                put("tag", tag)
                put("message", message)
                put("platform", "desktop")
                put("os", System.getProperty("os.name", "unknown"))
                if (stack != null) put("stack", stack)
            }
            (logFile ?: file).appendText(json.encodeToString(obj) + "\n")
        } catch (e: Exception) {
            jul.severe("Failed to write log: ${e.message}")
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

            val entries = buildJsonArray {
                for (line in lines) {
                    runCatching {
                        val obj: JsonObject = json.parseToJsonElement(line).jsonObject
                        add(buildJsonObject {
                            put("timestamp", obj["timestamp"]?.jsonPrimitive?.content ?: "")
                            put("level",     obj["level"]?.jsonPrimitive?.content ?: "error")
                            put("userId",    "")
                            put("route",     "desktop/${obj["os"]?.jsonPrimitive?.content ?: ""}")
                            put("message",   "[${obj["tag"]?.jsonPrimitive?.content}] ${obj["message"]?.jsonPrimitive?.content}")
                            val stack = obj["stack"]?.jsonPrimitive?.content
                            if (!stack.isNullOrEmpty()) put("details", stack)
                        })
                    }
                }
            }
            if (entries.isEmpty()) return

            val body = json.encodeToString(buildJsonObject { put("entries", entries) })
                .toByteArray()

            val conn = URL("$serverUrl/api/client-errors").openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            conn.outputStream.use { it.write(body) }

            if (conn.responseCode == HttpURLConnection.HTTP_NO_CONTENT) {
                val remaining = file.readLines().filter { it.isNotBlank() }.drop(lines.size)
                file.writeText(remaining.joinToString("\n") + if (remaining.isNotEmpty()) "\n" else "")
            }
            conn.disconnect()
        } catch (_: Exception) {
            // Сеть недоступна — логи сохранены, попытка при следующем старте.
        }
    }
}
