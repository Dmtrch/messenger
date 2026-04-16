// src/test/kotlin/com/messenger/service/ApiClientMediaTest.kt
package com.messenger.service

import com.goterl.lazysodium.LazySodiumJava
import com.goterl.lazysodium.SodiumJava
import io.ktor.client.engine.mock.*
import io.ktor.http.*
import io.ktor.utils.io.*
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.util.Base64

class ApiClientMediaTest {
    private val sodium = LazySodiumJava(SodiumJava())
    private val b64dec = Base64.getDecoder()

    private fun makeClient(handler: MockRequestHandler): ApiClient {
        val engine = MockEngine(handler)
        val tokenStore = object : TokenStoreInterface {
            override var accessToken = "test-token"
            override fun save(accessToken: String) {}
            override fun clear() {}
        }
        return ApiClient(
            baseUrl = "http://localhost",
            engine = engine,
            tokenStore = tokenStore,
            sodium = sodium,
        )
    }

    @Test
    fun `uploadEncryptedMedia sends multipart POST and returns mediaId and mediaKey`() = runBlocking {
        var capturedPath = ""
        val client = makeClient { request ->
            capturedPath = request.url.encodedPath
            respond(
                content = ByteReadChannel("""{"mediaId":"abc123"}"""),
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }

        val result = client.uploadEncryptedMedia(
            bytes = "hello".toByteArray(),
            filename = "test.txt",
            contentType = "text/plain",
            chatId = "chat1",
            msgId = "msg1",
        )

        assertEquals("/api/media/upload", capturedPath)
        assertEquals("abc123", result.mediaId)
        // mediaKey должен быть base64 из 32 байт
        val keyBytes = b64dec.decode(result.mediaKey)
        assertEquals(32, keyBytes.size)
    }

    @Test
    fun `fetchDecryptedMedia decrypts content correctly`() = runBlocking {
        val plaintext = "secret content".toByteArray()
        val key = sodium.randomBytesBuf(32)
        val nonce = ByteArray(24) // нулевой nonce для теста
        val cipher = ByteArray(plaintext.size + 16)
        sodium.cryptoSecretBoxEasy(cipher, plaintext, plaintext.size.toLong(), nonce, key)
        val combined = nonce + cipher

        val client = makeClient {
            respond(
                content = ByteReadChannel(combined),
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/octet-stream"),
            )
        }

        val mediaKeyBase64 = Base64.getEncoder().encodeToString(key)
        val decrypted = client.fetchDecryptedMedia("test-media", mediaKeyBase64)
        assertArrayEquals(plaintext, decrypted)
    }

    @Test
    fun `uploadEncryptedMedia rejects files over 10 MB`() = runBlocking {
        val client = makeClient { respond("", HttpStatusCode.OK) }
        val tooBig = ByteArray(10 * 1024 * 1024 + 1)
        val ex = runCatching {
            client.uploadEncryptedMedia(tooBig, "big.bin", "application/octet-stream", "c", "m")
        }.exceptionOrNull()
        assertNotNull(ex)
        assertTrue(ex!!.message!!.contains("10"))
    }
}
