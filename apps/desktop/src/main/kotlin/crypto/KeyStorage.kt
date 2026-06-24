package crypto

import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.AclEntry
import java.nio.file.attribute.AclEntryPermission
import java.nio.file.attribute.AclEntryType
import java.nio.file.attribute.AclFileAttributeView
import java.nio.file.attribute.PosixFilePermissions
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

        /**
         * Создаёт файл с содержимым и правами owner-only (600 на POSIX, ACL-только-владелец на Windows).
         * Операция атомарна на POSIX: файл создаётся сразу с ограниченными правами,
         * без промежуточного окна с открытыми permissions.
         */
        private fun writeOwnerOnly(path: Path, content: String) {
            Files.deleteIfExists(path)
            try {
                val perms = PosixFilePermissions.fromString("rw-------")
                Files.createFile(path, PosixFilePermissions.asFileAttribute(perms))
            } catch (_: UnsupportedOperationException) {
                // Windows или не-POSIX ФС: создаём обычно, потом ограничиваем ACL
                Files.createFile(path)
                val aclView = Files.getFileAttributeView(path, AclFileAttributeView::class.java)
                if (aclView != null) {
                    val owner = Files.getOwner(path)
                    val entry = AclEntry.newBuilder()
                        .setType(AclEntryType.ALLOW)
                        .setPrincipal(owner)
                        .setPermissions(AclEntryPermission.entries.toSet())
                        .build()
                    aclView.acl = listOf(entry)
                }
            }
            Files.write(path, content.toByteArray(Charsets.UTF_8))
        }

        fun loadOrCreatePassword(): CharArray {
            val pwdFile = File("${System.getProperty("user.home")}/$PWD_PATH")
            if (pwdFile.exists()) {
                return pwdFile.readText(Charsets.UTF_8).toCharArray()
            }
            // Генерируем 48 случайных байт → base64 (~64 символа)
            val bytes = ByteArray(48).also { SecureRandom().nextBytes(it) }
            val pwd = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
            pwdFile.parentFile.mkdirs()
            writeOwnerOnly(pwdFile.toPath(), pwd)
            return pwd.toCharArray()
        }
    }
}
