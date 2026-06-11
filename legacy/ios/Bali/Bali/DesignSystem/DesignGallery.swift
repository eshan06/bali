//
//  DesignGallery.swift
//  Bali — design system
//
//  A single-screen showcase of every design-system primitive, for verifying
//  fidelity against the bali.css spec and the handoff screenshots in Xcode
//  previews. DEBUG-only — never compiled into a release build, never presented
//  in the app.
//

#if DEBUG
import SwiftUI

struct DesignGallery: View {
    @State private var method = "Code"
    @State private var grade = "11"
    @State private var email = "maya.chen@lincoln.edu"

    private let blocked = [
        AppVisual(id: "1", name: "Instagram", systemImage: "camera.fill", fill: BaliColor.violet),
        AppVisual(id: "2", name: "TikTok", systemImage: "music.note", fill: BaliColor.ink),
        AppVisual(id: "3", name: "YouTube", systemImage: "play.fill", fill: BaliColor.coral),
        AppVisual(id: "4", name: "Snapchat", systemImage: "bubble.fill", fill: BaliColor.amber),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                section("Type scale") {
                    BaliText("Maya.", .display)
                    BaliText("Hero headline", .h1)
                    BaliText("Card title", .h2)
                    BaliText("Row heading", .h3)
                    BaliText("Body copy sets the tone for secondary text.", .body)
                    BaliText("Body strong", .bodyStrong)
                    BaliText("Footnote detail", .foot)
                    Eyebrow("Student sign in")
                }

                section("Buttons") {
                    BaliButton(title: "Sign in", trailingIcon: "arrow.right", action: {})
                    BaliButton(title: "Continue with Google", variant: .ghost, action: {})
                    BaliButton(title: "Secondary", variant: .secondary, action: {})
                    BaliButton(title: "Request emergency unlock", variant: .dangerSoft, action: {})
                }

                section("Badges") {
                    HStack(spacing: 8) {
                        Badge(text: "CLASS IS LIVE", tone: .blue, showsDot: true, pulse: true)
                        Badge(text: "Present", tone: .green, showsDot: true)
                    }
                    HStack(spacing: 8) {
                        Badge(text: "Late", tone: .amber, showsDot: true)
                        Badge(text: "Absent", tone: .coral, showsDot: true)
                        Badge(text: "No session", tone: .gray, showsDot: true)
                    }
                }

                section("Tiles & ring") {
                    HStack(spacing: 12) {
                        IconTile(systemImage: "shield", tone: .blue)
                        IconTile(systemImage: "checkmark", tone: .green)
                        IconTile(systemImage: "bell.fill", tone: .amber)
                        AttendanceRing(progress: 0.92)
                    }
                }

                section("Inputs") {
                    BaliTextField(placeholder: "you@school.edu", text: $email, icon: "envelope")
                    BaliReadOnlyField(value: "maya.chen@lincoln.edu", icon: "envelope")
                    BaliSegmentedControl(items: ["Code", "Link", "QR"], selection: $method) { $0 }
                    BaliSegmentedControl(items: ["9", "10", "11", "12"], selection: $grade) { $0 }
                }

                section("Cards") {
                    Card {
                        VStack(alignment: .leading, spacing: 6) {
                            BaliText("White card", .h3)
                            BaliText("Radius 24, sh-1, 18pt padding.", .body)
                        }
                    }
                }

                section("App tiles") {
                    HStack(spacing: 16) { ForEach(blocked) { AppTile(visual: $0, locked: true) } }
                }

                section("Marks") {
                    HStack(spacing: 30) {
                        NfcMark(size: 96)
                        ShieldTile(size: 96)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .padding(BaliSpacing.screenH)
        }
        .background(BaliColor.bg)
    }

    @ViewBuilder
    private func section(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Eyebrow(title, muted: true)
            content()
        }
    }
}

#Preview("Design Gallery") {
    DesignGallery()
}

#Preview("Focus dark marks") {
    VStack(spacing: 40) {
        ShieldTile()
        Badge(text: "BLOCKING APPLIED", tone: .green, showsDot: true, pulse: true, onDark: true)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(BaliGradient.focusScreen.ignoresSafeArea())
}
#endif
