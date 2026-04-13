// apps/mobile/android/src/test/kotlin/com/messenger/crypto/RatchetTest.kt
package com.messenger.crypto

import com.goterl.lazysodium.LazySodiumAndroid
import com.goterl.lazysodium.SodiumAndroid
import kotlinx.serialization.json.*
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File
import java.util.Base64

class RatchetTest {
    private val sodium = LazySodiumAndroid(SodiumAndroid())
    private val b64Dec = Base64.getDecoder()
    private val b64Enc = Base64.getEncoder()

    private fun loadVector(name: String): JsonObject {
        val file = File("../../../shared/test-vectors/$name.json")
        return Json.parseToJsonElement(file.readText()).jsonObject
    }

    @Test
    fun `deriveMessageKey matches web test vector`() {
        val v = loadVector("ratchet")
        val chainKey = b64Dec.decode(v["chainKey"]!!.jsonPrimitive.content)
        val index = v["messageIndex"]!!.jsonPrimitive.int
        val expected = v["expectedMsgKey"]!!.jsonPrimitive.content

        val msgKey = Ratchet(sodium).deriveMessageKey(chainKey, index)

        assertEquals(expected, b64Enc.encodeToString(msgKey))
    }

    @Test
    fun `encrypt then decrypt round-trip`() {
        val ratchet = Ratchet(sodium)
        val chainKey = ByteArray(32) { it.toByte() }
        val msgKey = ratchet.deriveMessageKey(chainKey, 0)
        val plaintext = "hello ratchet"

        val (ciphertext, nonce) = ratchet.encrypt(plaintext.toByteArray(), msgKey)
        assertEquals(plaintext.toByteArray().size + 16, ciphertext.size)
        val decrypted = ratchet.decrypt(ciphertext, nonce, msgKey)

        assertEquals(plaintext, String(decrypted))
    }

    @Test
    fun `encrypt ciphertext matches web test vector`() {
        val v = loadVector("ratchet")
        val msgKey = b64Dec.decode(v["expectedMsgKey"]!!.jsonPrimitive.content)
        val nonce = b64Dec.decode(v["nonce"]!!.jsonPrimitive.content)
        val plaintext = v["plaintext"]!!.jsonPrimitive.content
        val expected = v["expectedCiphertext"]!!.jsonPrimitive.content

        val (ciphertext, _) = Ratchet(sodium).encryptWithNonce(plaintext.toByteArray(), msgKey, nonce)

        assertEquals(expected, b64Enc.encodeToString(ciphertext))
    }
}
