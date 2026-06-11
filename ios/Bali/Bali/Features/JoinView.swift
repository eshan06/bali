import SwiftUI

/// S2 · Join a class — 8 mono cells, auto-uppercase; class preview BEFORE the join
/// button (informed consent); invalid + pending states per spec.
struct JoinView: View {
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    var onJoined: () async -> Void

    @State private var code = ""
    @State private var preview: JoinResult?
    @State private var errorText: String?
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
                    if cleaned.count == 8 {
                        Task { await lookUp(cleaned) }
                    } else {
                        preview = nil
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
                                errorText != nil ? Tokens.red500 : active ? Tokens.green400 : Tokens.Dark.borderStrong,
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
                Label("Request sent", systemImage: "hourglass")
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
                if !p.allowedAppLabels.isEmpty {
                    Text("During focus, this class allows")
                        .font(.system(size: 12))
                        .foregroundColor(Tokens.Dark.textTertiary)
                    AllowedAppsRow(labels: p.allowedAppLabels, messagesAllowed: p.messagesAllowed)
                }
                Button {
                    Task { await onJoined(); dismiss() }
                } label: {
                    Text("Done")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(maxWidth: .infinity).frame(height: 50)
                        .background(Tokens.Dark.actionPrimaryBg)
                        .foregroundColor(Tokens.Dark.actionPrimaryFg)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
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

    private func lookUp(_ value: String) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            preview = try await auth.api.post("join", body: JoinBody(code: value), as: JoinResult.self)
        } catch {
            preview = nil
            errorText = "That code doesn't match a class — check the board."
        }
    }
}

/// AllowedAppsRow — generic glyphs + policy labels, never real app icons (honesty rule).
struct AllowedAppsRow: View {
    var labels: [String]
    var messagesAllowed: Bool

    private func glyph(for label: String) -> String {
        switch label.lowercased() {
        case "notes": return "square.and.pencil"
        case "camera": return "camera"
        case "calculator": return "plus.forwardslash.minus"
        case "music": return "music.note"
        case "books", "reading": return "book"
        default: return "app"
        }
    }

    var body: some View {
        HStack(spacing: 14) {
            chip(symbol: "phone", label: "Phone")
            if messagesAllowed { chip(symbol: "message", label: "Messages") }
            ForEach(labels, id: \.self) { label in
                chip(symbol: glyph(for: label), label: label)
            }
        }
    }

    private func chip(symbol: String, label: String) -> some View {
        VStack(spacing: 6) {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Tokens.Dark.raised)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(Tokens.Dark.border, lineWidth: 1)
                    )
                    .frame(width: 48, height: 48)
                Image(systemName: symbol)
                    .font(.system(size: 19))
                    .foregroundColor(Tokens.Dark.textSecondary)
            }
            Text(label)
                .font(.system(size: 11))
                .foregroundColor(Tokens.Dark.textTertiary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label) stays available")
    }
}
