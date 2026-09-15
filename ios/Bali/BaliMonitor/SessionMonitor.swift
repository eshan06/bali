//
//  SessionMonitor.swift — DeviceActivity monitor extension. Shields live in
//  ManagedSettings and outlive the app, so anything that must happen to them on a
//  schedule has to happen HERE: Bali declares no background modes, and iOS suspends
//  it within seconds of the student pocketing the phone.
//
//  Two windows:
//    • bali.session — ends at the bell. Shields must never outlive the session.
//    • bali.pass    — STARTS when a hall pass expires. Putting the shields back is
//                     the promise both the student chip and the teacher's live page
//                     make ("shields return automatically"); the in-app timer alone
//                     cannot keep it for a suspended app.
//

import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings

private enum Shared {
    static let suite = "group.com.bali.shared"
    static let allowList = "shield.allowList.v1"
    static let applied = "shield.applied"
    static let teacher = "shield.teacher"
    static let endsAt = "shield.endsAt"
    static let marker = "shield.marker.v1"
    static let pendingMarker = "shield.marker.pending.v1"

    static var store: UserDefaults? { UserDefaults(suiteName: suite) }
}

private let passActivity = DeviceActivityName("bali.pass")

/// The app's ShieldMarker shapes, mirrored — this process cannot import the app target.
/// The two keys hold DIFFERENT shapes: `shield.marker.pending.v1` wraps the marker in
/// {marker, restoreAt}, `shield.marker.v1` IS the marker. Copying the raw bytes across
/// wrote a live marker the app cannot decode, so after an extension-driven restore the
/// phone was genuinely shielded while every marker read came back empty — no focus screen,
/// no emergency unlock, until the bell. Both sides use default JSONEncoder/JSONDecoder
/// (Date = seconds since the 2001 reference date), so re-encoding here round-trips exactly.
private struct MonitorMarker: Codable {
    var sessionId: String
    var endsAt: Date
    var className: String
    var teacher: String
}

private struct MonitorPendingRestore: Codable {
    var marker: MonitorMarker
    var restoreAt: Date
}

class SessionMonitor: DeviceActivityMonitor {
    /// The hall pass is over. Re-apply the same full-focus policy the app applies, using
    /// the allow-list the app mirrors into the group container on every shield-up — this
    /// process cannot read the app's own defaults or its FamilyActivitySelection.
    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        guard activity == passActivity else { return }

        // Everything below hangs off the marker the app parked when the pass began. Shields
        // we cannot hand back to the app are shields NOBODY owns: no launch of Bali would
        // know this phone is shielded, so it would render no focus screen and no emergency
        // unlock. No marker (or one whose bell has already rung) means we do not shield.
        guard let pendingData = Shared.store?.data(forKey: Shared.pendingMarker),
              let pending = try? JSONDecoder().decode(MonitorPendingRestore.self, from: pendingData),
              pending.marker.endsAt > Date(),
              let promoted = try? JSONEncoder().encode(pending.marker)
        else {
            Shared.store?.removeObject(forKey: Shared.pendingMarker)
            DeviceActivityCenter().stopMonitoring([activity])
            return
        }

        var selection = FamilyActivitySelection()
        if let data = Shared.store?.data(forKey: Shared.allowList),
           let decoded = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) {
            selection = decoded
        }
        let store = ManagedSettingsStore()
        // Identical to RealScreenTimeService.applyFullFocus: `.all(except:)` honours app and
        // web-domain tokens only — category tokens are opaque and cannot be exempted.
        store.shield.applicationCategories = .all(except: selection.applicationTokens)
        store.shield.webDomainCategories = .all(except: selection.webDomainTokens)
        Shared.store?.set(true, forKey: Shared.applied)

        // Promote the pending marker — RESHAPED into the live marker's own shape, not
        // copied — so a relaunch knows this phone is holding shields again.
        Shared.store?.set(promoted, forKey: Shared.marker)
        Shared.store?.removeObject(forKey: Shared.pendingMarker)

        // dropShields() cleared these when the pass began and only the app rewrites them,
        // so without this the shield overlay reads "Focused with your class" with no end
        // time for the rest of the period. BaliShield reads shield.endsAt as seconds since
        // 1970; a Codable Date is seconds since 2001, hence the conversion.
        Shared.store?.set(pending.marker.teacher, forKey: Shared.teacher)
        Shared.store?.set(pending.marker.endsAt.timeIntervalSince1970, forKey: Shared.endsAt)

        // bali.session already clears at the bell, and this window may now be padded past
        // it to meet the 15-minute minimum. Stop it here so its intervalDidEnd normally
        // never fires at all.
        DeviceActivityCenter().stopMonitoring([activity])
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        // Both windows can outlive the session they were armed for: bali.session pads short
        // (demo) sessions up to the 15-minute minimum, and bali.pass pads for a pass that
        // ends near the bell. A live marker whose session has NOT ended means a LATER period
        // (or an extended one) owns these shields, and clearing them would unshield a whole
        // class mid-lesson. The 5-minute slack is deliberately generous: anything closer than
        // that to the bell clears, because a wrong answer there only costs focus, while a
        // wrong answer the other way leaves shields no one is scheduled to lift.
        if let data = Shared.store?.data(forKey: Shared.marker),
           let marker = try? JSONDecoder().decode(MonitorMarker.self, from: data),
           marker.endsAt > Date().addingTimeInterval(5 * 60) {
            return
        }
        let store = ManagedSettingsStore()
        store.shield.applicationCategories = nil
        store.shield.applications = nil
        store.shield.webDomainCategories = nil
        store.shield.webDomains = nil
        // The flag and the markers describe shields that no longer exist. Leaving them set
        // makes the next launch believe this phone is still shielded.
        Shared.store?.set(false, forKey: Shared.applied)
        Shared.store?.removeObject(forKey: Shared.marker)
        Shared.store?.removeObject(forKey: Shared.pendingMarker)
        Shared.store?.removeObject(forKey: Shared.teacher)
        Shared.store?.removeObject(forKey: Shared.endsAt)
    }
}
