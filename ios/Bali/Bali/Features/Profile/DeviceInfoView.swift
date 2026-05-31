//
//  DeviceInfoView.swift
//  Bali — Device Info (stub, pushed)
//
//  Phase 2 stub. The real registered-device detail (model, device ID, seat) is
//  built in Phase 5 alongside device registration.
//

import SwiftUI

struct DeviceInfoView: View {
    var body: some View {
        DetailScaffold {
            VStack(alignment: .leading, spacing: 2) {
                Eyebrow("Device")
                BaliText("Registered device", .h1)
            }
            StubPlaceholder(
                systemImage: "iphone",
                title: "Device info",
                note: "Model, stable device ID, registration, and assigned seat arrive in Phase 5."
            )
        }
    }
}

#Preview {
    NavigationStack { DeviceInfoView() }
        .injectBaliEnvironment(AppEnvironment())
}
