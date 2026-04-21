// BuildConfig.swift — compile-time constants.
// CI: run scripts/set-server-url.sh <url> before building to bake in server address.
enum BuildConfig {
    static let defaultServerUrl = ""
    static let appVersion = "1.0.0"
}
