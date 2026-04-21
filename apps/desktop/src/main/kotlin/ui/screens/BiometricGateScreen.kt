package ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import store.BiometricLockStore

// Биометрия на desktop JVM требует нативных вызовов (macOS JNA → LAContext,
// Windows → WinRT Credential Provider). Пока реализуем PIN-only.
// TODO: опциональный macOS Touch ID через JNA + Security.framework LAContext.
@Composable
fun BiometricGateScreen(onUnlocked: () -> Unit) {
    var pin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }

    Column(
        modifier = Modifier.fillMaxSize().padding(48.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Разблокировать Messenger", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(24.dp))
        OutlinedTextField(
            value = pin,
            onValueChange = { pin = it; error = "" },
            label = { Text("PIN-код") },
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true,
            isError = error.isNotEmpty(),
            supportingText = if (error.isNotEmpty()) {{ Text(error) }} else null,
            modifier = Modifier.width(280.dp),
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = {
                if (pin.length < 4) {
                    error = "PIN должен содержать не менее 4 символов"
                    return@Button
                }
                if (BiometricLockStore.isPinCorrect(pin)) {
                    BiometricLockStore.unlock()
                    onUnlocked()
                } else {
                    error = "Неверный PIN"
                }
            },
            modifier = Modifier.width(280.dp),
        ) { Text("Войти") }
    }
}
