package service

import crypto.Ratchet
import crypto.SenderKey
import db.DatabaseProvider
import kotlinx.serialization.json.*
import service.call.CallAnswerSignal
import service.call.CallOfferSignal
import service.call.IceCandidateSignal
import store.ChatStore

/**
 * Принимает WSFrame как JsonElement, декриптует, обновляет ChatStore.
 * Зеркало messenger-ws-orchestrator.ts из web-клиента.
 */
class WSOrchestrator(
    private val ratchet: Ratchet,
    private val senderKey: SenderKey,
    private val chatStore: ChatStore,
    private val currentUserId: String,
    private val onCallOffer: (CallOfferSignal) -> Unit = {},
    private val onCallAnswer: (CallAnswerSignal) -> Unit = {},
    private val onIceCandidate: (IceCandidateSignal) -> Unit = {},
) {
    private val b64Dec = java.util.Base64.getDecoder()

    fun onFrame(frame: JsonElement) {
        val obj = frame.jsonObject
        when (obj["type"]?.jsonPrimitive?.content) {
            "message"          -> handleMessage(obj)
            "ack"              -> handleAck(obj)
            "typing"           -> handleTyping(obj)
            "read"             -> handleRead(obj)
            "message_deleted"  -> handleDeleted(obj)
            "message_edited"   -> handleEdited(obj)
            "call_offer"       -> handleCallOffer(obj)
            "call_answer"      -> handleCallAnswer(obj)
            "ice_candidate"    -> handleIceCandidate(obj)
            "call_end",
            "call_reject"      -> handleCallEnd(obj)
            else               -> { /* игнорируем */ }
        }
    }

    private fun handleMessage(obj: JsonObject) {
        val chatId = obj["chatId"]?.jsonPrimitive?.content ?: return
        val senderId = obj["senderId"]?.jsonPrimitive?.content ?: return
        val ciphertext = obj["ciphertext"]?.jsonPrimitive?.content ?: return
        val messageId = obj["messageId"]?.jsonPrimitive?.content ?: return
        val clientMsgId = obj["clientMsgId"]?.jsonPrimitive?.content ?: messageId
        val timestamp = obj["timestamp"]?.jsonPrimitive?.long ?: System.currentTimeMillis()
        val isGroup = chatStore.isGroup(chatId)

        val plaintext = try {
            val parts = ciphertext.split(":")
            if (parts.size != 2) return
            val nonce = b64Dec.decode(parts[0])
            val ct = b64Dec.decode(parts[1])

            if (isGroup) {
                // MVP: группы используют SenderKey, хранящийся как "sk_$chatId"
                val skBlob = DatabaseProvider.database.messengerQueries
                    .loadRatchetSession("sk_$chatId")
                    .executeAsOneOrNull() ?: return
                senderKey.decrypt(ct, nonce, skBlob)
            } else {
                val sessionKey = "session_${minOf(senderId, currentUserId)}_${maxOf(senderId, currentUserId)}"
                val chainKey = DatabaseProvider.database.messengerQueries
                    .loadRatchetSession(sessionKey)
                    .executeAsOneOrNull() ?: return
                // TODO: MVP упрощение — используется индекс 0 вместо реального счётчика рачета.
                // В полной реализации Double Ratchet нужно хранить и инкрементировать счётчик per-session.
                val msgKey = ratchet.deriveMessageKey(chainKey, 0)
                ratchet.decrypt(ct, nonce, msgKey)
            }
        } catch (e: Exception) {
            return // не удалось расшифровать — пропускаем
        }

        DatabaseProvider.database.messengerQueries.insertMessage(
            id = messageId,
            client_msg_id = clientMsgId,
            chat_id = chatId,
            sender_id = senderId,
            plaintext = String(plaintext),
            timestamp = timestamp,
            status = "delivered",
            is_deleted = 0L,
            media_id = null,
            media_key = null,
            original_name = null,
            content_type = null,
        )
        chatStore.onMessageReceived(chatId, clientMsgId, String(plaintext), senderId, timestamp)
    }

    private fun handleAck(obj: JsonObject) {
        val clientMsgId = obj["clientMsgId"]?.jsonPrimitive?.content ?: return
        DatabaseProvider.database.messengerQueries.updateMessageStatus(
            status = "sent",
            client_msg_id = clientMsgId,
        )
        chatStore.onMessageStatusUpdate(clientMsgId, "sent")
    }

    private fun handleTyping(obj: JsonObject) {
        val chatId = obj["chatId"]?.jsonPrimitive?.content ?: return
        val userId = obj["userId"]?.jsonPrimitive?.content ?: return
        chatStore.onTyping(chatId, userId)
    }

    private fun handleRead(obj: JsonObject) {
        val chatId = obj["chatId"]?.jsonPrimitive?.content ?: return
        val messageId = obj["messageId"]?.jsonPrimitive?.content ?: return
        chatStore.onRead(chatId, messageId)
    }

    private fun handleDeleted(obj: JsonObject) {
        val clientMsgId = obj["clientMsgId"]?.jsonPrimitive?.content ?: return
        DatabaseProvider.database.messengerQueries.softDeleteMessage(client_msg_id = clientMsgId)
        chatStore.onMessageDeleted(clientMsgId)
    }

    private fun handleCallOffer(obj: JsonObject) {
        val callId   = obj["callId"]?.jsonPrimitive?.content ?: return
        val chatId   = obj["chatId"]?.jsonPrimitive?.content ?: return
        val senderId = obj["senderDeviceId"]?.jsonPrimitive?.content
            ?: obj["senderId"]?.jsonPrimitive?.content ?: return
        val sdp      = obj["sdp"]?.jsonPrimitive?.content ?: return
        val isVideo  = obj["isVideo"]?.jsonPrimitive?.booleanOrNull ?: false
        chatStore.onCallOffer(callId, chatId, senderId, isVideo)
        onCallOffer(CallOfferSignal(callId = callId, chatId = chatId, fromUserId = senderId,
            sdp = sdp, isVideo = isVideo))
    }

    private fun handleCallAnswer(obj: JsonObject) {
        val callId = obj["callId"]?.jsonPrimitive?.content ?: return
        val sdp    = obj["sdp"]?.jsonPrimitive?.content ?: return
        chatStore.onCallAnswer(callId)
        onCallAnswer(CallAnswerSignal(callId = callId, sdp = sdp))
    }

    private fun handleIceCandidate(obj: JsonObject) {
        val callId       = obj["callId"]?.jsonPrimitive?.content ?: return
        val sdpMid       = obj["sdpMid"]?.jsonPrimitive?.content ?: return
        val sdpMLineIndex = obj["sdpMLineIndex"]?.jsonPrimitive?.intOrNull ?: return
        val candidate    = obj["candidate"]?.jsonPrimitive?.content ?: return
        onIceCandidate(IceCandidateSignal(callId = callId, sdpMid = sdpMid,
            sdpMLineIndex = sdpMLineIndex, candidate = candidate))
    }

    private fun handleCallEnd(obj: JsonObject) {
        val callId = obj["callId"]?.jsonPrimitive?.content ?: return
        chatStore.onCallEnd(callId)
    }

    private fun handleEdited(obj: JsonObject) {
        val clientMsgId = obj["clientMsgId"]?.jsonPrimitive?.content ?: return
        val ciphertext = obj["ciphertext"]?.jsonPrimitive?.content ?: return
        val senderId = obj["senderId"]?.jsonPrimitive?.content ?: return
        val chatId = obj["chatId"]?.jsonPrimitive?.content ?: return
        val isGroup = chatStore.isGroup(chatId)

        val plaintext = try {
            val parts = ciphertext.split(":")
            if (parts.size != 2) return
            val nonce = b64Dec.decode(parts[0])
            val ct = b64Dec.decode(parts[1])
            if (isGroup) {
                val skBlob = DatabaseProvider.database.messengerQueries
                    .loadRatchetSession("sk_$chatId")
                    .executeAsOneOrNull() ?: return
                senderKey.decrypt(ct, nonce, skBlob)
            } else {
                val sessionKey = "session_${minOf(senderId, currentUserId)}_${maxOf(senderId, currentUserId)}"
                val chainKey = DatabaseProvider.database.messengerQueries
                    .loadRatchetSession(sessionKey)
                    .executeAsOneOrNull() ?: return
                // TODO: MVP упрощение — см. handleMessage
                val msgKey = ratchet.deriveMessageKey(chainKey, 0)
                ratchet.decrypt(ct, nonce, msgKey)
            }
        } catch (e: Exception) {
            return
        }

        chatStore.onMessageEdited(clientMsgId, String(plaintext))
    }
}
