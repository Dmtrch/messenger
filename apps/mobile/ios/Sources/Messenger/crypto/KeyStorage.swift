// KeyStorage.swift — хранение криптографических ключей устройства.
// Зеркало KeyStorage.kt (Desktop/Android).
// TODO production: перенести все ключи в Keychain (SecItemAdd/SecItemCopyMatching).

import Foundation
import Sodium

/// Пара ключей Ed25519: publicKey (32 байта), secretKey (64 байта).
struct Ed25519KeyPair {
    let publicKey: Bytes
    let secretKey: Bytes
}

/// Пара ключей Curve25519: publicKey (32 байта), secretKey (32 байта).
struct Curve25519KeyPair {
    let publicKey: Bytes
    let secretKey: Bytes
}

final class KeyStorage {
    private let sodium = Sodium()
    private let defaults = UserDefaults.standard
    private enum Key {
        static let identityKeyPub  = "messenger.keys.ik.pub"
        static let identityKeySec  = "messenger.keys.ik.sec"
        static let signedPreKeyPub = "messenger.keys.spk.pub"
        static let signedPreKeySec = "messenger.keys.spk.sec"
        static let spkSignature    = "messenger.keys.spk.sig"
        static let oneTimePreKeys  = "messenger.keys.opk.list"
        static let deviceId        = "messenger.device.id"
    }

    // MARK: - Identity Key (Ed25519)

    func getOrCreateIdentityKey() -> Ed25519KeyPair {
        if let pub  = defaults.data(forKey: Key.identityKeyPub),
           let sec  = defaults.data(forKey: Key.identityKeySec) {
            return Ed25519KeyPair(publicKey: Bytes(pub), secretKey: Bytes(sec))
        }
        let kp = sodium.sign.keyPair()!
        defaults.set(Data(kp.publicKey), forKey: Key.identityKeyPub)
        defaults.set(Data(kp.secretKey), forKey: Key.identityKeySec)
        return Ed25519KeyPair(publicKey: kp.publicKey, secretKey: kp.secretKey)
    }

    // MARK: - Signed Pre-Key (Curve25519)

    func getOrCreateSignedPreKey() -> (keyPair: Curve25519KeyPair, signature: Bytes) {
        if let pub = defaults.data(forKey: Key.signedPreKeyPub),
           let sec = defaults.data(forKey: Key.signedPreKeySec),
           let sig = defaults.data(forKey: Key.spkSignature) {
            return (
                Curve25519KeyPair(publicKey: Bytes(pub), secretKey: Bytes(sec)),
                Bytes(sig)
            )
        }
        let kp = sodium.box.keyPair()!
        let ikSec = getOrCreateIdentityKey().secretKey
        let signature = sodium.sign.sign(message: kp.publicKey, secretKey: ikSec)!
        defaults.set(Data(kp.publicKey), forKey: Key.signedPreKeyPub)
        defaults.set(Data(kp.secretKey), forKey: Key.signedPreKeySec)
        defaults.set(Data(signature),   forKey: Key.spkSignature)
        return (Curve25519KeyPair(publicKey: kp.publicKey, secretKey: kp.secretKey), signature)
    }

    // MARK: - One-Time Pre-Keys (Curve25519)

    /// Генерирует batch из n OPK и сохраняет в UserDefaults.
    func generateOneTimePreKeys(count: Int) -> [Curve25519KeyPair] {
        var existing = loadOneTimePreKeys()
        var newKeys: [Curve25519KeyPair] = []
        for _ in 0..<count {
            let kp = sodium.box.keyPair()!
            let pair = Curve25519KeyPair(publicKey: kp.publicKey, secretKey: kp.secretKey)
            existing.append(pair)
            newKeys.append(pair)
        }
        saveOneTimePreKeys(existing)
        return newKeys
    }

    func popOneTimePreKey() -> Curve25519KeyPair? {
        var keys = loadOneTimePreKeys()
        guard !keys.isEmpty else { return nil }
        let key = keys.removeFirst()
        saveOneTimePreKeys(keys)
        return key
    }

    private func loadOneTimePreKeys() -> [Curve25519KeyPair] {
        guard let data = defaults.data(forKey: Key.oneTimePreKeys),
              let list = try? JSONDecoder().decode([[String: String]].self, from: data) else {
            return []
        }
        return list.compactMap { dict in
            guard let pubB64 = dict["pub"], let secB64 = dict["sec"],
                  let pub = Data(base64Encoded: pubB64), let sec = Data(base64Encoded: secB64) else { return nil }
            return Curve25519KeyPair(publicKey: Bytes(pub), secretKey: Bytes(sec))
        }
    }

    private func saveOneTimePreKeys(_ keys: [Curve25519KeyPair]) {
        let list = keys.map { kp -> [String: String] in
            ["pub": Data(kp.publicKey).base64EncodedString(),
             "sec": Data(kp.secretKey).base64EncodedString()]
        }
        if let data = try? JSONEncoder().encode(list) {
            defaults.set(data, forKey: Key.oneTimePreKeys)
        }
    }

    // MARK: - Device ID

    func getOrCreateDeviceId() -> String {
        if let id = defaults.string(forKey: Key.deviceId) { return id }
        let id = UUID().uuidString
        defaults.set(id, forKey: Key.deviceId)
        return id
    }

    // MARK: - Ratchet sessions → delegated to DatabaseManager

    func clearAll() {
        [Key.identityKeyPub, Key.identityKeySec,
         Key.signedPreKeyPub, Key.signedPreKeySec, Key.spkSignature,
         Key.oneTimePreKeys, Key.deviceId].forEach { defaults.removeObject(forKey: $0) }
    }
}
