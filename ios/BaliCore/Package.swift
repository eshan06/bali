// swift-tools-version: 6.0
import PackageDescription

// BaliCore: what the iOS apps share — the API's wire types, its outbox tables, its client and the
// sign-in (ARCHITECTURE, "iOS app structure", decision 5). Foundation and CryptoKit only
// (FoundationNetworking and swift-crypto's `Crypto` on Linux), so its tests run on Linux too; the
// apps' UIKit, SwiftUI and FamilyControls code stays out of it.
let package = Package(
    name: "BaliCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "BaliCore", targets: ["BaliCore"])],
    dependencies: [
        // CryptoKit's SHA-256, for PKCE, where there is no CryptoKit. Exact, like GRDB, and 4.x:
        // its manifest needs Swift 6.1, GRDB's floor, where 5.x's needs 6.2.
        .package(url: "https://github.com/apple/swift-crypto", exact: "4.5.2")
    ],
    targets: [
        .target(
            name: "BaliCore",
            dependencies: [
                .product(
                    name: "Crypto", package: "swift-crypto", condition: .when(platforms: [.linux]))
            ]),
        .testTarget(name: "BaliCoreTests", dependencies: ["BaliCore"]),
    ],
    swiftLanguageModes: [.v6]
)
