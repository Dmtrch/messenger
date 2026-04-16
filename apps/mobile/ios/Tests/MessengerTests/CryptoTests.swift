// CryptoTests.swift — smoke-тесты и тест-векторные тесты крипто-классов.
// Запуск: swift test (из apps/mobile/ios/)

import XCTest
import Sodium
@testable import MessengerCrypto

// MARK: - Test vector helpers

private func loadVector(_ name: String) throws -> [String: Any] {
    // Рабочий каталог при `swift test` — директория Package.swift (apps/mobile/ios/).
    // Отсюда ../../../shared/test-vectors/ — корень тест-векторов.
    let url = URL(fileURLWithPath: "../../../shared/test-vectors/\(name).json",
                  relativeTo: URL(fileURLWithPath: FileManager.default.currentDirectoryPath))
    let data = try Data(contentsOf: url)
    return try JSONSerialization.jsonObject(with: data) as! [String: Any]
}

private func b64d(_ s: String) -> [UInt8] {
    Array(Data(base64Encoded: s)!)
}

private func b64e(_ bytes: [UInt8]) -> String {
    Data(bytes).base64EncodedString()
}

final class RatchetTests: XCTestCase {

    private let ratchet = Ratchet()
    private let sodium = Sodium()

    func testDeriveMessageKeyDeterministic() throws {
        let chainKey = sodium.randomBytes.buf(length: 32)!
        let key1 = try ratchet.deriveMessageKey(chainKey: chainKey, index: 0)
        let key2 = try ratchet.deriveMessageKey(chainKey: chainKey, index: 0)
        XCTAssertEqual(key1, key2)
    }

    func testDeriveMessageKeyDifferentIndices() throws {
        let chainKey = sodium.randomBytes.buf(length: 32)!
        let key0 = try ratchet.deriveMessageKey(chainKey: chainKey, index: 0)
        let key1 = try ratchet.deriveMessageKey(chainKey: chainKey, index: 1)
        XCTAssertNotEqual(key0, key1)
    }

    func testEncryptDecryptRoundTrip() throws {
        let msgKey  = sodium.randomBytes.buf(length: 32)!
        let message = Array("Привет, мир!".utf8)

        let (ciphertext, nonce) = try ratchet.encrypt(plaintext: message, msgKey: msgKey)
        let decrypted           = try ratchet.decrypt(ciphertext: ciphertext, nonce: nonce, msgKey: msgKey)

        XCTAssertEqual(decrypted, message)
    }

    func testDecryptWithWrongKeyFails() throws {
        let msgKey  = sodium.randomBytes.buf(length: 32)!
        let wrongKey = sodium.randomBytes.buf(length: 32)!
        let message = Array("test".utf8)

        let (ciphertext, nonce) = try ratchet.encrypt(plaintext: message, msgKey: msgKey)
        XCTAssertThrowsError(try ratchet.decrypt(ciphertext: ciphertext, nonce: nonce, msgKey: wrongKey))
    }
}

final class SenderKeyTests: XCTestCase {

    private let senderKey = SenderKey()
    private let sodium = Sodium()

    func testEncryptDecryptRoundTrip() throws {
        let key     = sodium.randomBytes.buf(length: 32)!
        let message = Array("Групповое сообщение".utf8)

        let (ciphertext, nonce) = try senderKey.encrypt(plaintext: message, senderKey: key)
        let decrypted           = try senderKey.decrypt(ciphertext: ciphertext, nonce: nonce, senderKey: key)

        XCTAssertEqual(decrypted, message)
    }

    func testCiphertextDifferentFromPlaintext() throws {
        let key     = sodium.randomBytes.buf(length: 32)!
        let message = Array("secret".utf8)

        let (ciphertext, _) = try senderKey.encrypt(plaintext: message, senderKey: key)
        XCTAssertNotEqual(ciphertext, message)
    }
}

// MARK: - X3DH test-vector tests

final class X3DHVectorTests: XCTestCase {

    private let x3dh = X3DH()

    func testSharedSecretMatchesWebVector() throws {
        let v = try loadVector("x3dh")

        let aliceIKPair  = v["aliceIdentityKeyPair"]  as! [String: String]
        let aliceEKPair  = v["aliceEphemeralKeyPair"] as! [String: String]
        let bobIKPair    = v["bobIdentityKeyPair"]    as! [String: String]
        let bobSPKPair   = v["bobSignedPreKey"]       as! [String: String]
        let bobOPKPair   = v["bobOneTimePreKey"]      as! [String: String]
        let expected     = v["expectedSharedSecret"]  as! String

        let aliceIKPriv  = b64d(aliceIKPair["privateKey"]!)
        let aliceEKPriv  = b64d(aliceEKPair["privateKey"]!)
        let bobIKPub     = b64d(bobIKPair["publicKey"]!)
        let bobSPKPub    = b64d(bobSPKPair["publicKey"]!)
        let bobOPKPub    = b64d(bobOPKPair["publicKey"]!)

        let result = try x3dh.computeSharedSecret(
            aliceIKPrivEd: aliceIKPriv,
            aliceEKPriv:   aliceEKPriv,
            bobIKPubEd:    bobIKPub,
            bobSPKPub:     bobSPKPub,
            bobOPKPub:     bobOPKPub
        )

        XCTAssertEqual(b64e(result), expected,
                       "X3DH shared secret mismatch — iOS not compatible with web vector")
    }

    func testSharedSecretWithoutOPKMatchesWebVector() throws {
        // Тот же вектор, но без OPK — проверяем что без OPK тоже детерминирован.
        let v = try loadVector("x3dh")

        let aliceIKPriv = b64d((v["aliceIdentityKeyPair"] as! [String: String])["privateKey"]!)
        let aliceEKPriv = b64d((v["aliceEphemeralKeyPair"] as! [String: String])["privateKey"]!)
        let bobIKPub    = b64d((v["bobIdentityKeyPair"] as! [String: String])["publicKey"]!)
        let bobSPKPub   = b64d((v["bobSignedPreKey"] as! [String: String])["publicKey"]!)

        let r1 = try x3dh.computeSharedSecret(
            aliceIKPrivEd: aliceIKPriv, aliceEKPriv: aliceEKPriv,
            bobIKPubEd: bobIKPub, bobSPKPub: bobSPKPub)
        let r2 = try x3dh.computeSharedSecret(
            aliceIKPrivEd: aliceIKPriv, aliceEKPriv: aliceEKPriv,
            bobIKPubEd: bobIKPub, bobSPKPub: bobSPKPub)

        XCTAssertEqual(r1, r2)
        XCTAssertEqual(r1.count, 32)
    }
}

// MARK: - Ratchet test-vector tests

final class RatchetVectorTests: XCTestCase {

    private let ratchet = Ratchet()

    func testDeriveMessageKeyMatchesWebVector() throws {
        let v        = try loadVector("ratchet")
        let chainKey = b64d(v["chainKey"] as! String)
        let index    = v["messageIndex"] as! Int
        let expected = v["expectedMsgKey"] as! String

        let result = try ratchet.deriveMessageKey(chainKey: chainKey, index: index)

        XCTAssertEqual(b64e(result), expected,
                       "Ratchet deriveMessageKey mismatch — iOS not compatible with web vector")
    }

    func testEncryptCiphertextMatchesWebVector() throws {
        let v         = try loadVector("ratchet")
        let msgKey    = b64d(v["expectedMsgKey"] as! String)
        let nonce     = b64d(v["nonce"] as! String)
        let plaintext = (v["plaintext"] as! String).utf8.map { UInt8($0) }
        let expected  = v["expectedCiphertext"] as! String

        let (ciphertext, _) = try ratchet.encryptWithNonce(
            plaintext: Array(plaintext), msgKey: msgKey, nonce: nonce)

        XCTAssertEqual(b64e(ciphertext), expected,
                       "Ratchet encrypt mismatch — iOS not compatible with web vector")
    }
}

final class X3DHTests: XCTestCase {

    private let x3dh   = X3DH()
    private let sodium = Sodium()

    func testComputeSharedSecretWithoutOPK() throws {
        // Alice — генерируем identity key (ed25519) и ephemeral key (curve25519)
        let aliceIKPair = sodium.sign.keyPair()!
        let aliceEKPair = sodium.box.keyPair()!

        // Bob — identity key (ed25519) и signed pre-key (curve25519)
        let bobIKPair  = sodium.sign.keyPair()!
        let bobSPKPair = sodium.box.keyPair()!

        let secret = try x3dh.computeSharedSecret(
            aliceIKPrivEd: aliceIKPair.secretKey,
            aliceEKPriv:   aliceEKPair.secretKey,
            bobIKPubEd:    bobIKPair.publicKey,
            bobSPKPub:     bobSPKPair.publicKey
        )

        XCTAssertEqual(secret.count, 32)
    }

    func testSharedSecretIsDeterministic() throws {
        let aliceIKPair = sodium.sign.keyPair()!
        let aliceEKPair = sodium.box.keyPair()!
        let bobIKPair   = sodium.sign.keyPair()!
        let bobSPKPair  = sodium.box.keyPair()!

        let s1 = try x3dh.computeSharedSecret(
            aliceIKPrivEd: aliceIKPair.secretKey,
            aliceEKPriv:   aliceEKPair.secretKey,
            bobIKPubEd:    bobIKPair.publicKey,
            bobSPKPub:     bobSPKPair.publicKey
        )
        let s2 = try x3dh.computeSharedSecret(
            aliceIKPrivEd: aliceIKPair.secretKey,
            aliceEKPriv:   aliceEKPair.secretKey,
            bobIKPubEd:    bobIKPair.publicKey,
            bobSPKPub:     bobSPKPair.publicKey
        )

        XCTAssertEqual(s1, s2)
    }
}
