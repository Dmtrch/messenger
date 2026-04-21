package com.messenger.store

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.security.MessageDigest

data class AppLockSettings(
    val enabled: Boolean = true,
    val relockTimeoutSeconds: Int = 0, // 0 = немедленно; -1 = никогда
    val pinHashSha256: String? = null,
)

object BiometricLockStore {
    private lateinit var prefs: SharedPreferences

    private val _settings = MutableStateFlow(AppLockSettings())
    val settings: StateFlow<AppLockSettings> = _settings

    private val _isLocked = MutableStateFlow(true)
    val isLocked: StateFlow<Boolean> = _isLocked

    fun init(context: Context) {
        // Используем обычные SharedPreferences (не EncryptedSharedPreferences чтобы не добавлять зависимость)
        prefs = context.getSharedPreferences("biometric_lock", Context.MODE_PRIVATE)
        _settings.value = AppLockSettings(
            enabled = prefs.getBoolean("enabled", true),
            relockTimeoutSeconds = prefs.getInt("relock_timeout", 0),
            pinHashSha256 = prefs.getString("pin_hash", null),
        )
    }

    fun unlock() { _isLocked.value = false }
    fun lock() { _isLocked.value = true }

    fun isPinCorrect(pin: String): Boolean {
        val hash = _settings.value.pinHashSha256 ?: return pin.length >= 4
        return sha256(pin) == hash
    }

    fun saveSettings(settings: AppLockSettings) {
        _settings.value = settings
        prefs.edit()
            .putBoolean("enabled", settings.enabled)
            .putInt("relock_timeout", settings.relockTimeoutSeconds)
            .apply()
    }

    fun updatePin(newPin: String) {
        val hash = sha256(newPin)
        prefs.edit().putString("pin_hash", hash).apply()
        _settings.value = _settings.value.copy(pinHashSha256 = hash)
    }

    private fun sha256(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray())
        return bytes.joinToString("") { "%02x".format(it) }
    }
}
