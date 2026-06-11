//
//  FocusBucket.swift
//  Bali — services/focus
//
//  The teacher's session preset decides WHICH apps are shielded, but iOS only
//  shields opaque tokens the student picked (Apple hides app identities), and the
//  app can't introspect a single "all apps" selection to pull out "the social
//  ones". So the student labels apps PER BUCKET once; at session start
//  `applyShields` maps the preset to the matching bucket(s). Full Focus needs no
//  bucket — it shields `.all()` categories straight from the policy.
//
//  See ios/PLAN.md §11 + memory `ios-blocking-model`.
//

import Foundation

/// A labeled set of apps the student picks once, matched to a teacher preset.
nonisolated enum FocusBucket: String, CaseIterable, Identifiable {
    case social
    case games

    var id: String { rawValue }

    /// UserDefaults key for this bucket's persisted FamilyActivitySelection.
    var storageKey: String { "bali.focus.selection.\(rawValue)" }

    var title: String {
        switch self {
        case .social: return "Social media"
        case .games:  return "Games"
        }
    }

    /// Which teacher preset shields this bucket (setup-UI subtitle).
    var servesPolicy: String {
        switch self {
        case .social: return "Blocked during a No Social Media class"
        case .games:  return "Blocked during a No Games class"
        }
    }

    /// The iOS Screen Time category the student taps in the picker. The picker
    /// groups apps under these; shielding the category covers every app Apple
    /// classifies there (now and in the future), so no per-app curation needed.
    var categoryHint: String {
        switch self {
        case .social: return "Social Networking"
        case .games:  return "Games"
        }
    }

    var icon: String {
        switch self {
        case .social: return "bubble.left.and.bubble.right.fill"
        case .games:  return "gamecontroller.fill"
        }
    }

    /// The bucket(s) a session preset shields. Full Focus / allow-list shield
    /// `.all()` directly (no bucket); `custom` is a best-effort union of every
    /// bucket because an arbitrary teacher app list can't be mapped to tokens.
    static func buckets(for preset: BlockingPreset) -> [FocusBucket] {
        switch preset {
        case .noSocialMedia: return [.social]
        case .noGames:       return [.games]
        case .custom:        return FocusBucket.allCases
        case .none, .fullFocus: return []
        }
    }
}
