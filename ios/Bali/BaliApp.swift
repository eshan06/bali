import BaliCore
import BaliOutbox
import SwiftUI

// The student app (ARCHITECTURE, "iOS app structure"). A placeholder until its screens (C1–C6):
// all it shows is that BaliCore and BaliOutbox are linked in, and which build this is.
@main
struct BaliApp: App {
    var body: some Scene {
        WindowGroup {
            VStack(spacing: 8) {
                Text("Bali").font(.largeTitle)
                // "BaliCore.APIClient" and "BaliOutbox.Outbox", read from the packages' own types.
                Text(String(reflecting: APIClient.self)).font(.body.monospaced())
                Text(String(reflecting: Outbox.self)).font(.body.monospaced())
                Text("Build \(Self.version)").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    static let version = ["CFBundleShortVersionString", "CFBundleVersion"]
        .map { Bundle.main.object(forInfoDictionaryKey: $0) as? String ?? "?" }
        .joined(separator: " · ")
}
