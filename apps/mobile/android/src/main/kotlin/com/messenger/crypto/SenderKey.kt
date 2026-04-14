// apps/mobile/android/src/main/kotlin/com/messenger/crypto/SenderKey.kt
package com.messenger.crypto

import com.goterl.lazysodium.LazySodium
import com.goterl.lazysodium.interfaces.SecretBox

class SenderKey(private val sodium: LazySodium) {

    companion object {
        private const val NONCEBYTES = SecretBox.NONCEBYTES
        private const val MACBYTES   = SecretBox.MACBYTES
    }

    fun encrypt(plaintext: ByteArray, senderKey: ByteArray): Pair<ByteArray, ByteArray> {
        require(senderKey.size == 32) { "senderKey must be 32 bytes, got ${senderKey.size}" }
        val nonce = sodium.randomBytesBuf(NONCEBYTES)
        return encryptWithNonce(plaintext, senderKey, nonce) to nonce
    }

    fun encryptWithNonce(plaintext: ByteArray, senderKey: ByteArray, nonce: ByteArray): ByteArray {
        require(senderKey.size == 32) { "senderKey must be 32 bytes, got ${senderKey.size}" }
        require(nonce.size == NONCEBYTES) { "nonce must be $NONCEBYTES bytes, got ${nonce.size}" }
        val ciphertext = ByteArray(plaintext.size + MACBYTES)
        check(sodium.cryptoSecretBoxEasy(ciphertext, plaintext, plaintext.size.toLong(), nonce, senderKey)) {
            "SenderKey encrypt failed"
        }
        return ciphertext
    }

    fun decrypt(ciphertext: ByteArray, nonce: ByteArray, senderKey: ByteArray): ByteArray {
        require(senderKey.size == 32) { "senderKey must be 32 bytes, got ${senderKey.size}" }
        require(nonce.size == NONCEBYTES) { "nonce must be $NONCEBYTES bytes, got ${nonce.size}" }
        require(ciphertext.size >= MACBYTES) { "ciphertext too short" }
        val plaintext = ByteArray(ciphertext.size - MACBYTES)
        check(sodium.cryptoSecretBoxOpenEasy(plaintext, ciphertext, ciphertext.size.toLong(), nonce, senderKey)) {
            "SenderKey decrypt failed — wrong key or corrupted ciphertext"
        }
        return plaintext
    }
}
