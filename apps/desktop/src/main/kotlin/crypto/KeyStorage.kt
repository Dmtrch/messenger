package crypto

import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec

/**
 * Хранит крипто-ключи в PKCS12 keystore (~/.messenger/keystore.p12).
 *
 * Пароль keystore генерируется один раз при первом запуске и хранится в
 * ~/.messenger/keystore.pwd с правами owner-only (chmod 600).
 * На последующих запусках пароль загружается из этого файла.
 */
class KeyStorage(
    private val keystorePath: String = "${System.getProperty("user.home")}/.messenger/keystore.p12",
    private val password: CharArray = loadOrCreatePassword(),
) : KeyAccess, AutoCloseable {
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

    override fun saveKey(alias: String, keyBytes: ByteArray) {
        val secretKey: SecretKey = SecretKeySpec(keyBytes, "RAW")
        val entry = KeyStore.SecretKeyEntry(secretKey)
        keystore.setEntry(alias, entry, KeyStore.PasswordProtection(password))
        persist()
    }

    override fun loadKey(alias: String): ByteArray? {
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

    /** Возвращает SPK ID, генерируя его при первом вызове. */
    override fun getOrCreateSpkId(): Int {
        loadKey("spk_id")?.let { bytes ->
            if (bytes.size == 4) return java.nio.ByteBuffer.wrap(bytes).int
        }
        val id = (1..Int.MAX_VALUE).random()
        saveKey("spk_id", java.nio.ByteBuffer.allocate(4).putInt(id).array())
        return id
    }

    override fun close() {
        password.fill(0.toChar())
    }

    private fun persist() {
        File(keystorePath).outputStream().use { keystore.store(it, password) }
    }

    companion object {
        private const val PWD_PATH = ".messenger/keystore.pwd"

        fun loadOrCreatePassword(): CharArray {
            val pwdFile = File("${System.getProperty("user.home")}/$PWD_PATH")
            if (pwdFile.exists()) {
                return pwdFile.readText(Charsets.UTF_8).toCharArray()
            }
            // Генерируем 48 случайных байт → base64 (~64 символа)
            val bytes = ByteArray(48).also { SecureRandom().nextBytes(it) }
            val pwd = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
            pwdFile.parentFile.mkdirs()
            pwdFile.writeText(pwd, Charsets.UTF_8)
            // owner read/write only (аналог chmod 600)
            pwdFile.setReadable(false, false)
            pwdFile.setReadable(true, true)
            pwdFile.setWritable(false, false)
            pwdFile.setWritable(true, true)
            return pwd.toCharArray()
        }
    }
}
