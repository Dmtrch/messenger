// apps/mobile/android/src/test/kotlin/com/messenger/crypto/X3DHTest.kt
package com.messenger.crypto

import com.goterl.lazysodium.LazySodiumAndroid
import com.goterl.lazysodium.SodiumAndroid
import kotlinx.serialization.json.*
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File
import java.util.Base64

class X3DHTest {
    private val sodium = LazySodiumAndroid(SodiumAndroid())
    private val b64 = Base64.getDecoder()

    private fun loadVector(name: String): JsonObject {
        val file = File("../../../shared/test-vectors/$name.json")
        return Json.parseToJsonElement(file.readText()).jsonObject
    }

    @Test
    fun `x3dh shared secret matches web test vector`() {
        val v = loadVector("x3dh")

        val aliceIKPriv = b64.decode(v["aliceIdentityKeyPair"]!!.jsonObject["privateKey"]!!.jsonPrimitive.content)
        val aliceEKPriv = b64.decode(v["aliceEphemeralKeyPair"]!!.jsonObject["privateKey"]!!.jsonPrimitive.content)
        val bobIKPub = b64.decode(v["bobIdentityKeyPair"]!!.jsonObject["publicKey"]!!.jsonPrimitive.content)
        val bobSPKPub = b64.decode(v["bobSignedPreKey"]!!.jsonObject["publicKey"]!!.jsonPrimitive.content)
        val bobOPKPub = b64.decode(v["bobOneTimePreKey"]!!.jsonObject["publicKey"]!!.jsonPrimitive.content)
        val expected = v["expectedSharedSecret"]!!.jsonPrimitive.content

        val result = X3DH(sodium).computeSharedSecret(
            aliceIKPrivEd = aliceIKPriv,
            aliceEKPriv = aliceEKPriv,
            bobIKPubEd = bobIKPub,
            bobSPKPub = bobSPKPub,
            bobOPKPub = bobOPKPub,
        )

        assertEquals(expected, Base64.getEncoder().encodeToString(result))
    }
}
