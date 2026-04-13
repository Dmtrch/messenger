// apps/desktop/src/main/kotlin/service/TokenStore.kt
package service

import java.util.prefs.Preferences

interface TokenStoreInterface {
    var accessToken: String
    var refreshToken: String
    fun save(accessToken: String, refreshToken: String)
    fun clear()
}

/**
 * Хранит токены в java.util.prefs.Preferences (OS keychain / user prefs).
 */
class TokenStore : TokenStoreInterface {
    private val prefs = Preferences.userRoot().node("com/messenger/desktop")

    override var accessToken: String
        get() = prefs.get("access_token", "")
        set(value) { prefs.put("access_token", value) }

    override var refreshToken: String
        get() = prefs.get("refresh_token", "")
        set(value) { prefs.put("refresh_token", value) }

    override fun save(accessToken: String, refreshToken: String) {
        this.accessToken = accessToken
        this.refreshToken = refreshToken
        prefs.flush()
    }

    override fun clear() {
        prefs.remove("access_token")
        prefs.remove("refresh_token")
        prefs.flush()
    }
}
