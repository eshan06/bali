//
//  RootView.swift
//  Bali
//
//  Phase 0/1 scaffold. For now this is a minimal branded launch surface so the
//  project builds and runs as a real app shell (not the Xcode "Hello, world!"
//  template). Phase 2 replaces the body with the real phase gate:
//  auth → onboarding → tabbed app, driven by AuthStore + AppRouter.
//
//  The design system the rest of the app composes from lives in DesignSystem/
//  (verify it in Xcode via the DesignGallery #Preview).
//

import SwiftUI

struct RootView: View {
    var body: some View {
        ZStack {
            BaliColor.bg.ignoresSafeArea()

            VStack(spacing: BaliSpacing.s10) {
                Wordmark(size: 40, color: BaliColor.blue)
                BaliText("Focus, made effortless.", .body)
            }
        }
    }
}

#Preview {
    RootView()
}
