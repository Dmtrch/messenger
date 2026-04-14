// src/main/kotlin/com/messenger/ui/screens/ServerSetupScreen.kt
package com.messenger.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun ServerSetupScreen(onServerSet: (String) -> Unit) {
    var url by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }

    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Настройка сервера", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(24.dp))
        OutlinedTextField(
            value = url,
            onValueChange = { url = it; error = "" },
            label = { Text("URL сервера (например https://messenger.example.com)") },
            modifier = Modifier.fillMaxWidth(),
            isError = error.isNotEmpty(),
            supportingText = if (error.isNotEmpty()) ({ Text(error) }) else null,
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = {
                val trimmed = url.trim()
                if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                    onServerSet(trimmed)
                } else {
                    error = "URL должен начинаться с http:// или https://"
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Подключиться") }
    }
}
