//
//  IconTile.swift
//  Bali — design system
//
//  Rounded-square 44×44 icon tile (radius 13): tinted background + matching
//  accent glyph (.tile / .tile-blue etc.).
//

import SwiftUI

struct IconTile: View {
    let systemImage: String
    var tone: BaliTone = .blue
    var size: CGFloat = 44
    var glyphSize: CGFloat = 19

    var body: some View {
        RoundedRectangle(cornerRadius: BaliRadius.tile, style: .continuous)
            .fill(tone.tint)
            .frame(width: size, height: size)
            .overlay {
                Image(systemName: systemImage)
                    .font(.system(size: glyphSize, weight: .semibold))
                    .foregroundStyle(tone.solid)
            }
    }
}

#Preview {
    HStack(spacing: 12) {
        IconTile(systemImage: "shield", tone: .blue)
        IconTile(systemImage: "checkmark", tone: .green)
        IconTile(systemImage: "envelope", tone: .amber)
        IconTile(systemImage: "hand.raised.fill", tone: .coral)
        IconTile(systemImage: "graduationcap.fill", tone: .violet)
        IconTile(systemImage: "iphone", tone: .ink)
    }
    .padding()
    .background(BaliColor.bg)
}
