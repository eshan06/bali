//
//  Shadow+Bali.swift
//  Bali — design system
//
//  The three layered shadows from bali.css (--sh-1, --sh-2, --sh-blue) plus the
//  danger-button shadow. CSS box-shadows stack multiple layers; SwiftUI applies
//  one per `.shadow`, so each token chains its layers. CSS blur ≈ SwiftUI
//  radius × 2, so radius = blur / 2.
//

import SwiftUI

enum BaliShadow {
    case card      // --sh-1
    case elevated  // --sh-2
    case blue      // --sh-blue (primary button)
    case danger    // coral button
}

private struct BaliShadowModifier: ViewModifier {
    let shadow: BaliShadow

    func body(content: Content) -> some View {
        switch shadow {
        case .card:
            content
                .shadow(color: Color(hex: "0F1C38", opacity: 0.04), radius: 1, x: 0, y: 1)
                .shadow(color: Color(hex: "0F1C38", opacity: 0.05), radius: 7, x: 0, y: 4)
        case .elevated:
            content
                .shadow(color: Color(hex: "0F1C38", opacity: 0.06), radius: 3, x: 0, y: 2)
                .shadow(color: Color(hex: "0F1C38", opacity: 0.09), radius: 17, x: 0, y: 14)
        case .blue:
            content
                .shadow(color: Color(hex: "2E5CFF", opacity: 0.30), radius: 12, x: 0, y: 8)
        case .danger:
            content
                .shadow(color: Color(hex: "F1564A", opacity: 0.30), radius: 11, x: 0, y: 8)
        }
    }
}

extension View {
    func baliShadow(_ shadow: BaliShadow) -> some View {
        modifier(BaliShadowModifier(shadow: shadow))
    }
}
