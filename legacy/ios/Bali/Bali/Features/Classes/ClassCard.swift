//
//  ClassCard.swift
//  Bali — Classes / Home
//
//  The roster card used on Home and the Classes tab: a left class-color bar,
//  PERIOD eyebrow + LIVE badge, name + teacher, an attendance ring in the class
//  color, and a divider above a policy + status row. The class color is derived
//  deterministically from the classId (ClassColor); the policy / next-class
//  label come from the AppModel sidecar (the summary DTO carries neither).
//

import SwiftUI

struct ClassCard: View {
    let summary: StudentClassSummary
    var policy: BlockingSnapshot? = nil
    var nextLabel: String? = nil
    var isCheckedIn: Bool = false
    let onTap: () -> Void

    private var color: Color { ClassColor.accent(for: summary.id) }
    private var isLive: Bool { summary.activeSession != nil }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 0) {
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(color)
                    .frame(width: 4)
                    .padding(.vertical, 16)
                    .padding(.leading, 6)

                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .top, spacing: BaliSpacing.m) {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 8) {
                                BaliText((summary.period ?? "Class").uppercased(), .eyebrow, color: color)
                                if isLive { liveBadge }
                            }
                            BaliText(summary.name, .h3)
                            BaliText(summary.teacherName, .foot)
                        }
                        Spacer(minLength: 0)
                        AttendanceRing(progress: summary.attendanceFraction, color: color,
                                       size: 56, lineWidth: 5)
                    }

                    Rectangle().fill(BaliColor.line).frame(height: 1)

                    HStack(spacing: BaliSpacing.s) {
                        Image(systemName: "lock.fill")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(BaliColor.ink3)
                        Text(policy?.preset.title ?? "Focus policy")
                            .font(BaliFont.at(13.5, 600))
                            .foregroundStyle(BaliColor.ink2)
                        Spacer(minLength: BaliSpacing.s)
                        statusLabel
                    }
                }
                .padding(.vertical, 16)
                .padding(.leading, 14)
                .padding(.trailing, BaliSpacing.cardPadding)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(BaliColor.surface)
            .clipShape(RoundedRectangle(cornerRadius: BaliRadius.lg, style: .continuous))
            .baliShadow(.card)
        }
        .buttonStyle(CardPressStyle())
    }

    private var liveBadge: some View {
        HStack(spacing: 5) {
            PulseDot(color: BaliColor.blue, size: 6)
            Text("LIVE")
                .font(BaliFont.at(10.5, 700)).tracking(0.4)
                .foregroundStyle(BaliColor.blue)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(BaliColor.blueTint)
        .clipShape(Capsule())
    }

    @ViewBuilder private var statusLabel: some View {
        let parts: (dot: Color, text: String, tint: Color) = {
            if isLive {
                if isCheckedIn { return (BaliColor.green, "Checked in", BaliColor.green) }
                return (BaliColor.blue, "Live now · tap in", BaliColor.blue)
            }
            if let next = nextLabel { return (BaliColor.ink4, next, BaliColor.ink3) }
            return (BaliColor.ink4, "No live session", BaliColor.ink3)
        }()
        HStack(spacing: 6) {
            Circle().fill(parts.dot).frame(width: 7, height: 7)
            Text(parts.text)
                .font(BaliFont.at(13, 600))
                .foregroundStyle(parts.tint)
                .lineLimit(1)
        }
    }
}

/// Subtle press feedback for whole-card buttons.
struct CardPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

// MARK: - Shared load/empty/error states

struct LoadingCard: View {
    var label = "Loading…"
    var body: some View {
        Card {
            HStack(spacing: BaliSpacing.m) {
                ProgressView().tint(BaliColor.blue)
                BaliText(label, .body)
            }
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, BaliSpacing.s)
        }
    }
}

struct ErrorStateCard: View {
    let message: String?
    let retry: () -> Void
    var body: some View {
        Card {
            VStack(spacing: BaliSpacing.m) {
                IconTile(systemImage: "exclamationmark.triangle.fill", tone: .coral, size: 48, glyphSize: 20)
                BaliText("Couldn't load", .h3)
                BaliText(message ?? "Please try again.", .foot)
                    .multilineTextAlignment(.center)
                BaliButton(title: "Try again", variant: .secondary, fullWidth: false, action: retry)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, BaliSpacing.s)
        }
    }
}

struct EmptyClassesCard: View {
    let onJoin: () -> Void
    var body: some View {
        Card {
            VStack(spacing: BaliSpacing.m) {
                IconTile(systemImage: "square.grid.2x2.fill", tone: .blue, size: 48, glyphSize: 20)
                BaliText("No classes yet", .h3)
                BaliText("Join your first class to see sessions and focus policy.", .foot)
                    .multilineTextAlignment(.center)
                BaliButton(title: "Join a class", icon: "plus", fullWidth: false, action: onJoin)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, BaliSpacing.s)
        }
    }
}

#Preview {
    ScrollView {
        VStack(spacing: 16) {
            ClassCard(summary: SampleStudentRepository.sampleSelf().classes[0],
                      policy: SampleStudentRepository.fullFocus, isCheckedIn: false) {}
            ClassCard(summary: SampleStudentRepository.sampleSelf().classes[1],
                      policy: SampleStudentRepository.noSocial, nextLabel: "Next 11:15 AM") {}
            LoadingCard()
        }
        .padding(20)
    }
    .background(BaliColor.bg)
}
