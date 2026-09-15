import SwiftUI

/// T10 · Session Recap — the closing beat. Auto-presents when a session ends (from T2) and
/// is reachable from T6. A neutral recap: counts per §2 state, emergencies listed plainly
/// with a quiet check-in nudge, the framing line — and zero red, no ranking, no scoreboard.
struct T10RecapView: View {
    let sessionId: String
    /// "View full log" → T6 · Activity. When nil the button just closes.
    var onViewLog: (() -> Void)? = nil

    @EnvironmentObject private var store: TeacherStore
    @Environment(\.dismiss) private var dismiss
    @State private var recap: TRecap?
    @State private var loadFailed = false

    var body: some View {
        ZStack {
            Tokens.Light.page.ignoresSafeArea()
            if let recap {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        if recap.clean { cleanHeader(recap) } else { statsBlock(recap) }
                        if !recap.emergencies.isEmpty { emergenciesBlock(recap) }
                        FramingLine().padding(.top, 2)
                        actions
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 28)
                    .padding(.bottom, 32)
                }
            } else if loadFailed {
                loadErrorState
            } else {
                loadingState
            }
        }
        .task { await load() }
    }

    private func load() async {
        loadFailed = false
        do {
            recap = try await store.api.get("sessions/\(sessionId)/recap", as: TRecap.self)
        } catch {
            loadFailed = true
        }
    }

    // MARK: clean ("Smooth period.")

    private func cleanHeader(_ r: TRecap) -> some View {
        VStack(spacing: 16) {
            ZStack {
                Circle().stroke(Tokens.green600, lineWidth: 8)
                Image(systemName: "checkmark").font(.system(size: 34, weight: .semibold)).foregroundColor(Tokens.green600)
            }
            .frame(width: 104, height: 104)
            .padding(.top, 12)
            Text(r.endedEarly ? "Ended early." : "Smooth period.")
                .font(.system(size: 28, weight: .bold))
                .foregroundColor(Tokens.Light.textPrimary)
            Text(r.className)
                .font(.system(size: 15))
                .foregroundColor(Tokens.Light.textSecondary)
            Text(r.endedEarly
                 ? "\(r.durationLabel) — ended before the bell."
                 : "Everyone who tapped in stayed focused to the bell")
                .font(.system(size: 16))
                .foregroundColor(Tokens.Light.textSecondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 320)
            Text(cleanSubline(r))
                .font(.system(size: 14))
                .foregroundColor(Tokens.Light.textTertiary)
        }
        .frame(maxWidth: .infinity)
    }

    private func cleanSubline(_ r: TRecap) -> String {
        var parts = ["\(r.studentsTappedIn) student\(r.studentsTappedIn == 1 ? "" : "s")"]
        if let m = r.medianFocusMinutes { parts.append("\(m) min median focus") }
        return parts.joined(separator: " · ")
    }

    // MARK: incident recap

    private func statsBlock(_ r: TRecap) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Session recap")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(Tokens.Light.textPrimary)
                Text("\(r.className) · \(r.scheduleLabel) · \(r.durationLabel)")
                    .font(.system(size: 14))
                    .foregroundColor(Tokens.Light.textSecondary)
            }
            StatGrid(cells: [
                ("\(r.focusedCount)", "stayed focused"),
                ("\(r.emergencyCount)", r.emergencyCount == 1 ? "emergency unlock" : "emergency unlocks"),
                ("\(r.passCount)", r.passCount == 1 ? "pass" : "passes"),
                ("\(r.permissionOffCount)", "permission off"),
            ])
            Text(footnote(r))
                .font(.system(size: 13))
                .foregroundColor(Tokens.Light.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func footnote(_ r: TRecap) -> String {
        var parts: [String] = []
        if let m = r.medianFocusMinutes { parts.append("\(m) min median focus") }
        if r.neverJoinedCount > 0 { parts.append("\(r.neverJoinedCount) never joined") }
        if !r.noDeviceNames.isEmpty { parts.append("\(r.noDeviceNames.joined(separator: ", ")) marked no-device") }
        return parts.joined(separator: " · ")
    }

    private func emergenciesBlock(_ r: TRecap) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            TSectionLabel("EMERGENCIES")
            VStack(spacing: 0) {
                ForEach(r.emergencies) { e in
                    VStack(spacing: 0) {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: "lock.open")
                                .font(.system(size: 17))
                                .foregroundColor(Tokens.Light.stateEmergencyFg)
                                .padding(.top, 2)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(e.studentName) · \(e.atLabel)")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundColor(Tokens.Light.textPrimary)
                                Text(reasonLine(e))
                                    .font(.system(size: 13))
                                    .foregroundColor(Tokens.Light.textSecondary)
                            }
                            Spacer()
                        }
                        .padding(14)
                        HStack(spacing: 10) {
                            Image(systemName: "bubble.left").font(.system(size: 14)).foregroundColor(Tokens.Light.textTertiary)
                            Text(e.nudge).font(.system(size: 13)).foregroundColor(Tokens.Light.textSecondary)
                            Spacer()
                        }
                        .padding(.horizontal, 14)
                        .padding(.bottom, 14)
                    }
                    .background(Tokens.Light.card)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
        }
    }

    private func reasonLine(_ e: TRecapEmergency) -> String {
        [e.reasonLabel, e.refocusedLabel].compactMap { $0 }.joined(separator: " · ")
    }

    // MARK: loading / failed

    // T10 is presented in a `.fullScreenCover` with no swipe-to-dismiss, so every state —
    // including a request that fails or never returns — has to carry its own way out.
    private var loadingState: some View {
        VStack(spacing: 24) {
            ProgressView().tint(Tokens.Light.textSecondary)
            TSecondaryButton(title: "Done") { dismiss() }
        }
        .frame(maxWidth: 320)
        .padding(.horizontal, 20)
    }

    private var loadErrorState: some View {
        VStack(spacing: 8) {
            Text("Couldn’t load the recap")
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(Tokens.Light.textPrimary)
            Text("Check your connection and try again.")
                .font(.system(size: 14))
                .foregroundColor(Tokens.Light.textSecondary)
                .multilineTextAlignment(.center)
            VStack(spacing: 10) {
                TPrimaryButton(title: "Retry") { Task { await load() } }
                TSecondaryButton(title: "Done") { dismiss() }
            }
            .padding(.top, 10)
        }
        .frame(maxWidth: 320)
        .padding(.horizontal, 20)
    }

    // MARK: actions

    private var actions: some View {
        VStack(spacing: 10) {
            TPrimaryButton(title: "Done") { dismiss() }
            if onViewLog != nil {
                TSecondaryButton(title: "View full log") {
                    dismiss()
                    onViewLog?()
                }
            }
        }
        .padding(.top, 4)
    }
}
