import Foundation
import CryptoKit

struct AppLockSettings: Codable {
    var enabled: Bool = true
    var relockTimeoutSeconds: Int = 0
    var pinHashSha256: String? = nil
}

final class BiometricLockStore: ObservableObject {
    static let shared = BiometricLockStore()
    private static let key = "messenger.lock.settings"

    @Published var settings: AppLockSettings
    @Published var isLocked: Bool = true

    private init() {
        if let data = UserDefaults.standard.data(forKey: Self.key),
           let decoded = try? JSONDecoder().decode(AppLockSettings.self, from: data) {
            settings = decoded
        } else {
            settings = AppLockSettings()
        }
    }

    func unlock() { isLocked = false }
    func lock() { isLocked = true }

    func isPinCorrect(_ pin: String) -> Bool {
        guard let hash = settings.pinHashSha256 else { return pin.count >= 4 }
        return sha256(pin) == hash
    }

    func saveSettings(_ newSettings: AppLockSettings) {
        settings = newSettings
        if let data = try? JSONEncoder().encode(newSettings) {
            UserDefaults.standard.set(data, forKey: Self.key)
        }
    }

    func updatePin(_ newPin: String) {
        let hash = sha256(newPin)
        settings.pinHashSha256 = hash
        saveSettings(settings)
    }

    private func sha256(_ input: String) -> String {
        let data = Data(input.utf8)
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}
