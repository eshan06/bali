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
    init() {
        #if canImport(Amplify)
        // Configures Amplify once at launch (real Cognito). Compiled in only once
        // the Amplify SPM package is added; until then this is a no-op.
        AmplifyAuthService.configure()
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}
