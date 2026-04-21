package store

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.util.prefs.Preferences

object PrivacyScreenStore {
    private val prefs = Preferences.userNodeForPackage(PrivacyScreenStore::class.java)

    private val _enabled = MutableStateFlow(prefs.getBoolean("privacy_screen_enabled", false))
    val enabled: StateFlow<Boolean> = _enabled

    fun enable() {
        _enabled.value = true
        prefs.putBoolean("privacy_screen_enabled", true)
    }

    fun disable() {
        _enabled.value = false
        prefs.putBoolean("privacy_screen_enabled", false)
    }
}
