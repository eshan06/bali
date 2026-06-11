//
//  AppRouter.swift
//  Bali
//
//  Observable navigation state for the tabbed app: the selected tab, an
//  independent push stack per tab, the active modal sheet, and the
//  session-ended overlay. Views read this and call its helpers; nothing
//  navigates by reaching into another screen.
//

import SwiftUI

@MainActor
@Observable
final class AppRouter {
    var selectedTab: AppTab = .home

    init() {
        #if DEBUG
        // Verification aid: `simctl launch … -baliTab classes -baliPush settings`
        // opens a chosen tab and optionally pushes a detail route on launch
        // (paired with -baliAutologin). No effect on normal runs.
        let defaults = UserDefaults.standard
        if let raw = defaults.string(forKey: "baliTab"), let tab = AppTab(name: raw) {
            selectedTab = tab
        }
        if let pushName = defaults.string(forKey: "baliPush"), let route = Route(debugName: pushName) {
            push(route)
        }
        switch defaults.string(forKey: "baliSheet") {
        case "nfc":       sheet = .nfcCheckIn(classId: nil)
        case "emergency": sheet = .emergencyUnlock
        default:          break
        }
        #endif
    }

    // One push stack per tab so back history is preserved per tab.
    var homePath: [Route] = []
    var classesPath: [Route] = []
    var focusPath: [Route] = []
    var profilePath: [Route] = []

    /// The active modal sheet (NFC / emergency), if any.
    var sheet: SheetRoute?

    /// Set when the teacher ends the session, to show the Session Ended overlay.
    var sessionEndedClassName: String?

    // MARK: Derived

    /// True when a detail screen is pushed on the current tab — the custom tab
    /// bar hides on pushed screens (per the design).
    var isShowingDetail: Bool {
        !currentPath.isEmpty
    }

    private var currentPath: [Route] {
        switch selectedTab {
        case .home: return homePath
        case .classes: return classesPath
        case .focus: return focusPath
        case .profile: return profilePath
        }
    }

    // MARK: Intent helpers

    /// Push a route onto the current tab's stack.
    func push(_ route: Route, on tab: AppTab? = nil) {
        let target = tab ?? selectedTab
        switch target {
        case .home: homePath.append(route)
        case .classes: classesPath.append(route)
        case .focus: focusPath.append(route)
        case .profile: profilePath.append(route)
        }
    }

    /// Switch tabs; tapping the active tab again pops it to root.
    func selectTab(_ tab: AppTab) {
        if tab == selectedTab {
            popToRoot(tab)
        } else {
            selectedTab = tab
        }
    }

    func popToRoot(_ tab: AppTab) {
        switch tab {
        case .home: homePath.removeAll()
        case .classes: classesPath.removeAll()
        case .focus: focusPath.removeAll()
        case .profile: profilePath.removeAll()
        }
    }

    /// Start the NFC check-in flow for a class (nil = current/likely-live).
    func startCheckIn(classId: String? = nil) {
        sheet = .nfcCheckIn(classId: classId)
    }

    func binding(for tab: AppTab) -> Binding<[Route]> {
        switch tab {
        case .home: return Binding(get: { self.homePath }, set: { self.homePath = $0 })
        case .classes: return Binding(get: { self.classesPath }, set: { self.classesPath = $0 })
        case .focus: return Binding(get: { self.focusPath }, set: { self.focusPath = $0 })
        case .profile: return Binding(get: { self.profilePath }, set: { self.profilePath = $0 })
        }
    }
}
