// swift-tools-version: 6.0
import PackageDescription

// BaliOutbox: the student phone's outbox, a GRDB database in the app group (ARCHITECTURE, "iOS app
// structure", decision 3), run by BaliCore's outbox tables. Student-only: the teacher app has none.
let package = Package(
    name: "BaliOutbox",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "BaliOutbox", targets: ["BaliOutbox"])],
    dependencies: [
        .package(path: "../BaliCore"),
        // Exact, so the app and every CI job build the same GRDB.
        .package(url: "https://github.com/groue/GRDB.swift", exact: "7.11.1"),
    ],
    targets: [
        .target(
            name: "BaliOutbox",
            dependencies: [
                "BaliCore", .product(name: "GRDB", package: "GRDB.swift"),
                // The SQLite C API GRDB is built on, for the persistent WAL mode.
                .product(name: "GRDBSQLite", package: "GRDB.swift"),
            ]),
        .testTarget(name: "BaliOutboxTests", dependencies: ["BaliOutbox"]),
    ],
    swiftLanguageModes: [.v6]
)
