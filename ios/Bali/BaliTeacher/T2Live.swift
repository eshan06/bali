import SwiftUI

/// T2 · Live grid (phone, walking the room) — compact header, summary chips,
/// 2-column 46pt phone-chips, 5s poll. Emergency toast slides under the header
/// (sticky); the student's chip gets one soft pulse, never infinite blinking.
struct T2LiveView: View {
    let classId: String
    let sessionId: String
    var onClosed: () -> Void

    @EnvironmentObject private var store: TeacherStore
    @State private var detail: TSessionDetail?
    @State private var now = Date()
    @State private var selected: TParticipant?
    @State private var confirmEnd = false
    @State private var toast: ToastInfo?
    @State private var pulseStudentId: String?
    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    struct ToastInfo: Equatable {
        var studentId: String
        var title: String
        var subtitle: String
    }

    var body: some View {
        ZStack {
            Tokens.Light.page.ignoresSafeArea()
            VStack(spacing: 12) {
                header
                if let toast {
                    toastView(toast)
                }
                if let detail {
                    summary(detail)
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.flexible(), spacing: 7), GridItem(.flexible())], spacing: 7) {
                            ForEach(detail.participants) { p in
                                phoneChip(p)
                                    .onTapGesture { selected = p }
                            }
                        }
                        .padding(.bottom, 24)
                    }
                } else {
                    Spacer()
                    ProgressView().tint(Tokens.Light.textSecondary)
                    Spacer()
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
        }
        .task { await poll() }
        .onReceive(tick) { now = $0 }
        .sheet(item: $selected) { participant in
            T3StudentSheet(sessionId: sessionId, participant: participant) {
                await refresh()
            }
        }
        .confirmationDialog("End this session?", isPresented: $confirmEnd, titleVisibility: .visible) {
            Button("End session", role: .destructive) {
                Task {
                    try? await store.api.postVoid("sessions/\(sessionId)/end", body: nil as EmptyBody?)
                    onClosed()
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Shields lift for everyone. Ending early is fine — the bell would have done it anyway.")
        }
    }

    // MARK: header

    private var header: some View {
        HStack(spacing: 12) {
            arc
            VStack(alignment: .leading, spacing: 0) {
                Text(detail?.session.className ?? "")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(Tokens.Light.textPrimary)
                Text(headerSub)
                    .font(.system(size: 13).monospacedDigit())
                    .foregroundColor(Tokens.Light.textSecondary)
            }
            Spacer()
            Button("Extend") {
                Task {
                    try? await store.api.postVoid("sessions/\(sessionId)/extend", body: ExtendBody(minutes: 5))
                    await refresh()
                }
            }
            .font(.system(size: 14, weight: .semibold))
            .foregroundColor(Tokens.Light.textPrimary)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(Tokens.Light.card)
            .overlay(Capsule().stroke(Tokens.Light.borderStrong, lineWidth: 1))
            .clipShape(Capsule())

            Button("End") { confirmEnd = true }
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(Tokens.Light.red600)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(Tokens.Light.card)
                .overlay(Capsule().stroke(Tokens.Light.borderStrong, lineWidth: 1))
                .clipShape(Capsule())
        }
    }

    private var headerSub: String {
        guard let session = detail?.session else { return "" }
        let remain = session.endsAt.timeIntervalSince(now)
        return "\(mmss(remain)) · ends \(hmm(session.endsAt))"
    }

    private var arc: some View {
        ZStack {
            Circle().stroke(Tokens.Light.arcTrack, lineWidth: 4.5)
            Circle()
                .trim(from: 0, to: arcPct)
                .stroke(Tokens.Light.arcFill, style: StrokeStyle(lineWidth: 4.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: 38, height: 38)
    }

    private var arcPct: CGFloat {
        guard let session = detail?.session else { return 0 }
        let total = session.endsAt.timeIntervalSince(session.startedAt)
        guard total > 0 else { return 0 }
        return CGFloat(min(1, max(0, session.endsAt.timeIntervalSince(now) / total)))
    }

    // MARK: summary + grid

    private func summary(_ detail: TSessionDetail) -> some View {
        let order = ["focused", "not_joined", "pass", "emergency_unlocked", "revoked", "no_device", "ended"]
        return HStack(spacing: 6) {
            ForEach(order, id: \.self) { state in
                if let count = detail.counts[state], count > 0 {
                    let style = TChip.style(state)
                    HStack(spacing: 5) {
                        Image(systemName: style.icon).font(.system(size: 11))
                        Text("\(count)").font(.system(size: 13, weight: .semibold).monospacedDigit())
                    }
                    .foregroundColor(style.fg)
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .background(style.bg)
                    .overlay(state == "no_device" ? Capsule().stroke(style.fg, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3])) : nil)
                    .clipShape(Capsule())
                }
            }
            Spacer()
        }
    }

    private func phoneChip(_ p: TParticipant) -> some View {
        let style = TChip.style(p.state)
        var label = style.label
        if p.state == "pass", let ends = p.passEndsAt {
            label = "Pass · \(mmss(ends.timeIntervalSince(now)))"
        }
        if p.isStale, let stale = p.staleSeconds {
            label += " · \(stale >= 120 ? "\(stale / 60)m" : "\(stale)s")"
        }
        return HStack(spacing: 9) {
            Image(systemName: style.icon).font(.system(size: 15)).foregroundColor(style.fg)
            VStack(alignment: .leading, spacing: 0) {
                Text(p.shortName)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Tokens.Light.textPrimary)
                    .lineLimit(1)
                Text(label)
                    .font(.system(size: 12, weight: .medium).monospacedDigit())
                    .foregroundColor(style.fg)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(minHeight: 46)
        .background(p.state == "no_device" ? Color.clear : style.bg)
        .overlay(
            p.state == "no_device"
                ? RoundedRectangle(cornerRadius: 12).stroke(style.fg, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
                : nil
        )
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .opacity(p.isStale ? 0.75 : 1)
        .overlay(
            pulseStudentId == p.studentId
                ? PulseRing().clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                : nil
        )
        .contentShape(Rectangle())
    }

    private func toastView(_ info: ToastInfo) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "lock.open")
                .font(.system(size: 17))
                .foregroundColor(Tokens.Light.stateEmergencyFg)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                Text(info.title)
                    .font(.system(size: 14.5, weight: .semibold))
                    .foregroundColor(Tokens.Light.textPrimary)
                Text(info.subtitle)
                    .font(.system(size: 13))
                    .foregroundColor(Tokens.Light.textSecondary)
                Button("Open student") {
                    selected = detail?.participants.first { $0.studentId == info.studentId }
                }
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Tokens.Light.stateEmergencyFg)
                .padding(.top, 2)
            }
            Spacer()
            Button {
                toast = nil
            } label: {
                Image(systemName: "xmark").font(.system(size: 13)).foregroundColor(Tokens.Light.textTertiary)
            }
            .accessibilityLabel("Dismiss")
        }
        .padding(14)
        .background(Tokens.Light.stateEmergencyBg)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .shadow(color: Color.black.opacity(0.07), radius: 6, y: 2)
    }

    // MARK: data

    private func poll() async {
        while !Task.isCancelled {
            await refresh()
            try? await Task.sleep(nanoseconds: 5_000_000_000)
        }
    }

    private func refresh() async {
        guard let fresh = try? await store.api.get("sessions/\(sessionId)", as: TSessionDetail.self) else { return }
        // New emergency since the last poll → sticky toast + one soft pulse.
        if let previous = detail {
            let was = Set(previous.participants.filter { $0.state == "emergency_unlocked" }.map(\.studentId))
            if let new = fresh.participants.first(where: { $0.state == "emergency_unlocked" && !was.contains($0.studentId) }) {
                toast = ToastInfo(
                    studentId: new.studentId,
                    title: "\(new.shortName) used Emergency Unlock",
                    subtitle: "Reason pending · \(hmm(Date()))"
                )
                pulseStudentId = new.studentId
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.6) {
                    if pulseStudentId == new.studentId { pulseStudentId = nil }
                }
            }
        }
        detail = fresh
        if fresh.session.endedAt != nil { onClosed() }
    }
}

/// One soft pulse, two iterations max — emphasis, not alarm.
struct PulseRing: View {
    @State private var on = false

    var body: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(Tokens.orange400.opacity(on ? 0 : 0.45), lineWidth: on ? 10 : 1)
            .onAppear {
                withAnimation(.easeOut(duration: 1.2).repeatCount(2, autoreverses: false)) {
                    on = true
                }
            }
            .allowsHitTesting(false)
    }
}
