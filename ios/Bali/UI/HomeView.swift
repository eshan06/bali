import BaliCore
import BaliOutbox
import SwiftUI

/// Home (C3; D1's Home artboard): the student greeted by name, Tap in (B6's scan), their classes
/// with each teacher (`GET /v1/me`), and Join a class, opened over Home with a way back. What the
/// phone could not read or record is said with Try again (rule 5); where it stood unread with the
/// last run's shields on, Emergency Unlock is here (B6b, C4). D1's tab bar under it is the
/// router's to show (C6a, `RootView`).
struct HomeView: View {
    let phone: Phone

    private var me: MeResponse? { phone.sync?.me }

    var body: some View {
        ScreenScaffold {
            // Opened over Waiting: back to "Ready — waiting for your teacher" (#114's review),
            // above the scroll as Join's is, so it never scrolls away.
            if phone.canGoBack { BackButton { phone.back() } }
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(spacing: 8) {
                        BaliMark(size: 28).accessibilityHidden(true)
                        Text("Bali").textStyle(TextStyle(size: 20, line: 28, weight: .semibold))
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(me?.user.displayName.map { "Hi, \($0)" } ?? "Hi there").textStyle(.h1)
                        Text("Ready when your class is.").textStyle(.bodyLg)
                            .foregroundStyle(Theme.textSecondary)
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
                    tapIn
                    if let refused = phone.sync?.refusedTapWords {
                        Retry(words: refused, phone: phone)
                    }
                    classes
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, 16)
            }
            .scrollBounceBehavior(.basedOnSize)
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

    /// The student's classes as `GET /v1/me` names them — or, until a read answers, why not — and
    /// Join a class.
    private var classes: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Your classes").textStyle(.label).textCase(.uppercase)
                .foregroundStyle(Theme.textTertiary)
            if let me, me.classes.isEmpty {
                Text("No classes yet.").textStyle(.body).foregroundStyle(Theme.textSecondary)
            } else if let me {
                Card(padding: 0) {
                    VStack(spacing: 0) {
                        ForEach(Array(me.classes.enumerated()), id: \.element.id) { index, row in
                            if index > 0 { Rectangle().fill(Theme.border).frame(height: 1) }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.name)
                                    .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                                if let teacher = row.teacher?.displayName {
                                    Text(teacher).textStyle(.caption)
                                        .foregroundStyle(Theme.textTertiary)
                                }
                            }
                            .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
                            .padding(.horizontal, 16).accessibilityElement(children: .combine)
                        }
                    }
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
    }
}

/// What the phone could not read, said (rule 5), and **Try again**: everything queued sent now,
/// and the truth read again (`Phone.retry`) — or, for a screen's own read, `again`.
struct Retry: View {
    let words: String
    let phone: Phone
    var again: (@MainActor () async -> Void)?

    var body: some View {
        Card(padding: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text(words).textStyle(.body)
                Button("Try again") { Task { await (again ?? phone.retry)() } }
                    .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                    .foregroundStyle(Theme.brand).frame(minHeight: 44)
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
#endif
