package store

import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.net.HttpURLConnection
import java.net.URL

data class UpdateInfo(
    val hasUpdate: Boolean,
    val latestVersion: String,
    val isForced: Boolean
)

class UpdateCheckerStore(private val serverUrl: String) {

    private val _updateInfo = MutableStateFlow<UpdateInfo?>(null)
    val updateInfo: StateFlow<UpdateInfo?> = _updateInfo

    /** Запускать из ApplicationScope. Polling каждые 24ч. */
    suspend fun startPolling() {
        while (true) {
            _updateInfo.value = checkNow()
            delay(24L * 60 * 60 * 1000) // 24 часа
        }
    }

    /** Разовая проверка. Возвращает null при ошибке сети. */
    suspend fun checkNow(): UpdateInfo? = runCatching {
        val conn = URL("$serverUrl/api/version").openConnection() as HttpURLConnection
        conn.connectTimeout = 10_000
        conn.readTimeout = 10_000
        conn.requestMethod = "GET"

        if (conn.responseCode != 200) return@runCatching null

        val body = conn.inputStream.bufferedReader().readText()
        conn.disconnect()

        val latestVersion = extractJsonString(body, "version") ?: return@runCatching null
        val minClientVersion = extractJsonString(body, "min_client_version") ?: "0.0.0"

        val current = CURRENT_VERSION
        val hasUpdate = compareVersions(latestVersion, current) > 0
        val isForced = compareVersions(current, minClientVersion) < 0

        UpdateInfo(
            hasUpdate = hasUpdate,
            latestVersion = latestVersion,
            isForced = isForced
        )
    }.getOrNull()

    /** Извлекает строковое значение поля из JSON вида {"key":"value",...} */
    private fun extractJsonString(json: String, key: String): String? {
        val pattern = Regex(""""$key"\s*:\s*"([^"]+)"""")
        return pattern.find(json)?.groupValues?.get(1)
    }

    /**
     * Сравнивает semver-версии.
     * Возвращает: > 0 если a > b, 0 если равны, < 0 если a < b.
     */
    private fun compareVersions(a: String, b: String): Int {
        val aParts = a.split(".").map { it.toIntOrNull() ?: 0 }
        val bParts = b.split(".").map { it.toIntOrNull() ?: 0 }
        val maxLen = maxOf(aParts.size, bParts.size)
        for (i in 0 until maxLen) {
            val av = aParts.getOrElse(i) { 0 }
            val bv = bParts.getOrElse(i) { 0 }
            if (av != bv) return av - bv
        }
        return 0
    }

    companion object {
        /** Текущая версия приложения. Берётся из BuildConfig при наличии, иначе "dev". */
        val CURRENT_VERSION: String = try {
            config.BuildConfig::class.java
                .getDeclaredField("APP_VERSION")
                .get(null) as? String ?: "dev"
        } catch (_: Exception) {
            "dev"
        }
    }
}
