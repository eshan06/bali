//
//  JoinClassView.swift
//  Bali — Join Class (pushed)
//
//  Code / Link / QR entry → GET /classes/{id}/preview → confirm → POST
//  /classes/{id}/join. Links carry the classId (the web shares /join/{classId});
//  the design's short "code" has no server resolver yet (§9) so it's passed
//  through the same seam. QR needs a camera, so it's an honest device-only state
//  on the Simulator.
//

import SwiftUI

private enum JoinMethod: String, CaseIterable, Hashable {
    case code, link, qr
    var label: String { self == .qr ? "QR" : rawValue.capitalized }
}

struct JoinClassView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var method: JoinMethod = .code
    @State private var code = ""
    @State private var link = ""
    @State private var preview: ClassJoinPreview?
    @State private var isWorking = false
    @State private var joined = false
    @State private var errorText: String?

    var body: some View {
        DetailScaffold {
            VStack(alignment: .leading, spacing: 2) {
                Eyebrow("Add a class")
                BaliText("Join class", .display)
            }

            BaliSegmentedControl(items: JoinMethod.allCases, selection: $method) { $0.label }
                .disabled(preview != nil)

            if let preview {
                confirmCard(preview)
            } else {
                switch method {
                case .code: codeInput
                case .link: linkInput
                case .qr:   qrUnavailable
                }
                if let errorText { errorBanner(errorText) }
            }
        }
        .task {
            #if DEBUG
            // Verification aid: `-baliJoinToken 7K2-Q9F` prefills + previews so the
            // confirm state is screenshottable without typing. No effect otherwise.
            if preview == nil,
               let token = UserDefaults.standard.string(forKey: "baliJoinToken"),
               !token.isEmpty {
                code = token
                find(token: token)
            }
            #endif
        }
    }

    // MARK: - Inputs

    private var codeInput: some View {
        VStack(alignment: .leading, spacing: BaliSpacing.l) {
            VStack(alignment: .leading, spacing: BaliSpacing.s) {
                FieldLabel("Class code from your teacher")
                BaliTextField(placeholder: "e.g. 7K2-Q9F", text: $code,
                              icon: "hand.raised", autocapitalization: .characters)
                BaliText("Enter the code shown on the board.", .foot)
            }
            findButton(token: code)
        }
    }

    private var linkInput: some View {
        VStack(alignment: .leading, spacing: BaliSpacing.l) {
            VStack(alignment: .leading, spacing: BaliSpacing.s) {
                FieldLabel("Class link")
                BaliTextField(placeholder: "https://bali.app/join/…", text: $link,
                              icon: "link", keyboard: .URL)
                BaliText("Paste the class link your teacher shared.", .foot)
            }
            findButton(token: classId(fromLink: link) ?? link)
        }
    }

    private var qrUnavailable: some View {
        Card {
            VStack(spacing: BaliSpacing.m) {
                IconTile(systemImage: "qrcode.viewfinder", tone: .blue, size: 52, glyphSize: 24)
                BaliText("Scanning needs a physical iPhone", .h3)
                    .multilineTextAlignment(.center)
                BaliText("The Simulator has no camera. Use a code or link, or scan on a device.", .foot)
                    .multilineTextAlignment(.center)
                BaliButton(title: "Use a link instead", variant: .secondary, fullWidth: false) {
                    method = .link
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, BaliSpacing.s)
        }
    }

    private func findButton(token: String) -> some View {
        BaliButton(title: "Find class", icon: "magnifyingglass") { find(token: token) }
            .disabled(token.trimmingCharacters(in: .whitespaces).isEmpty || isWorking)
    }

    private func errorBanner(_ text: String) -> some View {
        HStack(spacing: BaliSpacing.s10) {
            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(BaliColor.coral)
            BaliText(text, .foot, color: BaliColor.badgeCoralText)
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BaliColor.coralTint)
        .clipShape(RoundedRectangle(cornerRadius: BaliRadius.r, style: .continuous))
    }

    // MARK: - Confirm

    private func confirmCard(_ preview: ClassJoinPreview) -> some View {
        VStack(alignment: .leading, spacing: BaliSpacing.l) {
            Card {
                VStack(alignment: .leading, spacing: BaliSpacing.m) {
                    HStack(spacing: BaliSpacing.m14) {
                        IconTile(systemImage: "graduationcap.fill", tone: .blue, size: 48, glyphSize: 20)
                        VStack(alignment: .leading, spacing: 3) {
                            if let period = preview.period {
                                BaliText(period.uppercased(), .eyebrow)
                            }
                            BaliText(preview.className, .h3)
                            BaliText(metaLine(preview), .foot)
                        }
                        Spacer(minLength: 0)
                    }

                    Rectangle().fill(BaliColor.line).frame(height: 1)

                    if preview.alreadyEnrolled {
                        HStack(spacing: BaliSpacing.s) {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(BaliColor.green)
                            BaliText("You're already in this class.", .bodyStrong)
                        }
                        BaliButton(title: "Back to classes", variant: .secondary) { dismiss() }
                    } else {
                        BaliButton(title: joined ? "Joined" : "Join class",
                                   icon: joined ? "checkmark" : nil,
                                   variant: joined ? .secondary : .primary) { join(preview) }
                            .disabled(isWorking)
                    }
                }
            }

            if !preview.alreadyEnrolled {
                BaliButton(title: "Look up another", variant: .ghost) {
                    self.preview = nil
                    errorText = nil
                }
            }
        }
    }

    // MARK: - Actions

    private func find(token: String) {
        errorText = nil
        isWorking = true
        Task {
            let found = await model.joinPreview(token: token)
            isWorking = false
            if let found { preview = found }
            else { errorText = model.errorMessage ?? "We couldn't find that class." }
        }
    }

    private func join(_ preview: ClassJoinPreview) {
        isWorking = true
        Task {
            let ok = await model.joinClass(preview)
            isWorking = false
            if ok {
                joined = true
                try? await Task.sleep(for: .seconds(0.7))
                dismiss()
            } else {
                errorText = model.errorMessage
            }
        }
    }

    private func metaLine(_ preview: ClassJoinPreview) -> String {
        [preview.teacherName, preview.schoolName].compactMap { $0 }.joined(separator: " · ")
    }

    /// Extract a classId from a shared link like `https://…/join/{classId}`.
    private func classId(fromLink link: String) -> String? {
        let trimmed = link.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed) else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" && !$0.isEmpty }
        if let i = parts.firstIndex(of: "join"), i + 1 < parts.count { return parts[i + 1] }
        return parts.last
    }
}

#Preview {
    NavigationStack { JoinClassView() }
        .injectBaliEnvironment(.preview())
}
