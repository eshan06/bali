//
//  SettingsView.swift
//  Bali — Settings (pushed)
//
//  Grouped settings: account, device & focus status, notifications, about, and
//  sign out. Read-mostly in Phase 4 — the registered-device row opens Device
//  Info, the alerts row opens Notifications; focus-permission / assignment
//  statuses are surfaced here and wired for real in Phases 6–7.
//

import SwiftUI

struct SettingsView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(AppRouter.self) private var router
    @Environment(AppModel.self) private var model
    @Environment(AuthStore.self) private var auth
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss

    @State private var showBlockedApps = false
    @State private var focusAuth: FocusAuthorization = .approved
    @State private var blockedCount = 0

    private var deviceLinked: Bool { model.registeredDevice != nil }

    private var focusBadge: (text: String, tone: BaliTone) {
        switch focusAuth {
        case .approved:      return ("Granted", .green)
        case .denied:        return ("Denied", .coral)
        case .notDetermined: return ("Not set", .gray)
        }
    }

    var body: some View {
        DetailScaffold {
            BaliText("Settings", .display)

            section("Account") {
                SettingsRow(icon: "person.fill", tone: .blue, title: "Profile",
                            action: { dismiss() }) { chevron }
                rowDivider
                SettingsRow(icon: "envelope.fill", tone: .blue, title: "Email") {
                    BaliText(model.student?.email ?? "—", .foot)
                }
            }

            section("Device & Focus") {
                SettingsRow(icon: "iphone", tone: .ink, title: "Registered device",
                            action: { router.push(.deviceInfo, on: .profile) }) {
                    HStack(spacing: BaliSpacing.s) {
                        BaliText(model.registeredDevice?.friendlyName ?? "Not linked", .foot)
                        chevron
                    }
                }
                rowDivider
                SettingsRow(icon: "lock.fill", tone: .amber, title: "Focus permissions") {
                    Badge(text: focusBadge.text, tone: focusBadge.tone, showsDot: true)
                }
                rowDivider
                SettingsRow(icon: "app.badge.fill", tone: .coral, title: "Apps to block",
                            action: { Task { await pickBlockedApps() } }) {
                    HStack(spacing: BaliSpacing.s) {
                        BaliText(blockedCount > 0 ? "\(blockedCount) selected" : "None", .foot)
                        chevron
                    }
                }
                rowDivider
                SettingsRow(icon: "graduationcap.fill", tone: .green, title: "Class assignment") {
                    Badge(text: deviceLinked ? "Linked" : "Unlinked",
                          tone: deviceLinked ? .green : .gray, showsDot: true)
                }
            }

            section("Notifications") {
                SettingsRow(icon: "bell.fill", tone: .blue, title: "Class & focus alerts",
                            action: { router.push(.notifications, on: .profile) }) {
                    Badge(text: "On", tone: .green, showsDot: true)
                }
            }

            section("About") {
                SettingsRow(icon: "info.circle.fill", tone: .blue, title: "Help & support",
                            action: { openURL(URL(string: "mailto:support@bali.app")!) }) { chevron }
                rowDivider
                SettingsRow(icon: "hand.raised.fill", tone: .gray, title: "Privacy",
                            action: { openURL(URL(string: "https://bali.app/privacy")!) }) { chevron }
            }

            BaliButton(title: "Sign out", icon: "rectangle.portrait.and.arrow.right",
                       variant: .dangerSoft) {
                Task { await auth.signOut(); model.reset() }
            }
            .padding(.top, BaliSpacing.s)
        }
        .sheet(isPresented: $showBlockedApps, onDismiss: refreshFocus) {
            BlockedAppsView(isLive: env.screenTimeService.isAvailable)
        }
        .task { await loadFocus() }
    }

    private func loadFocus() async {
        focusAuth = await env.screenTimeService.authorizationStatus()
        blockedCount = env.screenTimeService.blockedSelectionCount
    }

    /// Tapping "Apps to block": grant Screen Time access if it hasn't been
    /// granted yet (existing accounts skip onboarding), then open the picker.
    private func pickBlockedApps() async {
        if focusAuth != .approved {
            focusAuth = await env.screenTimeService.requestAuthorization()
        }
        showBlockedApps = true
    }

    private func refreshFocus() {
        blockedCount = env.screenTimeService.blockedSelectionCount
    }

    // MARK: - Building blocks

    private func section<Content: View>(_ title: String,
                                        @ViewBuilder _ content: @escaping () -> Content) -> some View {
        VStack(alignment: .leading, spacing: BaliSpacing.s10) {
            Eyebrow(title, muted: true)
            Card(padding: 0) { VStack(spacing: 0) { content() } }
        }
    }

    private var chevron: some View {
        Image(systemName: "chevron.right")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(BaliColor.ink4)
    }

    private var rowDivider: some View {
        Rectangle().fill(BaliColor.line).frame(height: 1).padding(.leading, 68)
    }
}

private struct SettingsRow<Trailing: View>: View {
    let icon: String
    let tone: BaliTone
    let title: String
    var action: (() -> Void)? = nil
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        Group {
            if let action {
                Button(action: action) { rowContent }.buttonStyle(.plain)
            } else {
                rowContent
            }
        }
    }

    @ViewBuilder private var rowContent: some View {
        HStack(spacing: BaliSpacing.m14) {
            IconTile(systemImage: icon, tone: tone, size: 38, glyphSize: 16)
            BaliText(title, .bodyStrong)
            Spacer(minLength: BaliSpacing.s)
            trailing()
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 58)
        .contentShape(Rectangle())
    }
}

#Preview {
    NavigationStack { SettingsView() }
        .injectBaliEnvironment(.preview())
}
