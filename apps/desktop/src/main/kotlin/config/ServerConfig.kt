package config

import java.util.prefs.Preferences

object ServerConfig {
    private val prefs = Preferences.userRoot().node("com/messenger/desktop")

    var serverUrl: String
        get() = prefs.get("server_url", "")
        set(value) { prefs.put("server_url", value); prefs.flush() }

    fun hasServerUrl(): Boolean = serverUrl.isNotEmpty()
}
