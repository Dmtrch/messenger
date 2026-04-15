package com.messenger.store

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ChatStoreCallStateTest {

    @Test
    fun `incoming video offer marks preview flags false until tracks attach`() {
        val store = ChatStore()
        store.onCallOffer(callId = "c1", chatId = "chat-1", fromUserId = "bob", isVideo = true)
        assertEquals(CallStatus.RINGING_IN, store.call.value.status)
        assertEquals(false, store.call.value.hasLocalVideo)
        assertEquals(false, store.call.value.hasRemoteVideo)
    }

    @Test
    fun `markLocalVideoReady sets flag for matching call`() {
        val store = ChatStore()
        store.onCallOffer(callId = "c1", chatId = "chat-1", fromUserId = "bob", isVideo = true)
        store.markLocalVideoReady("c1")
        assertEquals(true, store.call.value.hasLocalVideo)
        assertEquals(false, store.call.value.hasRemoteVideo)
    }

    @Test
    fun `markRemoteVideoReady sets flag for matching call`() {
        val store = ChatStore()
        store.onCallOffer(callId = "c1", chatId = "chat-1", fromUserId = "bob", isVideo = true)
        store.markRemoteVideoReady("c1")
        assertEquals(false, store.call.value.hasLocalVideo)
        assertEquals(true, store.call.value.hasRemoteVideo)
    }

    @Test
    fun `markLocalVideoReady ignores mismatched callId`() {
        val store = ChatStore()
        store.onCallOffer(callId = "c1", chatId = "chat-1", fromUserId = "bob", isVideo = true)
        store.markLocalVideoReady("other-call")
        assertEquals(false, store.call.value.hasLocalVideo)
    }

    @Test
    fun `clearCall resets all video flags`() {
        val store = ChatStore()
        store.onCallOffer(callId = "c1", chatId = "chat-1", fromUserId = "bob", isVideo = true)
        store.markLocalVideoReady("c1")
        store.clearCall()
        assertEquals(CallStatus.IDLE, store.call.value.status)
        assertEquals(false, store.call.value.hasLocalVideo)
        assertEquals(false, store.call.value.hasRemoteVideo)
    }
}
