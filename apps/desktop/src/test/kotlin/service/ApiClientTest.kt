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
    fun `login stores tokens in tokenStore`() = runTest {
        val engine = MockEngine { _ ->
            respond(
                content = ByteReadChannel("""{"accessToken":"acc","refreshToken":"ref"}"""),
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val tokenStore = InMemoryTokenStore()
        val client = ApiClient(baseUrl = "http://localhost", engine = engine, tokenStore = tokenStore)

        client.login("user", "pass")

        assertEquals("acc", tokenStore.accessToken)
        assertEquals("ref", tokenStore.refreshToken)
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
