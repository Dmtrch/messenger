// apps/desktop/src/test/kotlin/service/ApiClientTest.kt
package service

import io.ktor.client.engine.mock.*
import io.ktor.http.*
import io.ktor.utils.io.*
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ApiClientTest {

    @Test
    fun `login returns tokens on 200`() = runTest {
        val engine = MockEngine { request ->
            respond(
                content = ByteReadChannel("""{"accessToken":"acc","userId":"u1","username":"user"}"""),
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val tokenStore = InMemoryTokenStore()
        val client = ApiClient(baseUrl = "http://localhost", engine = engine, tokenStore = tokenStore)

        val result = client.login("user", "pass")

        assertEquals("acc", result.accessToken)
        assertEquals("u1", result.userId)
        assertEquals("user", result.username)
    }

    @Test
    fun `login stores tokens in tokenStore`() = runTest {
        val engine = MockEngine { _ ->
            respond(
                content = ByteReadChannel("""{"accessToken":"acc","userId":"u1","username":"user"}"""),
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val tokenStore = InMemoryTokenStore()
        val client = ApiClient(baseUrl = "http://localhost", engine = engine, tokenStore = tokenStore)

        client.login("user", "pass")

        assertEquals("acc", tokenStore.accessToken)
    }

    @Test
    fun `login throws on 401`() = runTest {
        // MockEngine возвращает 401 с JSON-телом для всех запросов (включая refresh).
        // Это гарантирует, что Bearer-refresh-плагин тоже получит 401 и не упадёт
        // с NoTransformationFoundException при попытке десериализовать text/plain.
        val engine = MockEngine { _ ->
            respond(
                content = ByteReadChannel("""{"error":"unauthorized"}"""),
                status = HttpStatusCode.Unauthorized,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val client = ApiClient(baseUrl = "http://localhost", engine = engine, tokenStore = InMemoryTokenStore())

        var threw = false
        try {
            client.login("user", "wrong")
        } catch (e: Exception) {
            threw = true
        }
        assertTrue(threw, "login() должен бросать исключение при 401")
    }

    @Test
    fun `getChats returns empty list`() = runTest {
        val engine = MockEngine { _ ->
            respond(
                content = ByteReadChannel("[]"),
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val tokenStore = InMemoryTokenStore(accessToken = "tok")
        val client = ApiClient(baseUrl = "http://localhost", engine = engine, tokenStore = tokenStore)

        val result = client.getChats()

        assertTrue(result.isEmpty(), "getChats() должен вернуть пустой список")
    }
}

class InMemoryTokenStore(
    override var accessToken: String = "",
) : TokenStoreInterface {
    override fun save(accessToken: String) {
        this.accessToken = accessToken
    }
    override fun clear() { accessToken = "" }
}
