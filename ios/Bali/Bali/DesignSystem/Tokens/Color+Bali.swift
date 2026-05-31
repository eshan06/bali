//
//  Color+Bali.swift
//  Bali — design system
//
//  Exact reproduction of the `:root` color tokens in
//  `design_handoff_bali_student_app/bali.css`. Bundle IDs render the policy;
//  these tokens render the whole app. Treat this file as the single source of
//  truth for color — never hard-code a hex elsewhere.
//

import SwiftUI

extension Color {
    /// Hex initializer supporting "RRGGBB" / "#RRGGBB" / "RRGGBBAA".
    init(hex: String, opacity: Double = 1.0) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var value: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&value)

        let r, g, b, a: Double
        switch cleaned.count {
        case 8: // RRGGBBAA
            r = Double((value >> 24) & 0xFF) / 255
            g = Double((value >> 16) & 0xFF) / 255
            b = Double((value >> 8) & 0xFF) / 255
            a = Double(value & 0xFF) / 255
        default: // RRGGBB (and fallback)
            r = Double((value >> 16) & 0xFF) / 255
            g = Double((value >> 8) & 0xFF) / 255
            b = Double(value & 0xFF) / 255
            a = opacity
        }
        self.init(.sRGB, red: r, green: g, blue: b, opacity: a)
    }
}

/// The Bali palette. Names mirror the CSS custom properties one-to-one.
enum BaliColor {
    // MARK: Brand
    static let blue = Color(hex: "2E5CFF")       // --blue
    static let blue700 = Color(hex: "1E3FCC")    // --blue-700
    static let blue300 = Color(hex: "8AA4FF")    // --blue-300
    static let blueTint = Color(hex: "EAF0FF")   // --blue-tint
    static let blueTint2 = Color(hex: "DDE6FF")  // --blue-tint-2

    // MARK: Ink / neutral (cool)
    static let ink = Color(hex: "0D1526")        // --ink
    static let ink2 = Color(hex: "404B5E")       // --ink-2
    static let ink3 = Color(hex: "6B7585")       // --ink-3
    static let ink4 = Color(hex: "9AA3B2")       // --ink-4
    static let line = Color(hex: "E7EAF0")       // --line
    static let line2 = Color(hex: "EEF0F5")      // --line-2
    static let bg = Color(hex: "F4F5F8")         // --bg
    static let surface = Color(hex: "FFFFFF")    // --surface

    // MARK: Status
    static let green = Color(hex: "15A974")      // --green
    static let greenTint = Color(hex: "E2F6EE")  // --green-tint
    static let amber = Color(hex: "E08A12")      // --amber
    static let amberTint = Color(hex: "FBEFD8")  // --amber-tint
    static let coral = Color(hex: "F1564A")      // --coral
    static let coralTint = Color(hex: "FCE6E4")  // --coral-tint
    static let violet = Color(hex: "7C5CFF")     // --violet

    // MARK: Badge text (darker-than-tint foregrounds from bali.css)
    static let badgeBlueText = blue700           // .b-blue color
    static let badgeGreenText = Color(hex: "0E7A52") // .b-green color
    static let badgeAmberText = Color(hex: "9A5C05") // .b-amber color
    static let badgeCoralText = Color(hex: "C13125") // .b-coral color
    static let badgeGrayBg = Color(hex: "EEF0F5")    // .b-gray bg

    // MARK: Focus mode (dark)
    static let focusBg = Color(hex: "070C1A")        // --focus-bg
    static let focusBg2 = Color(hex: "0C1430")       // --focus-bg-2
    static let focusCard = Color.white.opacity(0.06) // --focus-card
    static let focusLine = Color.white.opacity(0.10) // --focus-line
    static let focusText = Color(hex: "EAF0FF")      // --focus-text
    static let focusText2 = Color(hex: "EAF0FF", opacity: 0.62) // --focus-text-2
    static let focusGlow = Color(hex: "2E5CFF")      // --focus-glow

    // MARK: Misc surfaces from component styles
    static let fieldReadOnlyBg = Color(hex: "EFF1F5") // read-only .field bg
    static let segTrack = Color(hex: "E9ECF2")        // .seg track
    static let scrim = Color(hex: "080E1C", opacity: 0.42) // .scrim rgba(8,14,28,.42)
    static let sheetDark = Color(hex: "14182B")       // .sheet.dark
    static let grabber = Color(hex: "D3D7E0")         // .grabber
}
