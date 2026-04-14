// apps/mobile/android/src/main/kotlin/com/messenger/crypto/KeyStorage.kt
package com.messenger.crypto

import android.content.Context
import android.util.Base64

class KeyStorage(context: Context) : AutoCloseable {
    private val prefs = context.getSharedPreferences("messenger_crypto_keys", Context.MODE_PRIVATE)

    fun saveKey(alias: String, keyBytes: ByteArray) {
        prefs.edit()
            .putString(alias, Base64.encodeToString(keyBytes, Base64.NO_WRAP))
            .apply()
    }

    fun loadKey(alias: String): ByteArray? {
        val encoded = prefs.getString(alias, null) ?: return null
        return Base64.decode(encoded, Base64.NO_WRAP)
    }

    fun deleteKey(alias: String) {
        prefs.edit().remove(alias).apply()
    }

    override fun close() { /* no resources to release */ }
}
