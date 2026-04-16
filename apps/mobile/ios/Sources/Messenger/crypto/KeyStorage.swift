// KeyStorage.swift — хранение криптографических ключей устройства в Keychain.

import Foundation
import Security
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
    private let service = "com.messenger.keys"

    // MARK: - Identity Key (Ed25519)

    func getOrCreateIdentityKey() -> Ed25519KeyPair {
        if let pub = keychainGetData("ik_pub"),
           let sec = keychainGetData("ik_sec") {
            return Ed25519KeyPair(publicKey: Bytes(pub), secretKey: Bytes(sec))
        }
        let kp = sodium.sign.keyPair()!
        keychainSetData(Data(kp.publicKey), for: "ik_pub")
        keychainSetData(Data(kp.secretKey), for: "ik_sec")
        return Ed25519KeyPair(publicKey: kp.publicKey, secretKey: kp.secretKey)
    }

    // MARK: - Signed Pre-Key (Curve25519)

    func getOrCreateSignedPreKey() -> (keyPair: Curve25519KeyPair, signature: Bytes) {
        if let pub = keychainGetData("spk_pub"),
           let sec = keychainGetData("spk_sec"),
           let sig = keychainGetData("spk_sig") {
            return (
                Curve25519KeyPair(publicKey: Bytes(pub), secretKey: Bytes(sec)),
                Bytes(sig)
            )
        }
        let kp = sodium.box.keyPair()!
        let ikSec = getOrCreateIdentityKey().secretKey
        let signature = sodium.sign.sign(message: kp.publicKey, secretKey: ikSec)!
        keychainSetData(Data(kp.publicKey), for: "spk_pub")
        keychainSetData(Data(kp.secretKey), for: "spk_sec")
        keychainSetData(Data(signature),    for: "spk_sig")
        return (Curve25519KeyPair(publicKey: kp.publicKey, secretKey: kp.secretKey), signature)
    }

    // MARK: - SPK ID

    func getOrCreateSpkId() -> Int {
        if let data = keychainGetData("spk_id"), data.count == 8 {
            return Int(bitPattern: UInt(bigEndian: data.withUnsafeBytes { $0.load(as: UInt.self) }))
        }
        let id = Int.random(in: 1...Int.max)
        var value = UInt(bitPattern: id).bigEndian
        keychainSetData(Data(bytes: &value, count: 8), for: "spk_id")
        return id
    }

    // MARK: - One-Time Pre-Keys (Curve25519)

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

    func saveOneTimePreKeySecret(_ secret: Bytes, id: Int) {
        keychainSetData(Data(secret), for: "opk_\(id)")
    }

    func loadOneTimePreKeySecret(id: Int) -> Bytes? {
        guard let data = keychainGetData("opk_\(id)") else { return nil }
        return Array(data)
    }

    func popOneTimePreKey() -> Curve25519KeyPair? {
        var keys = loadOneTimePreKeys()
        guard !keys.isEmpty else { return nil }
        let key = keys.removeFirst()
        saveOneTimePreKeys(keys)
        return key
    }

    private func loadOneTimePreKeys() -> [Curve25519KeyPair] {
        guard let data = keychainGetData("opk_list"),
              let list = try? JSONDecoder().decode([[String: String]].self, from: data) else {
            return []
        }
        return list.compactMap { dict in
            guard let pubB64 = dict["pub"], let secB64 = dict["sec"],
                  let pub = Data(base64Encoded: pubB64),
                  let sec = Data(base64Encoded: secB64) else { return nil }
            return Curve25519KeyPair(publicKey: Bytes(pub), secretKey: Bytes(sec))
        }
    }

    private func saveOneTimePreKeys(_ keys: [Curve25519KeyPair]) {
        let list = keys.map { kp -> [String: String] in
            ["pub": Data(kp.publicKey).base64EncodedString(),
             "sec": Data(kp.secretKey).base64EncodedString()]
        }
        if let data = try? JSONEncoder().encode(list) {
            keychainSetData(data, for: "opk_list")
        }
    }

    // MARK: - Device ID

    func getOrCreateDeviceId() -> String {
        if let data = keychainGetData("device_id"),
           let id = String(data: data, encoding: .utf8) { return id }
        let id = UUID().uuidString
        keychainSetData(Data(id.utf8), for: "device_id")
        return id
    }

    // MARK: - Clear all

    func clearAll() {
        ["ik_pub", "ik_sec", "spk_pub", "spk_sec", "spk_sig", "spk_id",
         "opk_list", "device_id"].forEach { keychainDelete($0) }
    }

    // MARK: - Keychain helpers

    private func keychainSetData(_ data: Data, for key: String) {
        let query: CFDictionary = [
            kSecClass:       kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: key,
        ] as CFDictionary
        let attrs: CFDictionary = [kSecValueData: data] as CFDictionary
        if SecItemUpdate(query, attrs) == errSecItemNotFound {
            let add: CFDictionary = [
                kSecClass:       kSecClassGenericPassword,
                kSecAttrService: service,
                kSecAttrAccount: key,
                kSecValueData:   data,
            ] as CFDictionary
            SecItemAdd(add, nil)
        }
    }

    private func keychainGetData(_ key: String) -> Data? {
        let query: CFDictionary = [
            kSecClass:       kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: key,
            kSecReturnData:  true,
            kSecMatchLimit:  kSecMatchLimitOne,
        ] as CFDictionary
        var result: AnyObject?
        guard SecItemCopyMatching(query, &result) == errSecSuccess else { return nil }
        return result as? Data
    }

    private func keychainDelete(_ key: String) {
        let query: CFDictionary = [
            kSecClass:       kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: key,
        ] as CFDictionary
        SecItemDelete(query)
    }
}
