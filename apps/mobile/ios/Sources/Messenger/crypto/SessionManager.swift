// SessionManager.swift — E2E Session Manager.
//
// Реализует X3DH + Double Ratchet совместимый с web-клиентом (session-web.ts / ratchet-web.ts).
//
// Wire format (direct):  base64(JSON({ v:1, ek?, opkId?, ikPub?, msg: { header:{dhPublic,n,pn}, ciphertext:base64(nonce||ct) } }))
// Wire format (group):   base64(JSON({ type:"group", nonce:base64, ct:base64 }))
// Chain advance:         HMAC-SHA256(chainKey, [0x01]) → msgKey ; HMAC-SHA256(chainKey, [0x02]) → nextKey
// DH ratchet KDF:        BLAKE2b(64, dhOutput, key=rootKey) → [0:32]=newRoot, [32:64]=chainKey
// Encrypt:               secretbox (XSalsa20-Poly1305), ciphertext = base64(nonce||ct)
// Session key:           "{peerId}:{deviceId}"
// Group sender key DB:   "sk_{chatId}"      (my key)
//                        "skp_{chatId}_{senderId}" (peer key)

import Foundation
import Sodium
import Clibsodium

// MARK: - Errors

enum SessionError: Error {
    case identityKeyNotFound
    case noSessionAndNoX3DHHeader
    case decryptFailed
    case encryptFailed
    case noSenderKey
    case invalidPayload
}

// MARK: - Wire payload types

private struct WirePayload: Codable {
    let v: Int
    var ek: String?
    var opkId: Int?
    var ikPub: String?
    let msg: EncryptedMessage
}

private struct EncryptedMessage: Codable {
    let header: RatchetHeader
    let ciphertext: String      // base64(nonce || ct)
}

private struct RatchetHeader: Codable {
    let dhPublic: String        // base64(dhRatchetPub)
    let n: Int
    let pn: Int
}

private struct GroupWirePayload: Codable {
    let type: String            // "group"
    let nonce: String           // base64
    let ct: String              // base64
}

private struct SKDMPayload: Codable {
    let type: String            // "skdm"
    let chatId: String
    let key: String             // base64(32-byte sender key)
}

// MARK: - Ratchet state

private struct DoubleRatchetState: Codable {
    var dhSendPublic: [UInt8]
    var dhSendPrivate: [UInt8]
    var dhRemotePublic: [UInt8]?
    var rootKey: [UInt8]
    var sendChainKey: [UInt8]?
    var recvChainKey: [UInt8]?
    var sendCount: Int
    var recvCount: Int
    var prevSendCount: Int
    var skippedKeys: [String: SkippedKeyEntry]
}

private struct SkippedKeyEntry: Codable {
    let key: String             // base64(messageKey)
    let storedAt: Double        // timestamp ms
}

// MARK: - SessionManager

final class SessionManager {
    private let sodium = Sodium()
    private let x3dh   = X3DH()
    private let db: DatabaseManager
    private let keyStorage: KeyStorage

    private let maxSkip = 100
    private let skippedKeyTTL: Double = 7 * 24 * 3600 * 1000

    init(db: DatabaseManager, keyStorage: KeyStorage) {
        self.db         = db
        self.keyStorage = keyStorage
    }

    // MARK: - Direct message encrypt (fan-out: one call per device)

    /// Шифрует plaintext для конкретного устройства получателя.
    /// Возвращает base64(JSON(WirePayload)).
    func encryptForDevice(peerId: String, deviceId: String,
                          bundle: DeviceBundle, plaintext: String) throws -> String {
        let ikPair = keyStorage.getOrCreateIdentityKey()
        let sessionKey = "\(peerId):\(deviceId)"

        var state = try loadRatchetState(sessionKey: sessionKey)
        var wireExtra: (ek: String, opkId: Int?, ikPub: String)? = nil

        if state == nil {
            let (newState, wire) = try initAsInitiator(bundle: bundle, myIK: ikPair)
            state = newState
            wireExtra = wire
        }

        let (encrypted, nextState) = try ratchetEncrypt(state: state!, plaintext: plaintext)
        try saveRatchetState(sessionKey: sessionKey, state: nextState)

        var payload = WirePayload(v: 1, msg: encrypted)
        if let w = wireExtra {
            payload.ek    = w.ek
            payload.opkId = w.opkId
            payload.ikPub = w.ikPub
        }
        return try encodePayload(payload)
    }

    // MARK: - Direct message decrypt

    /// Расшифровывает base64(JSON(WirePayload)).
    func decryptFromDevice(senderId: String, senderDeviceId: String,
                           encodedPayload: String) throws -> String {
        guard let data = Data(base64Encoded: encodedPayload),
              let payload = try? JSONDecoder().decode(WirePayload.self, from: data) else {
            // Fallback: попытка декодировать как plain base64 текст
            if let raw = Data(base64Encoded: encodedPayload),
               let str = String(data: raw, encoding: .utf8) { return str }
            throw SessionError.invalidPayload
        }

        let sessionKey = "\(senderId):\(senderDeviceId)"
        var state = try loadRatchetState(sessionKey: sessionKey)

        if state == nil {
            guard payload.ek != nil, payload.ikPub != nil else {
                throw SessionError.noSessionAndNoX3DHHeader
            }
            state = try initAsResponder(wire: payload)
        }

        guard let s = state else { throw SessionError.noSessionAndNoX3DHHeader }

        let (plaintext, nextState) = try ratchetDecrypt(state: s, message: payload.msg)
        try saveRatchetState(sessionKey: sessionKey, state: nextState)
        return plaintext
    }

    // MARK: - Group encrypt

    /// Шифрует групповое сообщение; возвращает base64(JSON(GroupWirePayload)).
    func encryptGroupMessage(chatId: String, plaintext: String) throws -> String {
        let senderKey = try getOrCreateMySenderKey(chatId: chatId)
        let nonce = sodium.secretBox.nonce()
        guard let ct = sodium.secretBox.seal(
            message: Array(plaintext.utf8), secretKey: senderKey, nonce: nonce) else {
            throw SessionError.encryptFailed
        }
        let wire = GroupWirePayload(
            type: "group",
            nonce: Data(nonce).base64EncodedString(),
            ct:    Data(ct).base64EncodedString()
        )
        return try encodePayload(wire)
    }

    /// Расшифровывает base64(JSON(GroupWirePayload)).
    func decryptGroupMessage(chatId: String, senderId: String,
                             encodedPayload: String) throws -> String {
        guard let data = Data(base64Encoded: encodedPayload),
              let wire = try? JSONDecoder().decode(GroupWirePayload.self, from: data),
              wire.type == "group",
              let nonce = Data(base64Encoded: wire.nonce),
              let ct    = Data(base64Encoded: wire.ct) else {
            throw SessionError.invalidPayload
        }
        guard let senderKey = try loadPeerSenderKey(chatId: chatId, senderId: senderId) else {
            throw SessionError.noSenderKey
        }
        guard let plain = sodium.secretBox.open(
            authenticatedCipherText: Array(ct), secretKey: senderKey, nonce: Array(nonce)) else {
            throw SessionError.decryptFailed
        }
        return String(bytes: plain, encoding: .utf8) ?? ""
    }

    // MARK: - SKDM handling

    /// Обрабатывает входящий SKDM (Sender Key Distribution Message).
    func handleIncomingSKDM(chatId: String, senderId: String, senderDeviceId: String,
                            encodedSkdm: String) throws {
        let skdmJson = try decryptFromDevice(senderId: senderId, senderDeviceId: senderDeviceId,
                                             encodedPayload: encodedSkdm)
        guard let skdmData = skdmJson.data(using: .utf8),
              let skdm = try? JSONDecoder().decode(SKDMPayload.self, from: skdmData),
              skdm.type == "skdm",
              let key = Data(base64Encoded: skdm.key) else { return }
        try savePeerSenderKey(chatId: chatId, senderId: senderId, key: Array(key))
    }

    /// Создаёт SKDM-сообщение для члена группы.
    func buildSKDM(chatId: String) throws -> String {
        let senderKey = try getOrCreateMySenderKey(chatId: chatId)
        let skdm = SKDMPayload(type: "skdm", chatId: chatId,
                               key: Data(senderKey).base64EncodedString())
        let json = try JSONEncoder().encode(skdm)
        return String(data: json, encoding: .utf8)!
    }

    func invalidateGroupSenderKey(chatId: String) throws {
        try db.saveRatchetSession(sessionKey: "sk_\(chatId)",
                                  chainKeyBlob: Data())   // пустой → следующий encrypt создаст новый
    }

    // MARK: - X3DH init as initiator

    private func initAsInitiator(bundle: DeviceBundle, myIK: Ed25519KeyPair)
    throws -> (state: DoubleRatchetState, wire: (ek: String, opkId: Int?, ikPub: String)) {
        let ekPair  = sodium.box.keyPair()!
        let bobIKPubEd  = Array(Data(base64Encoded: bundle.ikPublic)!)
        let bobSPKPub   = Array(Data(base64Encoded: bundle.spkPublic)!)
        let bobOPKPub: Bytes? = bundle.opkPublic.flatMap { Data(base64Encoded: $0).map(Array.init) }

        let sharedSecret = try x3dh.computeSharedSecret(
            aliceIKPrivEd: myIK.secretKey,
            aliceEKPriv:   ekPair.secretKey,
            bobIKPubEd:    bobIKPubEd,
            bobSPKPub:     bobSPKPub,
            bobOPKPub:     bobOPKPub
        )

        // initRatchet initiator: one more DH with Bob's SPK
        let dhOutput  = sodium.scalarmult.mult(n: ekPair.secretKey, p: bobSPKPub)!
        let derived   = deriveKeys(inputKey: dhOutput, salt: sharedSecret)

        let state = DoubleRatchetState(
            dhSendPublic:  ekPair.publicKey,
            dhSendPrivate: ekPair.secretKey,
            dhRemotePublic: bobSPKPub,
            rootKey:       derived.rootKey,
            sendChainKey:  derived.chainKey,
            recvChainKey:  nil,
            sendCount: 0, recvCount: 0, prevSendCount: 0,
            skippedKeys: [:]
        )
        let wire = (
            ek:    Data(ekPair.publicKey).base64EncodedString(),
            opkId: bundle.opkId,
            ikPub: Data(myIK.publicKey).base64EncodedString()
        )
        return (state, wire)
    }

    // MARK: - X3DH init as responder

    private func initAsResponder(wire: WirePayload) throws -> DoubleRatchetState {
        let myIK  = keyStorage.getOrCreateIdentityKey()
        let (mySpk, _) = keyStorage.getOrCreateSignedPreKey()

        guard let ekPub  = wire.ek.flatMap({ Data(base64Encoded: $0) }),
              let ikPub  = wire.ikPub.flatMap({ Data(base64Encoded: $0) }) else {
            throw SessionError.noSessionAndNoX3DHHeader
        }
        let aliceIKPubEd = Array(ikPub)
        let aliceEKPub   = Array(ekPub)

        // Bob's X3DH response (symmetric to Alice's computation)
        let myIKPrivEd   = myIK.secretKey
        let mySpkPriv    = mySpk.secretKey
        let mySpkPub     = mySpk.publicKey

        // Convert Bob IK ed25519 → curve25519
        let myIKCurvePriv: Bytes = try {
            var out = Bytes(repeating: 0, count: 32)
            guard crypto_sign_ed25519_sk_to_curve25519(&out, myIKPrivEd) == 0 else {
                throw SessionError.decryptFailed
            }
            return out
        }()
        let aliceIKCurvePub: Bytes = try {
            var out = Bytes(repeating: 0, count: 32)
            guard crypto_sign_ed25519_pk_to_curve25519(&out, aliceIKPubEd) == 0 else {
                throw SessionError.decryptFailed
            }
            return out
        }()

        // dh1 = Bob_SPK × Alice_IK_curve
        // dh2 = Bob_IK_curve × Alice_EK
        // dh3 = Bob_SPK × Alice_EK
        let dh1 = sodium.scalarmult.mult(n: mySpkPriv,      p: aliceIKCurvePub)!
        let dh2 = sodium.scalarmult.mult(n: myIKCurvePriv,  p: aliceEKPub)!
        let dh3 = sodium.scalarmult.mult(n: mySpkPriv,      p: aliceEKPub)!

        var combined = dh1 + dh2 + dh3

        if let opkId = wire.opkId,
           let opkPriv = keyStorage.loadOneTimePreKeySecret(id: opkId) {
            // dh4 = Bob_OPK × Alice_EK
            if let dh4 = sodium.scalarmult.mult(n: opkPriv, p: aliceEKPub) {
                combined += dh4
            }
        }

        guard let sharedSecret = sodium.genericHash.hash(message: combined, outputLength: 32) else {
            throw SessionError.decryptFailed
        }

        // initRatchet responder: start with sharedSecret as root key, mySpk as dhSend
        return DoubleRatchetState(
            dhSendPublic:  mySpkPub,
            dhSendPrivate: mySpkPriv,
            dhRemotePublic: nil,
            rootKey:       sharedSecret,
            sendChainKey:  nil,
            recvChainKey:  nil,
            sendCount: 0, recvCount: 0, prevSendCount: 0,
            skippedKeys: [:]
        )
    }

    // MARK: - Double Ratchet encrypt

    private func ratchetEncrypt(state: DoubleRatchetState,
                                plaintext: String) throws -> (EncryptedMessage, DoubleRatchetState) {
        guard let chainKey = state.sendChainKey else { throw SessionError.encryptFailed }

        let (msgKey, nextChain) = advanceChain(chainKey)
        let nonce = sodium.secretBox.nonce()
        guard let ct = sodium.secretBox.seal(
            message: Array(plaintext.utf8), secretKey: msgKey, nonce: nonce) else {
            throw SessionError.encryptFailed
        }
        let combined = Data(nonce + ct)
        let msg = EncryptedMessage(
            header: RatchetHeader(
                dhPublic: Data(state.dhSendPublic).base64EncodedString(),
                n:  state.sendCount,
                pn: state.prevSendCount
            ),
            ciphertext: combined.base64EncodedString()
        )
        var next = state
        next.sendChainKey = nextChain
        next.sendCount   += 1
        return (msg, next)
    }

    // MARK: - Double Ratchet decrypt

    private func ratchetDecrypt(state: DoubleRatchetState,
                                message: EncryptedMessage) throws -> (String, DoubleRatchetState) {
        guard let incomingDH = Data(base64Encoded: message.header.dhPublic) else {
            throw SessionError.invalidPayload
        }
        let dhBytes  = Array(incomingDH)
        let n        = message.header.n
        let pn       = message.header.pn

        // Check skipped keys
        let skipKey  = "\(message.header.dhPublic):\(n)"
        var freshSkipped = purgeExpiredSkippedKeys(state.skippedKeys)

        if let entry = freshSkipped[skipKey],
           let keyData = Data(base64Encoded: entry.key) {
            freshSkipped.removeValue(forKey: skipKey)
            var next = state; next.skippedKeys = freshSkipped
            let plain = try decryptWithKey(msgKey: Array(keyData), message: message)
            return (plain, next)
        }

        var currentState = state
        currentState.skippedKeys = freshSkipped

        // DH ratchet if remote public changed
        if currentState.dhRemotePublic == nil || currentState.dhRemotePublic! != dhBytes {
            currentState = skipMessageKeys(state: currentState, until: pn)
            currentState = performDHRatchet(state: currentState, theirNewDHPublic: dhBytes)
        }

        currentState = skipMessageKeys(state: currentState, until: n)
        guard let recvChain = currentState.recvChainKey else { throw SessionError.decryptFailed }

        let (msgKey, nextChain) = advanceChain(recvChain)
        let plain = try decryptWithKey(msgKey: msgKey, message: message)
        currentState.recvChainKey = nextChain
        currentState.recvCount    = n + 1
        return (plain, currentState)
    }

    // MARK: - DH Ratchet step

    private func performDHRatchet(state: DoubleRatchetState,
                                   theirNewDHPublic: Bytes) -> DoubleRatchetState {
        let dhOut1   = sodium.scalarmult.mult(n: state.dhSendPrivate, p: theirNewDHPublic)!
        let derived1 = deriveKeys(inputKey: dhOut1, salt: state.rootKey)

        let newKP    = sodium.box.keyPair()!
        let dhOut2   = sodium.scalarmult.mult(n: newKP.secretKey, p: theirNewDHPublic)!
        let derived2 = deriveKeys(inputKey: dhOut2, salt: derived1.rootKey)

        var next = state
        next.dhSendPublic    = newKP.publicKey
        next.dhSendPrivate   = newKP.secretKey
        next.dhRemotePublic  = theirNewDHPublic
        next.rootKey         = derived2.rootKey
        next.recvChainKey    = derived1.chainKey
        next.sendChainKey    = derived2.chainKey
        next.prevSendCount   = state.sendCount
        next.sendCount       = 0
        next.recvCount       = 0
        return next
    }

    // MARK: - Skip message keys

    private func skipMessageKeys(state: DoubleRatchetState, until: Int) -> DoubleRatchetState {
        guard let recvChain = state.recvChainKey, state.recvCount < until else { return state }
        let dhPubB64 = state.dhRemotePublic.map { Data($0).base64EncodedString() } ?? "none"
        var skipped  = state.skippedKeys
        var chain    = recvChain
        var count    = state.recvCount
        let now      = Date().timeIntervalSince1970 * 1000

        while count < min(until, count + maxSkip) {
            let (msgKey, nextChain) = advanceChain(chain)
            skipped["\(dhPubB64):\(count)"] = SkippedKeyEntry(
                key: Data(msgKey).base64EncodedString(), storedAt: now)
            chain = nextChain
            count += 1
        }
        var next = state
        next.skippedKeys  = skipped
        next.recvChainKey = chain
        next.recvCount    = count
        return next
    }

    // MARK: - Chain advance (HMAC-SHA256)

    private func advanceChain(_ chainKey: Bytes) -> (msgKey: Bytes, nextChain: Bytes) {
        return (
            hmacSHA256(message: [0x01], key: chainKey),
            hmacSHA256(message: [0x02], key: chainKey)
        )
    }

    private func hmacSHA256(message: Bytes, key: Bytes) -> Bytes {
        var out = Bytes(repeating: 0, count: 32)
        crypto_auth_hmacsha256(&out, message, UInt64(message.count), key)
        return out
    }

    // MARK: - KDF (BLAKE2b 64 bytes)

    private func deriveKeys(inputKey: Bytes, salt: Bytes) -> (rootKey: Bytes, chainKey: Bytes) {
        let okm = sodium.genericHash.hash(message: inputKey, key: salt, outputLength: 64)!
        return (Bytes(okm.prefix(32)), Bytes(okm.suffix(32)))
    }

    // MARK: - Symmetric decrypt helper

    private func decryptWithKey(msgKey: Bytes, message: EncryptedMessage) throws -> String {
        guard let combined = Data(base64Encoded: message.ciphertext) else {
            throw SessionError.invalidPayload
        }
        let nonce = Array(combined.prefix(sodium.secretBox.NonceBytes))
        let ct    = Array(combined.dropFirst(sodium.secretBox.NonceBytes))
        guard let plain = sodium.secretBox.open(
            authenticatedCipherText: ct, secretKey: msgKey, nonce: nonce) else {
            throw SessionError.decryptFailed
        }
        return String(bytes: plain, encoding: .utf8) ?? ""
    }

    // MARK: - Skipped key cleanup

    private func purgeExpiredSkippedKeys(_ keys: [String: SkippedKeyEntry]) -> [String: SkippedKeyEntry] {
        let cutoff = Date().timeIntervalSince1970 * 1000 - skippedKeyTTL
        return keys.filter { $0.value.storedAt >= cutoff }
    }

    // MARK: - State persistence

    private func loadRatchetState(sessionKey: String) throws -> DoubleRatchetState? {
        guard let data = try db.loadRatchetSession(sessionKey: sessionKey),
              !data.isEmpty else { return nil }
        return try JSONDecoder().decode(DoubleRatchetState.self, from: data)
    }

    private func saveRatchetState(sessionKey: String, state: DoubleRatchetState) throws {
        let data = try JSONEncoder().encode(state)
        try db.saveRatchetSession(sessionKey: sessionKey, chainKeyBlob: data)
    }

    // MARK: - Group sender key persistence

    private func getOrCreateMySenderKey(chatId: String) throws -> Bytes {
        let dbKey = "sk_\(chatId)"
        if let data = try db.loadRatchetSession(sessionKey: dbKey), data.count == 32 {
            return Array(data)
        }
        let key = sodium.randomBytes.buf(length: 32)!
        try db.saveRatchetSession(sessionKey: dbKey, chainKeyBlob: Data(key))
        return key
    }

    private func loadPeerSenderKey(chatId: String, senderId: String) throws -> Bytes? {
        let dbKey = "skp_\(chatId)_\(senderId)"
        guard let data = try db.loadRatchetSession(sessionKey: dbKey), !data.isEmpty else { return nil }
        return Array(data)
    }

    private func savePeerSenderKey(chatId: String, senderId: String, key: Bytes) throws {
        let dbKey = "skp_\(chatId)_\(senderId)"
        try db.saveRatchetSession(sessionKey: dbKey, chainKeyBlob: Data(key))
    }

    // MARK: - JSON encode helpers

    private func encodePayload<T: Encodable>(_ payload: T) throws -> String {
        let data = try JSONEncoder().encode(payload)
        return data.base64EncodedString()
    }
}

// MARK: - Bytes equality helper

private func != (lhs: [UInt8]?, rhs: [UInt8]) -> Bool {
    guard let l = lhs else { return true }
    return l != rhs
}
