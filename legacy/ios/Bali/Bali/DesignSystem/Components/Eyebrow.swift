//
//  Eyebrow.swift
//  Bali — design system
//
//  Small uppercase section label. Blue by default, or muted (ink-4).
//

import SwiftUI

struct Eyebrow: View {
    private let text: String
    private let muted: Bool

    init(_ text: String, muted: Bool = false) {
        self.text = text
        self.muted = muted
    }

    var body: some View {
        BaliText(text.uppercased(), .eyebrow,
                 color: muted ? BaliColor.ink4 : BaliColor.blue)
    }
}

#Preview {
    VStack(alignment: .leading, spacing: 12) {
        Eyebrow("Student sign in")
        Eyebrow("Your roster", muted: true)
    }
    .padding()
    .background(BaliColor.bg)
}
