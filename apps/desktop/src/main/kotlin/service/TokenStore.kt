// apps/desktop/src/main/kotlin/service/TokenStore.kt
package service

import java.util.prefs.Preferences

interface TokenStoreInterface {
    var accessToken: String
    fun save(accessToken: String)
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

    override fun save(accessToken: String) {
        this.accessToken = accessToken
        prefs.flush()
    }

    override fun clear() {
        prefs.remove("access_token")
        prefs.flush()
    }
}
