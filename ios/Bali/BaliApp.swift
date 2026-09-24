import BaliCore
import BaliOutbox
import SwiftUI

// The student app (ARCHITECTURE, "iOS app structure"). A placeholder until its screens (C1–C6):
// all it shows is that BaliCore and BaliOutbox are linked in, and which build this is.
@main
struct BaliApp: App {
    @Environment(\.scenePhase) private var phase

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
        // The outbox is in the app group, shared with the extensions: suspended holding a lock on
        // it, the app would be killed (0xdead10cc). So it takes none behind the app, and takes
        // them again in front.
        .onChange(of: phase) { _, phase in
            if phase == .background { Outbox.suspend() } else { Outbox.resume() }
        }
    }

    static let version = ["CFBundleShortVersionString", "CFBundleVersion"]
        .map { Bundle.main.object(forInfoDictionaryKey: $0) as? String ?? "?" }
        .joined(separator: " · ")
}
