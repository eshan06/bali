//
//  BaliApp.swift
//  Bali — student companion app
//
//  @main entry point. Hosts RootView, which gates between auth, onboarding,
//  and the tabbed app (the full gate lands in Phase 2). Kept deliberately thin:
//  composition of stores/services happens in AppEnvironment.
//

import SwiftUI

@main
struct BaliApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}
