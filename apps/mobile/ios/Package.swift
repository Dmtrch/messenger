// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Messenger",
    // MessengerCrypto компилируется на macOS (swift test в CI).
    // Полный Messenger target (UIKit/SwiftUI) открывается через Xcode.
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "MessengerCrypto", targets: ["MessengerCrypto"]),
    ],
    dependencies: [
        .package(url: "https://github.com/jedisct1/swift-sodium.git", from: "0.9.1"),
        .package(url: "https://github.com/groue/GRDB.swift.git", from: "6.27.0"),
    ],
    targets: [
        // Крипто-ядро: без UIKit/SwiftUI, компилируется на macOS и iOS.
        .target(
            name: "MessengerCrypto",
            dependencies: [
                .product(name: "Sodium",     package: "swift-sodium"),
                .product(name: "Clibsodium", package: "swift-sodium"),
            ],
            path: "Sources/MessengerCrypto"
        ),
        .testTarget(
            name: "MessengerTests",
            dependencies: [
                "MessengerCrypto",
                .product(name: "Sodium",     package: "swift-sodium"),
                .product(name: "Clibsodium", package: "swift-sodium"),
            ],
            path: "Tests/MessengerTests"
        ),
    ]
)
