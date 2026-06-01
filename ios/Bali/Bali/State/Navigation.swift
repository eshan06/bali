//
//  Navigation.swift
//  Bali
//
//  The typed navigation vocabulary: tab roots, pushed detail routes, and modal
//  sheets. Keeping these as enums (not stringly-typed) gives compile-time-safe
//  navigation and lets each tab own an independent `[Route]` back stack.
//

import Foundation

/// The four tab roots. The center NFC button is an action, not a tab.
enum AppTab: Int, CaseIterable, Hashable {
    case home, classes, focus, profile

    /// Map a launch-arg / deep-link name to a tab (used by the DEBUG -baliTab aid).
    init?(name: String) {
        switch name.lowercased() {
        case "home":     self = .home
        case "classes":  self = .classes
        case "focus":    self = .focus
        case "profile":  self = .profile
        default:         return nil
        }
    }
}

/// Screens pushed onto a tab's navigation stack (slide in from the right).
enum Route: Hashable {
    case classDetail(classId: String)
    case focusPolicyPreview(classId: String)
    case join
    case settings
    case deviceInfo
    case notifications
}

#if DEBUG
extension Route {
    /// Map a launch-arg name to a route (used by the DEBUG -baliPush aid; the
    /// class routes target the sample live class).
    init?(debugName: String) {
        switch debugName.lowercased() {
        case "classdetail":   self = .classDetail(classId: "cls-bio")
        case "focuspolicy":   self = .focusPolicyPreview(classId: "cls-bio")
        case "join":          self = .join
        case "settings":      self = .settings
        case "deviceinfo":    self = .deviceInfo
        case "notifications": self = .notifications
        default:              return nil
        }
    }
}
#endif

/// Modal bottom sheets / overlays presented above the current screen.
enum SheetRoute: Identifiable, Hashable {
    /// NFC check-in. `classId` targets a specific class; nil = current/likely-live.
    case nfcCheckIn(classId: String?)
    case emergencyUnlock

    var id: String {
        switch self {
        case .nfcCheckIn(let classId): return "nfc-\(classId ?? "current")"
        case .emergencyUnlock: return "emergency"
        }
    }
}
