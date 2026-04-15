// CryptoTests.swift — базовые smoke-тесты крипто-классов.
// Запуск: swift test (из apps/mobile/ios/)

import XCTest
import Sodium
@testable import MessengerCrypto

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
