//
//  RadarView.swift
//  Bali — design system
//
//  Concentric expanding rings for the NFC "waiting" state (radar keyframes,
//  2.4s, three staggered waves). Wrap any center content (e.g. NfcMark).
//

import SwiftUI

struct RadarView<Center: View>: View {
    var color: Color = BaliColor.blue
    var ringSize: CGFloat = 200
    @ViewBuilder var center: () -> Center

    @State private var animate = false
    private let waves = 3
    private let period = 2.4

    var body: some View {
        ZStack {
            ForEach(0..<waves, id: \.self) { i in
                Circle()
                    .strokeBorder(color, lineWidth: 2)
                    .frame(width: ringSize, height: ringSize)
                    .scaleEffect(animate ? 1.0 : 0.35)
                    .opacity(animate ? 0 : 0.8)
                    .animation(
                        .easeOut(duration: period)
                            .repeatForever(autoreverses: false)
                            .delay(Double(i) * (period / Double(waves))),
                        value: animate
                    )
            }
            center()
        }
        .frame(width: ringSize, height: ringSize)
        .onAppear { animate = true }
    }
}

#Preview {
    RadarView(ringSize: 220) {
        NfcMark(size: 120)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(BaliColor.surface)
}
