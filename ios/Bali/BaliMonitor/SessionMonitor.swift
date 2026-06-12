//
//  SessionMonitor.swift — DeviceActivity monitor extension. When the session
//  window ends and the app isn't alive to hear the bell, this clears the
//  shields anyway. Shields must never outlive the session.
//

import DeviceActivity
import Foundation
import ManagedSettings

class SessionMonitor: DeviceActivityMonitor {
    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        let store = ManagedSettingsStore()
        store.shield.applicationCategories = nil
        store.shield.applications = nil
        store.shield.webDomainCategories = nil
        store.shield.webDomains = nil
        UserDefaults(suiteName: "group.com.bali.shared")?.removeObject(forKey: "shield.teacher")
        UserDefaults(suiteName: "group.com.bali.shared")?.removeObject(forKey: "shield.endsAt")
    }
}
