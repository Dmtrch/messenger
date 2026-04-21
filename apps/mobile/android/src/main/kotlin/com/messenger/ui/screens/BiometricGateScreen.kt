// src/main/kotlin/com/messenger/ui/screens/BiometricGateScreen.kt
package com.messenger.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.messenger.store.BiometricLockStore

@Composable
fun BiometricGateScreen(
    onUnlocked: () -> Unit,
    onTriggerBiometric: () -> Unit,
) {
    var pin by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }

    LaunchedEffect(Unit) { onTriggerBiometric() }

    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Разблокировать", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(24.dp))
        OutlinedTextField(
            value = pin,
            onValueChange = { pin = it; error = "" },
            label = { Text("PIN-код") },
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true,
            isError = error.isNotEmpty(),
            supportingText = if (error.isNotEmpty()) {{ Text(error) }} else null,
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = {
                if (pin.length < 4) { error = "PIN должен содержать не менее 4 символов"; return@Button }
                if (BiometricLockStore.isPinCorrect(pin)) {
                    BiometricLockStore.unlock()
                    onUnlocked()
                } else {
                    error = "Неверный PIN"
                }
            },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Войти") }
        Spacer(Modifier.height(8.dp))
        TextButton(onClick = onTriggerBiometric) { Text("Использовать биометрию") }
    }
}
