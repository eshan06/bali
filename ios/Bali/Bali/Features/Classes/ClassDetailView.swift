//
//  ClassDetailView.swift
//  Bali — Class Detail (pushed)
//
//  A class's color-headed detail: the live session (check-in CTA → real NFC, or
//  a checked-in / resting state), attendance + sessions stats, the assigned
//  device + focus policy (→ policy preview), and recent sessions. Loads its
//  detail from AppModel on appear; the info button also opens the policy preview.
//

import SwiftUI

struct ClassDetailView: View {
    let classId: String
    @Environment(AppModel.self) private var model
    @Environment(AppRouter.self) private var router

    private var detail: StudentClassDetail? { model.detail(for: classId) }
    private var summary: StudentClassSummary? { model.classes.first { $0.id == classId } }
    private var color: Color { ClassColor.accent(for: classId) }

    var body: some View {
        DetailScaffold(trailingIcon: "info.circle") {
            router.push(.focusPolicyPreview(classId: classId))
        } content: {
            header
            sessionCard
            statRow
            devicePolicyCard
            recentSessions
        }
        .task { await model.loadDetail(classId: classId) }
    }

    // MARK: - Header

    private var header: some View {
        let name = detail?.classInfo.name ?? summary?.name ?? "Class"
        let period = detail?.classInfo.period ?? summary?.period
        let teacher = detail?.classInfo.teacherName ?? summary?.teacherName
        let school = detail?.classInfo.schoolName ?? summary?.schoolName
        return VStack(alignment: .leading, spacing: 10) {
            if let period { BaliText(period.uppercased(), .eyebrow, color: .white.opacity(0.85)) }
            BaliText(name, .h1, color: .white)
            HStack(spacing: BaliSpacing.l) {
                if let teacher { headerMeta("person.fill", teacher) }
                if let school { headerMeta("graduationcap.fill", school) }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            BaliGradient.classHeader(color).overlay(alignment: .topTrailing) {
                Circle().fill(Color.white.opacity(0.10))
                    .frame(width: 170, height: 170).offset(x: 60, y: -54)
            }
        )
        .clipShape(RoundedRectangle(cornerRadius: BaliRadius.lg, style: .continuous))
        .baliShadow(.card)
    }

    private func headerMeta(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 12, weight: .semibold))
            Text(text).font(BaliFont.at(13, 500))
        }
        .foregroundStyle(.white.opacity(0.88))
    }

    // MARK: - Session

    @ViewBuilder private var sessionCard: some View {
        if let session = detail?.activeSession {
            liveSessionCard(session)
        } else {
            restingSessionCard
        }
    }

    private func liveSessionCard(_ session: StudentActiveSessionInfo) -> some View {
        let isChecked = session.checkedIn || model.locallyCheckedIn.contains(session.id)
        let seat = model.presentation(for: classId).seat
        return Card(bordered: true, borderColor: BaliColor.blue.opacity(0.5)) {
            VStack(alignment: .leading, spacing: BaliSpacing.m) {
                HStack {
                    Badge(text: isChecked ? "CHECKED IN" : "SESSION LIVE",
                          tone: isChecked ? .green : .blue, showsDot: true, pulse: !isChecked)
                    Spacer(minLength: 0)
                    BaliText("Started \(BaliFormat.timeOfDay(session.startedAt))", .foot)
                }
                if isChecked {
                    BaliText("You're checked in", .h3)
                    BaliText("Focus Mode is active for this session.", .body)
                    BaliButton(title: "View Focus Mode", icon: "shield.fill", variant: .dark) {
                        router.selectTab(.focus)
                    }
                } else {
                    BaliText(seat.map { "Check in at \($0)" } ?? "Check in", .h3)
                    BaliText("Tap your Bali block to mark yourself present and start Focus Mode.", .body)
                    BaliButton(title: "Tap to check in", icon: "dot.radiowaves.left.and.right") {
                        router.startCheckIn(classId: classId)
                    }
                }
            }
        }
    }

    private var restingSessionCard: some View {
        Card {
            HStack(spacing: BaliSpacing.m14) {
                IconTile(systemImage: "calendar", tone: .gray)
                VStack(alignment: .leading, spacing: 3) {
                    BaliText("No active session", .bodyStrong)
                    BaliText(model.presentation(for: classId).nextLabel
                                ?? "We'll notify you when class starts.", .foot)
                }
                Spacer(minLength: 0)
            }
        }
    }

    // MARK: - Stats

    private var statRow: some View {
        let att = detail?.attendance
        let fraction = att?.fraction ?? summary?.attendanceFraction ?? 0
        return HStack(spacing: BaliSpacing.m) {
            Card {
                VStack(spacing: BaliSpacing.m) {
                    AttendanceRing(progress: fraction, color: color, size: 64, lineWidth: 6)
                    BaliText("Attendance", .foot)
                }
                .frame(maxWidth: .infinity)
            }
            Card {
                VStack(spacing: 4) {
                    BaliText("\(att?.present ?? 0)", .h1, color: BaliColor.blue)
                    BaliText("of \(att?.total ?? 0) sessions present", .foot)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: - Device + policy

    private var devicePolicyCard: some View {
        let policyTitle = (model.presentation(for: classId).policy
                            ?? detail?.activeSession?.blockingSnapshot)?.preset.title ?? "Not set"
        return Card(padding: 0) {
            VStack(spacing: 0) {
                HStack(spacing: BaliSpacing.m14) {
                    IconTile(systemImage: "iphone", tone: .blue)
                    VStack(alignment: .leading, spacing: 2) {
                        BaliText("Assigned device", .foot)
                        BaliText(detail?.device?.friendlyName ?? "Not linked", .bodyStrong)
                    }
                    Spacer(minLength: 0)
                    if detail?.device != nil { Badge(text: "Linked", tone: .green, showsDot: true) }
                }
                .padding(16)

                Rectangle().fill(BaliColor.line).frame(height: 1).padding(.leading, 16)

                Button { router.push(.focusPolicyPreview(classId: classId)) } label: {
                    HStack(spacing: BaliSpacing.m14) {
                        IconTile(systemImage: "lock.fill", tone: .ink)
                        VStack(alignment: .leading, spacing: 2) {
                            BaliText("Focus policy", .foot)
                            BaliText(policyTitle, .bodyStrong)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(BaliColor.ink4)
                    }
                    .padding(16)
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Recent sessions

    private var recentSessions: some View {
        VStack(alignment: .leading, spacing: BaliSpacing.m) {
            BaliText("Recent sessions", .h3)
            if let sessions = detail?.recentSessions, !sessions.isEmpty {
                Card(padding: 0) {
                    VStack(spacing: 0) {
                        ForEach(sessions) { s in
                            sessionRow(s)
                            if s.id != sessions.last?.id {
                                Rectangle().fill(BaliColor.line).frame(height: 1).padding(.leading, 16)
                            }
                        }
                    }
                }
            } else {
                Card { BaliText("No sessions yet.", .foot) }
            }
        }
    }

    private func sessionRow(_ s: StudentSessionHistoryEntry) -> some View {
        HStack(spacing: BaliSpacing.m) {
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(tone(s.status).dot)
                .frame(width: 12, height: 12)
            BaliText(BaliFormat.dayLabel(s.startedAt), .bodyStrong)
            Spacer(minLength: 0)
            BaliText(BaliFormat.timeOfDay(s.checkInAt ?? s.startedAt), .foot)
            Badge(text: s.status.label, tone: tone(s.status))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private func tone(_ status: AttendanceStatus) -> BaliTone {
        switch status {
        case .present: return .green
        case .late:    return .amber
        case .absent:  return .coral
        case .excused: return .gray
        }
    }
}

#Preview {
    NavigationStack { ClassDetailView(classId: "cls-bio") }
        .injectBaliEnvironment(.preview())
}
