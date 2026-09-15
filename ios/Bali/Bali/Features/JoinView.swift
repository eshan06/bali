import SwiftUI

/// S2 · Join a class — 8 mono cells, auto-uppercase; class preview BEFORE the join
/// button (informed consent); invalid + pending states per spec.
struct JoinView: View {
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    var onJoined: () async -> Void

    @State private var code = ""
    @State private var preview: JoinResult?
    /// The code that produced `preview`. The join posts THIS, never the live field: the
    /// student consents to the class they are reading, not to whatever is typed by then.
    @State private var previewCode: String?
    @State private var lookupTask: Task<Void, Never>?
    @State private var looking = false
    @State private var errorText: String?
    /// Red cells are a claim about the code itself, so only a rejected code lights them.
    @State private var codeRejected = false
    @State private var joinError: String?
    @State private var joined = false // true only once THIS screen posted the join
    @State private var busy = false
    @FocusState private var focused: Bool

    var body: some View {
        ZStack {
            Tokens.Dark.page.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 18) {
                Text("Join a class")
                    .font(.system(size: 34, weight: .bold))
                    .foregroundColor(Tokens.Dark.textPrimary)
                    .padding(.top, 24)
                Text("Enter the code from the board, or scan its QR.")
                    .font(.system(size: 15))
                    .foregroundColor(Tokens.Dark.textSecondary)

                cells
                    .onTapGesture { focused = true }

                if let errorText {
                    Text(errorText)
                        .font(.system(size: 13))
                        .foregroundColor(Tokens.red300)
                }

                if looking {
                    Text("Checking that code…")
                        .font(.system(size: 13))
                        .foregroundColor(Tokens.Dark.textSecondary)
                }

                if let preview {
                    previewCard(preview)
                }

                Spacer()
            }
            .padding(.horizontal, 20)

            // hidden input drives the cells
            TextField("", text: $code)
                .focused($focused)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .opacity(0.02)
                .frame(width: 1, height: 1)
                .onChange(of: code) { newValue in
                    let cleaned = String(newValue.uppercased().filter { $0.isLetter || $0.isNumber }.prefix(8))
                    if cleaned != newValue { code = cleaned }
                    errorText = nil
                    codeRejected = false
                    joinError = nil
                    // The card on screen must always be the class the cells spell, so a newer
                    // code supersedes an in-flight lookup instead of being dropped, and the
                    // stale preview leaves with the code that produced it.
                    lookupTask?.cancel()
                    preview = nil
                    previewCode = nil
                    joined = false
                    looking = cleaned.count == 8
                    if cleaned.count == 8 {
                        lookupTask = Task { await lookUp(cleaned) }
                    }
                }
        }
        .preferredColorScheme(.dark)
        .onAppear { focused = true }
    }

    private var cells: some View {
        HStack(spacing: 8) {
            ForEach(0 ..< 8, id: \.self) { i in
                let char = i < code.count ? String(Array(code)[i]) : ""
                let active = i == code.count && preview == nil
                Text(char)
                    .font(.system(size: 22, weight: .semibold, design: .monospaced))
                    .foregroundColor(Tokens.Dark.textPrimary)
                    .frame(width: 38, height: 48)
                    .background(Tokens.Dark.card)
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(
                                codeRejected ? Tokens.red500 : active ? Tokens.green400 : Tokens.Dark.borderStrong,
                                lineWidth: active ? 2 : 1
                            )
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
    }

    private func previewCard(_ p: JoinResult) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if p.membershipStatus == "pending" {
                Label(joined ? "Request sent" : "Request pending", systemImage: "hourglass")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundColor(Tokens.Dark.textPrimary)
                Text("\(p.teacherDisplayName) approves new members. You'll see the class on Home once you're in.")
                    .font(.system(size: 14))
                    .foregroundColor(Tokens.Dark.textSecondary)
                Button("Done") { Task { await onJoined(); dismiss() } }
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Tokens.green300)
            } else {
                Text(p.className)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundColor(Tokens.Dark.textPrimary)
                Text("\(p.teacherDisplayName) · \(p.scheduleLabel)")
                    .font(.system(size: 14))
                    .foregroundColor(Tokens.Dark.textSecondary)
                FocusScopeRow()
                if let joinError {
                    Text(joinError)
                        .font(.system(size: 13))
                        .foregroundColor(Tokens.red300)
                }
                // Nothing is written until this tap: "none" means the student is only
                // looking at the class, so the button commits instead of acknowledging.
                if p.membershipStatus == "none" {
                    primaryButton(busy ? "Joining…" : "Join class") { Task { await join() } }
                        .disabled(busy)
                } else {
                    Text(joined ? "You're in — Home shows this class now." : "You're already in this class.")
                        .font(.system(size: 14))
                        .foregroundColor(Tokens.Dark.textSecondary)
                    primaryButton("Done") { Task { await onJoined(); dismiss() } }
                }
                Text("You can leave any time in Settings.")
                    .font(.system(size: 12))
                    .foregroundColor(Tokens.Dark.textTertiary)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(18)
        .background(Tokens.Dark.card)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func primaryButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 17, weight: .semibold))
                .frame(maxWidth: .infinity).frame(height: 50)
                .background(Tokens.Dark.actionPrimaryBg)
                .foregroundColor(Tokens.Dark.actionPrimaryFg)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    /// The 8th character only *looks the class up* — informed consent means the student
    /// reads who they're joining before anything is written to that teacher's class.
    private func lookUp(_ value: String) async {
        do {
            let result = try await auth.api.get("classes/preview?code=\(value)", as: JoinResult.self)
            // A newer code may have arrived while this was in flight — that lookup owns the screen.
            guard !Task.isCancelled, code == value else { return }
            preview = result
            previewCode = value
            joined = false
            looking = false
        } catch {
            guard !Task.isCancelled, code == value else { return }
            preview = nil
            previewCode = nil
            looking = false
            errorText = lookupMessage(for: error)
            codeRejected = (error as? APIError)?.code == "bad_code"
        }
    }

    /// Only `bad_code` is a statement about the code. Offline, a 429 while the student
    /// corrects a typo, or a 500 must not accuse the code they read off the board.
    private func lookupMessage(for error: Error) -> String {
        guard let api = error as? APIError else {
            return "Couldn't check that code — check your connection and try again."
        }
        if api.code == "bad_code" { return api.message }
        if api.status >= 500 || api.message.isEmpty {
            return "Couldn't check that code right now — try again in a moment."
        }
        return api.message // rate limit / auth: the server's own wording is the accurate one
    }

    private func join() async {
        // Post the code that produced the preview on screen, never the live field — it may
        // have moved on to a different class since the student read this one.
        guard !busy, let target = previewCode else { return }
        busy = true
        joinError = nil
        defer { busy = false }
        do {
            preview = try await auth.api.post("join", body: JoinBody(code: target), as: JoinResult.self)
            joined = true
        } catch {
            joinError = (error as? APIError)?.message ?? "Couldn't join — check your connection and try again."
        }
    }
}

/// FocusScopeRow — the full-focus rule, honestly stated. Every session is identical
/// (full focus), so there's nothing per-class to show: every app pauses except the few
/// the student chose once at onboarding, plus calls & Messages (unblockable on iOS). We
/// never show real app icons or the student's private allow-list (honesty rule).
struct FocusScopeRow: View {
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "moon.zzz")
                .font(.system(size: 16))
                .foregroundColor(Tokens.Dark.textSecondary)
            Text("Full focus — every app pauses except the few you chose. Calls & Messages always work.")
                .font(.system(size: 13))
                .foregroundColor(Tokens.Dark.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Full focus. Every app pauses except the few you chose. Calls and Messages always work.")
    }
}
