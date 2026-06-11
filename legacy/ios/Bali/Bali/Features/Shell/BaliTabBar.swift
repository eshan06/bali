//
//  BaliTabBar.swift
//  Bali
//
//  The custom bottom tab bar: translucent blurred bar, 5 slots
//  (Home · Classes · [center NFC FAB] · Focus · Profile), the center button
//  raised ~22pt above the bar with the blue glow. Stock TabView can't host the
//  raised FAB, so the whole bar is custom.
//

import SwiftUI

struct BaliTabBar: View {
    @Bindable var router: AppRouter

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            tab(.home, icon: "house", activeIcon: "house.fill", label: "Home")
            tab(.classes, icon: "square.grid.2x2", activeIcon: "square.grid.2x2.fill", label: "Classes")
            fab
            tab(.focus, icon: "shield", activeIcon: "shield.fill", label: "Focus")
            tab(.profile, icon: "person", activeIcon: "person.fill", label: "Profile")
        }
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .frame(height: BaliSpacing.tabBarHeight, alignment: .top)
        .background(alignment: .top) {
            tabBarBackground
        }
    }

    // MARK: Background

    private var tabBarBackground: some View {
        Rectangle()
            .fill(Color(hex: "F8F9FC").opacity(0.82))
            .background(.ultraThinMaterial)
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(Color.black.opacity(0.06))
                    .frame(height: 0.5)
            }
            .ignoresSafeArea(edges: .bottom)
    }

    // MARK: Tab item

    private func tab(_ item: AppTab, icon: String, activeIcon: String, label: String) -> some View {
        let isActive = router.selectedTab == item
        return Button {
            router.selectTab(item)
        } label: {
            VStack(spacing: 4) {
                Image(systemName: isActive ? activeIcon : icon)
                    .font(.system(size: 22, weight: isActive ? .semibold : .regular))
                    .frame(height: 26)
                Text(label)
                    .font(BaliFont.at(10.5, 600))
                    .tracking(-0.1)
            }
            .foregroundStyle(isActive ? BaliColor.blue : BaliColor.ink4)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Center NFC FAB

    private var fab: some View {
        Button {
            router.startCheckIn()
        } label: {
            RoundedRectangle(cornerRadius: BaliRadius.fab, style: .continuous)
                .fill(BaliColor.blue)
                .frame(width: 62, height: 62)
                .overlay {
                    Image(systemName: "dot.radiowaves.left.and.right")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundStyle(.white)
                }
                .overlay {
                    RoundedRectangle(cornerRadius: BaliRadius.fab, style: .continuous)
                        .strokeBorder(Color(hex: "F8F9FC").opacity(0.9), lineWidth: 4)
                }
                .baliShadow(.blue)
        }
        .buttonStyle(FabPressStyle())
        .frame(maxWidth: .infinity)
        .offset(y: -22)
    }
}

private struct FabPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

#Preview {
    @Previewable @State var router = AppRouter()
    return ZStack(alignment: .bottom) {
        BaliColor.bg.ignoresSafeArea()
        BaliTabBar(router: router)
    }
}
