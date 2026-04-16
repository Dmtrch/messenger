// src/main/kotlin/com/messenger/ui/App.kt
package com.messenger.ui

import android.app.Application
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import com.messenger.config.ServerConfig
import com.messenger.service.call.AndroidVideoRendererBinding
import com.messenger.store.CallStatus
import com.messenger.ui.screens.*
import com.messenger.viewmodel.AppViewModel
import com.messenger.viewmodel.ChatListViewModel
import com.messenger.viewmodel.ChatWindowViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch

sealed class Screen {
    object ServerSetup : Screen()
    object Auth : Screen()
    object ChatList : Screen()
    data class ChatWindow(val chatId: String) : Screen()
    object Profile : Screen()
    object NewChat : Screen()
}

@Composable
fun App(application: Application) {
    val vm: AppViewModel = viewModel(
        factory = androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.getInstance(application)
    )
    val authState by vm.authState.collectAsState()
    val chats by vm.chatStore.chats.collectAsState()
    val callState by vm.chatStore.call.collectAsState()
    val scope = rememberCoroutineScope()
    val rendererBinding = remember { AndroidVideoRendererBinding() }

    var screen by remember {
        mutableStateOf<Screen>(
            if (!ServerConfig.hasServerUrl()) Screen.ServerSetup else Screen.Auth
        )
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
        } // Box
    }
}
