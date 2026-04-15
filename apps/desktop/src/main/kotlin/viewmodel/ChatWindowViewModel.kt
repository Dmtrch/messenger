package viewmodel

import db.DatabaseProvider
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import service.ApiClient
import store.ChatStore
import store.MessageItem
import java.io.File
import java.nio.file.Files
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class ChatWindowViewModel(
    val chatId: String,
    private val chatStore: ChatStore,
    private val apiClient: ApiClient?,
    private val currentUserId: String,
    private val scope: CoroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob()),
) {
    private val _messages = MutableStateFlow<List<MessageItem>>(emptyList())
    val messages: StateFlow<List<MessageItem>> = _messages.asStateFlow()

    private val _typingUsers = MutableStateFlow<Set<String>>(emptySet())
    val typingUsers: StateFlow<Set<String>> = _typingUsers.asStateFlow()

    private val mediaCache = ConcurrentHashMap<String, ByteArray>()

    init {
        scope.launch {
            val rows = DatabaseProvider.database.messengerQueries
                .getMessagesForChat(chatId).executeAsList()
            val dbMessages = rows.map { row ->
                MessageItem(
                    id = row.id,
                    clientMsgId = row.client_msg_id,
                    chatId = row.chat_id,
                    senderId = row.sender_id,
                    plaintext = row.plaintext,
                    timestamp = row.timestamp,
                    status = row.status,
                    isDeleted = row.is_deleted != 0L,
                    mediaId = row.media_id,
                    mediaKey = row.media_key,
                    originalName = row.original_name,
                    contentType = row.content_type,
                )
            }
            // Merge: keep in-memory messages not in DB (newly received via WS)
            val existing = chatStore.messages.value[chatId] ?: emptyList()
            val dbIds = dbMessages.map { it.clientMsgId }.toSet()
            val merged = (dbMessages + existing.filter { it.clientMsgId !in dbIds })
                .sortedBy { it.timestamp }
            chatStore.setMessages(chatId, merged)
        }
        scope.launch {
            chatStore.messages.collect { allMessages ->
                _messages.value = allMessages[chatId] ?: emptyList()
            }
        }
        scope.launch {
            chatStore.typing.collect { typingMap ->
                _typingUsers.value = typingMap[chatId] ?: emptySet()
            }
        }
    }

    fun sendTyping() { }

    /** Шифрует файл и отправляет на сервер; добавляет сообщение в чат и БД. */
    fun sendFile(file: File) {
        scope.launch {
            if (apiClient == null) return@launch
            val bytes = file.readBytes()
            val contentType = runCatching { Files.probeContentType(file.toPath()) }.getOrNull()
                ?: "application/octet-stream"
            val msgId = UUID.randomUUID().toString()

            val result = apiClient.uploadEncryptedMedia(bytes, file.name, contentType, chatId, msgId)

            val item = MessageItem(
                id = msgId,
                clientMsgId = msgId,
                chatId = chatId,
                senderId = currentUserId,
                plaintext = "",
                timestamp = System.currentTimeMillis(),
                status = "sent",
                isDeleted = false,
                mediaId = result.mediaId,
                mediaKey = result.mediaKey,
                originalName = file.name,
                contentType = contentType,
            )

            DatabaseProvider.database.messengerQueries.insertMessage(
                id = item.id,
                client_msg_id = item.clientMsgId,
                chat_id = item.chatId,
                sender_id = item.senderId,
                plaintext = item.plaintext,
                timestamp = item.timestamp,
                status = item.status,
                is_deleted = 0L,
                media_id = item.mediaId,
                media_key = item.mediaKey,
                original_name = item.originalName,
                content_type = item.contentType,
            )

            val current = chatStore.messages.value[chatId] ?: emptyList()
            chatStore.setMessages(chatId, current + item)
        }
    }

    /** Возвращает расшифрованные байты медиа; результат кешируется. */
    suspend fun fetchMediaBytes(mediaId: String, mediaKey: String): ByteArray? =
        withContext(Dispatchers.IO) {
            mediaCache.getOrPut(mediaId) {
                runCatching { apiClient?.fetchDecryptedMedia(mediaId, mediaKey) }.getOrNull()
                    ?: return@withContext null
            }
        }

    fun cancel() { scope.cancel() }
}
