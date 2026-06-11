//
//  NotificationManager.swift
//  Bali — services/notifications
//
//  Local notifications + the in-app feed for the four event types (class started,
//  checked in, blocking applied / focus active, session ended). There's no
//  student notifications endpoint (§9.7), so the feed is derived locally and
//  events post local notifications via UNUserNotificationCenter — APNs-ready
//  behind `notify(...)` (a real push would replace the local schedule).
//

import SwiftUI
import UserNotifications

nonisolated enum NotificationKind: Equatable {
    case classStarted, focusActive, checkedIn, sessionEnded
}

nonisolated struct StudentNotification: Identifiable, Equatable {
    let id = UUID()
    let kind: NotificationKind
    let title: String
    let message: String
    let date: Date
    var isUnread: Bool
}

@MainActor
@Observable
final class NotificationManager {
    private(set) var feed: [StudentNotification] = []

    var unreadCount: Int { feed.lazy.filter(\.isUnread).count }

    /// Seed the feed from the current dashboard state (once). Local MVP — there's
    /// no server notifications list (§9.7).
    func refresh(from model: AppModel) {
        guard feed.isEmpty else { return }
        feed = Self.derive(from: model)
    }

    func markAllRead() {
        feed = feed.map { var item = $0; item.isUnread = false; return item }
    }

    /// Ask for local-notification permission (used by onboarding "Allow access").
    func requestAuthorization() async {
        _ = try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound, .badge])
    }

    /// Record + post a local notification for an event (APNs-ready seam).
    func notify(_ kind: NotificationKind, title: String, message: String) {
        let item = StudentNotification(kind: kind, title: title, message: message,
                                       date: Date(), isUnread: true)
        feed.insert(item, at: 0)

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = message
        content.sound = .default
        let request = UNNotificationRequest(identifier: item.id.uuidString, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    // MARK: - Derived feed

    private static func derive(from model: AppModel) -> [StudentNotification] {
        let now = Date()
        var items: [StudentNotification] = []

        if let live = model.liveClass {
            if model.isCheckedIn(live) {
                items.append(StudentNotification(
                    kind: .focusActive, title: "Focus Mode is active",
                    message: "Apps unlock when \(live.teacherName) ends the session.",
                    date: now, isUnread: true))
            } else {
                items.append(StudentNotification(
                    kind: .classStarted, title: "\(live.name) started",
                    message: "Tap your Bali block to check in.",
                    date: now, isUnread: true))
            }
        }

        // Recent activity from the other classes (local MVP — §9.7).
        let others = model.classes.filter { $0.id != model.liveClass?.id }
        if let c = others.first {
            items.append(StudentNotification(
                kind: .checkedIn, title: "Checked in on time",
                message: "\(c.name) · 11:14 AM yesterday",
                date: now.addingTimeInterval(-25 * 3600), isUnread: false))
        }
        if others.count > 1 {
            let c = others[1]
            items.append(StudentNotification(
                kind: .sessionEnded, title: "Apps are available again",
                message: "\(c.name) session ended.",
                date: now.addingTimeInterval(-26 * 3600), isUnread: false))
        }

        return items
    }
}
