import SwiftUI

// S8 wire models (GET /v1/student/history)
struct StudentHistory: Codable {
    var week: [Int]
    var streakDays: Int
    var sessions: [HistorySession]
}

struct HistorySession: Codable, Identifiable {
    var sessionId: String
    var className: String
    var date: Date
    var focusedMinutes: Int
    var unlockCount: Int
    var timeline: [EventItem]
    var live: Bool
    var id: String { sessionId }
}

struct EventItem: Codable, Identifiable {
    var id: String
    var type: String
    var at: Date
    var title: String
    var subtitle: String?
}

/// S8 · History — personal-only: minutes this week, a quiet streak, sessions.
/// No class averages, no rank, nothing grades-adjacent. Unlocks are logged
/// factually, never flagged.
struct HistoryView: View {
    @EnvironmentObject private var auth: AuthStore
    @State private var history: StudentHistory?

    private let dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri"]

    var body: some View {
        ZStack {
            Tokens.Dark.page.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("History")
                        .font(.system(size: 34, weight: .bold))
                        .foregroundColor(Tokens.Dark.textPrimary)
                        .padding(.top, 12)

                    if let history {
                        weekCard(history)
                        if history.streakDays > 0 {
                            streakRow(history.streakDays)
                        }
                        if !history.sessions.isEmpty {
                            Text("SESSIONS")
                                .font(.system(size: 12, weight: .semibold))
                                .kerning(0.72)
                                .foregroundColor(Tokens.Dark.textTertiary)
                            VStack(spacing: 10) {
                                ForEach(history.sessions) { session in
                                    NavigationLink(value: session) {
                                        sessionRow(session)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        } else {
                            Text("Sessions appear here after your first focus.")
                                .font(.system(size: 14))
                                .foregroundColor(Tokens.Dark.textSecondary)
                        }
                    } else {
                        ProgressView().tint(Tokens.Dark.textSecondary)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 60)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 48)
            }
        }
        .preferredColorScheme(.dark)
        .navigationDestination(for: HistorySession.self) { session in
            SessionDetailView(session: session)
        }
        .task {
            history = try? await auth.api.get("student/history", as: StudentHistory.self)
        }
    }

    private func weekCard(_ history: StudentHistory) -> some View {
        let total = history.week.reduce(0, +)
        let todayIdx = (Calendar.current.component(.weekday, from: Date()) + 5) % 7
        return VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("This week")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(Tokens.Dark.textPrimary)
                Spacer()
                Text("\(total / 60)h \(total % 60)m focused")
                    .font(.system(size: 13).monospacedDigit())
                    .foregroundColor(Tokens.Dark.textSecondary)
            }
            VStack(spacing: 9) {
                ForEach(Array(dayNames.enumerated()), id: \.offset) { idx, day in
                    weekBar(
                        day: day,
                        mins: idx < history.week.count ? history.week[idx] : 0,
                        max: max(50, history.week.max() ?? 50),
                        today: idx == todayIdx
                    )
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Tokens.Dark.card)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func weekBar(day: String, mins: Int, max maxMins: Int, today: Bool) -> some View {
        HStack(spacing: 12) {
            Text(day)
                .font(.system(size: 12.5, weight: .medium))
                .foregroundColor(today ? Tokens.Dark.textPrimary : Tokens.Dark.textTertiary)
                .frame(width: 32, alignment: .leading)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Tokens.Dark.sunken)
                    if mins > 0 {
                        Capsule()
                            .fill(today ? Tokens.green400 : Tokens.green700)
                            .frame(width: max(8, geo.size.width * CGFloat(mins) / CGFloat(maxMins)))
                    }
                }
            }
            .frame(height: 10)
            Text(mins > 0 ? "\(mins)m" : "—")
                .font(.system(size: 12.5).monospacedDigit())
                .foregroundColor(Tokens.Dark.textTertiary)
                .frame(width: 42, alignment: .trailing)
        }
    }

    private func streakRow(_ days: Int) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "flame")
                .font(.system(size: 18))
                .foregroundColor(Tokens.green300)
            Text("\(days) school \(days == 1 ? "day" : "days") in a row with a full session")
                .font(.system(size: 15))
                .foregroundColor(Tokens.Dark.textPrimary)
            Spacer()
        }
        .padding(.horizontal, 16)
        .frame(height: 56)
        .background(Tokens.Dark.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func sessionRow(_ session: HistorySession) -> some View {
        let fmt = DateFormatter()
        fmt.dateFormat = "EEE"
        let sub = session.unlockCount > 0
            ? "\(session.focusedMinutes) min · \(session.unlockCount) \(session.unlockCount == 1 ? "unlock" : "unlocks")"
            : "\(session.focusedMinutes) min"
        return HStack {
            VStack(alignment: .leading, spacing: 1) {
                Text("\(fmt.string(from: session.date)) · \(session.className)")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Tokens.Dark.textPrimary)
                Text(session.live ? "live now" : sub)
                    .font(.system(size: 13))
                    .foregroundColor(Tokens.Dark.textTertiary)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Tokens.Dark.textTertiary)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Tokens.Dark.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .contentShape(Rectangle())
    }
}

extension HistorySession: Hashable {
    static func == (lhs: HistorySession, rhs: HistorySession) -> Bool { lhs.sessionId == rhs.sessionId }
    func hash(into hasher: inout Hasher) { hasher.combine(sessionId) }
}

/// S8 · Session detail — the student-side EventTimeline. Only the student sees this.
struct SessionDetailView: View {
    let session: HistorySession

    var body: some View {
        ZStack {
            Tokens.Dark.page.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    Text(dateLabel)
                        .font(.system(size: 28, weight: .bold))
                        .foregroundColor(Tokens.Dark.textPrimary)
                        .padding(.top, 8)
                    Text("\(session.className) · \(session.focusedMinutes) focused minutes")
                        .font(.system(size: 15))
                        .foregroundColor(Tokens.Dark.textSecondary)

                    VStack(spacing: 0) {
                        ForEach(Array(session.timeline.enumerated()), id: \.element.id) { idx, event in
                            timelineRow(event, isLast: idx == session.timeline.count - 1)
                        }
                    }
                    .padding(20)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Tokens.Dark.card)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .padding(.top, 20)

                    Text("Only you see this page. Teachers see session status, never this history.")
                        .font(.system(size: 13))
                        .foregroundColor(Tokens.Dark.textTertiary)
                        .padding(.top, 14)
                        .frame(maxWidth: 320, alignment: .leading)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 48)
            }
        }
        .preferredColorScheme(.dark)
    }

    private var dateLabel: String {
        let fmt = DateFormatter()
        fmt.dateFormat = "EEEE, MMMM d"
        return fmt.string(from: session.date)
    }

    private func timelineRow(_ event: EventItem, isLast: Bool) -> some View {
        let style = dotStyle(event.type)
        let fmt = DateFormatter()
        fmt.timeStyle = .short
        return HStack(alignment: .top, spacing: 10) {
            VStack(spacing: 0) {
                ZStack {
                    Circle().fill(style.bg).frame(width: 26, height: 26)
                    Image(systemName: style.icon)
                        .font(.system(size: 12))
                        .foregroundColor(style.fg)
                }
                if !isLast {
                    Rectangle().fill(Tokens.Dark.border).frame(width: 1).frame(minHeight: 14)
                }
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(event.title)
                    .font(.system(size: 14))
                    .foregroundColor(Tokens.Dark.textPrimary)
                if let subtitle = event.subtitle {
                    Text(subtitle)
                        .font(.system(size: 12.5))
                        .foregroundColor(Tokens.Dark.textSecondary)
                }
            }
            .padding(.top, 3)
            .padding(.bottom, isLast ? 0 : 14)
            Spacer()
            Text(fmt.string(from: event.at))
                .font(.system(size: 12.5, weight: .medium).monospacedDigit())
                .foregroundColor(Tokens.Dark.textTertiary)
                .padding(.top, 4)
        }
    }

    private func dotStyle(_ type: String) -> (icon: String, bg: Color, fg: Color) {
        switch type {
        case "tapped_in", "refocused", "session_started", "permission_restored":
            return ("checkmark.circle", Tokens.Dark.stateFocusedBg, Tokens.green300)
        case "pass_granted", "pass_ended":
            return ("ticket", Tokens.Dark.statePassBg, Tokens.blue300)
        case "emergency_unlock", "reason_shared":
            return ("lock.open", Tokens.Dark.stateEmergencyBg, Tokens.orange300)
        case "permission_revoked":
            return ("shield.slash", Tokens.Dark.stateRevokedBg, Tokens.red300)
        case "session_ended":
            return ("flag", Tokens.Dark.stateNeutralBg, Tokens.Dark.textSecondary)
        default:
            return ("circle", Tokens.Dark.stateNeutralBg, Tokens.Dark.textSecondary)
        }
    }
}
