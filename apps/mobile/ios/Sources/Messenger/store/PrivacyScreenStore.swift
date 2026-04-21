import Foundation

final class PrivacyScreenStore: ObservableObject {
    static let shared = PrivacyScreenStore()
    private static let key = "messenger.privacy_screen.enabled"

    @Published var privacyScreenEnabled: Bool

    private init() {
        privacyScreenEnabled = UserDefaults.standard.bool(forKey: Self.key)
    }

    func enable() {
        privacyScreenEnabled = true
        UserDefaults.standard.set(true, forKey: Self.key)
    }

    func disable() {
        privacyScreenEnabled = false
        UserDefaults.standard.set(false, forKey: Self.key)
    }
}
