package ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import config.ServerConfig
import ui.screens.*
import viewmodel.AppViewModel
import viewmodel.ChatListViewModel
import viewmodel.ChatWindowViewModel

sealed class Screen {
    object ServerSetup : Screen()
    object Auth : Screen()
    object ChatList : Screen()
    data class ChatWindow(val chatId: String) : Screen()
    object Profile : Screen()
}

@Composable
fun App() {
    val vm = remember { AppViewModel() }
    val authState by vm.authState.collectAsState()
    val chats by vm.chatStore.chats.collectAsState()
    val scope = rememberCoroutineScope()

    var screen by remember {
        mutableStateOf<Screen>(
            if (!ServerConfig.hasServerUrl()) Screen.ServerSetup else Screen.Auth
        )
    }

    MaterialTheme {
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
                )
            }
            Screen.ChatList -> {
                val clVm = remember { ChatListViewModel(vm.chatStore) }
                val chatList by clVm.chats.collectAsState()
                ChatListScreen(
                    chats = chatList,
                    onChatClick = { chatId -> screen = Screen.ChatWindow(chatId) },
                    onProfileClick = { screen = Screen.Profile },
                )
            }
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
                ChatWindowScreen(
                    chatName = chatName,
                    messages = messages,
                    typingUsers = typingUsers,
                    currentUserId = authState.userId,
                    onBack = { screen = Screen.ChatList },
                    onSend = { text -> vm.sendMessage(chatId, text) },
                )
            }
            Screen.Profile -> ProfileScreen(
                username = authState.username,
                serverUrl = ServerConfig.serverUrl,
                onBack = { screen = Screen.ChatList },
                onLogout = { vm.logout(); screen = Screen.Auth },
                onChangeServer = { screen = Screen.ServerSetup },
            )
        }
    }
}
