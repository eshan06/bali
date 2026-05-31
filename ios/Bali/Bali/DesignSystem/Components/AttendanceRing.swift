//
//  AttendanceRing.swift
//  Bali — design system
//
//  Circular progress ring: grey track, class-color progress with a rounded cap,
//  animating from 0 on appear, centered % label (weight 750).
//

import SwiftUI

struct AttendanceRing: View {
    /// 0...1.
    let progress: Double
    var color: Color = BaliColor.blue
    var size: CGFloat = 56
    var lineWidth: CGFloat = 5
    var showsLabel: Bool = true

    @State private var animatedProgress: Double = 0

    private var clamped: Double { min(max(progress, 0), 1) }

    var body: some View {
        ZStack {
            Circle()
                .stroke(BaliColor.line, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: animatedProgress)
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            if showsLabel {
                Text("\(Int((clamped * 100).rounded()))%")
                    .font(BaliFont.at(size * 0.25, 750))
                    .tracking(size * 0.25 * -0.02)
                    .foregroundStyle(BaliColor.ink)
                    .monospacedDigit()
            }
        }
        .frame(width: size, height: size)
        .onAppear {
            withAnimation(.easeOut(duration: 0.9)) { animatedProgress = clamped }
        }
        .onChange(of: clamped) { _, newValue in
            withAnimation(.easeOut(duration: 0.6)) { animatedProgress = newValue }
        }
    }
}

#Preview {
    HStack(spacing: 20) {
        AttendanceRing(progress: 0.92, color: BaliColor.blue)
        AttendanceRing(progress: 0.88, color: BaliColor.violet)
        AttendanceRing(progress: 0.96, color: BaliColor.green, size: 84, lineWidth: 7)
    }
    .padding()
    .background(BaliColor.bg)
}
