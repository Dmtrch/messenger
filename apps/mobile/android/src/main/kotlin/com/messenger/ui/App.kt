// src/main/kotlin/com/messenger/ui/App.kt
package com.messenger.ui

import android.app.Application
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import com.messenger.config.ServerConfig
import com.messenger.service.call.AndroidVideoRendererBinding
import com.messenger.store.CallStatus
import com.messenger.store.UpdateCheckerStore
import com.messenger.ui.screens.*
import com.messenger.viewmodel.AppViewModel
import com.messenger.viewmodel.ChatListViewModel
import com.messenger.viewmodel.ChatWindowViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch

sealed class Screen {
    object ServerSetup : Screen()
    object Auth : Screen()
    object LinkDevice : Screen()
    object ChatList : Screen()
    data class ChatWindow(val chatId: String) : Screen()
    object Profile : Screen()
    object NewChat : Screen()
    object Downloads : Screen()
    object Admin : Screen()
}

@Composable
fun App(
    application: Application,
    requiresBiometricUnlock: Boolean = false,
    onUnlocked: () -> Unit = {},
    onTriggerBiometric: () -> Unit = {},
) {
    val vm: AppViewModel = viewModel(
        factory = androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.getInstance(application)
    )
    val authState by vm.authState.collectAsState()
    val chats by vm.chatStore.chats.collectAsState()
    val callState by vm.chatStore.call.collectAsState()
    val scope = rememberCoroutineScope()
    val rendererBinding = remember { AndroidVideoRendererBinding() }
    val context = LocalContext.current

    // Проверка обновлений: запускаем polling при наличии serverUrl
    val updateCheckerStore = remember(ServerConfig.serverUrl) {
        if (!ServerConfig.hasServerUrl()) return@remember null
        val currentVersion = try {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            info.versionName ?: "1.0"
        } catch (_: Exception) { "1.0" }
        UpdateCheckerStore(ServerConfig.serverUrl, currentVersion)
    }
    LaunchedEffect(updateCheckerStore) {
        updateCheckerStore?.startPolling()
    }
    val updateInfo by updateCheckerStore?.updateInfo?.collectAsState() ?: remember { mutableStateOf(null) }
    var updateDismissed by remember { mutableStateOf(false) }

    var screen by remember {
        mutableStateOf<Screen>(
            if (!ServerConfig.hasServerUrl()) Screen.ServerSetup else Screen.Auth
        )
    }

    if (requiresBiometricUnlock) {
        BiometricGateScreen(
            onUnlocked = onUnlocked,
            onTriggerBiometric = onTriggerBiometric,
        )
        return
    }

    MaterialTheme {
        Box(Modifier.fillMaxSize()) {
        when (val s = screen) {
            Screen.ServerSetup -> ServerSetupScreen(
                onServerSet = { url -> vm.setServerUrl(url); screen = Screen.Auth },
            )
            Screen.Auth -> {
                LaunchedEffect(authState.isAuthenticated) {
                    if (authState.isAuthenticated) screen = Screen.ChatList
                }
                AuthScreen(
                    serverUrl = ServerConfig.serverUrl,
                    onLogin = { username, password -> vm.login(username, password) },
                    onChangeServer = { screen = Screen.ServerSetup },
                    onLinkDevice = { screen = Screen.LinkDevice },
                )
            }
            Screen.LinkDevice -> {
                LaunchedEffect(authState.isAuthenticated) {
                    if (authState.isAuthenticated) screen = Screen.ChatList
                }
                val defaultName = remember {
                    "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}".take(60)
                }
                LinkDeviceScreen(
                    serverUrl = ServerConfig.serverUrl,
                    defaultDeviceName = defaultName,
                    onActivate = { token, deviceName -> vm.activateDeviceLink(token, deviceName) },
                    onBack = { screen = Screen.Auth },
                )
            }
            Screen.ChatList -> {
                val clVm = remember { ChatListViewModel(application, vm.chatStore) }
                val chatList by clVm.chats.collectAsState()
                ChatListScreen(
                    chats = chatList,
                    onChatClick = { chatId -> screen = Screen.ChatWindow(chatId) },
                    onProfileClick = { screen = Screen.Profile },
                    onNewChatClick = { screen = Screen.NewChat },
                )
            }
            Screen.NewChat -> NewChatScreen(
                vm = vm,
                onBack = { screen = Screen.ChatList },
                onChatCreated = { chatId -> screen = Screen.ChatWindow(chatId) }
            )
            is Screen.ChatWindow -> {
                val chatId = s.chatId
                val chat = chats.find { it.id == chatId }
                val chatName = chat?.name ?: chatId
                val remoteUserId = chat?.members?.firstOrNull { it != authState.userId }
                val client = vm.apiClient!!
                val imageLoader = remember(client) {
                    coil.ImageLoader.Builder(application)
                        .components {
                            add(com.messenger.ui.coil.EncryptedMediaFetcher.Factory(client))
                        }
                        .build()
                }
                val cwVm = remember(chatId) {
                    ChatWindowViewModel(
                        application = application,
                        chatId = chatId,
                        chatStore = vm.chatStore,
                        db = vm.dbProvider.database,
                        currentUserId = authState.userId,
                        apiClient = client,
                    )
                }
                val messages by cwVm.messages.collectAsState()
                val typingUsers by cwVm.typingUsers.collectAsState()
                val uploadError by cwVm.uploadError.collectAsState()
                ChatWindowScreen(
                    chatName = chatName,
                    messages = messages,
                    typingUsers = typingUsers,
                    currentUserId = authState.userId,
                    uploadError = uploadError,
                    imageLoader = imageLoader,
                    onBack = { screen = Screen.ChatList },
                    onSend = { text -> vm.sendMessage(chatId, text) },
                    onSendFile = { uri -> cwVm.sendFile(uri, application) },
                    onClearUploadError = { cwVm.clearUploadError() },
                    onDownloadFile = { mediaId, mediaKey, name ->
                        cwVm.saveToDownloads(application, mediaId, mediaKey, name)
                    },
                    onCall = if (remoteUserId != null) {
                        { vm.initiateCall(chatId, remoteUserId, isVideo = false) }
                    } else null,
                )
            }
            Screen.Profile -> ProfileScreen(
                username = authState.username,
                serverUrl = ServerConfig.serverUrl,
                onBack = { screen = Screen.ChatList },
                onLogout = { scope.launch { vm.logout(); screen = Screen.Auth } },
                onChangeServer = { screen = Screen.ServerSetup },
                onDownloads = { screen = Screen.Downloads },
                onAdmin = { screen = Screen.Admin },
            )
            Screen.Downloads -> DownloadsScreen(
                apiClient = vm.apiClient,
                onBack = { screen = Screen.Profile },
            )
            Screen.Admin -> AdminScreen(
                apiClient = vm.apiClient,
                onBack = { screen = Screen.Profile },
            )
        }
        if (callState.status != CallStatus.IDLE) {
            CallOverlay(
                callState = callState,
                onAccept = { vm.acceptCall() },
                onReject = { vm.rejectCall() },
                onHangUp = { vm.hangUp() },
                rendererBinding = if (callState.isVideo) rendererBinding else null,
                onBindRenderers = { vm.bindVideoRenderers(rendererBinding) },
            )
        }

        // Диалог обновления
        val info = updateInfo
        if (info != null && info.hasUpdate && !updateDismissed) {
            AlertDialog(
                onDismissRequest = { if (!info.isForced) updateDismissed = true },
                title = { Text("Доступна версия ${info.latestVersion}") },
                text = {
                    if (info.isForced) Text("Требуется обязательное обновление приложения.")
                    else Text("Доступна новая версия приложения.")
                },
                confirmButton = {
                    TextButton(onClick = {
                        val url = info.downloadUrl ?: return@TextButton
                        updateCheckerStore?.downloadAndInstall(context, url)
                    }) {
                        Text(if (info.isForced) "Установить сейчас" else "Скачать и установить")
                    }
                },
                dismissButton = if (!info.isForced) {
                    { TextButton(onClick = { updateDismissed = true }) { Text("Позже") } }
                } else null,
            )
        }
        } // Box
    }
}
