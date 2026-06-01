//
//  ClassesView.swift
//  Bali — Classes tab
//
//  The roster: every joined class as a ClassCard, any pending invites, and a
//  dashed "Join a class" tile. The header "+" and the join tile both open the
//  Join flow (Phase 5). Pull-to-refresh + load/error states from AppModel.
//

import SwiftUI

struct ClassesView: View {
    @Environment(AppModel.self) private var model
    @Environment(AppRouter.self) private var router
    @State private var acceptingInviteId: String?

    var body: some View {
        BaliScreen(onRefresh: { await model.refresh() }) {
            ScreenHeader(eyebrow: "Your roster", title: "Classes") { plusButton }
            BaliText("Tap a class to see attendance, sessions, and focus policy.", .body)

            if model.classes.isEmpty {
                switch model.phase {
                case .loading, .idle:
                    LoadingCard()
                case .failed:
                    ErrorStateCard(message: model.errorMessage) { Task { await model.load() } }
                case .loaded:
                    EmptyClassesCard { router.push(.join, on: .classes) }
                }
            } else {
                ForEach(model.classes) { c in
                    ClassCard(summary: c,
                              policy: model.presentation(for: c.id).policy,
                              nextLabel: model.presentation(for: c.id).nextLabel,
                              isCheckedIn: model.isCheckedIn(c)) {
                        router.push(.classDetail(classId: c.id), on: .classes)
                    }
                }
                if !model.invites.isEmpty { invitesSection }
                joinTile
            }
        }
    }

    // MARK: - Header "+"

    private var plusButton: some View {
        Button { router.push(.join, on: .classes) } label: {
            Circle()
                .fill(BaliColor.blue)
                .frame(width: 44, height: 44)
                .overlay {
                    Image(systemName: "plus")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white)
                }
                .baliShadow(.blue)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Pending invites

    private var invitesSection: some View {
        VStack(alignment: .leading, spacing: BaliSpacing.m) {
            BaliText("Pending invites", .h3)
            ForEach(model.invites) { invite in
                Card {
                    VStack(alignment: .leading, spacing: BaliSpacing.m) {
                        HStack(spacing: BaliSpacing.m14) {
                            IconTile(systemImage: "envelope.fill", tone: .blue)
                            VStack(alignment: .leading, spacing: 3) {
                                BaliText(invite.className, .h3)
                                BaliText(inviteSubtitle(invite), .foot)
                            }
                            Spacer(minLength: 0)
                            Badge(text: "Invited", tone: .blue)
                        }
                        BaliButton(title: acceptingInviteId == invite.inviteId ? "Accepting…" : "Accept invite",
                                   icon: "checkmark", size: .sm) { accept(invite) }
                            .disabled(acceptingInviteId != nil)
                    }
                }
            }
        }
    }

    private func accept(_ invite: PendingInvite) {
        acceptingInviteId = invite.inviteId
        Task {
            _ = await model.acceptInvite(invite)
            acceptingInviteId = nil
        }
    }

    private func inviteSubtitle(_ invite: PendingInvite) -> String {
        [invite.period, invite.teacherName, invite.schoolName]
            .compactMap { $0 }
            .joined(separator: " · ")
    }

    // MARK: - Join tile

    private var joinTile: some View {
        Button { router.push(.join, on: .classes) } label: {
            HStack(spacing: BaliSpacing.s) {
                Image(systemName: "plus")
                Text("Join a class")
            }
            .font(BaliFont.at(16, 650))
            .foregroundStyle(BaliColor.blue)
            .frame(maxWidth: .infinity)
            .frame(height: 62)
            .background(
                RoundedRectangle(cornerRadius: BaliRadius.lg, style: .continuous)
                    .strokeBorder(BaliColor.blue300,
                                  style: StrokeStyle(lineWidth: 1.5, dash: [6, 5]))
            )
        }
        .buttonStyle(CardPressStyle())
    }
}

#Preview {
    NavigationStack { ClassesView() }
        .injectBaliEnvironment(.preview())
}
