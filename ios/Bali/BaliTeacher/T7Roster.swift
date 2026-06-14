import SwiftUI

/// T7 · Roster & Approvals — standalone screen the T1 approvals row lands on. The same
/// content is inlined in T6 · Roster via `RosterContent`. Manage membership from the phone:
/// approve/decline join requests, search members, mark default-no-device, remove (guarded).
struct T7RosterView: View {
    let classId: String

    @EnvironmentObject private var store: TeacherStore
    @Environment(\.dismiss) private var dismiss
    @State private var roster: TRoster?

    var body: some View {
        ZStack {
            Tokens.Light.page.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Button { dismiss() } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "chevron.left").font(.system(size: 15, weight: .semibold))
                            Text(roster?.cls.name ?? "Classes")
                        }
                        .font(.system(size: 16))
                        .foregroundColor(Tokens.green700)
                    }
                    .padding(.top, 8)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Roster")
                            .font(.system(size: 34, weight: .bold))
                            .foregroundColor(Tokens.Light.textPrimary)
                        if let roster {
                            Text("\(roster.members.count) students · auto-approve \(roster.cls.requireApproval ? "off" : "on")")
                                .font(.system(size: 14))
                                .foregroundColor(Tokens.Light.textSecondary)
                        }
                    }

                    if let roster {
                        RosterContent(roster: roster, reload: load)
                    } else {
                        ProgressView().tint(Tokens.Light.textSecondary).padding(.top, 60).frame(maxWidth: .infinity)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 36)
            }
            .refreshable { await load() }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task { await load() }
    }

    private func load() async {
        roster = try? await store.api.get("classes/\(classId)/roster", as: TRoster.self)
    }
}

/// Presentational roster body shared by T7 (standalone) and T6 · Roster (inline).
/// Hosts own the fetch and pass a `reload` closure; this view owns the row interactions.
struct RosterContent: View {
    let roster: TRoster
    var reload: () async -> Void

    @EnvironmentObject private var store: TeacherStore
    @State private var query = ""
    @State private var selected: TRosterMember?
    @State private var removeTarget: TRosterMember?
    @State private var busyIds: Set<String> = []

    private var filteredMembers: [TRosterMember] {
        guard !query.isEmpty else { return roster.members }
        return roster.members.filter { $0.name.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !roster.pending.isEmpty {
                approvalsSection
            }
            membersSection
        }
        .sheet(item: $selected) { member in
            MemberSheet(member: member, className: roster.cls.name, reload: reload)
                .presentationDetents([.height(280)])
        }
        .alert(
            "Remove \(firstName(removeTarget?.name)) from \(roster.cls.name)?",
            isPresented: Binding(get: { removeTarget != nil }, set: { if !$0 { removeTarget = nil } })
        ) {
            Button("Cancel", role: .cancel) { removeTarget = nil }
            Button("Remove", role: .destructive) {
                if let target = removeTarget { Task { await remove(target) } }
            }
        } message: {
            Text("Their focus history stays theirs. They can rejoin any time with the class code.")
        }
    }

    // MARK: approvals

    private var approvalsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                TSectionLabel("WANT TO JOIN · \(roster.pending.count)")
                Spacer()
                Button("Approve all") { Task { await approveAll() } }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Tokens.green700)
            }
            VStack(spacing: 10) {
                ForEach(roster.pending) { req in approvalRow(req) }
            }
        }
    }

    private func approvalRow(_ req: TJoinRequest) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(req.name)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(Tokens.Light.textPrimary)
                Text("\(relativeAgo(req.requestedAt)) · \(sourceLabel(req.source))")
                    .font(.system(size: 13))
                    .foregroundColor(Tokens.Light.textSecondary)
            }
            HStack(spacing: 10) {
                Button { Task { await decide(req, approve: false) } } label: {
                    Text("Decline")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(maxWidth: .infinity).frame(height: 44)
                        .background(Tokens.Light.card)
                        .foregroundColor(Tokens.Light.textPrimary)
                        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(Tokens.Light.borderStrong, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                }
                Button { Task { await decide(req, approve: true) } } label: {
                    Text("Approve")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(maxWidth: .infinity).frame(height: 44)
                        .background(Tokens.Light.actionPrimaryBg)
                        .foregroundColor(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                }
            }
            .disabled(busyIds.contains(req.membershipId))
            .opacity(busyIds.contains(req.membershipId) ? 0.5 : 1)
        }
        .padding(16)
        .background(Tokens.Light.card)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    // MARK: members

    private var membersSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            TSectionLabel("MEMBERS · \(roster.members.count)")

            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 14)).foregroundColor(Tokens.Light.textTertiary)
                TextField("Search students", text: $query)
                    .font(.system(size: 16))
                    .autocorrectionDisabled()
            }
            .padding(.horizontal, 14)
            .frame(height: 44)
            .background(Tokens.Light.card)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

            if roster.members.isEmpty {
                Text("Share the join code to add students.")
                    .font(.system(size: 14))
                    .foregroundColor(Tokens.Light.textSecondary)
                    .padding(.vertical, 8)
            } else {
                VStack(spacing: 8) {
                    ForEach(filteredMembers) { member in memberRow(member) }
                }
            }
        }
    }

    private func memberRow(_ member: TRosterMember) -> some View {
        Button { selected = member } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(member.name)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(Tokens.Light.textPrimary)
                    Text("joined \(monthDay(member.joinedAt))")
                        .font(.system(size: 12.5))
                        .foregroundColor(Tokens.Light.textTertiary)
                }
                Spacer()
                if member.defaultNoDevice {
                    let style = TChip.style("no_device")
                    HStack(spacing: 5) {
                        Image(systemName: style.icon).font(.system(size: 11))
                        Text("No device").font(.system(size: 12, weight: .medium))
                    }
                    .foregroundColor(style.fg)
                    .padding(.horizontal, 9).padding(.vertical, 3)
                    .overlay(Capsule().stroke(style.fg, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3])))
                }
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundColor(Tokens.Light.textTertiary)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 52)
            .background(Tokens.Light.card)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // MARK: actions

    private func decide(_ req: TJoinRequest, approve: Bool) async {
        busyIds.insert(req.membershipId)
        defer { busyIds.remove(req.membershipId) }
        try? await store.api.postVoid("memberships/\(req.membershipId)/\(approve ? "approve" : "decline")", body: nil as EmptyBody?)
        await reload()
    }

    private func approveAll() async {
        for req in roster.pending {
            try? await store.api.postVoid("memberships/\(req.membershipId)/approve", body: nil as EmptyBody?)
        }
        await reload()
    }

    private func remove(_ member: TRosterMember) async {
        struct Empty: Decodable {}
        _ = try? await store.api.delete("memberships/\(member.membershipId)")
        removeTarget = nil
        selected = nil
        await reload()
    }

    private func firstName(_ name: String?) -> String { name?.split(separator: " ").first.map(String.init) ?? "this student" }
    private func sourceLabel(_ source: String) -> String {
        switch source {
        case "tag": return "joined by tag"
        case "manual": return "added by you"
        default: return "joined by code"
        }
    }
    private func monthDay(_ date: Date) -> String {
        let fmt = DateFormatter(); fmt.dateFormat = "MMM d"; return fmt.string(from: date)
    }
}

/// Member detail sheet (small detent): the default-no-device mark + a guarded remove.
struct MemberSheet: View {
    let member: TRosterMember
    let className: String
    var reload: () async -> Void

    @EnvironmentObject private var store: TeacherStore
    @Environment(\.dismiss) private var dismiss
    @State private var noDevice: Bool
    @State private var confirmRemove = false

    init(member: TRosterMember, className: String, reload: @escaping () async -> Void) {
        self.member = member
        self.className = className
        self.reload = reload
        _noDevice = State(initialValue: member.defaultNoDevice)
    }

    private var firstName: String { member.name.split(separator: " ").first.map(String.init) ?? member.name }

    var body: some View {
        ZStack {
            Tokens.Light.page.ignoresSafeArea()
            VStack(spacing: 16) {
                VStack(spacing: 3) {
                    Text(member.name)
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundColor(Tokens.Light.textPrimary)
                    Text("joined \(monthDay(member.joinedAt)) · \(className)")
                        .font(.system(size: 13))
                        .foregroundColor(Tokens.Light.textSecondary)
                }
                .padding(.top, 24)

                Toggle(isOn: $noDevice) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("No device by default")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundColor(Tokens.Light.textPrimary)
                        Text("\(firstName) starts every session marked no-device")
                            .font(.system(size: 12.5))
                            .foregroundColor(Tokens.Light.textTertiary)
                    }
                }
                .tint(Tokens.green600)
                .padding(.horizontal, 16)
                .frame(minHeight: 64)
                .background(Tokens.Light.card)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .onChange(of: noDevice) { on in
                    Task {
                        _ = try? await store.api.patch("memberships/\(member.membershipId)", body: UpdateMembershipBody(defaultNoDevice: on), as: MembershipPatchResult.self)
                        await reload()
                    }
                }

                Button(role: .destructive) { confirmRemove = true } label: {
                    Text("Remove from class")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundColor(Tokens.Light.red600)
                        .frame(maxWidth: .infinity).frame(height: 50)
                        .background(Tokens.Light.card)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }

                Button("Cancel") { dismiss() }
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(Tokens.Light.textSecondary)

                Spacer()
            }
            .padding(.horizontal, 20)
        }
        .alert("Remove \(firstName) from \(className)?", isPresented: $confirmRemove) {
            Button("Cancel", role: .cancel) {}
            Button("Remove", role: .destructive) { Task { await remove() } }
        } message: {
            Text("Their focus history stays theirs. They can rejoin any time with the class code.")
        }
    }

    private func remove() async {
        _ = try? await store.api.delete("memberships/\(member.membershipId)")
        dismiss()
        await reload()
    }

    private func monthDay(_ date: Date) -> String {
        let fmt = DateFormatter(); fmt.dateFormat = "MMM d"; return fmt.string(from: date)
    }
}

struct MembershipPatchResult: Codable { var membershipId: String; var defaultNoDevice: Bool }
