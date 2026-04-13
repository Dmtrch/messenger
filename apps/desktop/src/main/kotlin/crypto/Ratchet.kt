package crypto

import com.goterl.lazysodium.LazySodiumJava

class Ratchet(private val sodium: LazySodiumJava) {

    private val NONCEBYTES = 24
    private val MACBYTES = 16

    /**
     * Деривирует message key из chain key и индекса.
     * Аналог TypeScript: crypto_kdf_derive_from_key(32, index, "msg_key_", chainKey)
     */
    fun deriveMessageKey(chainKey: ByteArray, index: Int): ByteArray {
        require(chainKey.size == 32) { "chainKey must be 32 bytes, got ${chainKey.size}" }
        val out = ByteArray(32)
        val context = "msg_key_".toByteArray(Charsets.UTF_8)
        val result = sodium.cryptoKdfDeriveFromKey(out, 32, index.toLong(), context, chainKey)
        check(result == 0) { "cryptoKdfDeriveFromKey failed with code $result" }
        return out
    }

    /**
     * Шифрует plaintext с помощью msgKey, генерирует случайный nonce.
     * Возвращает Pair(ciphertext, nonce).
     */
    fun encrypt(plaintext: ByteArray, msgKey: ByteArray): Pair<ByteArray, ByteArray> {
        require(msgKey.size == 32) { "msgKey must be 32 bytes, got ${msgKey.size}" }
        val nonce = sodium.randomBytesBuf(NONCEBYTES)
        return encryptWithNonce(plaintext, msgKey, nonce)
    }

    fun encryptWithNonce(plaintext: ByteArray, msgKey: ByteArray, nonce: ByteArray): Pair<ByteArray, ByteArray> {
        require(msgKey.size == 32) { "msgKey must be 32 bytes, got ${msgKey.size}" }
        require(nonce.size == NONCEBYTES) { "nonce must be $NONCEBYTES bytes, got ${nonce.size}" }
        val ciphertext = ByteArray(plaintext.size + MACBYTES)
        check(sodium.cryptoSecretBoxEasy(ciphertext, plaintext, plaintext.size.toLong(), nonce, msgKey)) {
            "cryptoSecretBoxEasy failed"
        }
        return Pair(ciphertext, nonce)
    }

    /**
     * Расшифровывает ciphertext.
     */
    fun decrypt(ciphertext: ByteArray, nonce: ByteArray, msgKey: ByteArray): ByteArray {
        require(msgKey.size == 32) { "msgKey must be 32 bytes, got ${msgKey.size}" }
        require(nonce.size == NONCEBYTES) { "nonce must be $NONCEBYTES bytes, got ${nonce.size}" }
        require(ciphertext.size >= MACBYTES) { "ciphertext too short" }
        val plaintext = ByteArray(ciphertext.size - MACBYTES)
        check(sodium.cryptoSecretBoxOpenEasy(plaintext, ciphertext, ciphertext.size.toLong(), nonce, msgKey)) {
            "cryptoSecretBoxOpenEasy failed — wrong key or corrupted ciphertext"
        }
        return plaintext
    }
}
