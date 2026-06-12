import SwiftUI

/// Brand arc mark (SVG recipe from the tokens doc, drawn natively) — shared chrome.
struct ArcMarkView: View {
    var size: CGFloat
    var trackColor: Color = Tokens.Dark.border
    var fillColor: Color = Tokens.green400

    var body: some View {
        ZStack {
            Circle().stroke(trackColor, lineWidth: size * 0.15)
            Circle()
                .trim(from: 0, to: 0.72)
                .stroke(fillColor, style: StrokeStyle(lineWidth: size * 0.15, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: size, height: size)
    }
}
