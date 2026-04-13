// apps/mobile/android/src/main/kotlin/com/messenger/store/AuthStore.kt
package com.messenger.store

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class AuthStore {
    private val _state = MutableStateFlow(AuthState())
    val state: StateFlow<AuthState> = _state.asStateFlow()

    val isAuthenticated: Boolean get() = _state.value.isAuthenticated

    fun login(userId: String, username: String, accessToken: String) {
        _state.value = AuthState(
            isAuthenticated = true,
            userId = userId,
            username = username,
            accessToken = accessToken,
        )
    }

    fun logout() { _state.value = AuthState() }
}
