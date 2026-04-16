package com.messenger.service

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.goterl.lazysodium.LazySodiumJava
import com.goterl.lazysodium.SodiumJava
import com.messenger.crypto.KeyAccess
import com.messenger.crypto.SessionManager
import com.messenger.db.MessengerDatabase
import com.messenger.store.ChatItem
import com.messenger.store.ChatStore
import kotlinx.serialization.json.Json
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertIterableEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

private class FakeKeyAccess : KeyAccess {
    private val keys = mutableMapOf<String, ByteArray>()
    override fun loadKey(alias: String): ByteArray? = keys[alias]
    override fun saveKey(alias: String, keyBytes: ByteArray) { keys[alias] = keyBytes }
    override fun getOrCreateSpkId(): Int = 1
}

class WSOrchestratorCallSignalingTest {
    private val sodium = LazySodiumJava(SodiumJava())

    private fun createDb(): MessengerDatabase {
        val driver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)
        MessengerDatabase.Schema.create(driver)
        return MessengerDatabase(driver)
    }

    private fun makeOrchestrator(
        chatStore: ChatStore = ChatStore(),
        currentUserId: String = "alice",
        onCallOffer: (com.messenger.service.call.CallOfferSignal) -> Unit = {},
        onCallAnswer: (com.messenger.service.call.CallAnswerSignal) -> Unit = {},
        onIceCandidate: (com.messenger.service.call.IceCandidateSignal) -> Unit = {},
        onCallEnd: (String) -> Unit = {},
    ): WSOrchestrator {
        val db = createDb()
        val sm = SessionManager(sodium, FakeKeyAccess(), db)
        return WSOrchestrator(
            sessionManager = sm,
            chatStore = chatStore,
            db = db,
            currentUserId = currentUserId,
            onCallOffer = onCallOffer,
            onCallAnswer = onCallAnswer,
            onIceCandidate = onIceCandidate,
            onCallEnd = onCallEnd,
        )
    }

    @Test
    fun `call offer parses isVideo from signaling payload`() {
        val events = mutableListOf<String>()
        val chatStore = ChatStore().apply {
            setChats(
                listOf(
                    ChatItem(
                        id = "chat-1",
                        name = "Chat 1",
                        isGroup = false,
                        lastMessage = null,
                        updatedAt = 0L,
                    ),
                ),
            )
        }
        val orchestrator = makeOrchestrator(
            chatStore = chatStore,
            onCallOffer = { offer -> events += "offer:${offer.callId}:${offer.sdp}:${offer.isVideo}" },
            onCallAnswer = { answer -> events += "answer:${answer.callId}:${answer.sdp}" },
            onIceCandidate = { ice ->
                events += "ice:${ice.callId}:${ice.sdpMid}:${ice.sdpMLineIndex}:${ice.candidate}"
            },
            onCallEnd = { callId -> events += "end:$callId" },
        )

        orchestrator.onFrame(
            Json.parseToJsonElement(
                """
                {
                  "type": "call_offer",
                  "callId": "call-1",
                  "chatId": "chat-1",
                  "senderId": "bob",
                  "sdp": "offer-sdp",
                  "isVideo": true
                }
                """.trimIndent(),
            ),
        )
        orchestrator.onFrame(
            Json.parseToJsonElement(
                """
                {
                  "type": "call_answer",
                  "callId": "call-1",
                  "sdp": "answer-sdp"
                }
                """.trimIndent(),
            ),
        )
        orchestrator.onFrame(
            Json.parseToJsonElement(
                """
                {
                  "type": "ice_candidate",
                  "callId": "call-1",
                  "candidate": "candidate-1",
                  "sdpMid": "audio",
                  "sdpMLineIndex": 0
                }
                """.trimIndent(),
            ),
        )
        orchestrator.onFrame(
            Json.parseToJsonElement(
                """
                {
                  "type": "call_end",
                  "callId": "call-1"
                }
                """.trimIndent(),
            ),
        )

        assertEquals("", chatStore.call.value.callId)
        assertEquals("IDLE", chatStore.call.value.status.name)
        assertTrue(events.contains("offer:call-1:offer-sdp:true"))
        assertIterableEquals(
            listOf(
                "offer:call-1:offer-sdp:true",
                "answer:call-1:answer-sdp",
                "ice:call-1:audio:0:candidate-1",
                "end:call-1",
            ),
            events,
        )
    }

    @Test
    fun `call reject forwards end callback`() {
        val events = mutableListOf<String>()
        val orchestrator = makeOrchestrator(
            onCallEnd = { callId -> events += callId },
        )

        orchestrator.onFrame(
            Json.parseToJsonElement(
                """
                {
                  "type": "call_reject",
                  "callId": "call-9"
                }
                """.trimIndent(),
            ),
        )

        assertEquals(listOf("call-9"), events)
    }

    @Test
    fun `call offer prefers senderId over senderDeviceId for remote user`() {
        val chatStore = ChatStore().apply {
            setChats(
                listOf(
                    ChatItem(
                        id = "chat-1",
                        name = "Chat 1",
                        isGroup = false,
                        lastMessage = null,
                        updatedAt = 0L,
                    ),
                ),
            )
        }
        val orchestrator = makeOrchestrator(
            chatStore = chatStore,
        )

        orchestrator.onFrame(
            Json.parseToJsonElement(
                """
                {
                  "type": "call_offer",
                  "callId": "call-2",
                  "chatId": "chat-1",
                  "senderId": "bob",
                  "senderDeviceId": "bob-device",
                  "sdp": "offer-sdp",
                  "isVideo": false
                }
                """.trimIndent(),
            ),
        )

        assertEquals("bob", chatStore.call.value.remoteUserId)
    }
}
