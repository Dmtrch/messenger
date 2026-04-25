// apps/desktop/src/test/kotlin/viewmodel/AppViewModelTest.kt
//
// AppViewModel зависит от DatabaseProvider (SQLite) и ServerConfig (java.util.prefs),
// которые недоступны в headless-тестовой среде. Поэтому smoke-тесты проверяют
// AuthStore — тот же state-слой, который AppViewModel.authState публикует наружу.
package viewmodel

import store.AuthState
import store.AuthStore
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AppViewModelTest {

    @Test
    fun `initial state is not authenticated`() {
        val authStore = AuthStore()

        assertFalse(authStore.state.value.isAuthenticated, "По умолчанию isAuthenticated должен быть false")
        assertEquals("", authStore.state.value.userId)
        assertEquals("", authStore.state.value.username)
    }

    @Test
    fun `login sets authenticated state`() {
        val authStore = AuthStore()

        authStore.login(userId = "u1", username = "alice", accessToken = "tok")

        assertTrue(authStore.state.value.isAuthenticated)
        assertEquals("u1", authStore.state.value.userId)
        assertEquals("alice", authStore.state.value.username)
    }

    @Test
    fun `logout clears authenticated state`() {
        val authStore = AuthStore()
        authStore.login(userId = "u1", username = "alice", accessToken = "tok")

        authStore.logout()

        assertFalse(authStore.state.value.isAuthenticated)
        assertEquals("", authStore.state.value.userId)
        assertEquals("", authStore.state.value.username)
    }
}
