//
//  Badge.swift
//  Bali — design system
//
//  Pill badge (height 26, 12.5/650) with an optional leading status dot. The
//  `pulse` dot emits an expanding ring (used for "LIVE" / "BLOCKING APPLIED").
//

import SwiftUI

struct Badge: View {
    let text: String
    var tone: BaliTone = .blue
    var showsDot: Bool = false
    var pulse: Bool = false
    /// Use the solid accent for the dot/text instead of badge-tint pairing
    /// (e.g. the green "BLOCKING APPLIED" badge on dark).
    var onDark: Bool = false

    var body: some View {
        HStack(spacing: BaliSpacing.xs) {
            if showsDot {
                if pulse {
                    PulseDot(color: tone.dot, size: 9)
                } else {
                    Circle().fill(tone.dot).frame(width: 7, height: 7)
                }
            }
            Text(text)
                .font(BaliFont.at(12.5, 650))
                .tracking(-0.125)
                .foregroundStyle(onDark ? tone.dot : tone.badgeText)
        }
        .padding(.horizontal, 11)
        .frame(height: 26)
        .background(onDark ? tone.dot.opacity(0.16) : tone.tint)
        .clipShape(Capsule())
    }
}

/// A status dot with an expanding pulse ring (`pulse` keyframes, 1.8s loop).
struct PulseDot: View {
    var color: Color = BaliColor.green
    var size: CGFloat = 9
    @State private var animating = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: size, height: size)
            .overlay {
                Circle()
                    .strokeBorder(color, lineWidth: 2)
                    .scaleEffect(animating ? 1.9 : 0.8)
                    .opacity(animating ? 0 : 0.6)
            }
            .onAppear {
                withAnimation(.easeOut(duration: 1.8).repeatForever(autoreverses: false)) {
                    animating = true
                }
            }
    }
}

#Preview {
    VStack(alignment: .leading, spacing: 14) {
        Badge(text: "CLASS IS LIVE", tone: .blue, showsDot: true, pulse: true)
        Badge(text: "Present", tone: .green, showsDot: true)
        Badge(text: "Checked in late", tone: .amber, showsDot: true)
        Badge(text: "Absent", tone: .coral, showsDot: true)
        Badge(text: "No session", tone: .gray, showsDot: true)
        ZStack {
            BaliColor.focusBg
            Badge(text: "BLOCKING APPLIED", tone: .green, showsDot: true, pulse: true, onDark: true)
                .padding()
        }
        .frame(height: 60)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
    .padding()
    .background(BaliColor.bg)
}
