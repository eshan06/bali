//
//  Layout+Bali.swift
//  Bali — design system
//
//  Radius + spacing tokens. The design is built on a 4px grid with a 402×874
//  reference canvas (≈ iPhone 15 logical points).
//

import CoreGraphics

enum BaliRadius {
    static let sm: CGFloat = 12      // --r-sm
    static let r: CGFloat = 18       // --r
    static let lg: CGFloat = 24      // --r-lg (default card)
    static let xl: CGFloat = 30      // --r-xl
    static let pill: CGFloat = 9999  // buttons / badges
    static let tile: CGFloat = 13    // 44×44 icon tiles
    static let appIcon: CGFloat = 15 // 58×58 app tiles
    static let field: CGFloat = 15   // inputs
    static let fab: CGFloat = 22     // center NFC button
    static let sheet: CGFloat = 28   // bottom sheet top corners
    static let shield: CGFloat = 40  // focus-mode shield tile (128pt)
}

enum BaliSpacing {
    // 4px grid steps used across the design.
    static let xxs: CGFloat = 4
    static let xs: CGFloat = 6
    static let s: CGFloat = 8
    static let s10: CGFloat = 10
    static let m: CGFloat = 12
    static let m14: CGFloat = 14
    static let l: CGFloat = 16
    static let xl: CGFloat = 20
    static let xxl: CGFloat = 24
    static let xxxl: CGFloat = 32

    /// Horizontal screen padding (.screen-scroll padding-inline).
    static let screenH: CGFloat = 20
    /// Default card inner padding (.card-pad).
    static let cardPadding: CGFloat = 18
    /// Top inset for scroll content under the floating top bar.
    static let contentTop: CGFloat = 56
    /// Bottom inset that clears the tab bar (.screen-scroll padding-bottom).
    static let contentBottomTabbed: CGFloat = 112
    /// Bottom inset on screens without a tab bar.
    static let contentBottom: CGFloat = 40
    /// Tab bar height.
    static let tabBarHeight: CGFloat = 92
}
