//
//  RootView.swift
//  Bali
//
//  Phase 0 scaffold. For now this is a minimal branded launch surface so the
//  project builds and runs as a real app shell (not the Xcode "Hello, world!"
//  template). Phase 2 replaces the body with the real phase gate:
//  auth → onboarding → tabbed app, driven by AuthStore + AppRouter.
//

import SwiftUI

struct RootView: View {
    var body: some View {
        ZStack {
            // App background (design token --bg #F4F5F8); the real Color+Bali
            // palette arrives in Phase 1's design system.
            Color(red: 0.957, green: 0.961, blue: 0.973)
                .ignoresSafeArea()

            VStack(spacing: 10) {
                Text("bali")
                    .font(.system(size: 40, weight: .heavy))
                    .tracking(-1.6) // ≈ -0.04em on 40pt
                    .foregroundStyle(Color(red: 0.180, green: 0.361, blue: 1.0)) // --blue
                Text("Focus, made effortless.")
                    .font(.system(size: 15.5))
                    .foregroundStyle(Color(red: 0.420, green: 0.459, blue: 0.522)) // --ink-3
            }
        }
    }
}

#Preview {
    RootView()
}
