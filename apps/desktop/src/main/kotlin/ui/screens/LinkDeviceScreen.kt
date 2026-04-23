package ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@Composable
fun LinkDeviceScreen(
    serverUrl: String,
    onActivate: suspend (token: String, deviceName: String) -> Result<Unit>,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var token by remember { mutableStateOf("") }
    var deviceName by remember {
        mutableStateOf("desktop-${System.getProperty("user.name") ?: "user"}")
    }
    var error by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Привязать устройство", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            "Введите токен с QR-кода или из ссылки, полученной на основном устройстве.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.outline,
        )
        Spacer(Modifier.height(4.dp))
        Text(serverUrl, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(
            value = token,
            onValueChange = { token = it.trim(); error = "" },
            label = { Text("Токен привязки") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = deviceName,
            onValueChange = { deviceName = it; error = "" },
            label = { Text("Имя устройства") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            isError = error.isNotEmpty(),
            supportingText = if (error.isNotEmpty()) ({ Text(error) }) else null,
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = {
                if (token.isBlank()) { error = "Введите токен"; return@Button }
                if (deviceName.isBlank()) { error = "Введите имя устройства"; return@Button }
                loading = true
                scope.launch {
                    val res = onActivate(token, deviceName)
                    loading = false
                    res.onFailure { e -> error = e.message ?: "Ошибка активации" }
                }
            },
            modifier = Modifier.fillMaxWidth(),
            enabled = !loading,
        ) {
            if (loading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            else Text("Подключить")
        }
        Spacer(Modifier.height(8.dp))
        TextButton(onClick = onBack, enabled = !loading) {
            Text("Назад ко входу")
        }
    }
}
