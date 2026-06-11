//
//  IconButton.swift
//  Bali — design system
//
//  Circular 38pt icon button (.icon-btn): translucent white bg + sh-1 on light
//  screens; a `.dark` variant (translucent white-on-dark, no shadow) for the
//  Focus Mode takeover. Used for back/info/bell/gear chrome.
//

import SwiftUI

struct IconButton: View {
    let systemImage: String
    var dark: Bool = false
    /// Optional unread indicator dot (e.g. the bell on Home).
    var showsBadge: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle()
                    .fill(dark ? Color.white.opacity(0.12) : Color.white.opacity(0.7))
                    .frame(width: 38, height: 38)
                    .background {
                        if !dark {
                            Circle().fill(.ultraThinMaterial)
                        }
                    }
                    .baliShadowIf(!dark, .card)

                Image(systemName: systemImage)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(dark ? .white : BaliColor.ink)
            }
            .overlay(alignment: .topTrailing) {
                if showsBadge {
                    Circle()
                        .fill(BaliColor.coral)
                        .frame(width: 8, height: 8)
                        .overlay(Circle().strokeBorder(BaliColor.bg, lineWidth: 1.5))
                        .offset(x: 1, y: -1)
                }
            }
        }
        .buttonStyle(.plain)
    }
}

private extension View {
    @ViewBuilder
    func baliShadowIf(_ condition: Bool, _ shadow: BaliShadow) -> some View {
        if condition { self.baliShadow(shadow) } else { self }
    }
}

#Preview {
    HStack(spacing: 16) {
        IconButton(systemImage: "chevron.left", action: {})
        IconButton(systemImage: "bell", showsBadge: true, action: {})
        IconButton(systemImage: "gearshape", action: {})
    }
    .padding()
    .frame(maxWidth: .infinity)
    .background(BaliColor.bg)
}
