//
//  ClassColor.swift
//  Bali — design system
//
//  Deterministic per-class accent color. Classes carry no color in the data
//  contract, so we derive a stable hue from the classId (same class → same
//  color every launch) for the card color bar, attendance ring, and avatar.
//

import SwiftUI

enum ClassColor {
    /// Distinct, on-brand accents drawn from the Bali palette. Six entries; the
    /// order is chosen so the sample roster's deterministic indices land on the
    /// design's hues (AP Biology → blue, World History → violet, Algebra → green).
    static let palette: [Color] = [
        BaliColor.blue,         // 0
        BaliColor.amber,        // 1
        BaliColor.violet,       // 2
        BaliColor.coral,        // 3
        BaliColor.green,        // 4
        Color(hex: "0EA5A5"),   // 5 — teal
    ]

    /// Stable accent for a class id (deterministic djb2 over UTF-8 — never the
    /// per-run-randomized `String.hashValue`).
    static func accent(for classId: String) -> Color {
        var hash: UInt64 = 5381
        for byte in classId.utf8 { hash = (hash &* 33) &+ UInt64(byte) }
        return palette[Int(hash % UInt64(palette.count))]
    }
}
