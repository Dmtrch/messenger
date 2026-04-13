package crypto

import java.io.File
import java.security.KeyStore
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec

/**
 * Хранит крипто-ключи в PKCS12 keystore (~/.messenger/keystore.p12).
 * Аналог IndexedDB keystore в web-клиенте.
 *
 * MVP: пароль keystore захардкожен — защищает от случайного доступа,
 * но не от целенаправленной атаки с доступом к исходникам/бинарнику.
 * В продакшн-версии должен заменяться на пароль из OS keychain.
 */
class KeyStorage(
    private val keystorePath: String = "${System.getProperty("user.home")}/.messenger/keystore.p12",
    private val password: CharArray = "messenger-desktop".toCharArray(),
) : AutoCloseable {
    private val keystore: KeyStore = KeyStore.getInstance("PKCS12")

    init {
        val file = File(keystorePath)
        file.parentFile.mkdirs()
        if (file.exists()) {
            file.inputStream().use { keystore.load(it, password) }
        } else {
            keystore.load(null, password)
        }
    }

    fun saveKey(alias: String, keyBytes: ByteArray) {
        val secretKey: SecretKey = SecretKeySpec(keyBytes, "RAW")
        val entry = KeyStore.SecretKeyEntry(secretKey)
        keystore.setEntry(alias, entry, KeyStore.PasswordProtection(password))
        persist()
    }

    fun loadKey(alias: String): ByteArray? {
        val entry = keystore.getEntry(alias, KeyStore.PasswordProtection(password))
            as? KeyStore.SecretKeyEntry
        return entry?.secretKey?.encoded
    }

    fun deleteKey(alias: String) {
        if (keystore.containsAlias(alias)) {
            keystore.deleteEntry(alias)
            persist()
        }
    }

    override fun close() {
        password.fill(0.toChar())
    }

    private fun persist() {
        File(keystorePath).outputStream().use { keystore.store(it, password) }
    }
}
