// TokenStore.swift — хранение JWT-токенов в Keychain (SecItemAdd/SecItemCopyMatching).

import Foundation
import Security

protocol TokenStoreProtocol {
    var accessToken: String { get }
    func save(accessToken: String)
    func clear()
}

final class TokenStore: TokenStoreProtocol {
    private let service = "com.messenger.app"
    private let accessKey = "access_token"

    var accessToken: String { keychainGet(accessKey) ?? "" }

    func save(accessToken: String) {
        keychainSet(accessKey, value: accessToken)
    }

    func clear() {
        keychainDelete(accessKey)
    }

    // MARK: - Keychain helpers

    private func keychainSet(_ key: String, value: String) {
        guard let data = value.data(using: .utf8) else { return }
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

    private func keychainGet(_ key: String) -> String? {
        let query: CFDictionary = [
            kSecClass:            kSecClassGenericPassword,
            kSecAttrService:      service,
            kSecAttrAccount:      key,
            kSecReturnData:       true,
            kSecMatchLimit:       kSecMatchLimitOne,
        ] as CFDictionary
        var result: AnyObject?
        guard SecItemCopyMatching(query, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
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
