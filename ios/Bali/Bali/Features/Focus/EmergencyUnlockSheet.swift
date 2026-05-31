//
//  EmergencyUnlockSheet.swift
//  Bali — Emergency unlock sheet (stub)
//
//  Phase 2 stub. The real reason picker + note + "Request sent" state is built
//  in Phase 7 (local/optimistic; a teacher-review backend endpoint is a flagged
//  change).
//

import SwiftUI

struct EmergencyUnlockSheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: BaliSpacing.l) {
            HStack(spacing: BaliSpacing.m) {
                IconTile(systemImage: "hand.raised.fill", tone: .coral)
                VStack(alignment: .leading, spacing: 2) {
                    BaliText("Emergency unlock", .h3)
                    BaliText("Sends a request to your teacher to review.", .foot)
                }
                Spacer()
            }
            .padding(.top, BaliSpacing.s)

            StubPlaceholder(
                systemImage: "hand.raised.fill",
                title: "Emergency unlock",
                note: "Reason picker, optional note, and the 'Request sent' state arrive in Phase 7."
            )

            BaliButton(title: "Cancel", variant: .ghost) { dismiss() }
        }
        .padding(.horizontal, BaliSpacing.xl)
        .padding(.bottom, BaliSpacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BaliColor.surface)
    }
}

#Preview {
    Color.black.sheet(isPresented: .constant(true)) {
        EmergencyUnlockSheet()
    }
}
