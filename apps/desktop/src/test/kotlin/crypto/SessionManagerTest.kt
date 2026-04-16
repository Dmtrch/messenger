package crypto

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import com.goterl.lazysodium.LazySodiumJava
import com.goterl.lazysodium.SodiumJava
import com.goterl.lazysodium.interfaces.Box
import com.goterl.lazysodium.interfaces.Sign
import com.messenger.db.MessengerDatabase
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import service.DeviceBundle
import java.util.Base64

// ── Test helpers ──────────────────────────────────────────────────────────────

private class MapKeyAccess : KeyAccess {
    private val keys = mutableMapOf<String, ByteArray>()
    private var spkId: Int = 0

    override fun loadKey(alias: String): ByteArray? = keys[alias]
    override fun saveKey(alias: String, keyBytes: ByteArray) { keys[alias] = keyBytes }
    override fun getOrCreateSpkId(): Int {
        if (spkId == 0) spkId = (1..Int.MAX_VALUE).random()
        return spkId
    }
}

private fun makeDb(): MessengerDatabase {
    val driver = JdbcSqliteDriver("jdbc:sqlite::memory:")
    MessengerDatabase.Schema.create(driver)
    return MessengerDatabase(driver)
}

private val b64 = Base64.getEncoder()

private fun generateBundle(sodium: LazySodiumJava, keys: MapKeyAccess, opkId: Int = 1): DeviceBundle {
    val ikPub = ByteArray(Sign.PUBLICKEYBYTES)
    val ikSec = ByteArray(Sign.SECRETKEYBYTES)
    (sodium as Sign.Native).cryptoSignKeypair(ikPub, ikSec)
    keys.saveKey("ik_pub", ikPub)
    keys.saveKey("ik_sec", ikSec)

    val spkPub = ByteArray(Box.PUBLICKEYBYTES)
    val spkSec = ByteArray(Box.SECRETKEYBYTES)
    (sodium as Box.Native).cryptoBoxKeypair(spkPub, spkSec)
    keys.saveKey("spk_pub", spkPub)
    keys.saveKey("spk_sec", spkSec)

    val spkSig = ByteArray(Sign.BYTES)
    (sodium as Sign.Native).cryptoSignDetached(spkSig, spkPub, spkPub.size.toLong(), ikSec)
    keys.saveKey("spk_sig", spkSig)

    val opkPub = ByteArray(Box.PUBLICKEYBYTES)
    val opkSec = ByteArray(Box.SECRETKEYBYTES)
    (sodium as Box.Native).cryptoBoxKeypair(opkPub, opkSec)
    keys.saveKey("opk_$opkId", opkSec)

    return DeviceBundle(
        deviceId = "device",
        ikPublic = b64.encodeToString(ikPub),
        spkPublic = b64.encodeToString(spkPub),
        spkId = keys.getOrCreateSpkId(),
        spkSignature = b64.encodeToString(spkSig),
        opkPublic = b64.encodeToString(opkPub),
        opkId = opkId,
    )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

class SessionManagerTest {

    private val sodium = LazySodiumJava(SodiumJava())

    // ── Test 1: X3DH handshake + first message ────────────────────────────────

    @Test
    fun `alice sends to bob - X3DH handshake and decrypt`() {
        val aliceKeys = MapKeyAccess()
        val bobKeys = MapKeyAccess()
        val aliceDb = makeDb()
        val bobDb = makeDb()

        generateBundle(sodium, aliceKeys)          // populate Alice's own keys
        val bobBundle = generateBundle(sodium, bobKeys)

        val alice = SessionManager(sodium, aliceKeys, aliceDb)
        val bob = SessionManager(sodium, bobKeys, bobDb)

        val cipher = alice.encryptForDevice("bob", "device", bobBundle, "hello bob")
        val plain = bob.decryptFromDevice("alice", "device", cipher)

        assertEquals("hello bob", plain)
    }

    // ── Test 2: multiple messages in both directions ──────────────────────────

    @Test
    fun `bidirectional multi-message exchange`() {
        val aliceKeys = MapKeyAccess()
        val bobKeys = MapKeyAccess()

        generateBundle(sodium, aliceKeys)
        val bobBundle = generateBundle(sodium, bobKeys)
        val aliceBundle = DeviceBundle(
            deviceId = "device",
            ikPublic = b64.encodeToString(aliceKeys.loadKey("ik_pub")!!),
            spkPublic = b64.encodeToString(aliceKeys.loadKey("spk_pub")!!),
            opkPublic = null,
            opkId = null,
        )

        val alice = SessionManager(sodium, aliceKeys, makeDb())
        val bob = SessionManager(sodium, bobKeys, makeDb())

        // Alice → Bob
        val c1 = alice.encryptForDevice("bob", "device", bobBundle, "msg1")
        val c2 = alice.encryptForDevice("bob", "device", bobBundle, "msg2")
        assertEquals("msg1", bob.decryptFromDevice("alice", "device", c1))
        assertEquals("msg2", bob.decryptFromDevice("alice", "device", c2))

        // Bob → Alice (initiates new session)
        val c3 = bob.encryptForDevice("alice", "device", aliceBundle, "reply1")
        assertEquals("reply1", alice.decryptFromDevice("bob", "device", c3))

        // Alice → Bob again (DH ratchet advances)
        val c4 = alice.encryptForDevice("bob", "device", bobBundle, "msg3")
        assertEquals("msg3", bob.decryptFromDevice("alice", "device", c4))
    }

    // ── Test 3: out-of-order delivery (Double Ratchet skip keys) ─────────────

    @Test
    fun `out-of-order delivery - skip keys`() {
        val aliceKeys = MapKeyAccess()
        val bobKeys = MapKeyAccess()

        generateBundle(sodium, aliceKeys)
        val bobBundle = generateBundle(sodium, bobKeys)

        val alice = SessionManager(sodium, aliceKeys, makeDb())
        val bob = SessionManager(sodium, bobKeys, makeDb())

        // c0 carries the X3DH header — must arrive first to establish session
        val c0 = alice.encryptForDevice("bob", "device", bobBundle, "zero")
        assertEquals("zero", bob.decryptFromDevice("alice", "device", c0))

        // Subsequent messages are in the same ratchet epoch (no DH ratchet step yet)
        val c1 = alice.encryptForDevice("bob", "device", bobBundle, "one")
        val c2 = alice.encryptForDevice("bob", "device", bobBundle, "two")
        val c3 = alice.encryptForDevice("bob", "device", bobBundle, "three")

        // Bob receives out-of-order: 3, 1, 2 — skip keys must save c1 and c2 when c3 arrives
        assertEquals("three", bob.decryptFromDevice("alice", "device", c3))
        assertEquals("one",   bob.decryptFromDevice("alice", "device", c1))
        assertEquals("two",   bob.decryptFromDevice("alice", "device", c2))
    }

    // ── Test 4: group SKDM distribution + group decrypt ──────────────────────

    @Test
    fun `group SKDM distribution and group decrypt`() {
        val aliceKeys = MapKeyAccess()
        val bobKeys = MapKeyAccess()

        generateBundle(sodium, aliceKeys)
        val bobBundle = generateBundle(sodium, bobKeys)

        val alice = SessionManager(sodium, aliceKeys, makeDb())
        val bob = SessionManager(sodium, bobKeys, makeDb())

        val chatId = "group-chat-1"

        // Alice builds SKDM and sends it to Bob over direct channel
        val skdmPlaintext = alice.buildSKDM(chatId)
        val skdmCipher = alice.encryptForDevice("bob", "device", bobBundle, skdmPlaintext)
        bob.handleIncomingSKDM(chatId, "alice", "device", skdmCipher)

        // Alice sends group message
        val groupCipher = alice.encryptGroupMessage(chatId, "hello group")

        // Bob decrypts group message using Alice's sender key
        val plain = bob.decryptGroupMessage(chatId, "alice", groupCipher)
        assertEquals("hello group", plain)
    }

    // ── Test 5: multiple group messages ──────────────────────────────────────

    @Test
    fun `multiple group messages from same sender`() {
        val aliceKeys = MapKeyAccess()
        val bobKeys = MapKeyAccess()

        generateBundle(sodium, aliceKeys)
        val bobBundle = generateBundle(sodium, bobKeys)

        val alice = SessionManager(sodium, aliceKeys, makeDb())
        val bob = SessionManager(sodium, bobKeys, makeDb())

        val chatId = "group-chat-2"

        // Distribute sender key
        val skdm = alice.buildSKDM(chatId)
        val skdmCipher = alice.encryptForDevice("bob", "device", bobBundle, skdm)
        bob.handleIncomingSKDM(chatId, "alice", "device", skdmCipher)

        // Multiple messages
        listOf("first", "second", "third").forEach { text ->
            val cipher = alice.encryptGroupMessage(chatId, text)
            assertEquals(text, bob.decryptGroupMessage(chatId, "alice", cipher))
        }
    }
}
