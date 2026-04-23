package ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import store.BiometricLockStore
import store.PrivacyScreenStore
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(
    username: String,
    serverUrl: String,
    onBack: () -> Unit,
    onLogout: suspend () -> Unit,
    onChangeServer: () -> Unit,
    onDownloads: () -> Unit = {},
    onAdmin: () -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Профиль") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(username, style = MaterialTheme.typography.titleLarge)
            Text(serverUrl, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.outline)
            Spacer(Modifier.height(8.dp))
            OutlinedButton(onClick = onChangeServer, modifier = Modifier.fillMaxWidth()) { Text("Изменить сервер") }
            OutlinedButton(onClick = onDownloads, modifier = Modifier.fillMaxWidth()) { Text("Загрузки и обновления") }
            OutlinedButton(onClick = onAdmin, modifier = Modifier.fillMaxWidth()) { Text("Администрирование") }
            AppLockSection()
            PrivacyScreenSection()
            Button(
                onClick = { scope.launch { onLogout() } },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
            ) { Text("Выйти") }
        }
    }
}

@Composable
private fun AppLockSection() {
    val settings by BiometricLockStore.settings.collectAsState()
    var showChangePinDialog by remember { mutableStateOf(false) }
    var newPin by remember { mutableStateOf("") }
    var pinError by remember { mutableStateOf("") }

    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Text("Блокировка приложения", style = MaterialTheme.typography.titleSmall,
             color = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Включить блокировку по PIN")
            Switch(
                checked = settings.enabled,
                onCheckedChange = {
                    BiometricLockStore.saveSettings(settings.copy(enabled = it))
                }
            )
        }
        if (settings.enabled) {
            TextButton(onClick = { showChangePinDialog = true; newPin = ""; pinError = "" }) {
                Text("Изменить PIN")
            }
        }
    }

    if (showChangePinDialog) {
        AlertDialog(
            onDismissRequest = { showChangePinDialog = false },
            title = { Text("Новый PIN") },
            text = {
                OutlinedTextField(
                    value = newPin,
                    onValueChange = { newPin = it; pinError = "" },
                    label = { Text("PIN (минимум 4 символа)") },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                    isError = pinError.isNotEmpty(),
                    supportingText = if (pinError.isNotEmpty()) {{ Text(pinError) }} else null,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    if (newPin.length < 4) { pinError = "Минимум 4 символа"; return@TextButton }
                    BiometricLockStore.updatePin(newPin)
                    showChangePinDialog = false
                }) { Text("Сохранить") }
            },
            dismissButton = {
                TextButton(onClick = { showChangePinDialog = false }) { Text("Отмена") }
            }
        )
    }
}

@Composable
private fun PrivacyScreenSection() {
    val enabled by PrivacyScreenStore.enabled.collectAsState()
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Text(
            "Экран конфиденциальности",
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.height(8.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f).padding(end = 8.dp)) {
                Text("Скрывать контент при потере фокуса")
                Text(
                    "Контент скрывается при сворачивании окна",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline,
                )
            }
            Switch(
                checked = enabled,
                onCheckedChange = { if (it) PrivacyScreenStore.enable() else PrivacyScreenStore.disable() },
            )
        }
    }
}
