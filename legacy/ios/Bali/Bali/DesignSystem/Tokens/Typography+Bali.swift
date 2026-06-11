//
//  Typography+Bali.swift
//  Bali — design system
//
//  The type scale from the handoff, reproduced precisely. CSS uses fractional
//  font-weights (750, 650) that SwiftUI's named `Font.Weight` can't express, so
//  we map the CSS weight onto UIKit's continuous weight axis and build the font
//  from `UIFont`. Letter-spacing (em) is converted to points (size × em).
//

import SwiftUI
import UIKit

enum BaliFont {
    /// CSS numeric weight (100–900) → UIKit weight rawValue control points.
    private static let stops: [(css: CGFloat, w: CGFloat)] = [
        (100, -0.80), (200, -0.60), (300, -0.40), (400, 0.0),
        (500, 0.23), (600, 0.30), (700, 0.40), (800, 0.56), (900, 0.62),
    ]

    static func uiWeight(_ css: CGFloat) -> UIFont.Weight {
        if css <= stops.first!.css { return UIFont.Weight(rawValue: stops.first!.w) }
        if css >= stops.last!.css { return UIFont.Weight(rawValue: stops.last!.w) }
        for i in 1..<stops.count {
            let lo = stops[i - 1], hi = stops[i]
            if css <= hi.css {
                let t = (css - lo.css) / (hi.css - lo.css)
                return UIFont.Weight(rawValue: lo.w + t * (hi.w - lo.w))
            }
        }
        return .regular
    }

    /// A system (SF) font at an exact pixel size and CSS weight.
    static func at(_ size: CGFloat, _ cssWeight: CGFloat) -> Font {
        Font(UIFont.systemFont(ofSize: size, weight: uiWeight(cssWeight)))
    }
}

/// A complete text style: size, weight, tracking (pts), line spacing, color.
struct BaliTextStyle {
    let size: CGFloat
    let weight: CGFloat
    let tracking: CGFloat
    let lineSpacing: CGFloat
    let color: Color

    var font: Font { BaliFont.at(size, weight) }

    fileprivate init(size: CGFloat, weight: CGFloat, em: CGFloat = 0,
                     lineSpacing: CGFloat = 0, color: Color) {
        self.size = size
        self.weight = weight
        self.tracking = size * em
        self.lineSpacing = lineSpacing
        self.color = color
    }

    // The scale (sizes/weights/letter-spacing straight from bali.css).
    static let display    = BaliTextStyle(size: 33,   weight: 800, em: -0.02,  color: BaliColor.ink)
    static let h1         = BaliTextStyle(size: 27,   weight: 800, em: -0.02,  color: BaliColor.ink)
    static let h2         = BaliTextStyle(size: 21,   weight: 750, em: -0.015, color: BaliColor.ink)
    static let h3         = BaliTextStyle(size: 17,   weight: 700, em: -0.01,  color: BaliColor.ink)
    static let body       = BaliTextStyle(size: 15.5, weight: 400, lineSpacing: 4, color: BaliColor.ink3)
    static let bodyStrong = BaliTextStyle(size: 15.5, weight: 600, lineSpacing: 4, color: BaliColor.ink)
    static let foot       = BaliTextStyle(size: 13,   weight: 400, lineSpacing: 2, color: BaliColor.ink3)
    static let eyebrow    = BaliTextStyle(size: 11.5, weight: 700, em: 0.13,   color: BaliColor.blue)
    static let tab        = BaliTextStyle(size: 10.5, weight: 600, em: -0.01,  color: BaliColor.ink4)
    static let label      = BaliTextStyle(size: 13,   weight: 650, color: BaliColor.ink2)
}

extension View {
    /// Apply a `BaliTextStyle`, optionally overriding its color.
    func baliText(_ style: BaliTextStyle, color: Color? = nil) -> some View {
        self
            .font(style.font)
            .tracking(style.tracking)
            .lineSpacing(style.lineSpacing)
            .foregroundStyle(color ?? style.color)
    }
}

/// Ergonomic styled text: `BaliText("Maya.", .display)`.
struct BaliText: View {
    private let content: String
    private let style: BaliTextStyle
    private let colorOverride: Color?

    init(_ content: String, _ style: BaliTextStyle, color: Color? = nil) {
        self.content = content
        self.style = style
        self.colorOverride = color
    }

    var body: some View {
        Text(content).baliText(style, color: colorOverride)
    }
}
