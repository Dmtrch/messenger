// apps/mobile/android/src/main/kotlin/com/messenger/crypto/KeyStorage.kt
package com.messenger.crypto

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Хранит криптографические ключи устройства в SharedPreferences,
 * зашифрованных через Android Keystore (AES-256-GCM).
 */
class KeyStorage(context: Context) : KeyAccess, AutoCloseable {
    private val prefs = context.getSharedPreferences("messenger_secure_crypto_keys", Context.MODE_PRIVATE)
    private val keyAlias = "messenger_crypto_key_v1"

    private fun getOrCreateKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").also { it.load(null) }
        (ks.getEntry(keyAlias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(
                    keyAlias,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build()
            )
            generateKey()
        }
    }

    override fun saveKey(alias: String, keyBytes: ByteArray) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val combined = cipher.iv + cipher.doFinal(keyBytes)
        prefs.edit().putString(alias, Base64.encodeToString(combined, Base64.NO_WRAP)).apply()
    }

    override fun loadKey(alias: String): ByteArray? {
        val stored = prefs.getString(alias, null) ?: return null
        return try {
            val combined = Base64.decode(stored, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, combined, 0, 12))
            cipher.doFinal(combined, 12, combined.size - 12)
        } catch (_: Exception) { null }
    }

    fun deleteKey(alias: String) {
        prefs.edit().remove(alias).apply()
    }

    /** Возвращает SPK ID, генерируя его при первом вызове. */
    override fun getOrCreateSpkId(): Int {
        val stored = prefs.getInt("spk_id", 0)
        if (stored != 0) return stored
        val id = (1..Int.MAX_VALUE).random()
        prefs.edit().putInt("spk_id", id).apply()
        return id
    }

    override fun close() { /* no resources to release */ }
}
