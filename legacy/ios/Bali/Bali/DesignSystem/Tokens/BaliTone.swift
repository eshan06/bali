//
//  BaliTone.swift
//  Bali — design system
//
//  The shared "tone" palette used by badges and icon tiles: a tinted background
//  paired with a darker foreground. One enum keeps Badge and IconTile in sync.
//

import SwiftUI

enum BaliTone {
    case blue, green, amber, coral, ink, violet, gray

    /// Tinted background (badge / tile fill).
    var tint: Color {
        switch self {
        case .blue:   return BaliColor.blueTint
        case .green:  return BaliColor.greenTint
        case .amber:  return BaliColor.amberTint
        case .coral:  return BaliColor.coralTint
        case .ink:    return BaliColor.ink
        case .violet: return BaliColor.violet.opacity(0.14)
        case .gray:   return BaliColor.badgeGrayBg
        }
    }

    /// Solid accent (icon-tile glyph color).
    var solid: Color {
        switch self {
        case .blue:   return BaliColor.blue
        case .green:  return BaliColor.green
        case .amber:  return BaliColor.amber
        case .coral:  return BaliColor.coral
        case .ink:    return .white
        case .violet: return BaliColor.violet
        case .gray:   return BaliColor.ink3
        }
    }

    /// Darker text used on a tinted badge background.
    var badgeText: Color {
        switch self {
        case .blue:   return BaliColor.badgeBlueText
        case .green:  return BaliColor.badgeGreenText
        case .amber:  return BaliColor.badgeAmberText
        case .coral:  return BaliColor.badgeCoralText
        case .ink:    return .white
        case .violet: return BaliColor.violet
        case .gray:   return BaliColor.ink3
        }
    }

    /// The status dot color for this tone.
    var dot: Color {
        switch self {
        case .blue:   return BaliColor.blue
        case .green:  return BaliColor.green
        case .amber:  return BaliColor.amber
        case .coral:  return BaliColor.coral
        case .ink:    return BaliColor.ink
        case .violet: return BaliColor.violet
        case .gray:   return BaliColor.ink4
        }
    }
}
