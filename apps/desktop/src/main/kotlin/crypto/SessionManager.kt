// SessionManager.kt — E2E Session Manager (Desktop).
// Зеркало Android SessionManager.kt. Совместим с web-клиентом (session-web.ts).
//
// Wire format (direct):  base64(JSON({v:1, ek?, opkId?, ikPub?, msg:{header:{dhPublic,n,pn}, ciphertext:base64(nonce||ct)}}))
// Wire format (group):   base64(JSON({type:"group", nonce:base64, ct:base64}))
// Chain advance:         HMAC-SHA256(chainKey, [0x01]) → msgKey ; HMAC-SHA256(chainKey, [0x02]) → nextKey
// DH ratchet KDF:        BLAKE2b(64, dhOutput, key=rootKey) → [0:32]=newRoot, [32:64]=chainKey
// Encrypt:               secretbox (XSalsa20-Poly1305), ciphertext = base64(nonce||ct)
package crypto

import com.goterl.lazysodium.LazySodium
import com.goterl.lazysodium.interfaces.Box
import com.goterl.lazysodium.interfaces.SecretBox
import com.messenger.db.MessengerDatabase
import service.DeviceBundle
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

// ── Wire payload types ────────────────────────────────────────────────────────

@Serializable
private data class WirePayload(
    val v: Int,
    val ek: String? = null,
    val opkId: Int? = null,
    val ikPub: String? = null,
    val msg: EncryptedMsg,
)

@Serializable
private data class EncryptedMsg(
    val header: RatchetHdr,
    val ciphertext: String,     // base64(nonce || ct)
)

@Serializable
private data class RatchetHdr(
    val dhPublic: String,       // base64(dhRatchetPub)
    val n: Int,
    val pn: Int,
)

@Serializable
private data class GroupWire(
    val type: String,           // "group"
    val nonce: String,          // base64
    val ct: String,             // base64
)

@Serializable
private data class SKDMPayload(
    val type: String,           // "skdm"
    val chatId: String,
    val key: String,            // base64(32-byte sender key)
)

// ── Ratchet state ─────────────────────────────────────────────────────────────

@Serializable
private data class RatchetState(
    val dhSendPublic: String,
    val dhSendPrivate: String,
    val dhRemotePublic: String? = null,
    val rootKey: String,
    val sendChainKey: String? = null,
    val recvChainKey: String? = null,
    val sendCount: Int,
    val recvCount: Int,
    val prevSendCount: Int,
    val skippedKeys: Map<String, SkippedEntry> = emptyMap(),
)

@Serializable
private data class SkippedEntry(
    val key: String,        // base64(messageKey)
    val storedAt: Double,   // epoch ms
)

// ── KeyAccess interface ───────────────────────────────────────────────────────

interface KeyAccess {
    fun loadKey(alias: String): ByteArray?
    fun saveKey(alias: String, keyBytes: ByteArray)
    fun getOrCreateSpkId(): Int
}

// ── SessionManager ────────────────────────────────────────────────────────────

class SessionManager(
    private val sodium: LazySodium,
    private val keyStorage: KeyAccess,
    private val db: MessengerDatabase,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val b64enc = Base64.getEncoder()
    private val b64dec = Base64.getDecoder()
    private val noncebytes = SecretBox.NONCEBYTES
    private val macbytes = SecretBox.MACBYTES
    private val maxSkip = 100
    private val skippedKeyTtl = 7 * 24 * 3600 * 1000.0  // 7 days in ms

    // ── Direct message encrypt ────────────────────────────────────────────────

    fun encryptForDevice(peerId: String, deviceId: String, bundle: DeviceBundle, plaintext: String): String {
        val ikPrivEd = keyStorage.loadKey("ik_sec") ?: error("Identity key not found")
        val ikPub = keyStorage.loadKey("ik_pub") ?: error("Identity pub not found")
        val sessionKey = "$peerId:$deviceId"

        var state = loadState(sessionKey)
        var wireExtra: Triple<String, Int?, String>? = null

        if (state == null) {
            val (newState, extra) = initAsInitiator(bundle, ikPrivEd, ikPub)
            state = newState
            wireExtra = extra
        }

        val (encrypted, nextState) = ratchetEncrypt(state, plaintext)
        saveState(sessionKey, nextState)

        var payload = WirePayload(v = 1, msg = encrypted)
        wireExtra?.let { (ek, opkId, ikPubStr) ->
            payload = payload.copy(ek = ek, opkId = opkId, ikPub = ikPubStr)
        }
        return encodePayload(payload)
    }

    // ── Direct message decrypt ────────────────────────────────────────────────

    fun decryptFromDevice(senderId: String, senderDeviceId: String, encodedPayload: String): String {
        val raw = b64dec.decode(encodedPayload)
        val payload = try {
            json.decodeFromString<WirePayload>(String(raw))
        } catch (_: Exception) {
            return String(raw)
        }

        val sessionKey = "$senderId:$senderDeviceId"
        var state = loadState(sessionKey)

        if (state == null) {
            if (payload.ek == null || payload.ikPub == null) error("No session and no X3DH header")
            state = initAsResponder(payload)
        }

        val (plaintext, nextState) = ratchetDecrypt(state, payload.msg)
        saveState(sessionKey, nextState)
        return plaintext
    }

    // ── Group encrypt ─────────────────────────────────────────────────────────

    fun encryptGroupMessage(chatId: String, plaintext: String): String {
        val senderKey = getOrCreateMySenderKey(chatId)
        val nonce = sodium.randomBytesBuf(noncebytes)
        val ct = ByteArray(plaintext.toByteArray(Charsets.UTF_8).size + macbytes)
        val ptBytes = plaintext.toByteArray(Charsets.UTF_8)
        check(sodium.cryptoSecretBoxEasy(ct, ptBytes, ptBytes.size.toLong(), nonce, senderKey)) { "group encrypt failed" }
        val wire = GroupWire(
            type = "group",
            nonce = b64enc.encodeToString(nonce),
            ct = b64enc.encodeToString(ct),
        )
        return encodePayload(wire)
    }

    fun decryptGroupMessage(chatId: String, senderId: String, encodedPayload: String): String {
        val raw = b64dec.decode(encodedPayload)
        val wire = try {
            json.decodeFromString<GroupWire>(String(raw))
        } catch (_: Exception) { error("Invalid group payload") }
        if (wire.type != "group") error("Not a group payload")

        val nonce = b64dec.decode(wire.nonce)
        val ct = b64dec.decode(wire.ct)
        val sk = loadPeerSenderKey(chatId, senderId) ?: error("No sender key for $senderId in $chatId")

        val plaintext = ByteArray(ct.size - macbytes)
        check(sodium.cryptoSecretBoxOpenEasy(plaintext, ct, ct.size.toLong(), nonce, sk)) { "group decrypt failed" }
        return String(plaintext, Charsets.UTF_8)
    }

    // ── SKDM ─────────────────────────────────────────────────────────────────

    fun handleIncomingSKDM(chatId: String, senderId: String, senderDeviceId: String, encodedSkdm: String) {
        val skdmJson = try { decryptFromDevice(senderId, senderDeviceId, encodedSkdm) } catch (_: Exception) { return }
        val skdm = try { json.decodeFromString<SKDMPayload>(skdmJson) } catch (_: Exception) { return }
        if (skdm.type != "skdm") return
        val key = b64dec.decode(skdm.key)
        savePeerSenderKey(chatId, senderId, key)
    }

    fun buildSKDM(chatId: String): String {
        val senderKey = getOrCreateMySenderKey(chatId)
        return json.encodeToString(SKDMPayload(type = "skdm", chatId = chatId,
            key = b64enc.encodeToString(senderKey)))
    }

    // ── X3DH initiator ────────────────────────────────────────────────────────

    private fun initAsInitiator(bundle: DeviceBundle, myIKPrivEd: ByteArray, myIKPub: ByteArray)
    : Pair<RatchetState, Triple<String, Int?, String>> {
        val ekPub = ByteArray(Box.PUBLICKEYBYTES)
        val ekPriv = ByteArray(Box.SECRETKEYBYTES)
        (sodium as Box.Native).cryptoBoxKeypair(ekPub, ekPriv)

        val bobIKPubEd = b64dec.decode(bundle.ikPublic)
        val bobSPKPub = b64dec.decode(bundle.spkPublic)
        val bobOPKPub = bundle.opkPublic?.let { b64dec.decode(it) }

        val aliceIKCurvePriv = ed25519SkToCurve25519(myIKPrivEd)
        val bobIKCurvePub = ed25519PkToCurve25519(bobIKPubEd)

        val dh1 = scalarmult(aliceIKCurvePriv, bobSPKPub)
        val dh2 = scalarmult(ekPriv, bobIKCurvePub)
        val dh3 = scalarmult(ekPriv, bobSPKPub)
        val combined = if (bobOPKPub != null) {
            val dh4 = scalarmult(ekPriv, bobOPKPub)
            dh1 + dh2 + dh3 + dh4
        } else {
            dh1 + dh2 + dh3
        }
        val sharedSecret = genericHash(combined, 32)

        val dhOutput = scalarmult(ekPriv, bobSPKPub)
        val (newRoot, chainKey) = deriveKeys(dhOutput, sharedSecret)

        val state = RatchetState(
            dhSendPublic = b64enc.encodeToString(ekPub),
            dhSendPrivate = b64enc.encodeToString(ekPriv),
            dhRemotePublic = b64enc.encodeToString(bobSPKPub),
            rootKey = b64enc.encodeToString(newRoot),
            sendChainKey = b64enc.encodeToString(chainKey),
            recvChainKey = null,
            sendCount = 0, recvCount = 0, prevSendCount = 0,
        )
        val wire = Triple(b64enc.encodeToString(ekPub), bundle.opkId, b64enc.encodeToString(myIKPub))
        return state to wire
    }

    // ── X3DH responder ────────────────────────────────────────────────────────

    private fun initAsResponder(wire: WirePayload): RatchetState {
        val myIKPrivEd = keyStorage.loadKey("ik_sec") ?: error("Identity key not found")
        val mySpkPub = keyStorage.loadKey("spk_pub") ?: error("SPK pub not found")
        val mySpkPriv = keyStorage.loadKey("spk_sec") ?: error("SPK priv not found")

        val aliceEKPub = b64dec.decode(wire.ek!!)
        val aliceIKPubEd = b64dec.decode(wire.ikPub!!)

        val myIKCurvePriv = ed25519SkToCurve25519(myIKPrivEd)
        val aliceIKCurvePub = ed25519PkToCurve25519(aliceIKPubEd)

        val dh1 = scalarmult(mySpkPriv, aliceIKCurvePub)
        val dh2 = scalarmult(myIKCurvePriv, aliceEKPub)
        val dh3 = scalarmult(mySpkPriv, aliceEKPub)
        val combined = wire.opkId?.let { id ->
            val opkPriv = keyStorage.loadKey("opk_$id") ?: error("OPK private key not found: $id")
            require(opkPriv.size == 32) { "OPK priv must be 32 bytes" }
            val dh4 = scalarmult(opkPriv, aliceEKPub)
            dh1 + dh2 + dh3 + dh4
        } ?: (dh1 + dh2 + dh3)
        val sharedSecret = genericHash(combined, 32)

        return RatchetState(
            dhSendPublic = b64enc.encodeToString(mySpkPub),
            dhSendPrivate = b64enc.encodeToString(mySpkPriv),
            dhRemotePublic = null,
            rootKey = b64enc.encodeToString(sharedSecret),
            sendChainKey = null,
            recvChainKey = null,
            sendCount = 0, recvCount = 0, prevSendCount = 0,
        )
    }

    // ── Double Ratchet encrypt ────────────────────────────────────────────────

    private fun ratchetEncrypt(state: RatchetState, plaintext: String): Pair<EncryptedMsg, RatchetState> {
        val chainKey = b64dec.decode(state.sendChainKey ?: error("No send chain key"))
        val (msgKey, nextChain) = advanceChain(chainKey)

        val nonce = sodium.randomBytesBuf(noncebytes)
        val ptBytes = plaintext.toByteArray(Charsets.UTF_8)
        val ct = ByteArray(ptBytes.size + macbytes)
        check(sodium.cryptoSecretBoxEasy(ct, ptBytes, ptBytes.size.toLong(), nonce, msgKey)) { "encrypt failed" }

        val combined = nonce + ct
        val msg = EncryptedMsg(
            header = RatchetHdr(
                dhPublic = state.dhSendPublic,
                n = state.sendCount,
                pn = state.prevSendCount,
            ),
            ciphertext = b64enc.encodeToString(combined),
        )
        val nextState = state.copy(sendChainKey = b64enc.encodeToString(nextChain), sendCount = state.sendCount + 1)
        return msg to nextState
    }

    // ── Double Ratchet decrypt ────────────────────────────────────────────────

    private fun ratchetDecrypt(state: RatchetState, message: EncryptedMsg): Pair<String, RatchetState> {
        val dhBytes = b64dec.decode(message.header.dhPublic)
        val n = message.header.n
        val pn = message.header.pn

        val skipKey = "${message.header.dhPublic}:$n"
        var freshSkipped = purgeExpiredSkippedKeys(state.skippedKeys)

        freshSkipped[skipKey]?.let { entry ->
            val msgKey = b64dec.decode(entry.key)
            val nextState = state.copy(skippedKeys = freshSkipped - skipKey)
            return decryptWithKey(msgKey, message) to nextState
        }

        var cur = state.copy(skippedKeys = freshSkipped)

        val curRemote = cur.dhRemotePublic?.let { b64dec.decode(it) }
        if (curRemote == null || !curRemote.contentEquals(dhBytes)) {
            cur = skipMessageKeys(cur, pn)
            cur = performDHRatchet(cur, dhBytes)
        }

        cur = skipMessageKeys(cur, n)
        val recvChain = b64dec.decode(cur.recvChainKey ?: error("No recv chain key"))
        val (msgKey, nextChain) = advanceChain(recvChain)
        val plain = decryptWithKey(msgKey, message)
        val nextState = cur.copy(recvChainKey = b64enc.encodeToString(nextChain), recvCount = n + 1)
        return plain to nextState
    }

    // ── DH Ratchet step ───────────────────────────────────────────────────────

    private fun performDHRatchet(state: RatchetState, theirNewDH: ByteArray): RatchetState {
        val dhOut1 = scalarmult(b64dec.decode(state.dhSendPrivate), theirNewDH)
        val (root1, recv) = deriveKeys(dhOut1, b64dec.decode(state.rootKey))

        val newPub = ByteArray(Box.PUBLICKEYBYTES)
        val newPriv = ByteArray(Box.SECRETKEYBYTES)
        (sodium as Box.Native).cryptoBoxKeypair(newPub, newPriv)

        val dhOut2 = scalarmult(newPriv, theirNewDH)
        val (root2, send) = deriveKeys(dhOut2, root1)

        return state.copy(
            dhSendPublic = b64enc.encodeToString(newPub),
            dhSendPrivate = b64enc.encodeToString(newPriv),
            dhRemotePublic = b64enc.encodeToString(theirNewDH),
            rootKey = b64enc.encodeToString(root2),
            recvChainKey = b64enc.encodeToString(recv),
            sendChainKey = b64enc.encodeToString(send),
            prevSendCount = state.sendCount,
            sendCount = 0,
            recvCount = 0,
        )
    }

    // ── Skip message keys ─────────────────────────────────────────────────────

    private fun skipMessageKeys(state: RatchetState, until: Int): RatchetState {
        val recvChain = state.recvChainKey?.let { b64dec.decode(it) } ?: return state
        if (state.recvCount >= until) return state

        val dhPubB64 = state.dhRemotePublic ?: "none"
        val skipped = state.skippedKeys.toMutableMap()
        var chain = recvChain
        var count = state.recvCount
        val now = System.currentTimeMillis().toDouble()

        while (count < minOf(until, count + maxSkip)) {
            val (msgKey, nextChain) = advanceChain(chain)
            skipped["$dhPubB64:$count"] = SkippedEntry(b64enc.encodeToString(msgKey), now)
            chain = nextChain
            count++
        }
        return state.copy(
            skippedKeys = skipped,
            recvChainKey = b64enc.encodeToString(chain),
            recvCount = count,
        )
    }

    // ── Chain advance (HMAC-SHA256) ───────────────────────────────────────────

    private fun advanceChain(chainKey: ByteArray): Pair<ByteArray, ByteArray> =
        hmacSha256(byteArrayOf(0x01), chainKey) to hmacSha256(byteArrayOf(0x02), chainKey)

    private fun hmacSha256(message: ByteArray, key: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(message)
    }

    // ── KDF: BLAKE2b 64 bytes ─────────────────────────────────────────────────

    private fun deriveKeys(inputKey: ByteArray, salt: ByteArray): Pair<ByteArray, ByteArray> {
        val out = ByteArray(64)
        check(sodium.cryptoGenericHash(out, 64, inputKey, inputKey.size.toLong(), salt, salt.size)) { "BLAKE2b failed" }
        return out.copyOfRange(0, 32) to out.copyOfRange(32, 64)
    }

    // ── Curve25519 helpers ────────────────────────────────────────────────────

    private fun scalarmult(priv: ByteArray, pub: ByteArray): ByteArray {
        require(priv.size == 32) { "scalarmult: priv must be 32 bytes, got ${priv.size}" }
        require(pub.size == 32) { "scalarmult: pub must be 32 bytes, got ${pub.size}" }
        val out = ByteArray(32)
        check(sodium.cryptoScalarMult(out, priv, pub)) { "cryptoScalarMult failed" }
        return out
    }

    private fun ed25519PkToCurve25519(edPk: ByteArray): ByteArray {
        require(edPk.size == 32) { "ed25519 pub must be 32 bytes, got ${edPk.size}" }
        val out = ByteArray(32)
        check(sodium.convertPublicKeyEd25519ToCurve25519(out, edPk)) { "ed25519PkToCurve25519 failed" }
        return out
    }

    private fun ed25519SkToCurve25519(edSk: ByteArray): ByteArray {
        require(edSk.size == 64) { "ed25519 sk must be 64 bytes, got ${edSk.size}" }
        val out = ByteArray(32)
        check(sodium.convertSecretKeyEd25519ToCurve25519(out, edSk)) { "ed25519SkToCurve25519 failed" }
        return out
    }

    // ── Symmetric decrypt ─────────────────────────────────────────────────────

    private fun decryptWithKey(msgKey: ByteArray, message: EncryptedMsg): String {
        val combined = b64dec.decode(message.ciphertext)
        val nonce = combined.copyOfRange(0, noncebytes)
        val ct = combined.copyOfRange(noncebytes, combined.size)
        val plain = ByteArray(ct.size - macbytes)
        check(sodium.cryptoSecretBoxOpenEasy(plain, ct, ct.size.toLong(), nonce, msgKey)) { "decrypt failed" }
        return String(plain, Charsets.UTF_8)
    }

    // ── Group sender key persistence ──────────────────────────────────────────

    private fun getOrCreateMySenderKey(chatId: String): ByteArray {
        val dbKey = "sk_$chatId"
        val blob = db.messengerQueries.loadRatchetSession(dbKey).executeAsOneOrNull()
        if (blob != null && blob.size == 32) return blob
        val key = sodium.randomBytesBuf(32)
        db.messengerQueries.saveRatchetSession(dbKey, key)
        return key
    }

    private fun loadPeerSenderKey(chatId: String, senderId: String): ByteArray? {
        val dbKey = "skp_${chatId}_$senderId"
        return db.messengerQueries.loadRatchetSession(dbKey).executeAsOneOrNull()
    }

    private fun savePeerSenderKey(chatId: String, senderId: String, key: ByteArray) {
        db.messengerQueries.saveRatchetSession("skp_${chatId}_$senderId", key)
    }

    // ── Session state persistence ─────────────────────────────────────────────

    private fun loadState(sessionKey: String): RatchetState? {
        val blob = db.messengerQueries.loadRatchetSession(sessionKey).executeAsOneOrNull() ?: return null
        if (blob.isEmpty()) return null
        return try { json.decodeFromString<RatchetState>(String(blob)) } catch (_: Exception) { null }
    }

    private fun saveState(sessionKey: String, state: RatchetState) {
        db.messengerQueries.saveRatchetSession(sessionKey, json.encodeToString(state).toByteArray())
    }

    // ── Encode payload ────────────────────────────────────────────────────────

    private inline fun <reified T> encodePayload(payload: T): String =
        b64enc.encodeToString(json.encodeToString(payload).toByteArray())

    // ── Skipped key cleanup ───────────────────────────────────────────────────

    private fun purgeExpiredSkippedKeys(keys: Map<String, SkippedEntry>): Map<String, SkippedEntry> {
        val cutoff = System.currentTimeMillis() - skippedKeyTtl
        return keys.filter { it.value.storedAt >= cutoff }
    }

    // ── BLAKE2b generic hash (no key) ─────────────────────────────────────────

    private fun genericHash(input: ByteArray, outLen: Int): ByteArray {
        val out = ByteArray(outLen)
        check(sodium.cryptoGenericHash(out, outLen, input, input.size.toLong(), null, 0)) { "genericHash failed" }
        return out
    }
}
