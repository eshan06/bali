//
//  FocusModeActiveView.swift
//  Bali — Focus Mode (dark takeover)
//
//  The full-screen dark takeover shown (via fullScreenCover) while a checked-in
//  session is active: shield hero, live blocking-status badge, a countdown to the
//  session end, and the real paused / still-available apps (no placeholder apps).
//  The countdown's end is assumed (the DTO carries none — §9). Emergency unlock is
//  local/optimistic.
//

import SwiftUI

struct FocusModeActiveView: View {
    @Environment(FocusModeController.self) private var controller
    @Environment(AppModel.self) private var model
    @State private var showEmergency = false

    private var policy: BlockingSnapshot? { controller.policy }
    private var className: String { controller.activeClass?.name ?? "Class" }

    var body: some View {
        ZStack(alignment: .top) {
            BaliGradient.focusScreen.ignoresSafeArea()

            ScrollView {
                VStack(spacing: BaliSpacing.l) {
                    ShieldTile(size: 116)
                        .padding(.top, BaliSpacing.s)
                    focusBadge
                    VStack(spacing: BaliSpacing.xs) {
                        BaliText(className, .h1, color: BaliColor.focusText)
                        checkedInLine
                    }
                    countdownCard
                    appsSection
                    emergencyButton
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, BaliSpacing.xl)
                .padding(.top, 64)
                .padding(.bottom, BaliSpacing.xxxl)
            }
            .scrollIndicators(.hidden)

            topBar
        }
        .sheet(isPresented: $showEmergency) {
            EmergencyUnlockSheet()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(BaliRadius.sheet)
        }
    }

    // MARK: - Top bar

    private var topBar: some View {
        HStack {
            Button { controller.collapse() } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(BaliColor.focusText)
                    .frame(width: 38, height: 38)
                    .background(Color.white.opacity(0.10))
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            Spacer()
            statusBadge
        }
        .padding(.horizontal, BaliSpacing.xl)
        .padding(.top, BaliSpacing.s)
    }

    private var statusBadge: some View {
        let parts: (text: String, color: Color, pulse: Bool) = {
            switch controller.status {
            case .applied:  return ("BLOCKING APPLIED", BaliColor.green, true)
            case .applying: return ("APPLYING…", BaliColor.blue300, false)
            case .failed:   return ("BLOCKING FAILED", BaliColor.coral, false)
            case .unknown:  return ("FOCUS ON", BaliColor.green, false)
            }
        }()
        return HStack(spacing: 7) {
            if parts.pulse { PulseDot(color: parts.color, size: 7) }
            else { Circle().fill(parts.color).frame(width: 7, height: 7) }
            Text(parts.text)
                .font(BaliFont.at(11, 700)).tracking(0.5)
                .foregroundStyle(parts.color)
        }
        .padding(.horizontal, 11)
        .frame(height: 26)
        .background(parts.color.opacity(0.16))
        .clipShape(Capsule())
    }

    private var focusBadge: some View {
        Text("FOCUS MODE ACTIVE")
            .font(BaliFont.at(11.5, 700)).tracking(1)
            .foregroundStyle(BaliColor.focusText)
            .padding(.horizontal, 12)
            .frame(height: 28)
            .background(Color.white.opacity(0.10))
            .clipShape(Capsule())
    }

    private var checkedInLine: some View {
        HStack(spacing: 6) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(BaliColor.green)
            BaliText("Checked in · \(BaliFormat.timeOfDay(controller.activeClass?.activeSession?.startedAt))",
                     .foot, color: BaliColor.focusText2)
        }
    }

    // MARK: - Countdown

    private var countdownCard: some View {
        VStack(alignment: .leading, spacing: BaliSpacing.s) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    BaliText("Apps unlock in", .foot, color: BaliColor.focusText2)
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text(countdownString(to: controller.sessionEnd, now: context.date))
                            .font(BaliFont.at(34, 800))
                            .foregroundStyle(BaliColor.focusText)
                            .monospacedDigit()
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    BaliText("Session ends", .foot, color: BaliColor.focusText2)
                    BaliText(controller.sessionEnd.map(clockTime) ?? "—",
                             .bodyStrong, color: BaliColor.focusText)
                        .monospacedDigit()
                }
            }
            Divider().overlay(BaliColor.focusLine)
            HStack(spacing: 6) {
                Image(systemName: "info.circle")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(BaliColor.focusText2)
                BaliText("Set by \(teacherName)'s session — not editable here.", .foot, color: BaliColor.focusText2)
            }
        }
        .padding(BaliSpacing.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: BaliRadius.lg, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: BaliRadius.lg, style: .continuous)
                .strokeBorder(BaliColor.focusLine, lineWidth: 1)
        }
    }

    // MARK: - Apps

    @ViewBuilder private var appsSection: some View {
        if let policy {
            if policy.isAllowList {
                appGrid(title: "Still available", trailing: policy.preset.title,
                        entries: policy.allowedApps, locked: false)
                pausedNote("Everything else is paused during class.")
            } else if !policy.blockedApps.isEmpty {
                appGrid(title: "Paused right now", trailing: policy.preset.title,
                        entries: policy.blockedApps, locked: true)
                pausedNote("Everything else stays available.")
            }
        }
    }

    private func appGrid(title: String, trailing: String, entries: [BlockingAppEntry], locked: Bool) -> some View {
        VStack(alignment: .leading, spacing: BaliSpacing.m) {
            HStack {
                BaliText(title, .h3, color: BaliColor.focusText)
                Spacer()
                BaliText(trailing, .foot, color: BaliColor.focusText2)
            }
            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: BaliSpacing.m), count: 4),
                spacing: BaliSpacing.l
            ) {
                ForEach(entries) { entry in
                    AppTile(visual: AppCatalog.visual(for: entry), locked: locked, onDark: true)
                }
            }
        }
    }

    private func pausedNote(_ text: String) -> some View {
        HStack(spacing: BaliSpacing.s) {
            Image(systemName: "moon.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(BaliColor.focusText2)
            BaliText(text, .foot, color: BaliColor.focusText2)
            Spacer(minLength: 0)
        }
    }

    private var emergencyButton: some View {
        Button { showEmergency = true } label: {
            Text("Request emergency unlock")
                .font(BaliFont.at(15, 650))
                .foregroundStyle(BaliColor.focusText2)
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .overlay {
                    Capsule().strokeBorder(BaliColor.focusLine, lineWidth: 1)
                }
        }
        .buttonStyle(.plain)
        .padding(.top, BaliSpacing.s)
    }

    // MARK: - Helpers

    private var teacherName: String { controller.activeClass?.teacherName ?? "your teacher" }

    private func countdownString(to end: Date?, now: Date) -> String {
        guard let end else { return "—" }
        let secs = max(0, Int(end.timeIntervalSince(now)))
        let h = secs / 3600, m = (secs % 3600) / 60, s = secs % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%02d:%02d", m, s)
    }

    private func clockTime(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "h:mm a"
        return f.string(from: date)
    }
}

#Preview {
    FocusModeActiveView()
        .injectBaliEnvironment(.preview())
}
