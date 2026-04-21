package store

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.security.MessageDigest
import java.util.prefs.Preferences

data class AppLockSettings(
    val enabled: Boolean = true,
    val relockTimeoutSeconds: Int = 0,
    val pinHashSha256: String? = null,
)

object BiometricLockStore {
    private val prefs = Preferences.userNodeForPackage(BiometricLockStore::class.java)

    private val _settings = MutableStateFlow(AppLockSettings(
        enabled = prefs.getBoolean("enabled", true),
        relockTimeoutSeconds = prefs.getInt("relock_timeout", 0),
        pinHashSha256 = prefs.get("pin_hash", null),
    ))
    val settings: StateFlow<AppLockSettings> = _settings

    private val _isLocked = MutableStateFlow(true)
    val isLocked: StateFlow<Boolean> = _isLocked

    fun unlock() { _isLocked.value = false }
    fun lock() { _isLocked.value = true }

    fun isPinCorrect(pin: String): Boolean {
        val hash = _settings.value.pinHashSha256 ?: return pin.length >= 4
        return sha256(pin) == hash
    }

    fun saveSettings(settings: AppLockSettings) {
        _settings.value = settings
        prefs.putBoolean("enabled", settings.enabled)
        prefs.putInt("relock_timeout", settings.relockTimeoutSeconds)
    }

    fun updatePin(newPin: String) {
        val hash = sha256(newPin)
        prefs.put("pin_hash", hash)
        _settings.value = _settings.value.copy(pinHashSha256 = hash)
    }

    private fun sha256(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray())
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
