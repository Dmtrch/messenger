package com.messenger.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.messenger.service.UserResultDto
import com.messenger.viewmodel.AppViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewChatScreen(
    vm: AppViewModel,
    onBack: () -> Unit,
    onChatCreated: (String) -> Unit
) {
    var mode by remember { mutableStateOf("direct") }
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf(emptyList<UserResultDto>()) }
    var selected by remember { mutableStateOf(emptyList<UserResultDto>()) }
    var groupName by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    // Поиск с дебаунсом
    LaunchedEffect(query, mode) {
        if (query.trim().length < 2) {
            results = emptyList()
            return@LaunchedEffect
        }
        delay(300)
        loading = true
        error = null
        try {
            val resp = vm.apiClient?.searchUsers(query.trim())
            results = if (mode == "group") {
                resp?.users?.filter { u -> selected.none { it.id == u.id } } ?: emptyList()
            } else {
                resp?.users ?: emptyList()
            }
        } catch (e: Exception) {
            error = "Ошибка поиска"
        } finally {
            loading = false
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Новый чат") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Назад")
                    }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            TabRow(selectedTabIndex = if (mode == "direct") 0 else 1) {
                Tab(selected = mode == "direct", onClick = { mode = "direct"; selected = emptyList() }) {
                    Text("Личный", modifier = Modifier.padding(16.dp))
                }
                Tab(selected = mode == "group", onClick = { mode = "group" }) {
                    Text("Группа", modifier = Modifier.padding(16.dp))
                }
            }

            if (mode == "group") {
                OutlinedTextField(
                    value = groupName,
                    onValueChange = { groupName = it },
                    label = { Text("Название группы") },
                    modifier = Modifier.fillMaxWidth().padding(8.dp),
                    singleLine = true
                )
                if (selected.isNotEmpty()) {
                    Text(
                        "Выбрано: ${selected.size}",
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.bodySmall
                    )
                    Row(modifier = Modifier.padding(horizontal = 8.dp).fillMaxWidth()) {
                        selected.forEach { u ->
                            InputChip(
                                selected = true,
                                onClick = { selected = selected.filter { it.id != u.id } },
                                label = { Text(u.displayName.ifEmpty { u.username }) },
                                trailingIcon = { Icon(Icons.Default.Clear, "Удалить", modifier = Modifier.size(16.dp)) },
                                modifier = Modifier.padding(2.dp)
                            )
                        }
                    }
                }
            }

            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text("Поиск пользователей...") },
                modifier = Modifier.fillMaxWidth().padding(8.dp),
                leadingIcon = { Icon(Icons.Default.Search, null) },
                singleLine = true
            )

            if (loading) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }

            error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp))
            }

            LazyColumn(modifier = Modifier.weight(1f)) {
                items(results) { user ->
                    ListItem(
                        headlineContent = { Text(user.displayName.ifEmpty { user.username }) },
                        supportingContent = { Text("@${user.username}") },
                        leadingContent = {
                            Surface(
                                shape = MaterialTheme.shapes.small,
                                color = MaterialTheme.colorScheme.primaryContainer,
                                modifier = Modifier.size(40.dp)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Text(
                                        (user.displayName.ifEmpty { user.username }).take(1).uppercase(),
                                        style = MaterialTheme.typography.titleMedium
                                    )
                                }
                            }
                        },
                        trailingContent = {
                            if (mode == "group") {
                                Button(onClick = {
                                    selected = selected + user
                                    query = ""
                                }) {
                                    Text("Добавить")
                                }
                            }
                        },
                        modifier = Modifier.clickable {
                            if (mode == "direct") {
                                scope.launch {
                                    creating = true
                                    try {
                                        val resp = vm.apiClient?.createChat("direct", listOf(user.id))
                                        resp?.chat?.let { onChatCreated(it.id) }
                                    } catch (e: Exception) {
                                        error = "Не удалось создать чат"
                                    } finally {
                                        creating = false
                                    }
                                }
                            }
                        }
                    )
                }
            }

            if (mode == "group") {
                Button(
                    onClick = {
                        scope.launch {
                            creating = true
                            try {
                                val resp = vm.apiClient?.createChat(
                                    "group",
                                    selected.map { it.id },
                                    groupName
                                )
                                resp?.chat?.let { onChatCreated(it.id) }
                            } catch (e: Exception) {
                                error = "Не удалось создать группу"
                            } finally {
                                creating = false
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    enabled = !creating && selected.size >= 2 && groupName.isNotBlank()
                ) {
                    Text(if (creating) "Создание..." else "Создать группу (${selected.size})")
                }
            }
        }
    }
}
