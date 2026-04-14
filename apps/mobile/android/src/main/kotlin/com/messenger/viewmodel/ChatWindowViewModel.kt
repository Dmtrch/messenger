// src/main/kotlin/com/messenger/viewmodel/ChatWindowViewModel.kt
package com.messenger.viewmodel

import android.app.Application
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.documentfile.provider.DocumentFile
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.messenger.db.MessengerDatabase
import com.messenger.service.ApiClient
import com.messenger.store.ChatStore
import com.messenger.store.MessageItem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

class ChatWindowViewModel(
    application: Application,
    val chatId: String,
    private val chatStore: ChatStore,
    private val db: MessengerDatabase,
    private val currentUserId: String,
    val apiClient: ApiClient,
) : AndroidViewModel(application) {

    private val _messages = MutableStateFlow<List<MessageItem>>(emptyList())
    val messages: StateFlow<List<MessageItem>> = _messages.asStateFlow()

    private val _typingUsers = MutableStateFlow<Set<String>>(emptySet())
    val typingUsers: StateFlow<Set<String>> = _typingUsers.asStateFlow()

    private val _uploadError = MutableStateFlow<String?>(null)
    val uploadError: StateFlow<String?> = _uploadError.asStateFlow()

    private val mediaCache = HashMap<String, ByteArray>()

    init {
        viewModelScope.launch(Dispatchers.IO) {
            val rows = db.messengerQueries.getMessagesForChat(chatId).executeAsList()
            val dbMessages = rows.map { row ->
                MessageItem(
                    id = row.id, clientMsgId = row.client_msg_id, chatId = row.chat_id,
                    senderId = row.sender_id, plaintext = row.plaintext,
                    timestamp = row.timestamp, status = row.status, isDeleted = row.is_deleted != 0L,
                    mediaId = row.media_id, mediaKey = row.media_key,
                    originalName = row.original_name, contentType = row.content_type,
                )
            }
            val existing = chatStore.messages.value[chatId] ?: emptyList()
            val dbIds = dbMessages.map { it.clientMsgId }.toSet()
            val merged = (dbMessages + existing.filter { it.clientMsgId !in dbIds })
                .sortedBy { it.timestamp }
            chatStore.setMessages(chatId, merged)
        }
        viewModelScope.launch {
            chatStore.messages.collect { allMessages ->
                _messages.value = allMessages[chatId] ?: emptyList()
            }
        }
        viewModelScope.launch {
            chatStore.typing.collect { typingMap ->
                _typingUsers.value = typingMap[chatId] ?: emptySet()
            }
        }
    }

    fun sendFile(uri: Uri, context: Context) {
        viewModelScope.launch(Dispatchers.IO) {
            try {
                val bytes = context.contentResolver.openInputStream(uri)?.readBytes()
                    ?: error("Не удалось прочитать файл")
                val contentType = context.contentResolver.getType(uri) ?: "application/octet-stream"
                val originalName = DocumentFile.fromSingleUri(context, uri)?.name ?: "file"
                val clientMsgId = UUID.randomUUID().toString()
                val timestamp = System.currentTimeMillis()

                val result = apiClient.uploadEncryptedMedia(
                    bytes = bytes,
                    filename = originalName,
                    contentType = contentType,
                    chatId = chatId,
                    msgId = clientMsgId,
                )

                db.messengerQueries.insertMessage(
                    id = clientMsgId, client_msg_id = clientMsgId, chat_id = chatId,
                    sender_id = currentUserId, plaintext = "",
                    timestamp = timestamp, status = "sent", is_deleted = 0L,
                    media_id = result.mediaId, media_key = result.mediaKey,
                    original_name = originalName, content_type = contentType,
                )

                chatStore.addMessage(chatId, MessageItem(
                    id = clientMsgId, clientMsgId = clientMsgId, chatId = chatId,
                    senderId = currentUserId, plaintext = "",
                    timestamp = timestamp, status = "sent", isDeleted = false,
                    mediaId = result.mediaId, mediaKey = result.mediaKey,
                    originalName = originalName, contentType = contentType,
                ))
            } catch (e: Exception) {
                _uploadError.value = e.message ?: "Ошибка загрузки файла"
            }
        }
    }

    fun clearUploadError() { _uploadError.value = null }

    suspend fun fetchMediaBytes(mediaId: String, mediaKey: String): ByteArray =
        withContext(Dispatchers.IO) {
            mediaCache.getOrPut(mediaId) {
                apiClient.fetchDecryptedMedia(mediaId, mediaKey)
            }
        }

    suspend fun saveToDownloads(
        context: Context,
        mediaId: String,
        mediaKey: String,
        originalName: String,
    ) = withContext(Dispatchers.IO) {
        val bytes = fetchMediaBytes(mediaId, mediaKey)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = context.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, originalName)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: error("Не удалось создать файл в Downloads")
            resolver.openOutputStream(uri)?.use { it.write(bytes) }
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } else {
            @Suppress("DEPRECATION")
            val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            dir.mkdirs()
            File(dir, originalName).writeBytes(bytes)
        }
    }
}
