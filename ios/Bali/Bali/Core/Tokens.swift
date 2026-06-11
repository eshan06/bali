import SwiftUI

/// Design tokens — Swift mirror of design_handoff_bali_2/tokens/tokens.css.
/// Student surfaces are dark-first: explicit dark hexes, never system inversions.
enum Tokens {
    // Evergreen
    static let green100 = Color(hex: 0xDCEDE3)
    static let green200 = Color(hex: 0xBCDCCA)
    static let green300 = Color(hex: 0x92C3A9)
    static let green400 = Color(hex: 0x62A483)
    static let green500 = Color(hex: 0x3F8765)
    static let green600 = Color(hex: 0x2C6F51)
    static let green700 = Color(hex: 0x245A43)

    // Orange (emergency — warm, never alarm)
    static let orange300 = Color(hex: 0xE5AF6F)
    static let orange400 = Color(hex: 0xDB9347)

    // Blue (pass)
    static let blue300 = Color(hex: 0x8FB4E8)
    static let blue400 = Color(hex: 0x5E90D9)

    // Red (revoked + destructive ONLY)
    static let red300 = Color(hex: 0xE89B92)
    static let red500 = Color(hex: 0xC44A3C)

    enum Dark {
        static let page = Color(hex: 0x141312)
        static let card = Color(hex: 0x1D1B19)
        static let sunken = Color(hex: 0x100F0E)
        static let raised = Color(hex: 0x262421)
        static let border = Color(hex: 0x2E2B27)
        static let borderStrong = Color(hex: 0x3C3934)
        static let textPrimary = Color(hex: 0xF1EFEB)
        static let textSecondary = Color(hex: 0xB0AAA1)
        static let textTertiary = Color(hex: 0x837D74)
        static let arcTrack = Color(hex: 0x2E2B27)
        static let arcFill = Tokens.green400
        static let arcFinal2 = Tokens.green300
        /// Dark primary action: green-400 bg + ink (green-500 fails AA).
        static let actionPrimaryBg = Tokens.green400
        static let actionPrimaryFg = Color(hex: 0x06130D)
        // State chip pairs (dark)
        static let stateFocusedBg = Color(hex: 0x1E2F27)
        static let statePassBg = Color(hex: 0x1D2938)
        static let stateEmergencyBg = Color(hex: 0x38291A)
        static let stateRevokedBg = Color(hex: 0x341F1C)
        static let stateNeutralBg = Color(hex: 0x242220)
        // EmergencyUnlockControl
        static let unlockBg = Color(hex: 0x2A2723)
        static let unlockInk = Color(hex: 0x2B1604)
    }

    enum Light {
        static let page = Color(hex: 0xF7F5F2)
        static let card = Color.white
        static let sunken = Color(hex: 0xEFECE7)
        static let border = Color(hex: 0xE3DFD8)
        static let borderStrong = Color(hex: 0xD2CCC2)
        static let textPrimary = Color(hex: 0x211F1B)
        static let textSecondary = Color(hex: 0x5B564E)
        static let textTertiary = Color(hex: 0x8A847A)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

extension Font {
    /// Hero countdown: SF Pro Rounded, semibold, tabular handled by monospacedDigit.
    static func heroTime(_ size: CGFloat = 56) -> Font {
        .system(size: size, weight: .semibold, design: .rounded)
    }
}
