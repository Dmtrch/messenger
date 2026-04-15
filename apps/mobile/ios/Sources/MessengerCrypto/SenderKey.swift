// SenderKey.swift — Sender Key шифрование для групповых чатов.
// Совместим с Kotlin-реализацией (Desktop/Android) и TypeScript-реализацией (web client).
//
// Алгоритм: crypto_secretbox_easy (XSalsa20-Poly1305), тот же примитив, что и Ratchet.

import Sodium

enum SenderKeyError: Error {
    case encryptFailed
    case decryptFailed
    case invalidInput(String)
}

final class SenderKey {
    private let sodium = Sodium()

    /// Шифрует plaintext с помощью senderKey, генерирует случайный nonce.
    /// Возвращает (ciphertext, nonce).
    func encrypt(plaintext: Bytes, senderKey: Bytes) throws -> (ciphertext: Bytes, nonce: Bytes) {
        guard senderKey.count == 32 else {
            throw SenderKeyError.invalidInput("senderKey must be 32 bytes, got \(senderKey.count)")
        }
        let nonce = sodium.secretBox.nonce()
        let ciphertext = try encryptWithNonce(plaintext: plaintext, senderKey: senderKey, nonce: nonce)
        return (ciphertext, nonce)
    }

    func encryptWithNonce(plaintext: Bytes, senderKey: Bytes, nonce: Bytes) throws -> Bytes {
        guard senderKey.count == 32 else {
            throw SenderKeyError.invalidInput("senderKey must be 32 bytes, got \(senderKey.count)")
        }
        guard nonce.count == sodium.secretBox.NonceBytes else {
            throw SenderKeyError.invalidInput("nonce must be \(sodium.secretBox.NonceBytes) bytes, got \(nonce.count)")
        }
        guard let ciphertext = sodium.secretBox.seal(message: plaintext, secretKey: senderKey, nonce: nonce) else {
            throw SenderKeyError.encryptFailed
        }
        return ciphertext
    }

    /// Расшифровывает ciphertext.
    func decrypt(ciphertext: Bytes, nonce: Bytes, senderKey: Bytes) throws -> Bytes {
        guard senderKey.count == 32 else {
            throw SenderKeyError.invalidInput("senderKey must be 32 bytes, got \(senderKey.count)")
        }
        guard nonce.count == sodium.secretBox.NonceBytes else {
            throw SenderKeyError.invalidInput("nonce must be \(sodium.secretBox.NonceBytes) bytes, got \(nonce.count)")
        }
        guard ciphertext.count >= sodium.secretBox.MacBytes else {
            throw SenderKeyError.invalidInput("ciphertext too short")
        }
        guard let plaintext = sodium.secretBox.open(authenticatedCipherText: ciphertext, secretKey: senderKey, nonce: nonce) else {
            throw SenderKeyError.decryptFailed
        }
        return plaintext
    }
}
