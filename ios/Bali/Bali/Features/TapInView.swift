import SwiftUI

/// Tag-code entry sheet — the Simulator's stand-in for an NFC tap (Core NFC is
/// device-only; the reader lands with the device pass, same resolve path).
struct TagEntrySheet: View {
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    var onResolved: (TagResolution) -> Void

    @State private var code = ""
    @State private var errorText: String?
    @State private var busy = false
    @FocusState private var focused: Bool

    var body: some View {
        ZStack {
            Tokens.Dark.page.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                Text("Tap the desk tag")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(Tokens.Dark.textPrimary)
                    .padding(.top, 24)
                Text("On an iPhone this is a real NFC tap. Here, enter the tag code printed under the QR.")
                    .font(.system(size: 14))
                    .foregroundColor(Tokens.Dark.textSecondary)

                TextField("", text: $code, prompt: Text("T7XK2M9QPF").foregroundColor(Tokens.Dark.textTertiary))
                    .focused($focused)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.system(size: 22, weight: .semibold, design: .monospaced))
                    .kerning(2)
                    .foregroundColor(Tokens.Dark.textPrimary)
                    .padding(.horizontal, 16)
                    .frame(height: 56)
                    .background(Tokens.Dark.card)
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(errorText == nil ? Tokens.Dark.borderStrong : Tokens.red500, lineWidth: 1)
                    )

                if let errorText {
                    Text(errorText).font(.system(size: 13)).foregroundColor(Tokens.red300)
                }

                Button {
                    Task { await resolve() }
                } label: {
                    Group {
                        if busy { ProgressView().tint(Tokens.Dark.actionPrimaryFg) } else { Text("Continue") }
                    }
                    .font(.system(size: 17, weight: .semibold))
                    .frame(maxWidth: .infinity).frame(height: 50)
                    .background(Tokens.Dark.actionPrimaryBg)
                    .foregroundColor(Tokens.Dark.actionPrimaryFg)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .disabled(code.count < 10 || busy)
                .opacity(code.count < 10 ? 0.45 : 1)

                Spacer()
            }
            .padding(.horizontal, 20)
        }
        .preferredColorScheme(.dark)
        .onAppear { focused = true }
    }

    private func resolve() async {
        busy = true
        defer { busy = false }
        do {
            let resolution = try await auth.api.post(
                "tags/resolve",
                body: ResolveBody(code: code.trimmingCharacters(in: .whitespaces).uppercased()),
                as: TagResolution.self
            )
            onResolved(resolution)
        } catch {
            errorText = "This tag isn't active — check with your teacher."
        }
    }
}

/// S4 · Tap-In Confirmation — the breath before focus. One screen, one decision.
/// Variants come from the server's resolve response: ready / not_member /
/// session_not_started.
struct TapInView: View {
    @Environment(\.dismiss) private var dismiss
    let resolution: TagResolution
    var onStartFocus: (ResolvedSession, String, String) async -> Void

    @State private var busy = false

    var body: some View {
        ZStack {
            Tokens.Dark.page.ignoresSafeArea()
            switch resolution.variant {
            case "ready":
                ready
            case "session_not_started":
                notStarted
            default:
                notMember
            }
        }
        .preferredColorScheme(.dark)
    }

    private var ready: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 10) {
                Text("You tapped into")
                    .font(.system(size: 15))
                    .foregroundColor(Tokens.Dark.textSecondary)
                Text(resolution.className)
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(Tokens.Dark.textPrimary)
                    .multilineTextAlignment(.center)
                if let session = resolution.session {
                    Text("until \(timeLabel(session.endsAt))")
                        .font(.system(size: 22))
                        .foregroundColor(Tokens.Dark.textSecondary)
                }
            }
            .padding(.horizontal, 20)

            if let session = resolution.session {
                VStack(spacing: 10) {
                    AllowedAppsRow(labels: session.allowedAppLabels, messagesAllowed: session.messagesAllowed)
                    Text("These stay available. Everything else rests.")
                        .font(.system(size: 12))
                        .foregroundColor(Tokens.Dark.textTertiary)
                }
                .padding(.top, 34)
            }

            Spacer()

            VStack(spacing: 12) {
                Button {
                    guard let session = resolution.session else { return }
                    busy = true
                    Task {
                        await onStartFocus(session, resolution.className, resolution.teacherDisplayName)
                        busy = false
                    }
                } label: {
                    Group {
                        if busy { ProgressView().tint(Tokens.Dark.actionPrimaryFg) } else { Text("Start Focus") }
                    }
                    .font(.system(size: 17, weight: .semibold))
                    .frame(maxWidth: .infinity).frame(height: 50)
                    .background(Tokens.Dark.actionPrimaryBg)
                    .foregroundColor(Tokens.Dark.actionPrimaryFg)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                Text("Ends at the bell — or instantly with Emergency Unlock.")
                    .font(.system(size: 13))
                    .foregroundColor(Tokens.Dark.textTertiary)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 48)
        }
    }

    private var notStarted: some View {
        infoVariant(
            symbol: "clock",
            title: "\(resolution.teacherDisplayName) hasn't started a session",
            body: "You're early. Focus begins when the session does.",
            buttonLabel: "OK"
        )
    }

    private var notMember: some View {
        infoVariant(
            symbol: "person.badge.plus",
            title: "This tag belongs to \(resolution.className)",
            body: "You're not in this class yet. Join it first — the code from the board works any time.",
            buttonLabel: "OK"
        )
    }

    private func infoVariant(symbol: String, title: String, body bodyText: String, buttonLabel: String) -> some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: symbol)
                .font(.system(size: 40))
                .foregroundColor(Tokens.Dark.textTertiary)
            Text(title)
                .font(.system(size: 24, weight: .bold))
                .foregroundColor(Tokens.Dark.textPrimary)
                .multilineTextAlignment(.center)
            Text(bodyText)
                .font(.system(size: 15))
                .foregroundColor(Tokens.Dark.textSecondary)
                .multilineTextAlignment(.center)
            Spacer()
            Button(buttonLabel) { dismiss() }
                .font(.system(size: 17, weight: .semibold))
                .frame(maxWidth: .infinity).frame(height: 50)
                .background(Tokens.Dark.actionPrimaryBg)
                .foregroundColor(Tokens.Dark.actionPrimaryFg)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .padding(.bottom, 48)
        }
        .padding(.horizontal, 20)
    }

    private func timeLabel(_ date: Date) -> String {
        let fmt = DateFormatter()
        fmt.timeStyle = .short
        return fmt.string(from: date)
    }
}
