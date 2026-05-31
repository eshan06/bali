//
//  FocusModeView.swift
//  Bali — Focus tab (stub: resting state)
//
//  Phase 2 stub of the "Focus is resting" state. The dark Focus Mode takeover
//  (active session) and the full "How it works" explainer are built in Phase 7;
//  for now this shows the resting hero so the tab is real.
//

import SwiftUI

struct FocusModeView: View {
    var body: some View {
        BaliScreen {
            ScreenHeader(eyebrow: "Focus", title: "Focus Mode")

            Card {
                VStack(spacing: BaliSpacing.m) {
                    IconTile(systemImage: "moon.fill", tone: .blue, size: 64, glyphSize: 26)
                        .padding(.bottom, BaliSpacing.xxs)
                    BaliText("Focus is resting", .h2)
                    BaliText("Focus Mode turns on automatically when you check in to a live class.", .body)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, BaliSpacing.xxl)
            }
        }
    }
}

#Preview {
    NavigationStack { FocusModeView() }
        .injectBaliEnvironment(AppEnvironment())
}
