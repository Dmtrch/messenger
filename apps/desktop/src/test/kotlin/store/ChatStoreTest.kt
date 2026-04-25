// apps/desktop/src/test/kotlin/store/ChatStoreTest.kt
package store

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ChatStoreTest {

    @Test
    fun `onTyping sets user as typing in chat`() = runTest {
        val store = ChatStore()

        store.onTyping("chat1", "user1")

        val typingInChat = store.typing.value["chat1"]
        assertTrue(typingInChat?.contains("user1") == true, "user1 должен быть в typing для chat1")
    }

    @Test
    fun `onTypingStop removes user from typing`() = runTest {
        val store = ChatStore()

        store.onTyping("chat1", "user1")
        store.onTypingStop("chat1", "user1")

        val typingInChat = store.typing.value["chat1"]
        assertFalse(typingInChat?.contains("user1") == true, "user1 не должен быть в typing после onTypingStop")
    }

    @Test
    fun `onTyping for multiple users tracks all`() = runTest {
        val store = ChatStore()

        store.onTyping("chat1", "userA")
        store.onTyping("chat1", "userB")

        val typingInChat = store.typing.value["chat1"] ?: emptySet()
        assertTrue(typingInChat.contains("userA"), "userA должен быть в typing")
        assertTrue(typingInChat.contains("userB"), "userB должен быть в typing")
    }

    @Test
    fun `onTypingStop for one user leaves others`() = runTest {
        val store = ChatStore()

        store.onTyping("chat1", "userA")
        store.onTyping("chat1", "userB")
        store.onTypingStop("chat1", "userA")

        val typingInChat = store.typing.value["chat1"] ?: emptySet()
        assertFalse(typingInChat.contains("userA"), "userA не должен быть в typing")
        assertTrue(typingInChat.contains("userB"), "userB должен оставаться в typing")
    }
}
