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
    /// Returns false when Screen Time authorization is missing — nothing was shielded,
    /// so the caller must not tell the student their apps are paused.
    func applyFullFocus() -> Bool
    func clearShields()
}

final class StubScreenTimeService: ScreenTimeService {
    private(set) var shieldsApplied = false
    var permissionOk: Bool { true }
    func requestAuthorization() async -> Bool { true }
    /// The Simulator has no ManagedSettings: NOTHING is shielded here. Returning true
    /// while leaving shieldsApplied false made the app claim `.focused`, write a durable
    /// marker and strand the next launch on a phone holding nothing — and the Simulator is
    /// where the slice is actually exercised. Failing here lands on `.statusOnly`, which is
    /// the truth: tapped in, reporting, nothing paused.
    func applyFullFocus() -> Bool { shieldsApplied = false; return false }
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

    /// How many picks full focus can actually honour. Activity tokens are opaque — a
    /// CATEGORY token cannot be expanded into the apps it covers — so `.all(except:)`
    /// only ever exempts app and web-domain tokens. Counting categories here would
    /// promise the student an exemption the shield can't keep.
    static func count(of selection: FamilyActivitySelection) -> Int {
        selection.applicationTokens.count + selection.webDomainTokens.count
    }

    /// Where the mirror below lives; the monitor extension reads this key.
    static let sharedKey = "shield.allowList.v1"

    /// Copy for the monitor extension, which runs in its own process and cannot read the
    /// app's UserDefaults. It needs the same exemptions to put the shields back at the end
    /// of a hall pass (see PassRestoreWatchdog); refreshed every time shields go up, so it
    /// is never staler than the selection the student is actually focusing under.
    static func mirrorForExtension(_ selection: FamilyActivitySelection?) {
        guard let selection, let data = try? JSONEncoder().encode(selection) else {
            SharedDefaults.store.removeObject(forKey: sharedKey)
            return
        }
        SharedDefaults.store.set(data, forKey: sharedKey)
    }
}

/// Device implementation. Full focus shields ALL app/web categories except the student's
/// one-time on-device allow-list. Phone can't be shielded by iOS at all — honesty the UI
/// states outright.
final class RealScreenTimeService: ScreenTimeService {
    private let store = ManagedSettingsStore()

    /// Persisted, never in-memory: the shields this flag describes live in ManagedSettings
    /// and survive suspension, force-quit and process death. An in-memory flag reports
    /// "nothing applied" after every relaunch while the phone is still shielded.
    private var applied: Bool {
        get { ShieldFlag.isSet }
        set { SharedDefaults.store.set(newValue, forKey: ShieldFlag.key) }
    }

    /// iOS drops the shields the instant Screen Time authorization goes away, so the
    /// stored flag on its own would lie — permission is part of the truth.
    var shieldsApplied: Bool { applied && permissionOk }

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

    func applyFullFocus() -> Bool {
        guard permissionOk else { return false }
        let selection = FocusAllowList.load()
        // Only app / web-domain tokens can be exempted (see count(of:)). With none of
        // them — no allow-list, skipped, or a category-only pick — the exception set is
        // empty and everything is shielded, which is what the count now tells the student.
        store.shield.applicationCategories = .all(except: selection?.applicationTokens ?? [])
        store.shield.webDomainCategories = .all(except: selection?.webDomainTokens ?? [])
        FocusAllowList.mirrorForExtension(selection)
        applied = true
        return true
    }

    func clearShields() {
        store.shield.applicationCategories = nil
        store.shield.applications = nil
        store.shield.webDomainCategories = nil
        store.shield.webDomains = nil
        applied = false
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

/// Pass restore that survives suspension. Bali declares no background modes, so during a
/// real hall pass it is suspended within seconds and an in-app timer does not fire until
/// the student next looks at the phone — while both UIs promise the shields come back on
/// their own. DeviceActivity is the only scheduler that runs with the app suspended or
/// dead, so this window is scheduled to START at the pass end: the monitor extension's
/// `intervalDidStart` is what puts the shields back.
///
/// The window ends at the bell where there is room for it. DeviceActivity rejects windows
/// under 15 minutes, and a 5-minute pass late in a 50-minute period is the COMMON case —
/// refusing to schedule there left "shields return automatically" as a promise only a
/// foregrounded app could keep, on the one path where the app is guaranteed to be in the
/// student's pocket. So the END is padded past the bell instead: `intervalDidStart` stops
/// this window the instant it restores (so its `intervalDidEnd` normally never fires), and
/// the monitor's `intervalDidEnd` now refuses to clear shields whose live marker belongs to
/// a session that has not ended — a padded end can never unshield a later period.
enum PassRestoreWatchdog {
    private static let activity = DeviceActivityName("bali.pass")
    private static let minimumWindow: TimeInterval = 15 * 60

    static func arm(passEndsAt: Date, sessionEndsAt: Date) {
        disarm()
        let end = max(sessionEndsAt, passEndsAt.addingTimeInterval(minimumWindow + 30))
        let cal = Calendar.current
        let comps: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute, .second]
        let schedule = DeviceActivitySchedule(
            intervalStart: cal.dateComponents(comps, from: passEndsAt),
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

enum PassRestoreWatchdog {
    static func arm(passEndsAt _: Date, sessionEndsAt _: Date) {}
    static func disarm() {}
}
#endif

/// Where everything that must outlive the process is written: the app group when the
/// entitlement is there (the shield screen and the monitor extension read it too), the
/// app's own defaults otherwise. Losing these facts loses the student's exit, so they
/// must survive even a build without the group.
enum SharedDefaults {
    static var store: UserDefaults { UserDefaults(suiteName: "group.com.bali.shared") ?? .standard }
}

/// The one flag BOTH processes write the moment shields actually go up or come down: this
/// app in applyFullFocus/clearShields, the monitor extension on a pass restore and at the
/// bell. Unlike ShieldMarker it is a plain Bool — no decode can fail — so it stays truthful
/// even when a marker is missing or malformed, which makes it the signal to trust when
/// asking "is this phone holding shields it must be able to let go of?".
enum ShieldFlag {
    static let key = "shield.applied"
    static var isSet: Bool { SharedDefaults.store.bool(forKey: key) }
}

/// What the S10 shield screen reads (separate process — shared via the app group).
/// Written when focus starts, cleared when shields drop.
enum ShieldContext {
    static func set(teacher: String, endsAt: Date) {
        SharedDefaults.store.set(teacher, forKey: "shield.teacher")
        SharedDefaults.store.set(endsAt.timeIntervalSince1970, forKey: "shield.endsAt")
    }

    static func clear() {
        SharedDefaults.store.removeObject(forKey: "shield.teacher")
        SharedDefaults.store.removeObject(forKey: "shield.endsAt")
    }
}

/// Durable proof that THIS phone is holding shields, and which session they belong to.
///
/// Shields live in ManagedSettings: they survive app suspension, force-quit and process
/// death. Nothing else in the app does. Without this marker a relaunched Bali that can no
/// longer see the session — offline, or the teacher removed the student — has no idea the
/// phone is shielded: it renders "Free", builds no engine, runs no heartbeat, and offers
/// no unlock, while the shield overlay still says "Emergency? Open Bali". THE STUDENT
/// ALWAYS HOLDS THE EXIT, so this is written the moment shields go up, cleared the moment
/// they come down, and reconciled at every launch (HomeModel.load).
enum ShieldMarker {
    struct Marker: Codable, Equatable {
        var sessionId: String
        var endsAt: Date
        /// Carried for display: the focus screen has to name the class and teacher even
        /// when the server cannot be reached to tell us who they are.
        var className: String
        var teacher: String
    }

    /// A marker that is not live yet. Written when a hall pass starts, because the shields
    /// are due back at `restoreAt` and by then this app may be suspended or dead — whoever
    /// gets there first (the in-app timer, the monitor extension, or the next launch) turns
    /// it into the live marker by actually applying the shields. Without it, shields that
    /// came back while the app was dead would be shields no relaunched app knows it holds.
    struct PendingRestore: Codable, Equatable {
        var marker: Marker
        var restoreAt: Date
    }

    private static let key = "shield.marker.v1"
    private static let pendingKey = "shield.marker.pending.v1"

    static var current: Marker? { decode(key) }
    static var pending: PendingRestore? { decode(pendingKey) }

    /// Anything this phone is holding or is about to hold.
    static var exists: Bool { current != nil || pending != nil }

    /// The marker whose shields this phone should be holding right now: the live one, or a
    /// pass restore whose moment has already passed.
    static func dueNow(_ now: Date = Date()) -> Marker? {
        if let current { return current }
        guard let pending, pending.restoreAt <= now else { return nil }
        return pending.marker
    }

    static func set(sessionId: String, endsAt: Date, className: String, teacher: String) {
        let marker = Marker(sessionId: sessionId, endsAt: endsAt, className: className, teacher: teacher)
        encode(marker, key)
        SharedDefaults.store.removeObject(forKey: pendingKey) // it is live now, not pending
    }

    static func setPending(sessionId: String, endsAt: Date, className: String, teacher: String, restoreAt: Date) {
        let marker = Marker(sessionId: sessionId, endsAt: endsAt, className: className, teacher: teacher)
        encode(PendingRestore(marker: marker, restoreAt: restoreAt), pendingKey)
    }

    static func clear() {
        SharedDefaults.store.removeObject(forKey: key)
        SharedDefaults.store.removeObject(forKey: pendingKey)
    }

    private static func decode<T: Decodable>(_ key: String) -> T? {
        guard let data = SharedDefaults.store.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    private static func encode(_ value: some Encodable, _ key: String) {
        guard let data = try? JSONEncoder().encode(value) else { return }
        SharedDefaults.store.set(data, forKey: key)
    }
}
