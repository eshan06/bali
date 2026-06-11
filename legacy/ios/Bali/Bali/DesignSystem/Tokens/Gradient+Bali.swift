//
//  Gradient+Bali.swift
//  Bali — design system
//
//  The named gradients from the design handoff: login hero, focus-screen
//  backdrop, the shield/NFC tiles, and the dark "checked-in" card.
//

import SwiftUI

enum BaliGradient {
    /// Login hero band — linear-gradient(160deg, #2E5CFF, #1E3FCC 60%, #16308f).
    static let loginHero = LinearGradient(
        stops: [
            .init(color: Color(hex: "2E5CFF"), location: 0.0),
            .init(color: Color(hex: "1E3FCC"), location: 0.6),
            .init(color: Color(hex: "16308F"), location: 1.0),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// Blue hero card (Home "live, not checked in") — linear 150°.
    static let blueHero = LinearGradient(
        colors: [Color(hex: "335CFF"), Color(hex: "1E3FCC")],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// Shield / NFC mark tile fill — linear-gradient(150deg,#335CFF,#1E3FCC).
    static let shieldTile = LinearGradient(
        colors: [Color(hex: "335CFF"), Color(hex: "1E3FCC")],
        startPoint: .top,
        endPoint: .bottom
    )

    /// Dark "checked in / focus active" card — linear-gradient(155deg,#0C1430,#070C1A).
    static let darkCard = LinearGradient(
        colors: [Color(hex: "0C1430"), Color(hex: "070C1A")],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// Avatar / initials circle.
    static let avatar = LinearGradient(
        colors: [Color(hex: "335CFF"), Color(hex: "1E3FCC")],
        startPoint: .top,
        endPoint: .bottom
    )

    /// Full-screen Focus Mode backdrop —
    /// radial-gradient(120% 90% at 50% -10%, #142152, #0C1430 42%, #070C1A).
    static let focusScreen = RadialGradient(
        stops: [
            .init(color: Color(hex: "142152"), location: 0.0),
            .init(color: Color(hex: "0C1430"), location: 0.42),
            .init(color: Color(hex: "070C1A"), location: 1.0),
        ],
        center: UnitPoint(x: 0.5, y: -0.10),
        startRadius: 0,
        endRadius: 720
    )

    /// Soft page backdrop behind the device on light screens (the .stage glow).
    static let lightStage = RadialGradient(
        stops: [
            .init(color: Color(hex: "EEF1F8"), location: 0.0),
            .init(color: Color(hex: "E7EAF2"), location: 0.55),
            .init(color: Color(hex: "E1E5EF"), location: 1.0),
        ],
        center: UnitPoint(x: 0.5, y: -0.10),
        startRadius: 0,
        endRadius: 900
    )

    /// Class-color header gradient: {color} → mix(color 70%, #0A1430).
    static func classHeader(_ color: Color) -> LinearGradient {
        LinearGradient(
            colors: [color, color.blended(with: Color(hex: "0A1430"), amount: 0.30)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

extension Color {
    /// Approximate `color-mix`: blend `amount` of `other` into `self` in sRGB.
    func blended(with other: Color, amount: Double) -> Color {
        let a = UIColor(self)
        let b = UIColor(other)
        var ar: CGFloat = 0, ag: CGFloat = 0, ab: CGFloat = 0, aa: CGFloat = 0
        var br: CGFloat = 0, bg: CGFloat = 0, bb: CGFloat = 0, ba: CGFloat = 0
        a.getRed(&ar, green: &ag, blue: &ab, alpha: &aa)
        b.getRed(&br, green: &bg, blue: &bb, alpha: &ba)
        let t = CGFloat(amount)
        return Color(
            .sRGB,
            red: Double(ar + (br - ar) * t),
            green: Double(ag + (bg - ag) * t),
            blue: Double(ab + (bb - ab) * t),
            opacity: Double(aa + (ba - aa) * t)
        )
    }
}
