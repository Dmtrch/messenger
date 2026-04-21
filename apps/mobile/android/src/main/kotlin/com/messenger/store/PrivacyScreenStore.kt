package com.messenger.store

import android.content.Context
import android.content.SharedPreferences
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

object PrivacyScreenStore {
    private lateinit var prefs: SharedPreferences

    private val _enabled = MutableStateFlow(false)
    val enabled: StateFlow<Boolean> = _enabled

    fun init(context: Context) {
        prefs = context.getSharedPreferences("privacy_screen", Context.MODE_PRIVATE)
        _enabled.value = prefs.getBoolean("enabled", false)
    }

    fun enable() {
        _enabled.value = true
        prefs.edit().putBoolean("enabled", true).apply()
    }

    fun disable() {
        _enabled.value = false
        prefs.edit().putBoolean("enabled", false).apply()
    }
}
