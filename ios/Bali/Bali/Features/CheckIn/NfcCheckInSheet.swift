//
//  NfcCheckInSheet.swift
//  Bali — NFC check-in sheet (stub)
//
//  Phase 2 stub presenting the sheet header + NFC mark so the center FAB does
//  something coherent. The real, auto-advancing Core NFC flow (waiting →
//  reading → result) is built in Phase 6; on the Simulator it shows an honest
//  "needs a physical iPhone" state — never a fake check-in.
//

import SwiftUI

struct NfcCheckInSheet: View {
    let classId: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: BaliSpacing.l) {
            // Header: wordmark · "Check in" · close
            HStack(spacing: BaliSpacing.m) {
                Wordmark(size: 22, color: BaliColor.ink)
                Rectangle().fill(BaliColor.line).frame(width: 1, height: 18)
                BaliText("Check in", .h3)
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(BaliColor.ink3)
                        .frame(width: 30, height: 30)
                        .background(BaliColor.line2)
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
            }
            .padding(.top, BaliSpacing.s)

            Spacer()

            NfcMark(size: 120)

            VStack(spacing: BaliSpacing.s) {
                BaliText("Hold near your Bali block", .h2)
                BaliText("Rest the top of your iPhone on the block to check in.", .body)
                    .multilineTextAlignment(.center)
            }

            Spacer()
        }
        .padding(.horizontal, BaliSpacing.xl)
        .padding(.bottom, BaliSpacing.xl)
        .frame(maxWidth: .infinity)
        .background(BaliColor.surface)
    }
}

#Preview {
    Color.black.sheet(isPresented: .constant(true)) {
        NfcCheckInSheet(classId: nil)
            .presentationDetents([.height(520)])
    }
}
