// src/test/kotlin/com/messenger/crypto/SessionManagerSmokeTest.kt
package com.messenger.crypto

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.goterl.lazysodium.LazySodiumJava
import com.goterl.lazysodium.SodiumJava
import com.messenger.db.MessengerDatabase
import com.messenger.service.DeviceBundle
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/**
 * Smoke-тесты SessionManager:
 * - encryptForDevice с пустым/некорректным bundle бросает исключение (не NPE)
 * - encryptForDevice без ik_sec в KeyStorage бросает осмысленную ошибку
 * - plain-text (не base64) передать как ключ в KeyStorage нельзя без ошибки при использовании
 */
class SessionManagerSmokeTest {

    private val sodium = LazySodiumJava(SodiumJava())

    private fun createDb(): MessengerDatabase {
        val driver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)
        MessengerDatabase.Schema.create(driver)
        return MessengerDatabase(driver)
    }

    private fun emptyKeyAccess(): KeyAccess = object : KeyAccess {
        private val store = mutableMapOf<String, ByteArray>()
        override fun loadKey(alias: String): ByteArray? = store[alias]
        override fun saveKey(alias: String, keyBytes: ByteArray) { store[alias] = keyBytes }
        override fun getOrCreateSpkId(): Int = 1
    }

    @Test
    fun `encryptForDevice without identity key throws meaningful error`() {
        val sm = SessionManager(sodium, emptyKeyAccess(), createDb())

        // bundle с валидной структурой, но KeyStorage пустой (нет ik_sec)
        val bundle = DeviceBundle(
            deviceId = "dev1",
            ikPublic = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            spkPublic = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        )

        val ex = assertThrows(IllegalStateException::class.java) {
            sm.encryptForDevice("peer1", "dev1", bundle, "hello")
        }
        // Сообщение должно быть осмысленным (не пустым NPE)
        assertNotNull(ex.message)
        assertTrue(
            ex.message!!.isNotEmpty(),
            "Exception message must not be empty"
        )
    }

    @Test
    fun `encryptForDevice with invalid base64 bundle fields throws exception not NPE`() {
        val keyAccess = emptyKeyAccess()
        // Симулируем наличие ключей с корректной длиной (ed25519: 64 байт private, 32 байт pub)
        keyAccess.saveKey("ik_sec", ByteArray(64) { 0x42 })
        keyAccess.saveKey("ik_pub", ByteArray(32) { 0x42 })

        val sm = SessionManager(sodium, keyAccess, createDb())

        // bundle с явно некорректным (plain-text, не base64) ikPublic
        val bundle = DeviceBundle(
            deviceId = "dev1",
            ikPublic = "this-is-not-valid-base64!!!",
            spkPublic = "this-is-not-valid-base64!!!",
        )

        val ex = assertThrows(Exception::class.java) {
            sm.encryptForDevice("peer1", "dev1", bundle, "hello")
        }
        // Главное: получаем исключение, а не NullPointerException без сообщения
        assertFalse(
            ex is NullPointerException && ex.message == null,
            "Should not throw a silent NPE — got: $ex"
        )
    }

    @Test
    fun `plain text stored as key bytes fails on crypto operation`() {
        val keyAccess = emptyKeyAccess()
        // plain-text "secret" как байты — не является валидным 64-байт ed25519 ключом
        val plainTextKey = "secret".toByteArray()
        keyAccess.saveKey("ik_sec", plainTextKey)
        keyAccess.saveKey("ik_pub", ByteArray(32) { 0x01 })

        val sm = SessionManager(sodium, keyAccess, createDb())
        val bundle = DeviceBundle(
            deviceId = "dev1",
            ikPublic = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            spkPublic = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        )

        // Должно выбросить исключение (неправильная длина ключа), а не вернуть результат
        assertThrows(Exception::class.java) {
            sm.encryptForDevice("peer1", "dev1", bundle, "hello")
        }
    }
}
