package store

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class ChatStore {
    private val storeScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val typingTimers = java.util.concurrent.ConcurrentHashMap<Pair<String, String>, Job>()
    private val typingTimeoutMs = 5_000L

    private val _chats = MutableStateFlow<List<ChatItem>>(emptyList())
    val chats: StateFlow<List<ChatItem>> = _chats.asStateFlow()

    private val _messages = MutableStateFlow<Map<String, List<MessageItem>>>(emptyMap())
    val messages: StateFlow<Map<String, List<MessageItem>>> = _messages.asStateFlow()

    private val _typing = MutableStateFlow<Map<String, Set<String>>>(emptyMap())
    val typing: StateFlow<Map<String, Set<String>>> = _typing.asStateFlow()

    private val _call = MutableStateFlow(CallState())
    val call: StateFlow<CallState> = _call.asStateFlow()

    private val _callError = MutableStateFlow<String?>(null)
    val callError: StateFlow<String?> = _callError.asStateFlow()

    fun setCallError(message: String) { _callError.value = message }
    fun clearCallError() { _callError.value = null }

    fun setChats(list: List<ChatItem>) { _chats.value = list }

    fun isGroup(chatId: String): Boolean =
        _chats.value.find { it.id == chatId }?.isGroup ?: false

    fun onMessageReceived(chatId: String, clientMsgId: String, plaintext: String, senderId: String, timestamp: Long) {
        val msg = MessageItem(
            id = clientMsgId, clientMsgId = clientMsgId, chatId = chatId,
            senderId = senderId, plaintext = plaintext, timestamp = timestamp,
            status = "delivered", isDeleted = false,
        )
        val current = _messages.value.toMutableMap()
        current[chatId] = (current[chatId] ?: emptyList()) + msg
        _messages.value = current

        val chats = _chats.value.toMutableList()
        val idx = chats.indexOfFirst { it.id == chatId }
        if (idx >= 0) {
            chats[idx] = chats[idx].copy(lastMessage = plaintext, updatedAt = timestamp)
            _chats.value = chats.sortedByDescending { it.updatedAt }
        }
    }

    fun onMessageStatusUpdate(clientMsgId: String, status: String) {
        val updated = _messages.value.mapValues { (_, msgs) ->
            msgs.map { if (it.clientMsgId == clientMsgId) it.copy(status = status) else it }
        }
        _messages.value = updated
    }

    fun onTyping(chatId: String, userId: String) {
        val current = _typing.value.toMutableMap()
        current[chatId] = (current[chatId] ?: emptySet()) + userId
        _typing.value = current

        val key = chatId to userId
        typingTimers[key]?.cancel()
        typingTimers[key] = storeScope.launch {
            delay(typingTimeoutMs)
            onTypingStop(chatId, userId)
        }
    }

    fun onTypingStop(chatId: String, userId: String) {
        val current = _typing.value.toMutableMap()
        val updated = (current[chatId] ?: emptySet()) - userId
        if (updated.isEmpty()) current.remove(chatId) else current[chatId] = updated
        _typing.value = current
        typingTimers.remove(chatId to userId)?.cancel()
    }

    fun onRead(chatId: String, messageId: String) {
        onMessageStatusUpdate(messageId, "read")
    }

    fun onMessageDeleted(clientMsgId: String) {
        val updated = _messages.value.mapValues { (_, msgs) ->
            msgs.map { if (it.clientMsgId == clientMsgId) it.copy(isDeleted = true) else it }
                .filter { !it.isDeleted }
        }
        _messages.value = updated
    }

    fun onMessageEdited(clientMsgId: String, newPlaintext: String) {
        val updated = _messages.value.mapValues { (_, msgs) ->
            msgs.map { if (it.clientMsgId == clientMsgId) it.copy(plaintext = newPlaintext) else it }
        }
        _messages.value = updated
    }

    fun setMessages(chatId: String, msgs: List<MessageItem>) {
        val current = _messages.value.toMutableMap()
        current[chatId] = msgs
        _messages.value = current
    }

    fun onCallOffer(callId: String, chatId: String, fromUserId: String, isVideo: Boolean = false) {
        _call.value = CallState(CallStatus.RINGING_IN, callId, chatId, fromUserId, isVideo)
    }

    fun markLocalVideoReady(callId: String) {
        if (_call.value.callId == callId) _call.value = _call.value.copy(hasLocalVideo = true)
    }

    fun markRemoteVideoReady(callId: String) {
        if (_call.value.callId == callId) _call.value = _call.value.copy(hasRemoteVideo = true)
    }

    fun onCallAnswer(callId: String) {
        val cur = _call.value
        if (cur.callId == callId) _call.value = cur.copy(status = CallStatus.ACTIVE)
    }

    fun onCallEnd(callId: String) {
        if (_call.value.callId == callId) _call.value = CallState()
    }

    fun setOutgoingCall(callId: String, chatId: String, targetId: String, isVideo: Boolean) {
        _call.value = CallState(CallStatus.RINGING_OUT, callId, chatId, targetId, isVideo)
    }

    fun clearCall() { _call.value = CallState() }
}
