//
//  BlockingSnapshot.swift
//  Bali — models
//
//  Mirrors `BlockingSnapshot` (packages/shared/src/blocking-snapshot.ts): the
//  immutable, session-frozen blocking policy the server resolves at session
//  start. Bundle IDs / app names here RENDER the policy; iOS enforces via opaque
//  FamilyControls tokens (Phase 7), not these IDs. Unknown preset/mode strings
//  decode to safe fallbacks so a future server value never breaks a screen.
//

import Foundation

nonisolated enum BlockingPreset: String, Codable, Equatable, CaseIterable {
    case none = "none"
    case fullFocus = "full_focus"
    case noSocialMedia = "no_social_media"
    case noGames = "no_games"
    case custom = "custom"

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = BlockingPreset(rawValue: raw) ?? .custom
    }

    var title: String {
        switch self {
        case .none:          return "No Blocking"
        case .fullFocus:     return "Full Focus"
        case .noSocialMedia: return "No Social Media"
        case .noGames:       return "No Games"
        case .custom:        return "Custom"
        }
    }

    /// One-line description used on policy previews / class detail.
    var summary: String {
        switch self {
        case .none:          return "Apps stay unlocked during this class."
        case .fullFocus:     return "Everything but a few essentials is paused."
        case .noSocialMedia: return "Social apps are paused during class."
        case .noGames:       return "Games are paused during class."
        case .custom:        return "A custom set of apps is paused."
        }
    }

    /// SF Symbol for the policy tile / row.
    var icon: String {
        switch self {
        case .none:          return "lock.open.fill"
        case .fullFocus:     return "moon.fill"
        case .noSocialMedia: return "bubble.left.and.bubble.right.fill"
        case .noGames:       return "gamecontroller.fill"
        case .custom:        return "slider.horizontal.3"
        }
    }
}

nonisolated enum BlockingMode: String, Codable, Equatable {
    case blockSpecific = "block_specific"
    case blockAllExcept = "block_all_except"

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = BlockingMode(rawValue: raw) ?? .blockSpecific
    }
}

nonisolated struct BlockingAppEntry: Codable, Equatable, Identifiable, Hashable {
    let bundleId: String
    let appName: String
    var id: String { bundleId }
}

nonisolated struct BlockingSnapshot: Codable, Equatable {
    let preset: BlockingPreset
    let mode: BlockingMode
    let blockingActive: Bool
    let blockedApps: [BlockingAppEntry]
    let allowedApps: [BlockingAppEntry]

    /// "No blocking" fallback (mirrors INACTIVE_BLOCKING_SNAPSHOT).
    static let inactive = BlockingSnapshot(
        preset: .none, mode: .blockSpecific,
        blockingActive: false, blockedApps: [], allowedApps: []
    )

    /// True for an allow-list policy (Full Focus): the meaningful list is the
    /// *allowed* apps; everything else is paused.
    var isAllowList: Bool { mode == .blockAllExcept }

    /// The apps worth showing in the UI for this policy.
    var displayApps: [BlockingAppEntry] {
        isAllowList ? allowedApps : blockedApps
    }
}
