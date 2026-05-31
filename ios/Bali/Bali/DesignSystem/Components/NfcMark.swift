//
//  NfcMark.swift
//  Bali — design system
//
//  The blue NFC block mark: a rounded-square gradient tile with the NFC glyph
//  and a soft blue glow behind it. Used in the check-in sheet and (smaller) as
//  the center tab FAB glyph.
//

import SwiftUI

struct NfcMark: View {
    var size: CGFloat = 120
    var glow: Bool = true

    private var corner: CGFloat { size * 0.30 } // ~36 on 120

    var body: some View {
        ZStack {
            if glow {
                RoundedRectangle(cornerRadius: corner, style: .continuous)
                    .fill(BaliColor.focusGlow)
                    .frame(width: size * 0.92, height: size * 0.92)
                    .blur(radius: size * 0.22)
                    .opacity(0.55)
            }
            RoundedRectangle(cornerRadius: corner, style: .continuous)
                .fill(BaliGradient.shieldTile)
                .frame(width: size, height: size)
                .overlay {
                    Image(systemName: "dot.radiowaves.left.and.right")
                        .font(.system(size: size * 0.42, weight: .semibold))
                        .foregroundStyle(.white)
                }
                .baliShadow(.blue)
        }
        .frame(width: size, height: size)
    }
}

#Preview {
    VStack(spacing: 30) {
        NfcMark(size: 120)
        NfcMark(size: 62, glow: false)
    }
    .padding(40)
    .background(BaliColor.bg)
}
