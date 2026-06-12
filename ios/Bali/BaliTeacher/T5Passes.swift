import SwiftUI

/// T5 · Passes & alerts — live passes across classes + notify toggles.
/// "Emergencies always alert on the dashboard regardless of phone settings."
struct T5PassesView: View {
    @EnvironmentObject private var store: TeacherStore
    @State private var passes: [ActivePass] = []
    @State private var settings: TSettings?
    @State private var now = Date()
    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    struct ActivePass: Identifiable {
        var id: String { studentId + sessionId }
        var sessionId: String
        var studentId: String
        var name: String
        var className: String
        var endsAt: Date
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Tokens.Light.page.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Passes & alerts")
                            .font(.system(size: 34, weight: .bold))
                            .foregroundColor(Tokens.Light.textPrimary)
                            .padding(.top, 12)

                        sectionLabel("ACTIVE PASSES")
                        if passes.isEmpty {
                            Text("No passes right now.")
                                .font(.system(size: 14))
                                .foregroundColor(Tokens.Light.textSecondary)
                        } else {
                            VStack(spacing: 10) {
                                ForEach(passes) { pass in
                                    passRow(pass)
                                }
                            }
                        }

                        sectionLabel("NOTIFY ME").padding(.top, 10)
                        if let settings {
                            notifyCard(settings)
                        }

                        Text("Emergencies always alert on the dashboard regardless of phone settings.")
                            .font(.system(size: 12.5))
                            .foregroundColor(Tokens.Light.textTertiary)
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 36)
                }
                .refreshable { await load() }
            }
            .toolbar(.hidden, for: .navigationBar)
            .task { await load() }
            .onReceive(tick) { now = $0 }
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 12, weight: .semibold))
            .kerning(0.72)
            .foregroundColor(Tokens.Light.textTertiary)
    }

    private func passRow(_ pass: ActivePass) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "ticket")
                .font(.system(size: 17))
                .foregroundColor(Tokens.Light.statePassFg)
            VStack(alignment: .leading, spacing: 1) {
                Text(pass.name)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(Tokens.Light.textPrimary)
                Text(pass.className)
                    .font(.system(size: 12.5))
                    .foregroundColor(Tokens.Light.textTertiary)
            }
            Spacer()
            Text(mmss(pass.endsAt.timeIntervalSince(now)))
                .font(.system(size: 15, weight: .semibold).monospacedDigit())
                .foregroundColor(Tokens.Light.statePassFg)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Tokens.Light.card)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func notifyCard(_ settings: TSettings) -> some View {
        VStack(spacing: 0) {
            toggleRow("Emergency unlocks", sub: "always also on the dashboard", value: settings.notifyEmergency) {
                await save(["notifyEmergency": $0])
            }
            divider
            toggleRow("Permission turned off", sub: nil, value: settings.notifyRevoked) {
                await save(["notifyRevoked": $0])
            }
            divider
            toggleRow("Pass endings", sub: nil, value: settings.notifyPassEndings) {
                await save(["notifyPassEndings": $0])
            }
        }
        .background(Tokens.Light.card)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var divider: some View {
        Rectangle().fill(Tokens.Light.border).frame(height: 0.5).padding(.leading, 16)
    }

    private func toggleRow(_ title: String, sub: String?, value: Bool, onChange: @escaping (Bool) async -> Void) -> some View {
        Toggle(isOn: Binding(
            get: { value },
            set: { next in Task { await onChange(next) } }
        )) {
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(Tokens.Light.textPrimary)
                if let sub {
                    Text(sub)
                        .font(.system(size: 12.5))
                        .foregroundColor(Tokens.Light.textTertiary)
                }
            }
        }
        .tint(Tokens.green600)
        .padding(.horizontal, 16)
        .frame(minHeight: 54)
    }

    private func save(_ fields: [String: Bool]) async {
        var body: [String: Bool] = [:]
        for (key, value) in fields { body[key] = value }
        struct AnyBody: Encodable {
            var notifyEmergency: Bool?
            var notifyRevoked: Bool?
            var notifyPassEndings: Bool?
        }
        let payload = AnyBody(
            notifyEmergency: body["notifyEmergency"],
            notifyRevoked: body["notifyRevoked"],
            notifyPassEndings: body["notifyPassEndings"]
        )
        settings = try? await store.api.patch("me/settings", body: payload, as: TSettings.self)
    }

    private func load() async {
        settings = try? await store.api.get("me/settings", as: TSettings.self)

        // Active passes: walk the live sessions and pick out `pass` participants.
        struct R: Decodable { var classes: [TClassCard] }
        guard let r = try? await store.api.get("classes", as: R.self) else { return }
        var found: [ActivePass] = []
        for cls in r.classes {
            guard let live = cls.live else { continue }
            if let detail = try? await store.api.get("sessions/\(live.sessionId)", as: TSessionDetail.self) {
                for p in detail.participants where p.state == "pass" {
                    if let ends = p.passEndsAt {
                        found.append(ActivePass(
                            sessionId: live.sessionId,
                            studentId: p.studentId,
                            name: "\(p.firstName) \(p.lastName)",
                            className: cls.name,
                            endsAt: ends
                        ))
                    }
                }
            }
        }
        passes = found
    }
}
