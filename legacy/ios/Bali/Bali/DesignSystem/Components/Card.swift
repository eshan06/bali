//
//  Card.swift
//  Bali — design system
//
//  White surface, radius 24, card shadow, 18pt padding by default (.card).
//  Set `padding: 0` for edge-to-edge content (e.g. grouped rows).
//

import SwiftUI

struct Card<Content: View>: View {
    var padding: CGFloat = BaliSpacing.cardPadding
    var radius: CGFloat = BaliRadius.lg
    var background: Color = BaliColor.surface
    var bordered: Bool = false
    var borderColor: Color = BaliColor.line
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(background)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay {
                if bordered {
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .strokeBorder(borderColor, lineWidth: 1)
                }
            }
            .baliShadow(.card)
    }
}

#Preview {
    VStack(spacing: 16) {
        Card {
            VStack(alignment: .leading, spacing: 6) {
                BaliText("Card title", .h3)
                BaliText("Default white card with sh-1 shadow.", .body)
            }
        }
        Card(bordered: true) {
            BaliText("Bordered card", .bodyStrong)
        }
    }
    .padding()
    .background(BaliColor.bg)
}
