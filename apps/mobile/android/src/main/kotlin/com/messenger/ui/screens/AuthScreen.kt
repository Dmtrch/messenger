// src/main/kotlin/com/messenger/ui/screens/AuthScreen.kt
package com.messenger.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@Composable
fun AuthScreen(
    serverUrl: String,
    onLogin: suspend (username: String, password: String) -> Result<Unit>,
    onChangeServer: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Вход", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))
        Text(serverUrl, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
        TextButton(onClick = onChangeServer) { Text("Изменить сервер") }
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(
            value = username, onValueChange = { username = it; error = "" },
            label = { Text("Имя пользователя") }, modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = password, onValueChange = { password = it; error = "" },
            label = { Text("Пароль") },
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
            isError = error.isNotEmpty(),
            supportingText = if (error.isNotEmpty()) ({ Text(error) }) else null,
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = {
                if (username.isBlank() || password.isBlank()) { error = "Введите логин и пароль"; return@Button }
                loading = true
                scope.launch {
                    val result = onLogin(username, password)
                    loading = false
                    result.onFailure { e -> error = e.message ?: "Ошибка входа" }
                }
            },
            modifier = Modifier.fillMaxWidth(),
            enabled = !loading,
        ) {
            if (loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            else Text("Войти")
        }
    }
}
