// apps/mobile/android/src/main/kotlin/com/messenger/config/ServerConfig.kt
package com.messenger.config

import android.content.Context
import android.content.SharedPreferences
import com.messenger.BuildConfig

object ServerConfig {
    private lateinit var prefs: SharedPreferences

    fun init(context: Context) {
        prefs = context.getSharedPreferences("messenger_config", Context.MODE_PRIVATE)
    }

    var serverUrl: String
        get() = prefs.getString("server_url", BuildConfig.SERVER_URL) ?: BuildConfig.SERVER_URL
        set(value) { prefs.edit().putString("server_url", value).apply() }

    fun hasServerUrl(): Boolean = serverUrl.isNotEmpty()
}
