//
//  GoogleGGlyph.swift
//  Bali — design system
//
//  A small multi-color "G" mark for the "Continue with Google" button, drawn
//  from an arc + bar rather than shipping the official asset. Approximates the
//  four Google brand colors; it's a generic sign-in affordance, not a reproduced
//  third-party app logo.
//

import SwiftUI

struct GoogleGGlyph: View {
    var size: CGFloat = 18

    private let blue = Color(hex: "4285F4")
    private let red = Color(hex: "EA4335")
    private let yellow = Color(hex: "FBBC05")
    private let green = Color(hex: "34A853")

    var body: some View {
        ZStack {
            Circle()
                .trim(from: 0.0, to: 0.25)
                .stroke(red, style: .init(lineWidth: size * 0.22, lineCap: .butt))
                .rotationEffect(.degrees(-135))
            Circle()
                .trim(from: 0.0, to: 0.25)
                .stroke(yellow, style: .init(lineWidth: size * 0.22, lineCap: .butt))
                .rotationEffect(.degrees(135))
            Circle()
                .trim(from: 0.0, to: 0.25)
                .stroke(green, style: .init(lineWidth: size * 0.22, lineCap: .butt))
                .rotationEffect(.degrees(45))
            Circle()
                .trim(from: 0.0, to: 0.28)
                .stroke(blue, style: .init(lineWidth: size * 0.22, lineCap: .butt))
                .rotationEffect(.degrees(-20))
            // The crossbar of the G.
            Rectangle()
                .fill(blue)
                .frame(width: size * 0.30, height: size * 0.22)
                .offset(x: size * 0.20, y: 0)
        }
        .frame(width: size, height: size)
    }
}

#Preview {
    HStack(spacing: 16) {
        GoogleGGlyph(size: 18)
        GoogleGGlyph(size: 32)
    }
    .padding()
    .background(BaliColor.surface)
}
