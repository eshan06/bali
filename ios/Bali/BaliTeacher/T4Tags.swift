import SwiftUI

/// T4 · Tags — class-scoped rows + the write flow. The NFC write happens here on
/// iPhone; the web (W7) prints the QR sheets for the same codes.
struct T4TagsView: View {
    @EnvironmentObject private var store: TeacherStore
    @State private var classes: [TClassCard] = []
    @State private var classId: String?
    @State private var tags: [TTag] = []
    @State private var showWrite = false
    @State private var deactivateTarget: TTag?

    var body: some View {
        NavigationStack {
            ZStack {
                Tokens.Light.page.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Desk tags")
                            .font(.system(size: 34, weight: .bold))
                            .foregroundColor(Tokens.Light.textPrimary)
                            .padding(.top, 12)

                        if classes.count > 1 {
                            Menu {
                                ForEach(classes) { cls in
                                    Button(cls.name) {
                                        classId = cls.id
                                        Task { await loadTags() }
                                    }
                                }
                            } label: {
                                HStack(spacing: 6) {
                                    Text(classes.first { $0.id == classId }?.name ?? "Choose a class")
                                        .font(.system(size: 15, weight: .semibold))
                                        .foregroundColor(Tokens.Light.textPrimary)
                                    Image(systemName: "chevron.down")
                                        .font(.system(size: 12))
                                        .foregroundColor(Tokens.Light.textTertiary)
                                }
                                .padding(.horizontal, 14).padding(.vertical, 8)
                                .background(Tokens.Light.card)
                                .clipShape(Capsule())
                            }
                        }

                        VStack(spacing: 10) {
                            ForEach(tags) { tag in
                                tagRow(tag)
                            }
                        }

                        if tags.isEmpty {
                            Text("No tags for this class yet. Write one, stick it where students tap.")
                                .font(.system(size: 14))
                                .foregroundColor(Tokens.Light.textSecondary)
                        }

                        Button {
                            showWrite = true
                        } label: {
                            Text("Write a new tag")
                                .font(.system(size: 16, weight: .semibold))
                                .frame(maxWidth: .infinity)
                                .frame(height: 48)
                                .background(Tokens.Light.actionPrimaryBg)
                                .foregroundColor(.white)
                                .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                        }
                        .disabled(classId == nil)
                        .padding(.top, 4)

                        Text("Printing QR sheets happens on the web (Tags page). Labels are only ever shown to you.")
                            .font(.system(size: 12.5))
                            .foregroundColor(Tokens.Light.textTertiary)
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 36)
                }
                .refreshable {
                    await loadClasses()
                    await loadTags()
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .task {
                await loadClasses()
                await loadTags()
            }
            .sheet(isPresented: $showWrite) {
                if let classId {
                    WriteTagSheet(classId: classId) {
                        showWrite = false
                        await loadTags()
                    }
                    .presentationDetents([.medium])
                }
            }
            .alert(
                "Deactivate \"\(deactivateTarget?.label ?? "")\"?",
                isPresented: Binding(get: { deactivateTarget != nil }, set: { if !$0 { deactivateTarget = nil } })
            ) {
                Button("Cancel", role: .cancel) { deactivateTarget = nil }
                Button("Deactivate", role: .destructive) {
                    if let tag = deactivateTarget {
                        Task {
                            struct Body: Encodable { var active: Bool }
                            _ = try? await store.api.patch("tags/\(tag.id)", body: Body(active: false), as: TTag.self)
                            deactivateTarget = nil
                            await loadTags()
                        }
                    }
                }
            } message: {
                Text("Every printed copy of this tag stops working immediately. Students can still join by code.")
            }
        }
    }

    private func loadClasses() async {
        struct R: Decodable { var classes: [TClassCard] }
        if let r = try? await store.api.get("classes", as: R.self) {
            classes = r.classes
            classId = classId ?? r.classes.first?.id
        }
    }

    private func loadTags() async {
        guard let classId else { return }
        if let r = try? await store.api.get("classes/\(classId)/tags", as: TTagList.self) {
            tags = r.tags
        }
    }

    private func tagRow(_ tag: TTag) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "wave.3.right")
                .font(.system(size: 17))
                .foregroundColor(tag.active ? Tokens.green600 : Tokens.Light.textTertiary)
            VStack(alignment: .leading, spacing: 1) {
                Text(tag.label)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Tokens.Light.textPrimary)
                Text(tag.code)
                    .font(.system(size: 12, design: .monospaced))
                    .kerning(0.8)
                    .foregroundColor(Tokens.Light.textTertiary)
            }
            Spacer()
            if tag.active {
                Text("Active")
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundColor(Tokens.Light.stateFocusedFg)
                    .padding(.horizontal, 10).padding(.vertical, 3)
                    .background(Tokens.Light.stateFocusedBg)
                    .clipShape(Capsule())
            } else {
                Text("Off")
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundColor(Tokens.Light.textTertiary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Tokens.Light.card)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .opacity(tag.active ? 1 : 0.62)
        .contentShape(Rectangle())
        .onTapGesture {
            if tag.active { deactivateTarget = tag }
        }
    }
}

/// T4 · Write flow — label first ("name it by where it'll live"), then the native
/// NFC sheet writes the server-issued code; verify with your own phone after.
struct WriteTagSheet: View {
    let classId: String
    var onDone: () async -> Void

    @EnvironmentObject private var store: TeacherStore
    @Environment(\.dismiss) private var dismiss
    @State private var label = ""
    @State private var phase: Phase = .label
    @State private var createdTag: TTag?
    @State private var errorText: String?
    @State private var busy = false

    private enum Phase {
        case label
        case written
    }

    var body: some View {
        ZStack {
            Tokens.Light.page.ignoresSafeArea()
            VStack(spacing: 16) {
                switch phase {
                case .label:
                    Text("Write a new tag")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundColor(Tokens.Light.textPrimary)
                        .padding(.top, 26)
                    TeacherField("Label — e.g. Front desk", text: $label, contentType: .name)
                    Text("Only you see labels — name it by where it'll live.")
                        .font(.system(size: 13))
                        .foregroundColor(Tokens.Light.textTertiary)
                    if let errorText {
                        Text(errorText).font(.system(size: 13)).foregroundColor(Tokens.Light.textSecondary)
                    }
                    Button {
                        Task { await createAndWrite() }
                    } label: {
                        Group {
                            if busy { ProgressView().tint(.white) } else { Text(writeButtonTitle) }
                        }
                        .font(.system(size: 17, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(Tokens.Light.actionPrimaryBg)
                        .foregroundColor(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .disabled(label.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                    .opacity(label.trimmingCharacters(in: .whitespaces).isEmpty ? 0.45 : 1)
                    Spacer()

                case .written:
                    Spacer()
                    ZStack {
                        Circle().stroke(Tokens.green600, lineWidth: 8)
                        Image(systemName: "checkmark").font(.system(size: 30, weight: .semibold)).foregroundColor(Tokens.green600)
                    }
                    .frame(width: 110, height: 110)
                    Text("\"\(createdTag?.label ?? label)\" is live")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundColor(Tokens.Light.textPrimary)
                    Text(writtenSub)
                        .font(.system(size: 15))
                        .foregroundColor(Tokens.Light.textSecondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 300)
                    if let code = createdTag?.code {
                        Text(code)
                            .font(.system(size: 15, design: .monospaced))
                            .kerning(1.2)
                            .foregroundColor(Tokens.Light.textTertiary)
                    }
                    Button("Done") {
                        dismiss()
                        Task { await onDone() }
                    }
                    .font(.system(size: 17, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(Tokens.Light.actionPrimaryBg)
                    .foregroundColor(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    Spacer()
                }
            }
            .padding(.horizontal, 20)
        }
    }

    private var canWriteNFC: Bool {
        #if !targetEnvironment(simulator) && canImport(CoreNFC)
        return TagCodeWriter.isAvailable
        #else
        return false
        #endif
    }

    private var writeButtonTitle: String {
        canWriteNFC ? "Write to the tag" : "Create tag (QR only here)"
    }

    private var writtenSub: String {
        canWriteNFC
            ? "Stick it where students tap. Test it with your own phone before class."
            : "Print its QR from the web Tags page — NFC writing needs an iPhone."
    }

    private func createAndWrite() async {
        busy = true
        defer { busy = false }
        do {
            let tag = try await store.api.post(
                "classes/\(classId)/tags",
                body: CreateTagBody(label: label.trimmingCharacters(in: .whitespaces)),
                as: TTag.self
            )
            createdTag = tag
            #if !targetEnvironment(simulator) && canImport(CoreNFC)
            if TagCodeWriter.isAvailable {
                try await TagCodeWriter().write(code: tag.code)
            }
            #endif
            phase = .written
        } catch {
            errorText = (error as? LocalizedError)?.errorDescription ?? "Couldn't write the tag — try again."
        }
    }
}
