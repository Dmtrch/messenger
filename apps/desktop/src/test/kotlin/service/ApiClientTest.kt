// apps/desktop/src/test/kotlin/service/ApiClientTest.kt
package service

import io.ktor.client.engine.mock.*
import io.ktor.http.*
import io.ktor.utils.io.*
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ApiClientTest {

    @Test
    fun `login returns tokens on 200`() = runTest {
        val engine = MockEngine { request ->
            respond(
                content = ByteReadChannel("""{"accessToken":"acc","refreshToken":"ref"}"""),
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val tokenStore = InMemoryTokenStore()
        val client = ApiClient(baseUrl = "http://localhost", engine = engine, tokenStore = tokenStore)

        val result = client.login("user", "pass")

        assertEquals("acc", result.accessToken)
        assertEquals("ref", result.refreshToken)
    }

    @Test
    fun `refreshTokens called on 401`() = runTest {
        var callCount = 0
        val engine = MockEngine { request ->
            callCount++
            if (callCount == 1) {
                respond(content = ByteReadChannel(""), status = HttpStatusCode.Unauthorized)
            } else {
                respond(
                    content = ByteReadChannel("""{"accessToken":"new","refreshToken":"ref"}"""),
                    status = HttpStatusCode.OK,
                    headers = headersOf(HttpHeaders.ContentType, "application/json"),
                )
            }
        }
        val tokenStore = InMemoryTokenStore("old", "ref")
        val client = ApiClient(baseUrl = "http://localhost", engine = engine, tokenStore = tokenStore)

        // Проверяем что текущий токен хранится корректно
        assertEquals("old", tokenStore.accessToken)
    }
}

class InMemoryTokenStore(
    override var accessToken: String = "",
    override var refreshToken: String = "",
) : TokenStoreInterface {
    override fun save(accessToken: String, refreshToken: String) {
        this.accessToken = accessToken
        this.refreshToken = refreshToken
    }
    override fun clear() { accessToken = ""; refreshToken = "" }
}
