import SwiftUI
import UIKit

/// S6 · Focus Active — THE flagship student screen. Sits face-up on a desk for
/// 50 minutes. Calm, almost empty: header, hero arc, allowed apps, and the
/// always-available EmergencyUnlockControl. The arc draws in ONCE (600ms) — the
/// product's only theatrical moment.
struct FocusActiveView: View {
    @ObservedObject var engine: FocusEngine
    var onExit: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var drawnIn = false
    @State private var now = Date()
    @State private var showReasonSheet = false
    @State private var announcedFinal2 = false
    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            Tokens.Dark.page.ignoresSafeArea()
            VStack(spacing: 0) {
                header
                    .padding(.top, 24)

                if case .pass = engine.state {
                    passChip.padding(.top, 14)
                }

                Spacer()

                heroArc

                FocusScopeRow()
                    .padding(.horizontal, 20)
                    .padding(.top, 34)

                Spacer()

                bottom
                    .padding(.horizontal, 20)
                    .padding(.bottom, 24)
            }
        }
        .preferredColorScheme(.dark)
        .onReceive(timer) { tick in
            now = tick
            checkSessionOver()
        }
        .onAppear {
            if reduceMotion {
                drawnIn = true
            } else {
                // double-beat so the first frame renders empty, then the 600ms draw-in
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                    withAnimation(.easeOut(duration: 0.6)) { drawnIn = true }
                }
            }
        }
        .onChange(of: engine.state) { state in
            if case .unlocked(let pending) = state, pending != nil {
                showReasonSheet = true
            }
            if case .ended = state { onExit() }
        }
        .sheet(isPresented: $showReasonSheet) {
            ReasonSheet(teacher: engine.teacherDisplayName) { reason in
                Task { await engine.shareReason(reason) }
                showReasonSheet = false
            }
            .presentationDetents([.height(300)])
        }
    }

    // MARK: pieces

    private var header: some View {
        VStack(spacing: 3) {
            Text(engine.className)
                .font(.system(size: 22, weight: .semibold))
                .foregroundColor(Tokens.Dark.textPrimary)
            Text("with \(engine.teacherDisplayName) · ends \(endsLabel)")
                .font(.system(size: 15))
                .foregroundColor(Tokens.Dark.textSecondary)
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, 20)
    }

    private var passChip: some View {
        HStack(spacing: 6) {
            Image(systemName: "ticket").font(.system(size: 12))
            Text("Pass — shields return automatically")
        }
        .font(.system(size: 13, weight: .semibold))
        .foregroundColor(Tokens.blue300)
        .padding(.horizontal, 11).padding(.vertical, 5)
        .background(Tokens.Dark.statePassBg)
        .clipShape(Capsule())
    }

    private var isPass: Bool {
        if case .pass = engine.state { return true }
        return false
    }

    private var isUnlocked: Bool {
        if case .unlocked = engine.state { return true }
        return false
    }

    private var final2: Bool {
        !isPass && remainingSeconds <= 120
    }

    /// XL Dynamic Type (doc 04 S6.6): arc drops to 218pt, control grows to 76pt —
    /// the layout adapts, nothing truncates.
    private var isXLType: Bool { typeSize >= .xxLarge }

    private var heroArc: some View {
        let arcSize: CGFloat = isXLType ? 218 : 244
        let stroke: CGFloat = final2 ? 12 : 10
        let fill: Color = isPass ? Tokens.blue400 : (final2 ? Tokens.Dark.arcFinal2 : Tokens.Dark.arcFill)
        let timeColor: Color = final2 ? Tokens.green200 : Tokens.Dark.textPrimary

        return ZStack {
            Circle().stroke(Tokens.Dark.arcTrack, lineWidth: stroke)
            Circle()
                .trim(from: 0, to: drawnIn ? pct : 0)
                .stroke(fill, style: StrokeStyle(lineWidth: stroke, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 2) {
                Text(countdownText)
                    .font(.heroTime(isXLType ? 50 : 56))
                    .monospacedDigit()
                    .foregroundColor(timeColor)
                Text(isPass ? "pass ends \(passEndsLabel)" : "until \(endsLabel)")
                    .font(.system(size: isXLType ? 18 : 15))
                    .foregroundColor(Tokens.Dark.textSecondary)
            }
        }
        .frame(width: arcSize, height: arcSize)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Session countdown. \(countdownText) \(isPass ? "left on your pass" : "until \(endsLabel)").")
        .onChange(of: final2) { isFinal in
            if isFinal && !announcedFinal2 {
                announcedFinal2 = true
                UIAccessibility.post(notification: .announcement, argument: "Two minutes left.")
            }
        }
    }

    private var bottom: some View {
        VStack(spacing: 12) {
            EmergencyUnlockControl(
                teacher: engine.teacherDisplayName,
                isUnlocked: isUnlocked,
                height: isXLType ? 76 : 64
            ) {
                engine.emergencyUnlock()
            }
            Text(isUnlocked ? "Re-focus any time by tapping the desk tag." : "Works without Wi-Fi. Releasing early does nothing.")
                .font(.system(size: 13))
                .foregroundColor(Tokens.Dark.textTertiary)
                .multilineTextAlignment(.center)

            if isUnlocked {
                Button("Back to Today") { onExit() }
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Tokens.green300)
                    .padding(.top, 4)
            }
        }
    }

    // MARK: time math

    private var remainingSeconds: Int {
        switch engine.state {
        case let .pass(endsAt):
            return max(0, Int(endsAt.timeIntervalSince(now)))
        default:
            guard let session = engine.session else { return 0 }
            return max(0, Int(session.endsAt.timeIntervalSince(now)))
        }
    }

    private var pct: CGFloat {
        guard let session = engine.session else { return 0 }
        if case let .pass(endsAt) = engine.state {
            let total = 50.0 * 60
            return CGFloat(min(1, max(0, endsAt.timeIntervalSince(now) / total)))
        }
        let total: TimeInterval = 50 * 60
        return CGFloat(min(1, max(0, session.endsAt.timeIntervalSince(now) / total)))
    }

    private var countdownText: String {
        let s = remainingSeconds
        return "\(s / 60):" + String(format: "%02d", s % 60)
    }

    private var endsLabel: String {
        guard let session = engine.session else { return "" }
        let fmt = DateFormatter()
        fmt.timeStyle = .short
        return fmt.string(from: session.endsAt)
    }

    private var passEndsLabel: String {
        if case let .pass(endsAt) = engine.state {
            let fmt = DateFormatter()
            fmt.timeStyle = .short
            return fmt.string(from: endsAt)
        }
        return ""
    }

    private func checkSessionOver() {
        if let session = engine.session, session.endsAt <= now, !isPass {
            // the heartbeat confirms, but the bell should never wait 30s
            engine.sessionEnded()
        }
    }
}

/// The EmergencyUnlockControl — always visible, never disabled, never red.
/// 1.0s hold fills edge-to-edge with warm orange while haptics ramp; releasing
/// early springs back with no error. VoiceOver gets a one-step "Unlock now".
struct EmergencyUnlockControl: View {
    var teacher: String
    var isUnlocked: Bool
    var height: CGFloat = 64
    var onUnlock: () -> Void

    @State private var holding = false
    @State private var fillFraction: CGFloat = 0
    @State private var holdTask: Task<Void, Never>?
    @State private var hapticTask: Task<Void, Never>?

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            ZStack(alignment: .leading) {
                // resting base
                Capsule()
                    .fill(isUnlocked ? Tokens.orange400 : Tokens.Dark.unlockBg)
                    .overlay(Capsule().stroke(isUnlocked ? Tokens.orange400 : Tokens.Dark.borderStrong, lineWidth: 1))

                // base label
                label(color: isUnlocked ? Tokens.Dark.unlockInk : Tokens.Dark.textPrimary, width: width)

                if !isUnlocked {
                    // growing fill with the ink label clipped inside (duplicate-label technique)
                    Capsule()
                        .fill(Tokens.orange400)
                        .frame(width: max(0, fillFraction * width))
                        .overlay(alignment: .leading) {
                            label(color: Tokens.Dark.unlockInk, width: width)
                                .frame(width: width, alignment: .center)
                                .clipShape(Rectangle())
                        }
                        .clipped()
                }
            }
            .contentShape(Capsule())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        guard !holding, !isUnlocked else { return }
                        beginHold()
                    }
                    .onEnded { _ in cancelHold() }
            )
        }
        .frame(height: height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Emergency unlock. Your teacher will be notified.")
        .accessibilityAction(named: "Unlock now") {
            guard !isUnlocked else { return }
            complete()
        }
    }

    private func label(color: Color, width: CGFloat) -> some View {
        HStack(spacing: 9) {
            Image(systemName: isUnlocked ? "checkmark" : "lock.open")
                .font(.system(size: 16, weight: .semibold))
            Text(isUnlocked
                ? "Unlocked — \(teacher) was notified"
                : "Hold to unlock — your teacher will be notified")
                .font(.system(size: 15, weight: .semibold))
                .multilineTextAlignment(.center)
                .lineLimit(2)
        }
        .foregroundColor(color)
        .frame(width: width)
        .frame(maxHeight: .infinity)
        .padding(.horizontal, 0)
    }

    private func beginHold() {
        holding = true
        withAnimation(.linear(duration: 1.0)) { fillFraction = 1 }

        // haptic ramp: light ticks → medium
        hapticTask = Task {
            let light = UIImpactFeedbackGenerator(style: .light)
            let medium = UIImpactFeedbackGenerator(style: .medium)
            light.prepare()
            medium.prepare()
            for i in 0 ..< 9 {
                if Task.isCancelled { return }
                if i < 5 { light.impactOccurred(intensity: 0.5 + Double(i) * 0.1) } else { medium.impactOccurred() }
                try? await Task.sleep(nanoseconds: 110_000_000)
            }
        }

        holdTask = Task {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            guard !Task.isCancelled else { return }
            complete()
        }
    }

    private func cancelHold() {
        guard holding else { return }
        holding = false
        holdTask?.cancel()
        hapticTask?.cancel()
        // early release: spring back, nothing happens, no error
        withAnimation(.spring(response: 0.28, dampingFraction: 0.7)) { fillFraction = 0 }
    }

    private func complete() {
        holdTask?.cancel()
        hapticTask?.cancel()
        holding = false
        fillFraction = 0
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        onUnlock()
    }
}

/// S7 · Post-emergency sheet — "Everything OK?" Five chips, identical size;
/// Skip is a first-class answer. One tap dismisses. Zero guilt styling.
struct ReasonSheet: View {
    var teacher: String
    var onPick: (String) -> Void

    private let reasons: [(String, String)] = [
        ("family", "Family"), ("medical", "Medical"), ("safety", "Safety"),
        ("other", "Other"), ("skipped", "Skip"),
    ]

    var body: some View {
        ZStack {
            Tokens.Dark.card.ignoresSafeArea()
            VStack(spacing: 14) {
                Capsule().fill(Tokens.Dark.borderStrong).frame(width: 36, height: 5).padding(.top, 10)
                Text("You're unlocked. Everything OK?")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundColor(Tokens.Dark.textPrimary)
                    .multilineTextAlignment(.center)
                Text("Sharing a reason is optional — it goes only to \(teacher).")
                    .font(.system(size: 15))
                    .foregroundColor(Tokens.Dark.textSecondary)
                    .multilineTextAlignment(.center)

                FlowChips(items: reasons.map(\.1)) { label in
                    if let reason = reasons.first(where: { $0.1 == label })?.0 {
                        onPick(reason)
                    }
                }

                Text("\(teacher) was notified.")
                    .font(.system(size: 13))
                    .foregroundColor(Tokens.Dark.textTertiary)
                Spacer(minLength: 8)
            }
            .padding(.horizontal, 20)
        }
        .preferredColorScheme(.dark)
    }
}

/// Equal-weight reason chips, wrapping — Skip renders exactly like the others.
struct FlowChips: View {
    var items: [String]
    var onTap: (String) -> Void

    var body: some View {
        let rows = [Array(items.prefix(3)), Array(items.dropFirst(3))]
        VStack(spacing: 10) {
            ForEach(0 ..< rows.count, id: \.self) { r in
                HStack(spacing: 10) {
                    ForEach(rows[r], id: \.self) { item in
                        Button {
                            onTap(item)
                        } label: {
                            Text(item)
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundColor(Tokens.Dark.textPrimary)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 13)
                                .background(Tokens.Dark.raised)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                        .stroke(Tokens.Dark.border, lineWidth: 1)
                                )
                                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                    }
                }
            }
        }
    }
}
