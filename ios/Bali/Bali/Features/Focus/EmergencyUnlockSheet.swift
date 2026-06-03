//
//  EmergencyUnlockSheet.swift
//  Bali — Emergency Stop sheet
//
//  Student-initiated Emergency Stop: turns off Focus immediately — no teacher
//  approval. The device clears shields right away (setting the stop flag makes
//  `focusActiveClass` go nil, which tears Focus down via the shell wiring); the
//  stop is reported best-effort so the teacher console logs it. Focus stays off
//  for the session until the student taps back in (a new NFC check-in). Reason +
//  note are captured for the record.
//

import SwiftUI

struct EmergencyUnlockSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model

    private let reasons = ["Family / urgent call", "Medical", "Need a specific app for class", "Other"]
    @State private var selectedReason: String?
    @State private var note = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BaliSpacing.l) {
                header
                form
            }
            .padding(.horizontal, BaliSpacing.xl)
            .padding(.top, BaliSpacing.m)
            .padding(.bottom, BaliSpacing.xl)
        }
        .scrollIndicators(.hidden)
        .background(BaliColor.surface)
    }

    private var header: some View {
        HStack(spacing: BaliSpacing.m) {
            IconTile(systemImage: "hand.raised.fill", tone: .coral)
            VStack(alignment: .leading, spacing: 2) {
                BaliText("Emergency Stop", .h3)
                BaliText("Turns off Focus right now.", .foot)
            }
            Spacer(minLength: 0)
        }
    }

    // MARK: - Form

    private var form: some View {
        VStack(alignment: .leading, spacing: BaliSpacing.l) {
            notice

            VStack(alignment: .leading, spacing: BaliSpacing.s) {
                FieldLabel("Reason (optional)")
                VStack(spacing: BaliSpacing.s) {
                    ForEach(reasons, id: \.self) { reasonRow($0) }
                }
            }

            VStack(alignment: .leading, spacing: BaliSpacing.s) {
                FieldLabel("Add a note (optional)")
                TextField("Tell your teacher what happened…", text: $note, axis: .vertical)
                    .font(BaliFont.at(16, 400))
                    .foregroundStyle(BaliColor.ink)
                    .tint(BaliColor.blue)
                    .lineLimit(2...4)
                    .padding(BaliSpacing.m14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(BaliColor.line2)
                    .clipShape(RoundedRectangle(cornerRadius: BaliRadius.field, style: .continuous))
            }

            VStack(spacing: BaliSpacing.s) {
                BaliButton(title: "Turn off Focus now", variant: .danger) { stop() }
                Button { dismiss() } label: {
                    BaliText("Cancel", .bodyStrong, color: BaliColor.ink3)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var notice: some View {
        HStack(alignment: .top, spacing: BaliSpacing.s10) {
            Image(systemName: "info.circle.fill")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(BaliColor.amber)
            BaliText("Your apps unlock immediately and your teacher is notified that you used Emergency Stop. Focus stays off until you tap back in.",
                     .foot, color: BaliColor.badgeAmberText)
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BaliColor.amberTint)
        .clipShape(RoundedRectangle(cornerRadius: BaliRadius.r, style: .continuous))
    }

    private func reasonRow(_ reason: String) -> some View {
        let selected = selectedReason == reason
        return Button { selectedReason = selected ? nil : reason } label: {
            HStack {
                BaliText(reason, .bodyStrong)
                Spacer(minLength: 0)
                if selected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(BaliColor.blue)
                }
            }
            .padding(.horizontal, 16)
            .frame(height: 52)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? BaliColor.blueTint : BaliColor.line2)
            .clipShape(RoundedRectangle(cornerRadius: BaliRadius.field, style: .continuous))
            .overlay {
                if selected {
                    RoundedRectangle(cornerRadius: BaliRadius.field, style: .continuous)
                        .strokeBorder(BaliColor.blue, lineWidth: 1.5)
                }
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: - Action

    /// Stop immediately: flag the active session (sticky), let the shell tear Focus
    /// down, and report best-effort. Capture the active class first — `emergencyStop`
    /// makes `focusActiveClass` go nil.
    private func stop() {
        guard let active = model.focusActiveClass else { dismiss(); return }
        let reason = selectedReason ?? "Unspecified"
        let noteText = note
        Task { await model.emergencyStop(for: active, reason: reason, note: noteText) }
        dismiss()
    }
}

#Preview {
    Color.black.sheet(isPresented: .constant(true)) {
        EmergencyUnlockSheet()
            .environment(AppModel.preview)
            .presentationDetents([.large])
    }
}
