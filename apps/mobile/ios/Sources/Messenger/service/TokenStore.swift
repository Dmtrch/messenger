// TokenStore.swift — хранение JWT-токенов.
// Использует UserDefaults (токены короткоживущие).
// TODO production: перейти на Keychain для refresh token.

import Foundation

protocol TokenStoreProtocol {
    var accessToken: String { get }
    var refreshToken: String { get }
    func save(accessToken: String, refreshToken: String)
    func clear()
}

final class TokenStore: TokenStoreProtocol {
    private let defaults = UserDefaults.standard
    private enum Key {
        static let access  = "messenger.token.access"
        static let refresh = "messenger.token.refresh"
    }

    var accessToken: String  { defaults.string(forKey: Key.access)  ?? "" }
    var refreshToken: String { defaults.string(forKey: Key.refresh) ?? "" }

    func save(accessToken: String, refreshToken: String) {
        defaults.set(accessToken,  forKey: Key.access)
        defaults.set(refreshToken, forKey: Key.refresh)
    }

    func clear() {
        defaults.removeObject(forKey: Key.access)
        defaults.removeObject(forKey: Key.refresh)
    }
}
