// swift-tools-version: 6.0
import PackageDescription

// BaliCore: what the iOS apps share — the API's wire types, its outbox tables and its client
// (ARCHITECTURE, "iOS app structure", decision 5). Foundation only (FoundationNetworking on
// Linux), so the contract tests run on Linux too; the apps' UIKit, SwiftUI and FamilyControls
// code stays out of it.
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
