//
//  NfcCheckInSheet.swift
//  Bali — NFC check-in sheet
//
//  A real Core NFC check-in, driven by NFCCheckInController: a class-context
//  header over a state body — waiting (radar), reading, the result states
//  (checked in / device not assigned / no session / failed), and an honest
//  "needs a physical iPhone" state on the Simulator. Never a fake / "simulate"
//  check-in. On success the controller records it in AppModel and we offer
//  Focus Mode.
//

import SwiftUI

struct NfcCheckInSheet: View {
    let classId: String?

    @Environment(AppEnvironment.self) private var env
    @Environment(AppModel.self) private var model
    @Environment(AppRouter.self) private var router
    @Environment(NotificationManager.self) private var notifications
    @Environment(\.dismiss) private var dismiss
    @State private var controller: NFCCheckInController?

    var body: some View {
        VStack(spacing: BaliSpacing.l) {
            header
            if let target = targetClass { classContext(target) }
            Spacer(minLength: 0)
            phaseBody
            Spacer(minLength: 0)
        }
        .padding(.horizontal, BaliSpacing.xl)
        .padding(.top, BaliSpacing.s)
        .padding(.bottom, BaliSpacing.xl)
        .frame(maxWidth: .infinity)
        .background(BaliColor.surface)
        .task {
            guard controller == nil else { return }
            let c = NFCCheckInController(reader: env.nfcReader, service: env.checkInService, model: model)
            controller = c
            await c.begin(classId: classId)
        }
        .onChange(of: isCancelled) { _, cancelled in
            if cancelled { dismiss() }
        }
        .onChange(of: successResponse) { _, response in
            if let response {
                notifications.notify(.checkedIn,
                    title: response.attendanceStatus == .late ? "Checked in late" : "Checked in on time",
                    message: "\(targetClass?.name ?? "Class") · just now")
            }
        }
    }

    private var successResponse: CheckInResponse? {
        if case .result(.success(let response)) = controller?.phase { return response }
        return nil
    }

    // MARK: - Header + class context

    private var header: some View {
        HStack(spacing: BaliSpacing.m) {
            Wordmark(size: 22, color: BaliColor.ink)
            Rectangle().fill(BaliColor.line).frame(width: 1, height: 18)
            BaliText("Check in", .h3)
            Spacer()
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(BaliColor.ink3)
                    .frame(width: 30, height: 30)
                    .background(BaliColor.line2)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
        }
    }

    private func classContext(_ summary: StudentClassSummary) -> some View {
        let seat = model.presentation(for: summary.id).seat
        return HStack(spacing: BaliSpacing.m14) {
            IconTile(systemImage: "graduationcap.fill", tone: .blue)
            VStack(alignment: .leading, spacing: 2) {
                BaliText(summary.name, .bodyStrong)
                BaliText([seat, summary.teacherName].compactMap { $0 }.joined(separator: " · "), .foot)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BaliColor.line2)
        .clipShape(RoundedRectangle(cornerRadius: BaliRadius.r, style: .continuous))
    }

    // MARK: - Phase body

    @ViewBuilder private var phaseBody: some View {
        switch controller?.phase {
        case .none, .waiting:
            waitingView
        case .reading:
            readingView
        case .unavailable:
            unavailableView
        case .result(let outcome):
            resultView(outcome)
        }
    }

    private var waitingView: some View {
        VStack(spacing: BaliSpacing.l) {
            RadarView(ringSize: 200) { NfcMark(size: 120) }
            VStack(spacing: BaliSpacing.s) {
                BaliText("Hold near your Bali block", .h2)
                BaliText("Rest the top of your iPhone on the block\(seatSuffix).", .body)
                    .multilineTextAlignment(.center)
            }
        }
    }

    private var readingView: some View {
        VStack(spacing: BaliSpacing.l) {
            ProgressView().scaleEffect(1.5).tint(BaliColor.blue).frame(height: 120)
            BaliText("Checking you in…", .h2)
        }
    }

    private var unavailableView: some View {
        VStack(spacing: BaliSpacing.l) {
            NfcMark(size: 120, glow: false)
            VStack(spacing: BaliSpacing.s) {
                BaliText("NFC needs a physical iPhone", .h2)
                    .multilineTextAlignment(.center)
                BaliText("Check-in taps your Bali block with Core NFC, which the Simulator can't do. Run Bali on an iPhone to check in.", .body)
                    .multilineTextAlignment(.center)
            }
            BaliButton(title: "Got it") { dismiss() }
        }
    }

    @ViewBuilder private func resultView(_ outcome: CheckInOutcome) -> some View {
        switch outcome {
        case .success(let response):
            resultLayout(icon: "checkmark", tone: .green,
                         title: response.attendanceStatus == .late ? "Checked in — late" : "You're checked in",
                         message: successMessage(response),
                         primaryTitle: "View Focus Mode", primary: { dismiss(); router.selectTab(.focus) })
        case .notAssigned:
            resultLayout(icon: "iphone", tone: .amber,
                         title: "Device not assigned",
                         message: "\(teacherName) hasn't linked this iPhone to your seat yet. Ask them to assign your device, then tap again.",
                         primaryTitle: "Got it", primary: { dismiss() })
        case .noSession:
            resultLayout(icon: "calendar.badge.exclamationmark", tone: .gray,
                         title: "No active session",
                         message: "There's no live class to check into right now.",
                         primaryTitle: "Got it", primary: { dismiss() })
        case .failed(let message):
            resultLayout(icon: "exclamationmark.triangle.fill", tone: .coral,
                         title: "Check-in failed", message: message,
                         primaryTitle: "Try again", primary: { Task { await controller?.retry() } },
                         secondaryTitle: "Close", secondary: { dismiss() })
        case .cancelled:
            Color.clear.frame(height: 1)   // dismissed via onChange
        }
    }

    private func resultLayout(icon: String, tone: BaliTone, title: String, message: String,
                              primaryTitle: String, primary: @escaping () -> Void,
                              secondaryTitle: String? = nil,
                              secondary: (() -> Void)? = nil) -> some View {
        VStack(spacing: BaliSpacing.l) {
            ZStack {
                Circle().fill(tone.tint).frame(width: 96, height: 96)
                Image(systemName: icon)
                    .font(.system(size: 38, weight: .semibold))
                    .foregroundStyle(tone.solid)
            }
            VStack(spacing: BaliSpacing.s) {
                BaliText(title, .h2).multilineTextAlignment(.center)
                BaliText(message, .body).multilineTextAlignment(.center)
            }
            VStack(spacing: BaliSpacing.s) {
                BaliButton(title: primaryTitle, action: primary)
                if let secondaryTitle, let secondary {
                    BaliButton(title: secondaryTitle, variant: .ghost, action: secondary)
                }
            }
        }
    }

    // MARK: - Derived

    private var targetClass: StudentClassSummary? {
        let id = controller?.targetClassId ?? classId ?? model.liveClass?.id
        return model.classes.first { $0.id == id }
    }

    private var seatSuffix: String {
        if let id = targetClass?.id, let seat = model.presentation(for: id).seat { return " at \(seat)" }
        return ""
    }

    private var teacherName: String { targetClass?.teacherName ?? "Your teacher" }

    private func successMessage(_ response: CheckInResponse) -> String {
        let name = targetClass?.name ?? "this class"
        if response.blockingPolicy.blockingActive {
            return "Focus Mode is on for \(name) · \(response.blockingPolicy.preset.title)."
        }
        return "You're marked present for \(name)."
    }

    private var isCancelled: Bool {
        if case .result(.cancelled) = controller?.phase { return true }
        return false
    }
}

#Preview {
    Color.black.sheet(isPresented: .constant(true)) {
        NfcCheckInSheet(classId: "cls-bio")
            .presentationDetents([.height(520)])
            .injectBaliEnvironment(.preview())
    }
}
