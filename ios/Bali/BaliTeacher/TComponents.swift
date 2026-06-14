import SwiftUI

/// Shared teacher-app building blocks. Every addendum screen composes these so the
/// system never forks — one countdown arc, one context-aware action, one set of chips.

// MARK: - buttons

/// Full-width primary action (green, radius 14, 50pt) — the one CTA treatment.
struct TPrimaryButton: View {
    var title: String
    var busy: Bool = false
    var enabled: Bool = true
    var height: CGFloat = 50
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if busy { ProgressView().tint(.white) } else { Text(title) }
            }
            .font(.system(size: 17, weight: .semibold))
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .background(Tokens.Light.actionPrimaryBg)
            .foregroundColor(.white)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .disabled(busy || !enabled)
        .opacity(enabled ? 1 : 0.45)
    }
}

/// Bordered secondary action (white card + hairline).
struct TSecondaryButton: View {
    var title: String
    var systemImage: String? = nil
    var height: CGFloat = 50
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let systemImage { Image(systemName: systemImage).font(.system(size: 14, weight: .semibold)) }
                Text(title)
            }
            .font(.system(size: 15, weight: .semibold))
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .background(Tokens.Light.card)
            .foregroundColor(Tokens.Light.textPrimary)
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Tokens.Light.borderStrong, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }
}

/// Uppercase tertiary section label (matches T3/T5).
struct TSectionLabel: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .kerning(0.72)
            .foregroundColor(Tokens.Light.textTertiary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - context-aware class action

enum ClassActionKind: Equatable {
    case openLive(sessionId: String)
    case start
    case none
}

/// Identifiable target for presenting the T2 live grid via `.fullScreenCover(item:)`.
struct LiveTarget: Identifiable {
    var classId: String
    var sessionId: String
    var id: String { sessionId }
}

/// The single source of truth for a class's primary action. T1 cards, T1 schedule rows,
/// and the T6 header all read this so they can never disagree (addendum rule 6).
/// `forceStart` is for surfaces that always show a primary even when idle (the T6 header).
func classPrimaryAction(_ cls: TClassCard, forceStart: Bool = false) -> ClassActionKind {
    if let live = cls.live { return .openLive(sessionId: live.sessionId) }
    if forceStart || cls.isScheduledNow { return .start }
    return .none
}

// MARK: - countdown arc

struct ArcRing: View {
    var progress: CGFloat          // 1 = full, 0 = empty
    var size: CGFloat
    var lineWidth: CGFloat = 4.5

    var body: some View {
        ZStack {
            Circle().stroke(Tokens.Light.arcTrack, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: max(0, min(1, progress)))
                .stroke(Tokens.Light.arcFill, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: size, height: size)
    }
}

/// Fraction of a session still remaining (for the arc).
func sessionProgress(start: Date, end: Date, now: Date) -> CGFloat {
    let total = end.timeIntervalSince(start)
    guard total > 0 else { return 0 }
    return CGFloat(min(1, max(0, end.timeIntervalSince(now) / total)))
}

/// Pulsing 8pt "alive" dot — 2s ease loop, still under Reduce Motion (addendum / motion budget).
struct LiveDot: View {
    var size: CGFloat = 8
    @State private var on = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Circle()
            .fill(Tokens.green600)
            .frame(width: size, height: size)
            .opacity(reduceMotion ? 1 : (on ? 0.35 : 1))
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) { on = true }
            }
    }
}

// MARK: - summary chips (the §2 six-foot read)

struct SummaryChips: View {
    let counts: [String: Int]
    private let order = ["focused", "not_joined", "pass", "emergency_unlocked", "revoked", "no_device", "ended"]

    private var visible: [String] { order.filter { (counts[$0] ?? 0) > 0 } }

    var body: some View {
        // Self-contained flow so the chips wrap (the §2 read can exceed one row).
        FlowLayout(spacing: 6, lineSpacing: 6) {
            ForEach(visible, id: \.self) { state in
                let style = TChip.style(state)
                HStack(spacing: 5) {
                    Image(systemName: style.icon).font(.system(size: 11))
                    Text("\(counts[state] ?? 0)").font(.system(size: 13, weight: .semibold).monospacedDigit())
                }
                .foregroundColor(style.fg)
                .padding(.horizontal, 9).padding(.vertical, 4)
                .background(state == "no_device" ? Color.clear : style.bg)
                .overlay(state == "no_device" ? Capsule().stroke(style.fg, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3])) : nil)
                .clipShape(Capsule())
            }
        }
    }
}

/// One-line summary, e.g. "22 focused · 1 unlocked · 1 pass" (live banner subline).
func summaryLine(_ counts: [String: Int]) -> String {
    var parts: [String] = []
    let focused = counts["focused"] ?? 0
    parts.append("\(focused) focused")
    if let n = counts["emergency_unlocked"], n > 0 { parts.append("\(n) unlocked") }
    if let n = counts["pass"], n > 0 { parts.append("\(n) pass") }
    if let n = counts["revoked"], n > 0 { parts.append("\(n) permission off") }
    if let n = counts["no_device"], n > 0 { parts.append("\(n) no-device") }
    return parts.joined(separator: " · ")
}

// MARK: - live banner (pinned under the T6 header on every segment)

struct LiveBanner: View {
    let detail: TSessionDetail
    var onTap: () -> Void

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let now = context.date
            Button(action: onTap) {
                HStack(spacing: 12) {
                    ArcRing(
                        progress: sessionProgress(start: detail.session.startedAt, end: detail.session.endsAt, now: now),
                        size: 36
                    )
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            LiveDot()
                            Text("Live · \(mmss(detail.session.endsAt.timeIntervalSince(now))) · ends \(hmm(detail.session.endsAt))")
                                .font(.system(size: 14, weight: .semibold).monospacedDigit())
                                .foregroundColor(Tokens.Light.textPrimary)
                        }
                        Text(summaryLine(detail.counts))
                            .font(.system(size: 12.5))
                            .foregroundColor(Tokens.Light.textSecondary)
                            .lineLimit(1)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(Tokens.Light.textTertiary)
                }
                .padding(14)
                .background(Tokens.Light.card)
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Tokens.green200, lineWidth: 1.5))
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
        }
    }
}

// MARK: - stat cards (T6 Overview; reflows 2→1 column at accessibility sizes)

struct StatCard: View {
    var value: String
    var label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(value)
                .font(.system(size: 30, weight: .bold))
                .foregroundColor(Tokens.Light.textPrimary)
            Text(label)
                .font(.system(size: 13))
                .foregroundColor(Tokens.Light.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: 88, alignment: .leading)
        .padding(16)
        .background(Tokens.Light.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

struct StatGrid: View {
    let cells: [(value: String, label: String)]
    @Environment(\.dynamicTypeSize) private var dts

    var body: some View {
        let columns: [GridItem] = dts.isAccessibilitySize
            ? [GridItem(.flexible())]
            : [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]
        LazyVGrid(columns: columns, spacing: 12) {
            ForEach(Array(cells.enumerated()), id: \.offset) { _, cell in
                StatCard(value: cell.value, label: cell.label)
            }
        }
    }
}

// MARK: - join code (chip + full-screen projectable badge)

struct JoinCodeChip: View {
    let code: String
    var onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 8) {
                Text(code)
                    .font(.system(size: 14, design: .monospaced))
                    .kerning(1)
                    .foregroundColor(Tokens.Light.textPrimary)
                Image(systemName: "qrcode")
                    .font(.system(size: 14))
                    .foregroundColor(Tokens.Light.textSecondary)
            }
            .padding(.horizontal, 14)
            .frame(height: 44)
            .background(Tokens.Light.sunken)
            .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

/// The big projectable code — reached from T6's header chip, T9 no-members, and T12 reveal.
struct ProjectCodeView: View {
    let code: String
    var className: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            Tokens.Light.page.ignoresSafeArea()
            VStack(spacing: 24) {
                Spacer()
                ArcMarkView(size: 44, trackColor: Tokens.Light.border, fillColor: Tokens.green600)
                if let className {
                    Text(className)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(Tokens.Light.textSecondary)
                }
                Text(code)
                    .font(.system(size: 64, weight: .bold, design: .monospaced))
                    .kerning(4)
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                    .foregroundColor(Tokens.Light.textPrimary)
                    .padding(.horizontal, 16)
                Text("Project this for students — they join from the Bali app.")
                    .font(.system(size: 15))
                    .foregroundColor(Tokens.Light.textSecondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 300)
                Spacer()
                ShareLink(item: code) {
                    HStack(spacing: 8) {
                        Image(systemName: "square.and.arrow.up")
                        Text("Share the code")
                    }
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(Tokens.green700)
                }
                Button("Done") { dismiss() }
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(Tokens.Light.textSecondary)
                    .padding(.bottom, 24)
            }
            .padding(.horizontal, 20)
        }
    }
}

// MARK: - state icon dot (grayscale-safe; for T3 Recent + activity)

struct StateIconDot: View {
    let state: String
    var size: CGFloat = 34

    var body: some View {
        let style = TChip.style(state)
        ZStack {
            Circle()
                .fill(state == "no_device" ? Color.clear : style.bg)
                .overlay(state == "no_device" ? Circle().stroke(style.fg, style: StrokeStyle(lineWidth: 1.5, dash: [3, 2.5])) : nil)
            Image(systemName: style.icon)
                .font(.system(size: size * 0.42))
                .foregroundColor(style.fg)
        }
        .frame(width: size, height: size)
    }
}

// MARK: - event timeline card (T6 Activity)

func eventDotColor(_ type: String) -> Color {
    switch type {
    case "emergency_unlock", "reason_shared": return Tokens.orange400
    case "pass_granted", "pass_ended": return Tokens.Light.statePassFg
    case "permission_revoked": return Tokens.Light.stateRevokedFg
    case "permission_restored", "refocused", "tapped_in", "member_joined", "member_approved": return Tokens.green600
    default: return Tokens.Light.textTertiary
    }
}

/// A card of timeline rows (used for a single day-group on T6 Activity).
struct EventTimelineCard: View {
    let events: [TEvent]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(events.enumerated()), id: \.element.id) { idx, event in
                HStack(alignment: .top, spacing: 10) {
                    VStack(spacing: 0) {
                        Circle().fill(eventDotColor(event.type)).frame(width: 9, height: 9).padding(.top, 5)
                        if idx < events.count - 1 {
                            Rectangle().fill(Tokens.Light.border).frame(width: 1).frame(minHeight: 16)
                        }
                    }
                    VStack(alignment: .leading, spacing: 1) {
                        Text(event.title)
                            .font(.system(size: 14))
                            .foregroundColor(Tokens.Light.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                        if let subtitle = event.subtitle {
                            Text(subtitle).font(.system(size: 12.5)).foregroundColor(Tokens.Light.textSecondary)
                        }
                    }
                    .padding(.bottom, idx < events.count - 1 ? 14 : 0)
                    Spacer(minLength: 8)
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
}

/// The conversation-starter framing line — designed copy on T6 Activity, T10, T3 Recent.
struct FramingLine: View {
    var text: String = "Patterns are conversation starters, not verdicts."
    var body: some View {
        Text(text)
            .font(.system(size: 13))
            .italic()
            .foregroundColor(Tokens.Light.textTertiary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - custom segmented control (scrolls horizontally at accessibility sizes)

struct SegPicker: View {
    let items: [String]
    @Binding var selection: Int
    var fontSize: CGFloat = 13
    @Environment(\.dynamicTypeSize) private var dts

    private func segment(_ idx: Int, fill: Bool) -> some View {
        Button {
            withAnimation(.easeOut(duration: 0.15)) { selection = idx }
        } label: {
            Text(items[idx])
                .font(.system(size: fontSize, weight: .semibold))
                .lineLimit(1)
                .foregroundColor(selection == idx ? Tokens.Light.textPrimary : Tokens.Light.textSecondary)
                .padding(.horizontal, 14)
                .frame(minHeight: 32)
                .frame(maxWidth: fill ? .infinity : nil)
                .background(selection == idx ? Tokens.Light.card : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .shadow(color: selection == idx ? Color.black.opacity(0.08) : .clear, radius: 2, y: 1)
        }
        .buttonStyle(.plain)
    }

    var body: some View {
        Group {
            if dts.isAccessibilitySize {
                // Accessibility sizes: size-to-content and scroll horizontally (never truncate).
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 4) { ForEach(items.indices, id: \.self) { segment($0, fill: false) } }
                        .padding(3)
                }
            } else {
                HStack(spacing: 4) { ForEach(items.indices, id: \.self) { segment($0, fill: true) } }
                    .padding(3)
            }
        }
        .background(Tokens.Light.sunken)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}
