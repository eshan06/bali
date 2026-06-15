import Foundation
#if canImport(FamilyControls)
import FamilyControls
import ManagedSettings
#endif

/// Shield control behind a protocol — the proven legacy seam. Real implementation
/// uses FamilyControls/ManagedSettings (device + entitlement); the stub keeps the
/// Simulator slice honest (reports shieldsApplied=false, permissionOk=true).
protocol ScreenTimeService {
    /// Whether Screen Time authorization is currently granted.
    var permissionOk: Bool { get }
    /// Whether shields are actually applied right now.
    var shieldsApplied: Bool { get }
    func requestAuthorization() async -> Bool
    /// Full focus: shield everything except the student's one-time, on-device allow-list.
    func applyFullFocus()
    func clearShields()
}

final class StubScreenTimeService: ScreenTimeService {
    private(set) var shieldsApplied = false
    var permissionOk: Bool { true }
    func requestAuthorization() async -> Bool { true }
    func applyFullFocus() { shieldsApplied = false } // honest: nothing is shielded
    func clearShields() { shieldsApplied = false }
}

#if canImport(FamilyControls)
/// The student's one-time, on-device "always allowed" set (e.g. Camera, Notes,
/// Calculator), chosen ONCE at onboarding via the iOS picker. Stored only on this phone
/// — Bali never sees anyone's app list. Full focus shields everything except this set;
/// phone & Messages are unblockable on iOS regardless. There is no per-policy/per-class
/// picker anymore — this single selection applies to every session.
enum FocusAllowList {
    private static let key = "bali.focusAllowList.v1"

    static func load() -> FamilyActivitySelection? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
    }

    static func save(_ selection: FamilyActivitySelection) {
        UserDefaults.standard.set(try? JSONEncoder().encode(selection), forKey: key)
    }

    /// Whether the student has been through the one-time allow-list step (even if they
    /// chose nothing — an empty set is a valid "block everything" choice).
    static var isConfigured: Bool { UserDefaults.standard.object(forKey: key) != nil }

    /// How many things the student picked (apps + categories + sites).
    static func count(of selection: FamilyActivitySelection) -> Int {
        selection.applications.count + selection.categories.count + selection.webDomains.count
    }
}

/// Device implementation. Full focus shields ALL app/web categories except the student's
/// one-time on-device allow-list. Phone can't be shielded by iOS at all — honesty the UI
/// states outright.
final class RealScreenTimeService: ScreenTimeService {
    private let store = ManagedSettingsStore()
    private(set) var shieldsApplied = false

    var permissionOk: Bool {
        AuthorizationCenter.shared.authorizationStatus == .approved
    }

    func requestAuthorization() async -> Bool {
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            return true
        } catch {
            return false
        }
    }

    func applyFullFocus() {
        guard permissionOk else { return }
        if let selection = FocusAllowList.load(), FocusAllowList.count(of: selection) > 0 {
            store.shield.applicationCategories = .all(except: selection.applicationTokens)
            store.shield.webDomainCategories = .all(except: selection.webDomainTokens)
        } else {
            // No allow-list (chose nothing, or skipped): shield everything.
            store.shield.applicationCategories = .all()
            store.shield.webDomainCategories = .all()
        }
        shieldsApplied = true
    }

    func clearShields() {
        store.shield.applicationCategories = nil
        store.shield.applications = nil
        store.shield.webDomainCategories = nil
        store.shield.webDomains = nil
        shieldsApplied = false
    }
}
#endif

enum ScreenTime {
    /// Real on a device with the entitlement; stub everywhere else.
    static func make() -> ScreenTimeService {
        #if targetEnvironment(simulator)
        return StubScreenTimeService()
        #elseif canImport(FamilyControls)
        return RealScreenTimeService()
        #else
        return StubScreenTimeService()
        #endif
    }
}

#if canImport(DeviceActivity) && !targetEnvironment(simulator)
import DeviceActivity

/// Dead-app safety net: a DeviceActivity window whose `intervalDidEnd` (in the
/// BaliMonitor extension) clears shields even if Bali was killed mid-session.
/// The live engine still clears at the real bell; this is the backstop.
enum SessionWatchdog {
    private static let activity = DeviceActivityName("bali.session")

    static func arm(endsAt: Date) {
        let now = Date()
        // DeviceActivity rejects windows under 15 minutes — pad short (demo)
        // sessions; real periods exceed it and end exactly at the bell.
        let end = max(endsAt, now.addingTimeInterval(15 * 60 + 30))
        let cal = Calendar.current
        let comps: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute, .second]
        let schedule = DeviceActivitySchedule(
            intervalStart: cal.dateComponents(comps, from: now),
            intervalEnd: cal.dateComponents(comps, from: end),
            repeats: false
        )
        try? DeviceActivityCenter().startMonitoring(activity, during: schedule)
    }

    static func disarm() {
        DeviceActivityCenter().stopMonitoring([activity])
    }
}
#else
enum SessionWatchdog {
    static func arm(endsAt _: Date) {}
    static func disarm() {}
}
#endif

/// What the S10 shield screen reads (separate process — shared via the app group).
/// Written when focus starts, cleared when shields drop.
enum ShieldContext {
    private static var suite: UserDefaults? { UserDefaults(suiteName: "group.com.bali.shared") }

    static func set(teacher: String, endsAt: Date) {
        suite?.set(teacher, forKey: "shield.teacher")
        suite?.set(endsAt.timeIntervalSince1970, forKey: "shield.endsAt")
    }

    static func clear() {
        suite?.removeObject(forKey: "shield.teacher")
        suite?.removeObject(forKey: "shield.endsAt")
    }
}
