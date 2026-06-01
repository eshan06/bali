//
//  NotificationsView.swift
//  Bali — Notifications (pushed)
//
//  The local notifications feed (4 event types) with unread dots, relative
//  times, and "Mark read". Derived locally — there's no server notifications
//  endpoint (§9.7). Events also post local notifications via NotificationManager.
//

import SwiftUI

struct NotificationsView: View {
    @Environment(AppModel.self) private var model
    @Environment(NotificationManager.self) private var notifications
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BaliSpacing.l) {
                BaliText("Notifications", .display)
                if notifications.feed.isEmpty {
                    emptyState
                } else {
                    ForEach(notifications.feed) { row($0) }
                    BaliText("You're all caught up.", .foot)
                        .frame(maxWidth: .infinity)
                        .padding(.top, BaliSpacing.xs)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, BaliSpacing.screenH)
            .padding(.top, 104)
            .padding(.bottom, BaliSpacing.contentBottom)
        }
        .scrollIndicators(.hidden)
        .background(BaliColor.bg.ignoresSafeArea())
        .overlay(alignment: .top) { topBar }
        .task { notifications.refresh(from: model) }
    }

    private var topBar: some View {
        HStack {
            IconButton(systemImage: "chevron.left") { dismiss() }
            Spacer()
            if notifications.unreadCount > 0 {
                Button { notifications.markAllRead() } label: {
                    Text("Mark read")
                        .font(BaliFont.at(14, 650))
                        .foregroundStyle(BaliColor.ink)
                        .padding(.horizontal, 16)
                        .frame(height: 38)
                        .background(BaliColor.surface)
                        .clipShape(Capsule())
                        .baliShadow(.card)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, BaliSpacing.l)
        .padding(.top, BaliSpacing.contentTop)
    }

    private func row(_ notification: StudentNotification) -> some View {
        let v = visual(notification.kind)
        return Card {
            HStack(alignment: .top, spacing: BaliSpacing.m14) {
                IconTile(systemImage: v.icon, tone: v.tone)
                VStack(alignment: .leading, spacing: 3) {
                    BaliText(notification.title, .bodyStrong)
                    BaliText(notification.message, .foot)
                }
                Spacer(minLength: BaliSpacing.s)
                VStack(alignment: .trailing, spacing: 6) {
                    BaliText(terse(notification.date), .foot)
                    if notification.isUnread {
                        Circle().fill(BaliColor.blue).frame(width: 8, height: 8)
                    }
                }
            }
        }
    }

    private var emptyState: some View {
        Card {
            VStack(spacing: BaliSpacing.m) {
                IconTile(systemImage: "bell.fill", tone: .blue, size: 48, glyphSize: 20)
                BaliText("No notifications yet", .h3)
                BaliText("Class, check-in, and Focus Mode alerts show up here.", .foot)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, BaliSpacing.s)
        }
    }

    private func visual(_ kind: NotificationKind) -> (icon: String, tone: BaliTone) {
        switch kind {
        case .classStarted: return ("dot.radiowaves.left.and.right", .blue)
        case .focusActive:  return ("shield.fill", .blue)
        case .checkedIn:    return ("checkmark.seal.fill", .green)
        case .sessionEnded: return ("lock.fill", .blue)
        }
    }

    private func terse(_ date: Date, now: Date = Date()) -> String {
        let seconds = now.timeIntervalSince(date)
        if seconds < 60 { return "now" }
        if seconds < 3600 { return "\(Int(seconds / 60))m" }
        if seconds < 86400 { return "\(Int(seconds / 3600))h" }
        return "\(Int(seconds / 86400))d"
    }
}

#Preview {
    NavigationStack { NotificationsView() }
        .injectBaliEnvironment(.preview())
}
