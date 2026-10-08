import BaliCore
import BaliOutbox
import SwiftUI

/// Home (C3; D1's Home artboard): the student greeted by name, Tap in (B6's scan), their classes
/// with each teacher (`GET /v1/me`), and Join a class, opened over Home with a way back. What the
/// phone could not read or record is said with Try again (rule 5); where it stood unread with the
/// last run's shields on, Emergency Unlock is here (B6b, C4). D1's tab bar under it is the
/// router's to show (C6a, `RootView`). A class of theirs in session, the student not focused in
/// it, its card takes the hero's place (C3c) — and so, waiting for their teacher's Start, does the
/// wait's (#151), and, in no class, the way into one: not in one yet, or in none any more (#143;
/// the approved Sign in & sign up design's Home boards).
struct HomeView: View {
    let phone: Phone
    /// The card's bell, rung: the card goes then, by the phone's clock (C3c).
    @State private var rung: Date?
    /// Why Lock my apps again did not go through (rule 5).
    @State private var notBack: String?

    private var me: MeResponse? { phone.sync?.me }

    var body: some View {
        let _ = rung
        let card = phone.sync?.inSessionCard(at: Date())
        let waiting = phone.sync?.waitingCard
        let empty = phone.sync?.noClassesCard(everInClass: phone.everInClass)
        ScreenScaffold {
            // Opened over Unlocked: back to it (C5c), above the scroll as Join's is, so it never
            // scrolls away. Never to Waiting: its Home is the regular one (#151).
            if phone.canGoBack { BackButton { phone.back() } }
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(spacing: 8) {
                        BaliMark(size: 28).accessibilityHidden(true)
                        Text("Bali").textStyle(TextStyle(size: 20, line: 28, weight: .semibold))
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(me?.user.displayName.map { "Hi, \($0)" } ?? "Hi there").textStyle(.h1)
                        if card == nil, waiting == nil, empty == nil {
                            Text("Ready when your class is.").textStyle(.bodyLg)
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                    if phone.sync?.standing == .unread {
                        Retry(
                            words:
                                "Bali can't tell right now whether you're in a class. It keeps checking.",
                            phone: phone)
                        // The router keeps Home over the last run's shields: their way out.
                        if phone.protection?.shielded == true {
                            EmergencyUnlock(
                                phone: phone,
                                caption: "Works without Wi-Fi. Letting go early does nothing.",
                                paused: true)
                        }
                    }
                    // In every build, as Emergency Unlock is wherever the shields can be on:
                    // nothing may shield a phone with no way out (ARCHITECTURE; FocusTests).
                    if let card {
                        // Its unlock stuck on the phone, said here too (C5c's review).
                        if card.unlocked, let sync = phone.sync,
                            let stuck = UnlockedWords(sync)?.stuck
                        {
                            Retry(words: stuck, phone: phone)
                        }
                        inSession(card)
                    } else if let waiting {
                        waitingCard(waiting)
                    } else if let empty {
                        noClasses(empty)
                    } else {
                        tapIn
                    }
                    // A read of the classes that did not go: a card may be older than it says
                    // (santa's round 1), and the wait's Start is found by that read (decision 6),
                    // as Waiting says — said by the classes themselves while none is read.
                    if card != nil || waiting != nil || empty != nil, phone.sync?.me != nil,
                        let failed = phone.sync?.meWords
                    {
                        Retry(words: failed, phone: phone)
                    }
                    // A Back to focus refused, in a class this build knows no state of (C5b) —
                    // unlocked there, the card says it (santa's round 2).
                    if card?.unlocked != true, let refused = phone.sync?.refusedRefocusWords(at: Date()) {
                        Card(padding: 16) {
                            Text(refused).textStyle(.body)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    if let refused = phone.sync?.refusedTapWords {
                        Retry(words: refused, phone: phone)
                    }
                    // In no class, the card is the classes' own empty state, its Join a class
                    // theirs: one way in, never two (#143).
                    if empty == nil { ClassesSection(phone: phone, title: "Your classes") }
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 16)
            }
            .scrollBounceBehavior(.basedOnSize).screenWide()
        }
    }

    /// A class in session, the student not focused in it (C3c), in D1's look: the state's chip and
    /// what is true, then the way on — Tap in, or Lock my apps again — gone at the bell.
    private func inSession(_ card: InSessionCard) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                Chip(
                    kind: card.unlocked ? .unlocked : .notIn,
                    text: card.unlocked ? "Unlocked" : "Not in")
                Text(card.words).textStyle(.bodyLg).fixedSize(horizontal: false, vertical: true)
                if let retap = card.retap {
                    // Unlocked's own rule: out of protection off, or its refocus refused, a
                    // re-tap is the way back (A2; santa's round 1).
                    Text(retap).textStyle(.body)
                    TapIn(phone: phone, primary: false)
                } else if card.unlocked {
                    Button("Lock my apps again") {
                        Task {
                            notBack = await phone.backToFocus()
                            if let notBack {
                                AccessibilityNotification.Announcement(notBack).post()
                            }
                        }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    if let notBack { Text(notBack).textStyle(.body) }
                } else {
                    TapIn(phone: phone)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .task(id: card.bell) {
            await Screen.bell(card.bell, change: UIApplication.significantTimeChangeNotification)
            if !Task.isCancelled { rung = card.bell }
        }
    }

    /// Waiting for the teacher's Start (#151; the owner's decision, 2026-10-01), in C3c's look: the
    /// wait's chip, what is true — the tap counted, and when the phone locks — and Tap in,
    /// secondary: only a Start or another tap ends the wait, so a block tapped by mistake, or a
    /// Start that never comes, is never a dead end.
    private func waitingCard(_ words: String) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                Chip(kind: .waiting, text: "Waiting")
                Text(words).textStyle(.bodyLg).fixedSize(horizontal: false, vertical: true)
                TapIn(phone: phone, primary: false)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// In no class (#143; as the approved Sign in & sign up design's Home boards draw it, C3c's
    /// look without a chip: no class, no state): what is true and how in, and Join a class, opened
    /// over Home with its way back (C3b). No Tap in: a tap joins only a class the student is in.
    private func noClasses(_ words: String) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                Text(words).textStyle(.bodyLg).fixedSize(horizontal: false, vertical: true)
                Button {
                    phone.open(.join)
                } label: {
                    Label("Join a class", systemImage: "plus")
                }
                .buttonStyle(PrimaryButtonStyle())
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// D1's hero card: the block's scan, and why the last one recorded no tap.
    private var tapIn: some View {
        Card {
            VStack(spacing: 8) {
                Image(systemName: "wave.3.right").font(.system(size: 40))
                    .foregroundStyle(Theme.brand).frame(width: 120, height: 120)
                    .overlay(Circle().inset(by: 8).stroke(Theme.arcTrack, lineWidth: 10))
                    .padding(.bottom, 4).accessibilityHidden(true)
                Text("Tap your teacher's block").textStyle(.h3)
                Text("Hold the top of your phone near the Bali block when class starts.")
                    .textStyle(.body).foregroundStyle(Theme.textSecondary)
                Button {
                    Task { await phone.tapIn() }
                } label: {
                    Label(phone.scanning ? "Scanning…" : "Tap in", systemImage: "wave.3.right")
                }
                .buttonStyle(PrimaryButtonStyle()).disabled(phone.scanning).padding(.top, 8)
                if let failed = phone.tapFailed { Text(failed).textStyle(.body) }
            }
            .multilineTextAlignment(.center)
        }
    }
}

/// The student's classes as `GET /v1/me` names them, each with its teacher — or, until a read
/// answers, why not — and Join a class, opened over the screen with a way back: Home's (C3) and
/// Me's (C6b), under `title`. Me's, `leaves`, has D1's Leave on each class, its question under
/// it, and D1's line under them (C6c) — a class's Leave held while the phone stands in its lesson,
/// judged once for the class, so its button and its line agree, and again at the lesson's bell.
struct ClassesSection: View {
    let phone: Phone
    let title: String
    var leaves = false
    /// The bell of the lesson the phone stands in, rung: a Leave held for it is let go then, by
    /// the phone's clock, as Home's card goes at its own (#134's review).
    @State private var rung: Date?

    private var me: MeResponse? { phone.sync?.me }

    var body: some View {
        let _ = rung
        VStack(alignment: .leading, spacing: 8) {
            Text(title).textStyle(.label).textCase(.uppercase)
                .foregroundStyle(Theme.textTertiary)
            if let me, me.classes.isEmpty {
                Text("No classes yet.").textStyle(.body).foregroundStyle(Theme.textSecondary)
            } else if let me {
                Card(padding: 0) {
                    VStack(spacing: 0) {
                        ForEach(Array(me.classes.enumerated()), id: \.element.id) { index, row in
                            let held =
                                leaves
                                ? phone.sync.flatMap { Leaving.held(row, $0, now: Date()) } : nil
                            if index > 0 { Rectangle().fill(Theme.border).frame(height: 1) }
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(row.name)
                                        .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                                    if let teacher = row.teacher?.displayName {
                                        Text(teacher).textStyle(.caption)
                                            .foregroundStyle(Theme.textTertiary)
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .accessibilityElement(children: .combine)
                                if leaves { LeaveButton(row: row, phone: phone, held: held) }
                            }
                            // Clear of the hairlines once the text size outgrows D1's 60.
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
                            .padding(.horizontal, 16)
                            if leaves { LeaveQuestion(row: row, phone: phone, held: held) }
                        }
                    }
                }
                if leaves {
                    Text(Leaving.recorded).textStyle(.caption).foregroundStyle(Theme.textTertiary)
                }
            } else if let words = phone.sync?.meWords {
                Retry(words: words, phone: phone)
            } else {
                Text("Reading your classes…").textStyle(.body)
                    .foregroundStyle(Theme.textTertiary)
            }
            // Not while where the phone stands is unread: the router keeps Home then (B6b).
            if phone.sync?.standing != .unread {
                Button {
                    phone.open(.join)
                } label: {
                    Label("Join a class", systemImage: "plus")
                }
                .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                .foregroundStyle(Theme.brand).frame(minHeight: 44)
            }
        }
        .task(id: leaves ? phone.bell : nil) {
            guard leaves, let bell = phone.bell else { return }
            await Screen.bell(bell, change: UIApplication.significantTimeChangeNotification)
            if !Task.isCancelled { rung = bell }
        }
    }
}

/// What the phone could not read, said (rule 5), and **Try again**: everything queued sent now,
/// and the truth read again (`Phone.retry`) — or, for a screen's own read, `again`, which reads
/// Reading…, dimmed, while `reading` (History's, F4's review).
struct Retry: View {
    let words: String
    let phone: Phone
    var reading = false
    var again: (@MainActor () async -> Void)?

    var body: some View {
        Card(padding: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text(words).textStyle(.body)
                Button(reading ? "Reading…" : "Try again") {
                    Task { await (again ?? phone.retry)() }
                }
                .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                .foregroundStyle(Theme.brand).frame(minHeight: 44)
                .disabled(reading).opacity(reading ? 0.6 : 1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

#if DEBUG
    #Preview("Home") { RootView(phone: Phone(fixture: PreviewFixtures.all["home"]!)) }
    #Preview("Home — reading") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["homeLoading"]!))
    }
    #Preview("Home — no answer") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["homeError"]!))
    }
    #Preview("Home — in no class") {
        RootView(phone: Phone(fixture: PreviewFixtures.all["homeNoClasses"]!))
    }
#endif
