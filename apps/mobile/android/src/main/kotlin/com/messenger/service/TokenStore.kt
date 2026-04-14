// apps/mobile/android/src/main/kotlin/com/messenger/service/TokenStore.kt
package com.messenger.service

import android.content.Context

interface TokenStoreInterface {
    var accessToken: String
    var refreshToken: String
    fun save(accessToken: String, refreshToken: String)
    fun clear()
}

class TokenStore(context: Context) : TokenStoreInterface {
    private val prefs = context.getSharedPreferences("messenger_tokens", Context.MODE_PRIVATE)

    override var accessToken: String
        get() = prefs.getString("access_token", "") ?: ""
        set(value) { prefs.edit().putString("access_token", value).apply() }

    override var refreshToken: String
        get() = prefs.getString("refresh_token", "") ?: ""
        set(value) { prefs.edit().putString("refresh_token", value).apply() }

    override fun save(accessToken: String, refreshToken: String) {
        prefs.edit()
            .putString("access_token", accessToken)
            .putString("refresh_token", refreshToken)
            .apply()
    }

    override fun clear() {
        prefs.edit()
            .remove("access_token")
            .remove("refresh_token")
            .apply()
    }
}
