//
//  SessionEndedOverlay.swift
//  Bali — Focus Mode
//
//  Shown (over everything) when the teacher ends the session: shields are
//  cleared and the student sees a confirmation with how many apps unlocked. A
//  bottom card over a scrim, dismissed with Done.
//

import SwiftUI

struct SessionEndedOverlay: View {
    let info: SessionEndedInfo
    let onDone: () -> Void

    var body: some View {
        ZStack(alignment: .bottom) {
            BaliColor.scrim.ignoresSafeArea()

            VStack(spacing: BaliSpacing.l) {
                Capsule().fill(BaliColor.grabber).frame(width: 40, height: 5)
                    .padding(.top, BaliSpacing.s)

                ZStack {
                    Circle().fill(BaliColor.greenTint).frame(width: 96, height: 96)
                    Image(systemName: "lock.open.fill")
                        .font(.system(size: 36, weight: .semibold))
                        .foregroundStyle(BaliColor.green)
                }

                VStack(spacing: BaliSpacing.s) {
                    BaliText("Focus Mode ended", .h2)
                    BaliText("All your apps are available again.", .body)
                        .multilineTextAlignment(.center)
                }

                HStack(spacing: BaliSpacing.m14) {
                    ZStack {
                        Circle().fill(BaliColor.greenTint).frame(width: 40, height: 40)
                        Image(systemName: "checkmark")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(BaliColor.green)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        BaliText("\(info.appCount) app\(info.appCount == 1 ? "" : "s") unlocked", .bodyStrong)
                        BaliText("\(info.className) · \(time(info.endedAt))", .foot)
                    }
                    Spacer(minLength: 0)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(BaliColor.line2)
                .clipShape(RoundedRectangle(cornerRadius: BaliRadius.r, style: .continuous))

                BaliButton(title: "Done", action: onDone)
            }
            .padding(.horizontal, BaliSpacing.xl)
            .padding(.bottom, BaliSpacing.xxl)
            .frame(maxWidth: .infinity)
            .background(BaliColor.surface)
            .clipShape(UnevenRoundedRectangle(
                topLeadingRadius: BaliRadius.sheet, topTrailingRadius: BaliRadius.sheet, style: .continuous))
            .ignoresSafeArea(edges: .bottom)
        }
        .transition(.opacity)
    }

    private func time(_ date: Date) -> String {
        let f = DateFormatter()
        f.dateFormat = "h:mm a"
        return f.string(from: date)
    }
}

#Preview {
    SessionEndedOverlay(info: SessionEndedInfo(className: "AP Biology", appCount: 7, endedAt: Date())) {}
        .injectBaliEnvironment(.preview())
}
