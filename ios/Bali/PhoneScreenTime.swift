import BaliOutbox
@preconcurrency import DeviceActivity
@preconcurrency import FamilyControls
import Foundation
@preconcurrency import ManagedSettings

/// Screen Time on this phone (B5), for the enforcer: the app's one `ManagedSettingsStore`, named so
/// the extensions open the same store, Family Controls' `.individual` authorization, and the
/// DeviceActivity window that wakes the monitor (B5b). Thin on purpose: what to shield, and when,
/// is `Enforcer`'s, tested on Linux.
@MainActor
final class PhoneScreenTime: ScreenTime {
    private let store = ManagedSettingsStore(named: .bali)

    func isShielding() -> Bool {
        store.shield.applicationCategories != nil && store.shield.webDomainCategories != nil
    }

    /// Every app and website a third party can block — no picker, no allow-list (2026-09-24). iOS
    /// itself keeps calls, FaceTime, Messages and Emergency SOS working.
    func shield() {
        store.shield.applicationCategories = .all()
        store.shield.webDomainCategories = .all()
    }

    func unshield() {
        store.shield.applicationCategories = nil
        store.shield.webDomainCategories = nil
    }

    func permission() -> Permission {
        let read: Permission =
            switch AuthorizationCenter.shared.authorizationStatus {
            case .approved: .approved
            case .denied: .denied
            default: .notDetermined
            }
        #if DEBUG
            Self.timed(read)
        #endif
        return read
    }

    /// iOS's own prompt; what it threw in the screen's words (C1b).
    func requestPermission() async throws {
        do {
            #if DEBUG
                try await Self.timedAsk()
            #else
                try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            #endif
        } catch {
            throw ScreenTimeAskError(familyControls: error)
        }
    }

    func schedule(_ window: DateInterval?) throws { try Bell.register(window) }

    func monitorUnscheduled() -> Date? { Bell.monitorUnscheduled }

    func marker() -> Marker { Marker.now }
    func writeMarker() { Marker.write() }
    func markerLostAt() -> Date? { Marker.lostAt }
}

#if DEBUG
    /// #144's device check, for the Debug readout: the marker, the asks of iOS — the silent check's
    /// among them — and the signals as iOS gives them now.
    extension PhoneScreenTime {
        /// Each ask of iOS for the access, newest first, three kept: when, what iOS answered, and
        /// how long it took. One no press made is the enforcer's silent check (F1b).
        static var asks: [String] = []

        /// iOS asked, as `requestPermission` asks it, and its answer logged in `asks`.
        static func timedAsk() async throws {
            let (asked, at) = (ContinuousClock.now, time(Date()))
            do {
                try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
                asks = Bell.logged("\(at) · given in \(ContinuousClock.now - asked)", in: asks)
            } catch {
                asks = Bell.logged("\(at) · \(error) in \(ContinuousClock.now - asked)", in: asks)
                throw error
            }
        }

        /// The marker (F1b): there, gone, or none written yet — and the monitor's note.
        static var markerNow: String {
            let note = Marker.lostAt.map { "the monitor found it gone at \(time($0))" } ?? "no note"
            return switch Marker.now {
            case .unwritten: "none written yet · \(note)"
            case .present: "present · \(note)"
            case .missing: "MISSING — access taken back · \(note)"
            }
        }

        /// Family Controls' read now — which a running app keeps after the access is taken back —
        /// and the window iOS's center holds under each of Bali's names.
        static var signals: String {
            let center = DeviceActivityCenter()
            let held = Bell.Name.allCases.map { name in
                "\(name) \(center.heldEnd(name).flatMap(Calendar.current.date(from:)).map(time) ?? "none")"
            }
            return "Family Controls reads \(AuthorizationCenter.shared.authorizationStatus)"
                + " · iOS holds " + held.joined(separator: ", ")
        }

        static func time(_ date: Date) -> String { date.formatted(date: .omitted, time: .standard) }

        /// #145's device check: when Family Controls was first read since this launch, by how long
        /// the phone has run, and how long after it a read first said other than not determined,
        /// and what — the moment `Enforcer.grace` must outlast on a phone whose access is on.
        private static var firstRead: TimeInterval?
        private static var settled: (after: TimeInterval, read: Permission)?

        static func timed(_ read: Permission) {
            let now = ProcessInfo.processInfo.systemUptime
            let first = firstRead ?? now
            firstRead = first
            if settled == nil, read != .notDetermined { settled = (now - first, read) }
        }

        /// The readout's `Launch:` line: how long Family Controls read not determined after this
        /// launch — or so far, judged off once it lasts the grace.
        static var launch: String {
            guard let firstRead else { return "not read yet" }
            guard let settled else {
                let so = ProcessInfo.processInfo.systemUptime - firstRead
                return "not determined for \(seconds(so)) so far — off at \(seconds(Enforcer.grace))"
            }
            return settled.after == 0
                ? "\(settled.read) at the first read"
                : "not determined for \(seconds(settled.after)), then \(settled.read)"
        }

        static func seconds(_ span: TimeInterval) -> String { String(format: "%.1f s", span) }
    }
#endif

extension ScreenTimeAskError {
    /// Family Controls' error from the ask, in the screen's words: Don't Allow — the permission
    /// reads denied then — is `cancelled`; anything else `failed`, what iOS said kept for the
    /// readout (C1b).
    init(familyControls error: any Error) {
        if case .authorizationCanceled? = error as? FamilyControlsError {
            self = .cancelled
        } else {
            self = .failed("\(error)")
        }
    }
}
