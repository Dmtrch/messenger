// Ratchet.swift — Double Ratchet message key derivation и шифрование.
// Совместим с Kotlin-реализацией (Desktop/Android) и TypeScript-реализацией (web client).
//
// Алгоритм:
//   deriveMessageKey: crypto_kdf_derive_from_key(32, index, "msg_key_", chainKey)
//   encrypt/decrypt:  crypto_secretbox_easy (XSalsa20-Poly1305, 24-байтовый nonce)

import Sodium

enum RatchetError: Error {
    case keyDerivationFailed
    case encryptFailed
    case decryptFailed
    case invalidInput(String)
}

final class Ratchet {
    private let sodium = Sodium()

    /// Деривирует message key из chain key и индекса.
    /// context фиксирован как "msg_key_" (8 байт) — аналог TypeScript и Kotlin.
    func deriveMessageKey(chainKey: Bytes, index: Int) throws -> Bytes {
        guard chainKey.count == 32 else {
            throw RatchetError.invalidInput("chainKey must be 32 bytes, got \(chainKey.count)")
        }
        let context = "msg_key_"
        guard let derived = sodium.keyDerivation.derive(
            secretKey: chainKey,
            index: UInt64(index),
            length: 32,
            context: context
        ) else {
            throw RatchetError.keyDerivationFailed
        }
        return derived
    }

    /// Шифрует plaintext с помощью msgKey, генерирует случайный nonce.
    /// Возвращает (ciphertext, nonce).
    func encrypt(plaintext: Bytes, msgKey: Bytes) throws -> (ciphertext: Bytes, nonce: Bytes) {
        guard msgKey.count == 32 else {
            throw RatchetError.invalidInput("msgKey must be 32 bytes, got \(msgKey.count)")
        }
        let nonce = sodium.secretBox.nonce()
        return try encryptWithNonce(plaintext: plaintext, msgKey: msgKey, nonce: nonce)
    }

    func encryptWithNonce(plaintext: Bytes, msgKey: Bytes, nonce: Bytes) throws -> (ciphertext: Bytes, nonce: Bytes) {
        guard msgKey.count == 32 else {
            throw RatchetError.invalidInput("msgKey must be 32 bytes, got \(msgKey.count)")
        }
        guard nonce.count == sodium.secretBox.NonceBytes else {
            throw RatchetError.invalidInput("nonce must be \(sodium.secretBox.NonceBytes) bytes, got \(nonce.count)")
        }
        guard let ciphertext = sodium.secretBox.seal(message: plaintext, secretKey: msgKey, nonce: nonce) else {
            throw RatchetError.encryptFailed
        }
        return (ciphertext, nonce)
    }

    /// Расшифровывает ciphertext.
    func decrypt(ciphertext: Bytes, nonce: Bytes, msgKey: Bytes) throws -> Bytes {
        guard msgKey.count == 32 else {
            throw RatchetError.invalidInput("msgKey must be 32 bytes, got \(msgKey.count)")
        }
        guard nonce.count == sodium.secretBox.NonceBytes else {
            throw RatchetError.invalidInput("nonce must be \(sodium.secretBox.NonceBytes) bytes, got \(nonce.count)")
        }
        guard ciphertext.count >= sodium.secretBox.MacBytes else {
            throw RatchetError.invalidInput("ciphertext too short")
        }
        guard let plaintext = sodium.secretBox.open(authenticatedCipherText: ciphertext, secretKey: msgKey, nonce: nonce) else {
            throw RatchetError.decryptFailed
        }
        return plaintext
    }
}
