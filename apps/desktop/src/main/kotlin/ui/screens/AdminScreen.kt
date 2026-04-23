package ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import service.AdminInviteCodeDto
import service.AdminRegRequestDto
import service.AdminResetRequestDto
import service.AdminSystemStatsDto
import service.AdminUserDto
import service.ApiClient

private enum class AdminTab(val label: String) {
    USERS("Пользователи"),
    REGISTRATIONS("Заявки"),
    RESETS("Сбросы паролей"),
    INVITES("Инвайты"),
    SETTINGS("Настройки"),
    SYSTEM("Система"),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminScreen(
    apiClient: ApiClient?,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var tab by remember { mutableStateOf(AdminTab.USERS) }
    var users by remember { mutableStateOf<List<AdminUserDto>>(emptyList()) }
    var regs by remember { mutableStateOf<List<AdminRegRequestDto>>(emptyList()) }
    var resets by remember { mutableStateOf<List<AdminResetRequestDto>>(emptyList()) }
    var invites by remember { mutableStateOf<List<AdminInviteCodeDto>>(emptyList()) }
    var retentionDays by remember { mutableStateOf(0) }
    var maxMembers by remember { mutableStateOf(0) }
    var sysStats by remember { mutableStateOf<AdminSystemStatsDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var toast by remember { mutableStateOf<String?>(null) }

    suspend fun reload() {
        val c = apiClient ?: run { error = "Не авторизован"; return }
        error = null
        runCatching { users = c.adminListUsers() }
            .onFailure { error = "users: ${it.message}" }
        runCatching { regs = c.adminListRegistrationRequests() }
            .onFailure { error = (error ?: "") + " regs: ${it.message}" }
        runCatching { resets = c.adminListResetRequests() }
            .onFailure { error = (error ?: "") + " resets: ${it.message}" }
        runCatching { invites = c.adminListInviteCodes() }
            .onFailure { error = (error ?: "") + " invites: ${it.message}" }
        runCatching { retentionDays = c.adminGetRetention() }.getOrDefault(0)
        runCatching { maxMembers = c.adminGetMaxGroupMembers() }.getOrDefault(0)
        runCatching { sysStats = c.adminGetSystemStats() }
            .onFailure { error = (error ?: "") + " sys: ${it.message}" }
    }

    LaunchedEffect(apiClient) { reload() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Администрирование") },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") }
                },
                actions = {
                    TextButton(onClick = { scope.launch { reload() } }) { Text("Обновить") }
                },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            ScrollableTabRow(selectedTabIndex = tab.ordinal, edgePadding = 8.dp) {
                AdminTab.entries.forEach { t ->
                    Tab(selected = tab == t, onClick = { tab = t }, text = { Text(t.label) })
                }
            }
            error?.let {
                Text("Ошибка: $it", color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(12.dp))
            }
            toast?.let {
                Snackbar(modifier = Modifier.padding(12.dp)) { Text(it) }
            }
            when (tab) {
                AdminTab.USERS -> UsersList(
                    users = users,
                    onAction = { action ->
                        scope.launch {
                            runCatching { action(apiClient!!) }
                                .onSuccess { toast = "Готово"; reload() }
                                .onFailure { toast = "Ошибка: ${it.message}" }
                        }
                    },
                )
                AdminTab.REGISTRATIONS -> RegistrationsList(
                    requests = regs,
                    onApprove = { id ->
                        scope.launch {
                            runCatching { apiClient!!.adminApproveRegistration(id) }
                                .onSuccess { toast = "Одобрено"; reload() }
                                .onFailure { toast = "Ошибка: ${it.message}" }
                        }
                    },
                    onReject = { id ->
                        scope.launch {
                            runCatching { apiClient!!.adminRejectRegistration(id) }
                                .onSuccess { toast = "Отклонено"; reload() }
                                .onFailure { toast = "Ошибка: ${it.message}" }
                        }
                    },
                )
                AdminTab.RESETS -> ResetsList(
                    requests = resets,
                    onResolve = { id, tmp ->
                        scope.launch {
                            runCatching { apiClient!!.adminResolveReset(id, tmp) }
                                .onSuccess { toast = "Временный пароль установлен"; reload() }
                                .onFailure { toast = "Ошибка: ${it.message}" }
                        }
                    },
                )
                AdminTab.INVITES -> InvitesList(
                    codes = invites,
                    onCreate = {
                        scope.launch {
                            runCatching { apiClient!!.adminCreateInviteCode() }
                                .onSuccess { toast = "Создан: ${it.code}"; reload() }
                                .onFailure { toast = "Ошибка: ${it.message}" }
                        }
                    },
                    onRevoke = { code ->
                        scope.launch {
                            runCatching { apiClient!!.adminRevokeInviteCode(code) }
                                .onSuccess { toast = "Отозван"; reload() }
                                .onFailure { toast = "Ошибка: ${it.message}" }
                        }
                    },
                )
                AdminTab.SETTINGS -> SettingsPane(
                    retentionDays = retentionDays,
                    maxMembers = maxMembers,
                    onSaveRetention = { v ->
                        scope.launch {
                            runCatching { apiClient!!.adminSetRetention(v) }
                                .onSuccess { toast = "Сохранено"; reload() }
                                .onFailure { toast = "Ошибка: ${it.message}" }
                        }
                    },
                    onSaveMaxMembers = { v ->
                        scope.launch {
                            runCatching { apiClient!!.adminSetMaxGroupMembers(v) }
                                .onSuccess { toast = "Сохранено"; reload() }
                                .onFailure { toast = "Ошибка: ${it.message}" }
                        }
                    },
                )
                AdminTab.SYSTEM -> SystemPane(stats = sysStats)
            }
        }
    }
}

@Composable
private fun UsersList(
    users: List<AdminUserDto>,
    onAction: ((suspend (ApiClient) -> Unit)) -> Unit,
) {
    var dialogUser by remember { mutableStateOf<AdminUserDto?>(null) }
    var resetUser by remember { mutableStateOf<AdminUserDto?>(null) }

    LazyColumn(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(users, key = { it.id }) { u ->
            ElevatedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    Text("${u.username} · ${u.role}", style = MaterialTheme.typography.titleSmall)
                    Text(
                        "status=${u.status}${u.displayName.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline,
                    )
                    Spacer(Modifier.height(8.dp))
                    FlowRowActions(
                        listOf(
                            "Suspend" to { onAction { it.adminSuspendUser(u.id) } },
                            "Unsuspend" to { onAction { it.adminUnsuspendUser(u.id) } },
                            "Ban" to { onAction { it.adminBanUser(u.id) } },
                            "Revoke sessions" to { onAction { it.adminRevokeSessions(u.id) } },
                            "Remote wipe" to { onAction { it.adminRemoteWipe(u.id) } },
                            "Role…" to { dialogUser = u },
                            "Reset password…" to { resetUser = u },
                        )
                    )
                }
            }
        }
    }

    dialogUser?.let { user ->
        var newRole by remember(user.id) { mutableStateOf(user.role) }
        AlertDialog(
            onDismissRequest = { dialogUser = null },
            title = { Text("Сменить роль: ${user.username}") },
            text = {
                Column {
                    listOf("user", "moderator", "admin").forEach { r ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(selected = newRole == r, onClick = { newRole = r })
                            Text(r)
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    onAction { it.adminSetUserRole(user.id, newRole) }
                    dialogUser = null
                }) { Text("Сохранить") }
            },
            dismissButton = { TextButton(onClick = { dialogUser = null }) { Text("Отмена") } },
        )
    }

    resetUser?.let { user ->
        var pwd by remember(user.id) { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { resetUser = null },
            title = { Text("Сброс пароля: ${user.username}") },
            text = {
                OutlinedTextField(
                    value = pwd,
                    onValueChange = { pwd = it },
                    label = { Text("Новый пароль") },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    if (pwd.length >= 8) {
                        onAction { it.adminResetUserPassword(user.id, pwd) }
                        resetUser = null
                    }
                }) { Text("Сбросить") }
            },
            dismissButton = { TextButton(onClick = { resetUser = null }) { Text("Отмена") } },
        )
    }
}

@Composable
private fun FlowRowActions(actions: List<Pair<String, () -> Unit>>) {
    // Простая row-обёртка с переносом через Column если не влезает (у Compose Desktop нет FlowRow в Material3,
    // поэтому используем LazyColumn-like подход с Row)
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        actions.chunked(3).forEach { chunk ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                chunk.forEach { (label, onClick) ->
                    OutlinedButton(onClick = onClick) { Text(label, style = MaterialTheme.typography.labelSmall) }
                }
            }
        }
    }
}

@Composable
private fun RegistrationsList(
    requests: List<AdminRegRequestDto>,
    onApprove: (String) -> Unit,
    onReject: (String) -> Unit,
) {
    if (requests.isEmpty()) {
        Text("Заявок нет", modifier = Modifier.padding(16.dp))
        return
    }
    LazyColumn(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(requests, key = { it.id }) { r ->
            ElevatedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    Text("${r.username} (${r.displayName})", style = MaterialTheme.typography.titleSmall)
                    Text("status=${r.status}", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline)
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { onApprove(r.id) }) { Text("Одобрить") }
                        OutlinedButton(onClick = { onReject(r.id) }) { Text("Отклонить") }
                    }
                }
            }
        }
    }
}

@Composable
private fun ResetsList(
    requests: List<AdminResetRequestDto>,
    onResolve: (id: String, tempPassword: String) -> Unit,
) {
    if (requests.isEmpty()) {
        Text("Заявок нет", modifier = Modifier.padding(16.dp))
        return
    }
    var dialogId by remember { mutableStateOf<String?>(null) }
    var tmp by remember { mutableStateOf("") }

    LazyColumn(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(requests, key = { it.id }) { r ->
            ElevatedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    Text(r.username, style = MaterialTheme.typography.titleSmall)
                    Text("status=${r.status}", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.outline)
                    Spacer(Modifier.height(8.dp))
                    Button(onClick = { dialogId = r.id; tmp = "" }) { Text("Установить временный пароль") }
                }
            }
        }
    }

    dialogId?.let { id ->
        AlertDialog(
            onDismissRequest = { dialogId = null },
            title = { Text("Временный пароль") },
            text = {
                OutlinedTextField(
                    value = tmp,
                    onValueChange = { tmp = it },
                    label = { Text("Пароль (≥8)") },
                    singleLine = true,
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    if (tmp.length >= 8) { onResolve(id, tmp); dialogId = null }
                }) { Text("Выдать") }
            },
            dismissButton = { TextButton(onClick = { dialogId = null }) { Text("Отмена") } },
        )
    }
}

@Composable
private fun InvitesList(
    codes: List<AdminInviteCodeDto>,
    onCreate: () -> Unit,
    onRevoke: (String) -> Unit,
) {
    Column(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = onCreate) { Text("Сгенерировать новый код") }
        if (codes.isEmpty()) {
            Text("Инвайтов нет")
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(codes, key = { it.code }) { c ->
                    ElevatedCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp)) {
                            Text(c.code, style = MaterialTheme.typography.titleSmall)
                            val status = when {
                                c.revokedAt > 0 -> "revoked"
                                c.usedAt > 0 -> "used by ${c.usedBy}"
                                c.expiresAt > 0 && c.expiresAt < System.currentTimeMillis() -> "expired"
                                else -> "active"
                            }
                            Text("status=$status", style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.outline)
                            Spacer(Modifier.height(8.dp))
                            OutlinedButton(
                                onClick = { onRevoke(c.code) },
                                enabled = c.revokedAt == 0L && c.usedAt == 0L,
                            ) { Text("Отозвать") }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsPane(
    retentionDays: Int,
    maxMembers: Int,
    onSaveRetention: (Int) -> Unit,
    onSaveMaxMembers: (Int) -> Unit,
) {
    var rd by remember(retentionDays) { mutableStateOf(retentionDays.toString()) }
    var mm by remember(maxMembers) { mutableStateOf(maxMembers.toString()) }

    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Хранение медиа (дней)", style = MaterialTheme.typography.titleSmall)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(value = rd, onValueChange = { rd = it.filter { ch -> ch.isDigit() } },
                modifier = Modifier.weight(1f), singleLine = true)
            Button(onClick = { rd.toIntOrNull()?.let(onSaveRetention) }) { Text("Сохранить") }
        }
        Spacer(Modifier.height(8.dp))
        Text("Макс. участников в группе", style = MaterialTheme.typography.titleSmall)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(value = mm, onValueChange = { mm = it.filter { ch -> ch.isDigit() } },
                modifier = Modifier.weight(1f), singleLine = true)
            Button(onClick = { mm.toIntOrNull()?.let(onSaveMaxMembers) }) { Text("Сохранить") }
        }
    }
}

@Composable
private fun SystemPane(stats: AdminSystemStatsDto?) {
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (stats == null) { Text("Нет данных"); return }
        Text("CPU: %.1f%%".format(stats.cpuPercent), style = MaterialTheme.typography.titleMedium)
        Text("RAM: ${formatBytes(stats.ramUsed)} / ${formatBytes(stats.ramTotal)}")
        Text("Disk: ${formatBytes(stats.diskUsed)} / ${formatBytes(stats.diskTotal)}")
    }
}

private fun formatBytes(b: Long): String {
    if (b <= 0) return "0"
    val gb = b / 1024.0 / 1024.0 / 1024.0
    val mb = b / 1024.0 / 1024.0
    return if (gb >= 1) "%.2f ГБ".format(gb) else "%.1f МБ".format(mb)
}
