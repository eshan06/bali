//
//  DeviceInfoView.swift
//  Bali — Device Info (pushed)
//
//  The student's registered device: a hero card, then model / stable device ID /
//  registration / assigned seat. The device id + registration are LOCAL
//  (DeviceIdentity, keychain — §9.5); the friendly name + seat come from the
//  server when a class detail is loaded ("linked" = the teacher side sees it).
//

import SwiftUI

struct DeviceInfoView: View {
    @Environment(AppModel.self) private var model

    private var registered: Bool { DeviceIdentity.isRegistered }
    private var serverLinked: Bool { model.registeredDevice != nil }
    private var deviceName: String { model.registeredDevice?.friendlyName ?? DeviceIdentity.modelName }
    private var deviceId: String { DeviceIdentity.current }

    private var heroBadge: (text: String, tone: BaliTone) {
        if registered && serverLinked { return ("Registered & linked", .green) }
        if registered { return ("Registered", .green) }
        return ("Not registered", .gray)
    }

    var body: some View {
        DetailScaffold {
            VStack(alignment: .leading, spacing: 2) {
                Eyebrow("Device")
                BaliText("Registered device", .h1)
            }

            heroCard
            detailsCard

            BaliText("Your device ID stays stable across sign-ins so teachers can keep your seat linked.", .foot)
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, BaliSpacing.l)
        }
        .task {
            if model.registeredDevice == nil, let first = model.classes.first {
                await model.loadDetail(classId: first.id)
            }
        }
    }

    private var heroCard: some View {
        Card {
            VStack(spacing: BaliSpacing.m) {
                RoundedRectangle(cornerRadius: BaliRadius.lg, style: .continuous)
                    .fill(BaliColor.blueTint)
                    .frame(width: 84, height: 84)
                    .overlay {
                        Image(systemName: "iphone")
                            .font(.system(size: 38, weight: .regular))
                            .foregroundStyle(BaliColor.blue)
                    }
                BaliText(deviceName, .h3)
                Badge(text: heroBadge.text, tone: heroBadge.tone, showsDot: true)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, BaliSpacing.s)
        }
    }

    private var detailsCard: some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                infoRow(icon: "iphone", tone: .ink, label: "Model", value: deviceName)
                divider
                infoRow(icon: "sparkle", tone: .blue, label: "Device ID", value: deviceId, mono: true)
                divider
                infoRow(icon: "checkmark.seal.fill", tone: .green, label: "Registration",
                        value: registered ? "Active" : "Not registered")
                divider
                infoRow(icon: "graduationcap.fill", tone: .ink, label: "Assigned seat",
                        value: model.assignedSeat ?? "—")
            }
        }
    }

    private func infoRow(icon: String, tone: BaliTone, label: String,
                         value: String, mono: Bool = false) -> some View {
        HStack(spacing: BaliSpacing.m14) {
            IconTile(systemImage: icon, tone: tone, size: 38, glyphSize: 16)
            BaliText(label, .bodyStrong)
            Spacer(minLength: BaliSpacing.s)
            Text(value)
                .font(mono ? .system(size: 13.5, weight: .medium, design: .monospaced)
                           : BaliFont.at(13.5, 500))
                .foregroundStyle(BaliColor.ink3)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 58)
    }

    private var divider: some View {
        Rectangle().fill(BaliColor.line).frame(height: 1).padding(.leading, 68)
    }
}

#Preview {
    NavigationStack { DeviceInfoView() }
        .injectBaliEnvironment(.preview())
}
