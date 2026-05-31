//
//  AppTile.swift
//  Bali — design system
//
//  An app icon tile for the policy/focus grids: 58pt rounded square with a
//  glyph, plus the app name beneath. The `locked` variant greyscales the icon
//  and adds a lock badge (paused-during-class). Renders real app/category data
//  via `AppVisual` — never third-party brand logos.
//

import SwiftUI

/// How a single app renders in a grid: a glyph, a fill color, and a label.
struct AppVisual: Identifiable, Hashable {
    let id: String          // bundle id (stable key)
    let name: String
    let systemImage: String
    let fill: Color

    init(id: String, name: String, systemImage: String, fill: Color) {
        self.id = id
        self.name = name
        self.systemImage = systemImage
        self.fill = fill
    }
}

struct AppTile: View {
    let visual: AppVisual
    var locked: Bool = false
    var onDark: Bool = false
    var iconSize: CGFloat = 58

    var body: some View {
        VStack(spacing: 7) {
            RoundedRectangle(cornerRadius: BaliRadius.appIcon, style: .continuous)
                .fill(visual.fill)
                .frame(width: iconSize, height: iconSize)
                .overlay {
                    Image(systemName: visual.systemImage)
                        .font(.system(size: iconSize * 0.42, weight: .semibold))
                        .foregroundStyle(.white)
                }
                .grayscale(locked ? 1 : 0)
                .brightness(locked ? -0.18 : 0)
                .overlay(alignment: .bottomTrailing) {
                    if locked {
                        Circle()
                            .fill(Color(hex: "14182B", opacity: 0.92))
                            .frame(width: 22, height: 22)
                            .overlay {
                                Image(systemName: "lock.fill")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundStyle(.white)
                            }
                            .overlay {
                                Circle().strokeBorder(
                                    onDark ? BaliColor.focusBg : BaliColor.bg, lineWidth: 2)
                            }
                            .offset(x: 4, y: 4)
                    }
                }

            Text(visual.name)
                .font(BaliFont.at(11.5, 500))
                .foregroundStyle(onDark ? BaliColor.focusText2 : BaliColor.ink3)
                .lineLimit(1)
        }
    }
}

#Preview {
    let apps = [
        AppVisual(id: "1", name: "Instagram", systemImage: "camera.fill", fill: BaliColor.violet),
        AppVisual(id: "2", name: "TikTok", systemImage: "music.note", fill: BaliColor.ink),
        AppVisual(id: "3", name: "YouTube", systemImage: "play.fill", fill: BaliColor.coral),
        AppVisual(id: "4", name: "Snapchat", systemImage: "bubble.fill", fill: BaliColor.amber),
    ]
    let allowed = [
        AppVisual(id: "5", name: "Phone", systemImage: "phone.fill", fill: BaliColor.green),
        AppVisual(id: "6", name: "Messages", systemImage: "message.fill", fill: BaliColor.green),
    ]
    return VStack(spacing: 24) {
        HStack(spacing: 16) { ForEach(apps) { AppTile(visual: $0, locked: true) } }
        HStack(spacing: 16) { ForEach(allowed) { AppTile(visual: $0) } }
    }
    .padding()
    .background(BaliColor.bg)
}
