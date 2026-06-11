//
//  Wordmark.swift
//  Bali — design system
//
//  The lowercase "bali" wordmark: weight 800, letter-spacing -0.04em.
//

import SwiftUI

struct Wordmark: View {
    var size: CGFloat = 40
    var color: Color = .white

    var body: some View {
        Text("bali")
            .font(BaliFont.at(size, 800))
            .tracking(size * -0.04)
            .foregroundStyle(color)
    }
}

#Preview {
    VStack(spacing: 20) {
        Wordmark(size: 40, color: BaliColor.blue)
        Wordmark(size: 22, color: BaliColor.ink)
    }
    .padding()
    .background(BaliColor.bg)
}
