// src/test/kotlin/com/messenger/service/ApiClientLoginTest.kt
package com.messenger.service

import com.goterl.lazysodium.LazySodiumJava
import com.goterl.lazysodium.SodiumJava
import io.ktor.client.engine.mock.*
import io.ktor.http.*
import io.ktor.utils.io.*
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class ApiClientLoginTest {
    private val sodium = LazySodiumJava(SodiumJava())

    private fun makeClient(handler: MockRequestHandler): ApiClient {
        val engine = MockEngine(handler)
        val tokenStore = object : TokenStoreInterface {
            override var accessToken = ""
            override fun save(accessToken: String) { this.accessToken = accessToken }
            override fun clear() { accessToken = "" }
        }
        return ApiClient(
            baseUrl = "http://localhost",
            engine = engine,
            tokenStore = tokenStore,
            sodium = sodium,
        )
    }

    @Test
    fun `login success returns user info`() = runBlocking {
        val client = makeClient { request ->
            assertEquals("/api/auth/login", request.url.encodedPath)
            respond(
                content = ByteReadChannel(
                    """{"accessToken":"tok","userId":"u1","username":"alice","displayName":"Alice"}"""
                ),
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }

        val result = client.login("alice", "pass")

        assertEquals("u1", result.userId)
        assertEquals("alice", result.username)
    }

    @Test
    fun `login failure throws on 401`() = runBlocking {
        val client = makeClient {
            respond(
                content = ByteReadChannel("Unauthorized"),
                status = HttpStatusCode.Unauthorized,
                headers = headersOf(HttpHeaders.ContentType, "text/plain"),
            )
        }

        val ex = runCatching { client.login("alice", "wrong") }.exceptionOrNull()
        assertNotNull(ex, "Expected an exception on 401 response")
        assertTrue(
            ex!!.message?.contains("401") == true || ex.message?.contains("Login failed") == true,
            "Exception message should mention failure, got: ${ex.message}"
        )
    }
}
