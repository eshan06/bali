//
//  ShieldTile.swift
//  Bali — design system
//
//  The glowing blue shield hero on the Focus Mode screen: 128pt rounded square
//  (radius 40), blue gradient, with a blue radial glow behind it.
//

import SwiftUI

struct ShieldTile: View {
    var size: CGFloat = 128

    var body: some View {
        ZStack {
            Circle()
                .fill(BaliColor.focusGlow)
                .frame(width: size * 1.25, height: size * 1.25)
                .blur(radius: size * 0.30)
                .opacity(0.45)
            RoundedRectangle(cornerRadius: BaliRadius.shield, style: .continuous)
                .fill(BaliGradient.shieldTile)
                .frame(width: size, height: size)
                .overlay {
                    Image(systemName: "shield.fill")
                        .font(.system(size: size * 0.42, weight: .semibold))
                        .foregroundStyle(.white)
                }
                .baliShadow(.blue)
        }
        .frame(width: size * 1.25, height: size * 1.25)
    }
}

#Preview {
    ShieldTile()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BaliGradient.focusScreen.ignoresSafeArea())
}
