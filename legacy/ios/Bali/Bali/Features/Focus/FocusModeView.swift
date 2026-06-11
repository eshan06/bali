//
//  FocusModeView.swift
//  Bali — Focus tab
//
//  The Focus tab's light states: "resting" (adaptive copy + a check-in button
//  when a class is live) with a "How it works" explainer, and a compact
//  "active but minimized" card when the dark takeover is collapsed. The takeover
//  itself + the session lifecycle live at the app level (MainTabView).
//

import SwiftUI

struct FocusModeView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppRouter.self) private var router
    @Environment(FocusModeController.self) private var controller

    var body: some View {
        if controller.isActive && !controller.isExpanded {
            collapsedActive
        } else {
            restingScreen
        }
    }

    // MARK: - Resting

    private var restingScreen: some View {
        BaliScreen {
            ScreenHeader(eyebrow: "Focus", title: "Focus Mode")
            restingCard
            howItWorks
        }
    }

    private var restingCard: some View {
        let live = model.liveClass
        return Card {
            VStack(spacing: BaliSpacing.m) {
                IconTile(systemImage: "moon.fill", tone: .blue, size: 64, glyphSize: 26)
                    .padding(.bottom, BaliSpacing.xxs)
                BaliText("Focus is resting", .h2)
                BaliText(live != nil
                            ? "A class is live — tap your block to start Focus Mode."
                            : "Focus Mode turns on automatically when you check in to a live class.",
                         .body)
                    .multilineTextAlignment(.center)
                if let live {
                    BaliButton(title: "Tap to check in", icon: "dot.radiowaves.left.and.right",
                               fullWidth: false) {
                        router.startCheckIn(classId: live.id)
                    }
                    .padding(.top, BaliSpacing.xxs)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, BaliSpacing.xl)
        }
    }

    private var howItWorks: some View {
        VStack(alignment: .leading, spacing: BaliSpacing.m) {
            BaliText("How it works", .h3)
            Card(padding: 0) {
                VStack(spacing: 0) {
                    howRow("dot.radiowaves.left.and.right", "Tap your Bali block",
                           "Check in the moment class starts.")
                    rowDivider
                    howRow("shield.fill", "Apps pause automatically",
                           "Using your teacher's session policy.")
                    rowDivider
                    howRow("lock.fill", "Everything unlocks",
                           "The second the session ends.")
                }
            }
        }
    }

    private func howRow(_ icon: String, _ title: String, _ subtitle: String) -> some View {
        HStack(alignment: .top, spacing: BaliSpacing.m14) {
            IconTile(systemImage: icon, tone: .blue, size: 38, glyphSize: 16)
            VStack(alignment: .leading, spacing: 3) {
                BaliText(title, .bodyStrong)
                BaliText(subtitle, .foot)
            }
            Spacer(minLength: 0)
        }
        .padding(16)
    }

    private var rowDivider: some View {
        Rectangle().fill(BaliColor.line).frame(height: 1).padding(.leading, 68)
    }

    // MARK: - Collapsed active

    private var collapsedActive: some View {
        BaliScreen {
            ScreenHeader(eyebrow: "Focus", title: "Focus Mode")
            Card {
                VStack(spacing: BaliSpacing.m) {
                    IconTile(systemImage: "shield.fill", tone: .blue, size: 64, glyphSize: 26)
                        .padding(.bottom, BaliSpacing.xxs)
                    BaliText("Focus Mode is on", .h2)
                    BaliText("\(controller.activeClass?.name ?? "Class") · your apps are paused.", .body)
                        .multilineTextAlignment(.center)
                    BaliButton(title: "Open Focus Mode", icon: "shield.fill", fullWidth: false) {
                        controller.isExpanded = true
                    }
                    .padding(.top, BaliSpacing.xxs)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, BaliSpacing.xl)
            }
        }
    }
}

#Preview {
    NavigationStack { FocusModeView() }
        .injectBaliEnvironment(.preview())
}
