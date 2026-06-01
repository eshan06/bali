//
//  EmergencyUnlockSheet.swift
//  Bali — Emergency unlock sheet
//
//  Local/optimistic emergency unlock: pick a reason + optional note → "Request
//  sent". It never silently bypasses blocking — the copy is explicit that the
//  teacher reviews and decides. A real teacher-review endpoint is a backend
//  change (PLAN.md §9.6); for now nothing is unlocked client-side.
//

import SwiftUI

struct EmergencyUnlockSheet: View {
    @Environment(\.dismiss) private var dismiss

    private let reasons = ["Family / urgent call", "Medical", "Need a specific app for class", "Other"]
    @State private var selectedReason: String?
    @State private var note = ""
    @State private var sent = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: BaliSpacing.l) {
                header
                if sent { sentState } else { form }
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
                BaliText("Emergency unlock", .h3)
                BaliText("Sends a request to your teacher to review.", .foot)
            }
            Spacer(minLength: 0)
        }
    }

    // MARK: - Form

    private var form: some View {
        VStack(alignment: .leading, spacing: BaliSpacing.l) {
            warning

            VStack(alignment: .leading, spacing: BaliSpacing.s) {
                FieldLabel("Reason")
                VStack(spacing: BaliSpacing.s) {
                    ForEach(reasons, id: \.self) { reasonRow($0) }
                }
            }

            VStack(alignment: .leading, spacing: BaliSpacing.s) {
                FieldLabel("Add a note (optional)")
                TextField("Tell your teacher what you need…", text: $note, axis: .vertical)
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
                BaliButton(title: "Send request to teacher", variant: .danger) {
                    withAnimation { sent = true }
                }
                .disabled(selectedReason == nil)
                Button { dismiss() } label: {
                    BaliText("Cancel", .bodyStrong, color: BaliColor.ink3)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var warning: some View {
        HStack(alignment: .top, spacing: BaliSpacing.s10) {
            Image(systemName: "info.circle.fill")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(BaliColor.amber)
            BaliText("This won't silently bypass blocking. Your teacher sees the request and decides.",
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
        return Button { selectedReason = reason } label: {
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

    // MARK: - Sent

    private var sentState: some View {
        VStack(spacing: BaliSpacing.l) {
            ZStack {
                Circle().fill(BaliColor.greenTint).frame(width: 96, height: 96)
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(BaliColor.green)
            }
            VStack(spacing: BaliSpacing.s) {
                BaliText("Request sent", .h2)
                BaliText("Your teacher will review it. Nothing is unlocked yet — they decide.", .body)
                    .multilineTextAlignment(.center)
            }
            BaliButton(title: "Done") { dismiss() }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, BaliSpacing.xl)
    }
}

#Preview {
    Color.black.sheet(isPresented: .constant(true)) {
        EmergencyUnlockSheet()
            .presentationDetents([.large])
    }
}
