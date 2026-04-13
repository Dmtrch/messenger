package crypto

import com.goterl.lazysodium.LazySodiumJava
import com.goterl.lazysodium.SodiumJava
import kotlinx.serialization.json.*
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File
import java.util.Base64

class SenderKeyTest {
    private val sodium = LazySodiumJava(SodiumJava())
    private val b64Dec = Base64.getDecoder()
    private val b64Enc = Base64.getEncoder()

    private fun loadVector(name: String): JsonObject {
        val file = File("../../shared/test-vectors/$name.json")
        return Json.parseToJsonElement(file.readText()).jsonObject
    }

    @Test
    fun `encrypt matches web test vector`() {
        val v = loadVector("sender-key")
        val senderKey = b64Dec.decode(v["senderKey"]!!.jsonPrimitive.content)
        val nonce = b64Dec.decode(v["nonce"]!!.jsonPrimitive.content)
        val plaintext = v["plaintext"]!!.jsonPrimitive.content
        val expected = v["expectedCiphertext"]!!.jsonPrimitive.content

        val sk = SenderKey(sodium)
        val ciphertext = sk.encryptWithNonce(plaintext.toByteArray(), senderKey, nonce)

        assertEquals(expected, b64Enc.encodeToString(ciphertext))
    }

    @Test
    fun `encrypt then decrypt round-trip`() {
        val sk = SenderKey(sodium)
        val senderKey = ByteArray(32) { (it * 3).toByte() }
        val plaintext = "hello group message"

        val (ciphertext, nonce) = sk.encrypt(plaintext.toByteArray(), senderKey)
        val decrypted = sk.decrypt(ciphertext, nonce, senderKey)

        assertEquals(plaintext, String(decrypted))
    }
}
