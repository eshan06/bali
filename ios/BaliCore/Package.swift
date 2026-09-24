// swift-tools-version: 6.0
import PackageDescription

// BaliCore: what the iOS apps share — the API's wire types today, then its outbox tables and
// client (ARCHITECTURE, "iOS app structure", decision 5). Foundation only, so the contract tests
// run on Linux too; the apps' UIKit, SwiftUI and FamilyControls code stays out of it.
let package = Package(
    name: "BaliCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "BaliCore", targets: ["BaliCore"])],
    targets: [
        .target(name: "BaliCore"),
        .testTarget(name: "BaliCoreTests", dependencies: ["BaliCore"]),
    ],
    swiftLanguageModes: [.v6]
)
