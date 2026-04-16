// apps/mobile/android/src/main/kotlin/com/messenger/service/TokenStore.kt
package com.messenger.service

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

interface TokenStoreInterface {
    var accessToken: String
    fun save(accessToken: String)
    fun clear()
}

/**
 * Хранит access token в SharedPreferences, зашифрованном через Android Keystore (AES-256-GCM).
 * Ключ шифрования живёт в системном AndroidKeyStore и никогда не покидает защищённый анклав.
 */
class TokenStore(context: Context) : TokenStoreInterface {
    private val prefs = context.getSharedPreferences("messenger_secure_tokens", Context.MODE_PRIVATE)
    private val keyAlias = "messenger_token_key_v1"

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

    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val combined = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(combined, Base64.NO_WRAP)
    }

    private fun decrypt(stored: String): String = try {
        val combined = Base64.decode(stored, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, combined, 0, 12))
        String(cipher.doFinal(combined, 12, combined.size - 12), Charsets.UTF_8)
    } catch (_: Exception) { "" }

    override var accessToken: String
        get() = prefs.getString("access_token", null)?.let { decrypt(it) } ?: ""
        set(value) { prefs.edit().putString("access_token", encrypt(value)).apply() }

    override fun save(accessToken: String) { this.accessToken = accessToken }

    override fun clear() { prefs.edit().remove("access_token").apply() }
}
