package ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import config.ServerConfig
import kotlinx.coroutines.launch
import store.BiometricLockStore
import store.PrivacyScreenStore
import store.UpdateCheckerStore
import androidx.compose.foundation.background
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalWindowInfo
import store.CallStatus
import ui.screens.*
import viewmodel.AppViewModel
import viewmodel.ChatListViewModel
import viewmodel.ChatWindowViewModel
import kotlin.system.exitProcess

sealed class Screen {
    object BiometricGate : Screen()
    object ServerSetup : Screen()
    object Auth : Screen()
    object ChatList : Screen()
    data class ChatWindow(val chatId: String) : Screen()
    object Profile : Screen()
    object NewChat : Screen()
}

@Composable
fun App() {
    val vm = remember { AppViewModel() }
    val authState by vm.authState.collectAsState()
    val chats by vm.chatStore.chats.collectAsState()
    val callState by vm.chatStore.call.collectAsState()
    val scope = rememberCoroutineScope()
    val privacyEnabled by PrivacyScreenStore.enabled.collectAsState()
    val windowFocused = LocalWindowInfo.current.isWindowFocused

    val updateChecker = remember { UpdateCheckerStore(ServerConfig.serverUrl) }
    val updateInfo by updateChecker.updateInfo.collectAsState()
    var updateDismissed by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        updateChecker.startPolling()
    }

    var screen by remember {
        mutableStateOf<Screen>(Screen.BiometricGate)
    }

    MaterialTheme {
        Box(modifier = Modifier.fillMaxSize()) {
        // Пропускаем gate если блокировка отключена
        LaunchedEffect(Unit) {
            if (!BiometricLockStore.settings.value.enabled) {
                screen = if (!ServerConfig.hasServerUrl()) Screen.ServerSetup else Screen.Auth
            }
        }

        when (val s = screen) {
            Screen.BiometricGate -> BiometricGateScreen(
                onUnlocked = {
                    screen = if (!ServerConfig.hasServerUrl()) Screen.ServerSetup else Screen.Auth
                }
            )
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
                )
            }
            Screen.ChatList -> {
                val clVm = remember { ChatListViewModel(vm.chatStore) }
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
                val chatName = chats.find { it.id == chatId }?.name ?: chatId
                val cwVm = remember(chatId) {
                    ChatWindowViewModel(
                        chatId = chatId,
                        chatStore = vm.chatStore,
                        apiClient = vm.apiClient,
                        currentUserId = authState.userId,
                    )
                }
                val messages by cwVm.messages.collectAsState()
                val typingUsers by cwVm.typingUsers.collectAsState()
                val chat = chats.find { it.id == chatId }
                val remoteUserId = chat?.members?.firstOrNull { it != authState.userId } ?: ""
                ChatWindowScreen(
                    chatName = chatName,
                    messages = messages,
                    typingUsers = typingUsers,
                    currentUserId = authState.userId,
                    onBack = { screen = Screen.ChatList },
                    onSend = { text -> vm.sendMessage(chatId, text) },
                    onSendFile = { file -> cwVm.sendFile(file) },
                    onFetchMedia = { mediaId, mediaKey -> cwVm.fetchMediaBytes(mediaId, mediaKey) },
                    onCall = if (!chat?.isGroup!! && remoteUserId.isNotEmpty()) {
                        { vm.initiateCall(chatId, remoteUserId, false) }
                    } else null,
                )
            }
            Screen.Profile -> ProfileScreen(
                username = authState.username,
                serverUrl = ServerConfig.serverUrl,
                onBack = { screen = Screen.ChatList },
                onLogout = { scope.launch { vm.logout(); screen = Screen.Auth } },
                onChangeServer = { screen = Screen.ServerSetup },
            )
        }
        // Оверлей звонка поверх всех экранов
        if (callState.status != CallStatus.IDLE) {
            val callChatName = chats.find { it.id == callState.chatId }?.name
                ?: callState.remoteUserId
            CallOverlay(
                call        = callState,
                callerName  = callChatName,
                onAccept    = { vm.acceptCall() },
                onReject    = { vm.rejectCall() },
                onHangUp    = { vm.hangUp() },
                localFrame  = vm.webRtcController?.localFrame,
                remoteFrame = vm.webRtcController?.remoteFrame,
            )
        }
        if (privacyEnabled && !windowFocused) {
            PrivacyOverlay()
        }

        // Диалог обновления
        val info = updateInfo
        if (info != null && info.hasUpdate && !updateDismissed) {
            if (info.isForced) {
                AlertDialog(
                    onDismissRequest = {},
                    title = { Text("Требуется обновление") },
                    text = { Text("Доступна версия ${info.latestVersion}. Обновите приложение для продолжения работы.") },
                    confirmButton = {
                        TextButton(onClick = { exitProcess(0) }) {
                            Text("Закрыть приложение")
                        }
                    }
                )
            } else {
                AlertDialog(
                    onDismissRequest = { updateDismissed = true },
                    title = { Text("Доступно обновление") },
                    text = { Text("Доступна версия ${info.latestVersion}. Обновите приложение.") },
                    confirmButton = {
                        TextButton(onClick = { updateDismissed = true }) {
                            Text("Напомнить позже")
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = { updateDismissed = true }) {
                            Text("Закрыть")
                        }
                    }
                )
            }
        }
        } // Box
    }
}

@Composable
private fun PrivacyOverlay() {
    Box(
        modifier = Modifier.fillMaxSize().background(Color(0xFF0D0D0D)),
        contentAlignment = Alignment.Center,
    ) {
        Text("🔒", style = MaterialTheme.typography.displayLarge, color = Color.White)
    }
}
