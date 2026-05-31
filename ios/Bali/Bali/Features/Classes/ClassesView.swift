//
//  ClassesView.swift
//  Bali — Classes tab (stub)
//
//  Phase 2 stub: the real roster of ClassCards is built in Phase 4. The header
//  "+" pushes Join, and the placeholder card pushes a sample Class Detail, so
//  the tab's navigation is real.
//

import SwiftUI

struct ClassesView: View {
    @Environment(AppRouter.self) private var router

    var body: some View {
        BaliScreen {
            ScreenHeader(eyebrow: "Your roster", title: "Classes") {
                Button {
                    router.push(.join)
                } label: {
                    Circle()
                        .fill(BaliColor.blue)
                        .frame(width: 38, height: 38)
                        .overlay {
                            Image(systemName: "plus")
                                .font(.system(size: 17, weight: .semibold))
                                .foregroundStyle(.white)
                        }
                        .baliShadow(.blue)
                }
                .buttonStyle(.plain)
            }

            BaliText("Tap a class to see attendance, sessions, and focus policy.", .body)

            Button {
                router.push(.classDetail(classId: "sample"))
            } label: {
                StubPlaceholder(
                    systemImage: "square.grid.2x2.fill",
                    title: "Classes",
                    note: "Your joined classes (ClassCards) arrive in Phase 4. Tap to preview Class Detail."
                )
            }
            .buttonStyle(.plain)
        }
    }
}

#Preview {
    NavigationStack { ClassesView() }
        .injectBaliEnvironment(AppEnvironment())
}
