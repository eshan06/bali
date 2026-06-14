import SwiftUI

/// T3 · Student detail sheet — pattern, not just this moment. A "This session · Recent"
/// segmented control: the live timeline + GrantPassForm + no-device toggle, and the last
/// ~5 sessions as factual outcome rows. Status only — there is deliberately nothing to
/// drill into; no device contents exist.
struct T3StudentSheet: View {
    let classId: String
    let sessionId: String
    let participant: TParticipant
    var onChanged: () async -> Void

    @EnvironmentObject private var store: TeacherStore
    @Environment(\.dismiss) private var dismiss
    @State private var segment = 0
    @State private var events: [TEvent] = []
    @State private var history: TStudentHistory?
    @State private var noDevice: Bool
    @State private var passMinutes = 10
    @State private var customMinutes = ""
    @State private var passReason = ""
    @State private var granting = false
    @State private var grantError: String?

    init(classId: String, sessionId: String, participant: TParticipant, onChanged: @escaping () async -> Void) {
        self.classId = classId
        self.sessionId = sessionId
        self.participant = participant
        self.onChanged = onChanged
        _noDevice = State(initialValue: participant.state == "no_device")
    }

    private var fullName: String { "\(participant.firstName) \(participant.lastName)" }

    var body: some View {
        ZStack {
            Tokens.Light.page.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    SegPicker(items: ["This session", "Recent"], selection: $segment, fontSize: 15)
                    if segment == 0 { thisSession } else { recentView }
                }
                .padding(.horizontal, 20)
                .padding(.top, 26)
                .padding(.bottom, 36)
            }
        }
        .presentationDetents([.large, .medium])
        .task {
            struct R: Decodable { var events: [TEvent] }
            if let r = try? await store.api.get("sessions/\(sessionId)/students/\(participant.studentId)/timeline", as: R.self) {
                events = r.events
            }
        }
        .onChange(of: segment) { seg in
            if seg == 1, history == nil { Task { await loadHistory() } }
        }
    }

    @ViewBuilder
    private var thisSession: some View {
        if !events.isEmpty {
            sectionLabel("THIS SESSION")
            timelineCard
        }
        if ["focused", "pass"].contains(participant.state) {
            sectionLabel("GRANT A PASS")
            passCard
        }
        noDeviceCard
    }

    @ViewBuilder
    private var recentView: some View {
        if let history {
            VStack(alignment: .leading, spacing: 14) {
                VStack(spacing: 0) {
                    ForEach(history.rows) { row in
                        HStack(spacing: 12) {
                            Text(row.dayLabel)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(Tokens.Light.textSecondary)
                                .frame(width: 40, alignment: .leading)
                            StateIconDot(state: row.state, size: 30)
                            Text(row.label)
                                .font(.system(size: 14))
                                .foregroundColor(Tokens.Light.textPrimary)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
                        }
                        .frame(minHeight: 44)
                    }
                }
                .padding(16)
                .background(Tokens.Light.card)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

                if history.rows.isEmpty {
                    Text("No past sessions yet for \(participant.firstName).")
                        .font(.system(size: 14)).foregroundColor(Tokens.Light.textSecondary)
                }

                FramingLine(text: history.framing)
                Text(history.boundary)
                    .font(.system(size: 12.5))
                    .foregroundColor(Tokens.Light.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else {
            ProgressView().tint(Tokens.Light.textSecondary).frame(maxWidth: .infinity).padding(.top, 30)
        }
    }

    private func loadHistory() async {
        history = try? await store.api.get("classes/\(classId)/students/\(participant.studentId)/history", as: TStudentHistory.self)
    }

    private var header: some View {
        let style = TChip.style(participant.state)
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(fullName)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundColor(Tokens.Light.textPrimary)
                Text(participant.tappedInAt.map { "tapped in \(hmm($0)) · iPhone" } ?? "hasn't tapped in")
                    .font(.system(size: 13))
                    .foregroundColor(Tokens.Light.textSecondary)
            }
            Spacer()
            HStack(spacing: 6) {
                Image(systemName: style.icon).font(.system(size: 12))
                Text(style.label).font(.system(size: 13, weight: .medium))
            }
            .foregroundColor(style.fg)
            .padding(.horizontal, 11).padding(.vertical, 4)
            .background(participant.state == "no_device" ? Color.clear : style.bg)
            .overlay(participant.state == "no_device" ? Capsule().stroke(style.fg, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3])) : nil)
            .clipShape(Capsule())
        }
    }

    private var timelineCard: some View {
        VStack(spacing: 0) {
            ForEach(Array(events.enumerated()), id: \.element.id) { idx, event in
                HStack(alignment: .top, spacing: 10) {
                    VStack(spacing: 0) {
                        Circle().fill(dotColor(event.type)).frame(width: 9, height: 9).padding(.top, 5)
                        if idx < events.count - 1 {
                            Rectangle().fill(Tokens.Light.border).frame(width: 1).frame(minHeight: 16)
                        }
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(event.title)
                            .font(.system(size: 14))
                            .foregroundColor(Tokens.Light.textPrimary)
                        if let subtitle = event.subtitle {
                            Text(subtitle).font(.system(size: 12.5)).foregroundColor(Tokens.Light.textSecondary)
                        }
                    }
                    .padding(.bottom, idx < events.count - 1 ? 14 : 0)
                    Spacer()
                    Text(hmm(event.at))
                        .font(.system(size: 12.5, weight: .medium).monospacedDigit())
                        .foregroundColor(Tokens.Light.textTertiary)
                }
            }
        }
        .padding(16)
        .background(Tokens.Light.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func dotColor(_ type: String) -> Color {
        switch type {
        case "emergency_unlock", "reason_shared": return Tokens.orange400
        case "pass_granted", "pass_ended": return Tokens.Light.statePassFg
        case "permission_revoked": return Tokens.Light.stateRevokedFg
        default: return Tokens.green600
        }
    }

    private var passCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 4) {
                ForEach([5, 10, 15], id: \.self) { minutes in
                    segButton("\(minutes)", selected: passMinutes == minutes && customMinutes.isEmpty) {
                        passMinutes = minutes
                        customMinutes = ""
                    }
                }
                TextField("Custom", text: $customMinutes)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.center)
                    .font(.system(size: 14, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 36)
                    .background(customMinutes.isEmpty ? Color.clear : Tokens.Light.card)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .padding(3)
            .background(Tokens.Light.sunken)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            TeacherField("Reason (optional) — e.g. nurse", text: $passReason, contentType: .name)

            if let grantError {
                Text(grantError).font(.system(size: 13)).foregroundColor(Tokens.Light.textSecondary)
            }

            Button {
                granting = true
                Task {
                    do {
                        _ = try await store.api.post("sessions/\(sessionId)/passes", body: PassBody(
                            studentId: participant.studentId,
                            minutes: effectiveMinutes,
                            reason: passReason.isEmpty ? nil : passReason
                        ), as: PassGrantResult.self)
                        granting = false
                        dismiss()
                        await onChanged()
                    } catch {
                        granting = false
                        grantError = (error as? APIError)?.message ?? "Couldn't grant the pass."
                    }
                }
            } label: {
                Group {
                    if granting { ProgressView().tint(.white) } else { Text("Grant \(effectiveMinutes)-minute pass") }
                }
                .font(.system(size: 16, weight: .semibold))
                .frame(maxWidth: .infinity)
                .frame(height: 46)
                .background(Tokens.Light.actionPrimaryBg)
                .foregroundColor(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .disabled(granting || effectiveMinutes < 1)

            Text("Shields return automatically when it ends.")
                .font(.system(size: 12.5))
                .foregroundColor(Tokens.Light.textTertiary)
        }
        .padding(16)
        .background(Tokens.Light.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var effectiveMinutes: Int {
        if let custom = Int(customMinutes), custom > 0 { return min(custom, 60) }
        return passMinutes
    }

    private func segButton(_ label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 14, weight: .semibold))
                .frame(maxWidth: .infinity)
                .frame(height: 36)
                .background(selected ? Tokens.Light.card : Color.clear)
                .foregroundColor(selected ? Tokens.Light.textPrimary : Tokens.Light.textSecondary)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .shadow(color: selected ? Color.black.opacity(0.08) : .clear, radius: 2, y: 1)
        }
    }

    private var noDeviceCard: some View {
        Toggle(isOn: $noDevice) {
            VStack(alignment: .leading, spacing: 1) {
                Text("No device today")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(Tokens.Light.textPrimary)
                Text("Marks \(participant.firstName) out of today's grid only")
                    .font(.system(size: 12.5))
                    .foregroundColor(Tokens.Light.textTertiary)
            }
        }
        .tint(Tokens.green600)
        .padding(.horizontal, 16)
        .frame(height: 64)
        .background(Tokens.Light.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .onChange(of: noDevice) { on in
            Task {
                try? await store.api.postVoid("sessions/\(sessionId)/no-device", body: NoDeviceBody(studentId: participant.studentId, on: on))
                await onChanged()
            }
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .kerning(0.72)
            .foregroundColor(Tokens.Light.textTertiary)
    }
}

struct PassGrantResult: Codable {
    var passId: String
    var endsAt: Date
}
