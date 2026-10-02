import BaliCore
import BaliOutbox
import SwiftUI

/// History (C6a; D1's History), where the router sends the History tab: the student's own moments
/// as `GET /v1/me/history` gives them — what their teachers see, nothing more — in D1's days and
/// class cards, times in the phone's locale and time zone (`History.days`, tested on Linux). Kept
/// while the app runs and shown at once, its newest page read again quietly each time it shows
/// (#141); reading, nothing yet and a read that failed are each said, a failure with Try again
/// (rule 5) — one over the moments kept said above them; an older page on Show earlier. Built as it
/// scrolls: only the days and cards on screen, each card by its own id (#139).
struct HistoryView: View {
    let phone: Phone

    var body: some View {
        let history = phone.history
        ScreenScaffold {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("History").textStyle(.h1).accessibilityAddTraits(.isHeader)
                        Text("The same moments your teachers see — nothing more.").textStyle(.body)
                            .foregroundStyle(Theme.textSecondary)
                    }
                    .padding(.bottom, 4)
                    if !history.read {
                        if let failure = history.failure {
                            Retry(words: failure, phone: phone) { await phone.readHistory() }
                        } else {
                            Text("Reading your history…").textStyle(.body)
                                .foregroundStyle(Theme.textTertiary)
                        }
                    } else {
                        if let notUpdated = history.notUpdated {
                            Retry(words: notUpdated, phone: phone) { await phone.readHistory() }
                        }
                        moments(history)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 16)
            }
            .scrollBounceBehavior(.basedOnSize).screenWide()
        }
        // Each time it shows, the moments kept show at once and the newest page is read again from
        // the top (#141) — and, forgotten while it shows (santa's round 2), it is read all the same.
        // Their own tasks, which leaving the screen does not cancel: an answer it outlives is kept
        // for the next visit. A fixture's stays as made.
        .onAppear { Task { await phone.refreshHistory() } }
        .onChange(of: phone.history == History()) { _, fresh in
            if fresh { Task { await phone.refreshHistory() } }
        }
    }

    /// The days read — or, with none and nothing older, that there is nothing yet — and Show
    /// earlier while an older page is left, its own failed page said there with Try again.
    @ViewBuilder private func moments(_ history: History) -> some View {
        let days = history.days(now: Date())
        if days.isEmpty, history.nextBefore == nil {
            Card {
                VStack(alignment: .leading, spacing: 8) {
                    Text("No moments yet").textStyle(.h3)
                    Text("When you tap in to a class, it shows here.").textStyle(.body)
                        .foregroundStyle(Theme.textSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        ForEach(Array(days.enumerated()), id: \.element.title) { index, day in
            Text(day.title).textStyle(.label).textCase(.uppercase)
                .foregroundStyle(Theme.textTertiary).padding(.top, index == 0 ? 0 : 4)
                .accessibilityAddTraits(.isHeader)
            ForEach(day.cards) { ClassCard(card: $0) }
        }
        if history.nextBefore != nil {
            if let failure = history.failure {
                Retry(words: failure, phone: phone) { await phone.readHistory(more: true) }
            } else {
                // Held while any read is under way, but "Reading…" only for its own page: the read
                // again from the top each visit makes stays quiet (#141).
                Button(history.busy && !history.fromTop ? "Reading…" : "Show earlier") {
                    Task { await phone.readHistory(more: true) }
                }
                .buttonStyle(SecondaryButtonStyle()).disabled(history.busy).padding(.top, 4)
            }
        }
    }
}

/// D1's class card: the class and its teacher, then each moment — its time, its icon in its state's
/// ink, its words and any note — a hairline between two. At the accessibility text sizes the
/// teacher sits under the class and the time above the words, so none is squeezed.
private struct ClassCard: View {
    let card: History.Card
    @Environment(\.dynamicTypeSize) private var size
    @ScaledMetric(relativeTo: .body) private var timeWidth: CGFloat = 68
    @ScaledMetric(relativeTo: .body) private var iconSize: CGFloat = 16

    /// Side by side as D1 draws them, or, at the accessibility text sizes, one above the other.
    private func line(@ViewBuilder _ content: () -> some View) -> some View {
        let layout =
            size.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))
        return layout(content)
    }

    var body: some View {
        Card(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                line {
                    Text(card.name).textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let teacher = card.teacher {
                        Text(teacher).textStyle(.caption).foregroundStyle(Theme.textTertiary)
                    }
                }
                .padding(.bottom, 4).accessibilityElement(children: .combine)
                ForEach(Array(card.moments.enumerated()), id: \.element.id) { index, moment in
                    if index > 0 { Rectangle().fill(Theme.border).frame(height: 1) }
                    row(moment)
                }
            }
            .padding(EdgeInsets(top: 12, leading: 16, bottom: 4, trailing: 16))
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func row(_ moment: History.Moment) -> some View {
        let (kind, icon) = look(moment.type)
        return line {
            Text(moment.time).textStyle(.data).foregroundStyle(Theme.textTertiary)
                .frame(width: size.isAccessibilitySize ? nil : timeWidth, alignment: .leading)
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Image(systemName: icon).font(.system(size: iconSize)).foregroundStyle(kind.look.ink)
                    .frame(width: iconSize + 2).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 0) {
                    Text(moment.words).textStyle(.body)
                    if let note = moment.note {
                        Text(note).textStyle(.caption).foregroundStyle(Theme.textTertiary)
                    }
                }
            }
        }
        .padding(.vertical, 6).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    /// A moment's state, whose ink its icon takes (DESIGN.md's states), and D1's icon for it: in
    /// focus, unlocked, Screen Time off, not in — a declined tap — and an end, of the class or of
    /// being in it.
    private func look(_ type: HistoryEventType) -> (Chip.Kind, String) {
        switch type {
        case .tapIn, .refocus: (.focused, "checkmark.circle")
        case .unlock: (.unlocked, "lock.open")
        case .protectionOff: (.protectionOff, "shield.slash")
        case .armedTapSkipped: (.notIn, "circle")
        case .sessionEnded, .sessionExpired, .leftForOtherSession, .enrollmentLeft,
            .enrollmentRemoved:
            (.ended, "flag")
        }
    }
}

#if DEBUG
    #Preview("History") { RootView(phone: Phone(fixture: PreviewFixtures.all["history"]!)) }
#endif
