//
//  OnboardingFlow.swift
//  Bali — Onboarding
//
//  The two-step first run shown (full-screen, no tab bar) when AuthStore.phase
//  is .onboarding: (1) register this device as the student's Bali phone (keychain
//  device id, local — §9.5) and (2) explain + request Focus blocking. "Allow
//  access" requests the real Family Controls (Screen Time) + notification
//  authorizations; "Maybe later" skips. Finishing advances into the tabbed app.
//

import SwiftUI

struct OnboardingFlow: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(AuthStore.self) private var auth
    @Environment(NotificationManager.self) private var notifications

    @State private var step: Int = {
        #if DEBUG
        if UserDefaults.standard.integer(forKey: "baliOnboardingStep") == 2 { return 2 }
        #endif
        return 1
    }()
    @State private var registered = DeviceIdentity.isRegistered

    var body: some View {
        ZStack {
            BaliColor.bg.ignoresSafeArea()
            Group {
                if step == 1 { registerStep } else { permissionsStep }
            }
            .padding(.horizontal, BaliSpacing.screenH)
            .padding(.bottom, BaliSpacing.xxl)
        }
        .animation(.easeInOut(duration: 0.25), value: step)
    }

    // MARK: - Step 1: register device

    private var registerStep: some View {
        VStack(spacing: BaliSpacing.xl) {
            Spacer()
            heroIcon("iphone")
            headline(step: "Step 1 of 2 · Device",
                     title: "Make this your\nBali phone",
                     subtitle: "We'll register this iPhone so your teacher can pair it with the Bali block on your desk. One phone, one student.")
            deviceCard
            BaliButton(title: registered ? "Continue" : "Register this iPhone",
                       icon: registered ? "checkmark" : nil) {
                DeviceIdentity.isRegistered = true
                registered = true
                step = 2
            }
            Spacer(); Spacer()
        }
    }

    private var deviceCard: some View {
        Card {
            HStack(spacing: BaliSpacing.m14) {
                IconTile(systemImage: "iphone", tone: .blue)
                VStack(alignment: .leading, spacing: 2) {
                    BaliText(DeviceIdentity.modelName, .bodyStrong)
                    BaliText("This device · iOS \(DeviceIdentity.systemVersion)", .foot)
                }
                Spacer(minLength: 0)
                Badge(text: "Ready", tone: .green, showsDot: true)
            }
        }
    }

    // MARK: - Step 2: permissions

    private var permissionsStep: some View {
        VStack(spacing: BaliSpacing.xl) {
            Spacer()
            heroIcon("shield.fill", tinted: true)
            headline(step: "Step 2 of 2 · Permissions",
                     title: "Allow Focus blocking",
                     subtitle: "Bali needs Screen Time access to pause apps during class. Here's exactly what that does:")
            permissionsCard
            VStack(spacing: BaliSpacing.m) {
                BaliButton(title: "Allow access", icon: "checkmark.shield.fill") {
                    Task {
                        // Screen Time first (the focus-blocking grant), then notifications.
                        _ = await env.screenTimeService.requestAuthorization()
                        await notifications.requestAuthorization()
                        auth.finishOnboarding()
                    }
                }
                Button { auth.finishOnboarding() } label: {
                    BaliText("Maybe later", .bodyStrong, color: BaliColor.ink3)
                }
                .buttonStyle(.plain)
            }
            Spacer(); Spacer()
        }
    }

    private var permissionsCard: some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                permissionRow("shield.fill", "Pause distracting apps",
                              "During class only — never outside session times.")
                rowDivider
                permissionRow("clock.fill", "Use your teacher's policy",
                              "Bali applies the session's rules, not your settings.")
                rowDivider
                permissionRow("lock.fill", "Auto-unlock when class ends",
                              "Everything returns the moment the session stops.")
            }
        }
    }

    // MARK: - Shared pieces

    private func heroIcon(_ symbol: String, tinted: Bool = false) -> some View {
        RoundedRectangle(cornerRadius: 26, style: .continuous)
            .fill(tinted ? BaliColor.blueTint : BaliColor.surface)
            .frame(width: 96, height: 96)
            .overlay {
                Image(systemName: symbol)
                    .font(.system(size: 40, weight: .regular))
                    .foregroundStyle(BaliColor.blue)
            }
            .baliShadow(.card)
    }

    private func headline(step: String, title: String, subtitle: String) -> some View {
        VStack(spacing: BaliSpacing.s10) {
            Eyebrow(step)
            BaliText(title, .h1).multilineTextAlignment(.center)
            BaliText(subtitle, .body).multilineTextAlignment(.center)
        }
    }

    private func permissionRow(_ icon: String, _ title: String, _ subtitle: String) -> some View {
        HStack(alignment: .top, spacing: BaliSpacing.m14) {
            IconTile(systemImage: icon, tone: .blue, size: 38, glyphSize: 16)
            VStack(alignment: .leading, spacing: 3) {
                BaliText(title, .bodyStrong)
                BaliText(subtitle, .foot)
            }
            Spacer(minLength: 0)
        }
        .padding(16)
    }

    private var rowDivider: some View {
        Rectangle().fill(BaliColor.line).frame(height: 1).padding(.leading, 68)
    }
}

#Preview {
    OnboardingFlow()
        .injectBaliEnvironment(.preview(phase: .onboarding))
}
