//
//  MainTabView.swift
//  Bali
//
//  The tabbed app shell. Four NavigationStacks (one per tab) are kept alive in
//  a ZStack and shown/hidden by opacity so each tab preserves its own state and
//  scroll position; the custom BaliTabBar overlays the bottom and hides itself
//  on pushed detail screens. Modal sheets + the session-ended overlay are
//  presented from AppRouter state.
//

import SwiftUI

struct MainTabView: View {
    @Environment(AppRouter.self) private var router
    @Environment(AppModel.self) private var model
    @Environment(FocusModeController.self) private var focus
    @Environment(NotificationManager.self) private var notifications

    var body: some View {
        @Bindable var router = router

        ZStack(alignment: .bottom) {
            BaliColor.bg.ignoresSafeArea()

            // All four tab stacks, only the selected one visible + interactive.
            // No .zIndex here on purpose: each stack has an opaque background, so
            // raising the selected stack's z-order would draw it over the tab
            // bar. Opacity + allowsHitTesting handle visibility/interaction;
            // leaving z-order in document order keeps the tab bar (declared
            // last) on top.
            ForEach(AppTab.allCases, id: \.self) { tab in
                tabStack(tab)
                    .opacity(router.selectedTab == tab ? 1 : 0)
                    .allowsHitTesting(router.selectedTab == tab)
            }

            if !router.isShowingDetail {
                BaliTabBar(router: router)
                    .transition(.move(edge: .bottom))
            }

            if let ended = focus.endedInfo {
                SessionEndedOverlay(info: ended) { focus.dismissEnded() }
            }
        }
        .animation(.easeOut(duration: 0.2), value: router.isShowingDetail)
        .animation(.easeInOut(duration: 0.25), value: focus.endedInfo)
        .sheet(item: $router.sheet) { sheet in
            sheetContent(sheet)
        }
        .fullScreenCover(isPresented: focusCoverBinding) {
            FocusModeActiveView()
        }
        .task {
            await model.load()
            notifications.refresh(from: model)
            #if DEBUG
            if UserDefaults.standard.bool(forKey: "baliSessionEnded") { focus.debugShowEnded() }
            #endif
        }
        .task(id: model.focusActiveClass?.id) {
            if let active = model.focusActiveClass {
                await focus.start(for: active)
            } else {
                focus.syncInactive()
            }
        }
        .onChange(of: focus.endedInfo) { _, info in
            if let info {
                notifications.notify(.sessionEnded, title: "Apps are available again",
                                     message: "\(info.className) session ended.")
            }
        }
    }

    private var focusCoverBinding: Binding<Bool> {
        Binding(
            get: { focus.isActive && focus.isExpanded },
            set: { if !$0 { focus.collapse() } }
        )
    }

    // MARK: Per-tab navigation stack

    @ViewBuilder
    private func tabStack(_ tab: AppTab) -> some View {
        NavigationStack(path: router.binding(for: tab)) {
            tabRoot(tab)
                .navigationBarBackButtonHidden(true)
                .toolbar(.hidden, for: .navigationBar)
                .navigationDestination(for: Route.self) { route in
                    destination(route)
                        .navigationBarBackButtonHidden(true)
                        .toolbar(.hidden, for: .navigationBar)
                }
        }
    }

    @ViewBuilder
    private func tabRoot(_ tab: AppTab) -> some View {
        switch tab {
        case .home: HomeView()
        case .classes: ClassesView()
        case .focus: FocusModeView()
        case .profile: ProfileView()
        }
    }

    // MARK: Pushed destinations

    @ViewBuilder
    private func destination(_ route: Route) -> some View {
        switch route {
        case .classDetail(let classId): ClassDetailView(classId: classId)
        case .focusPolicyPreview(let classId): FocusPolicyPreviewView(classId: classId)
        case .join: JoinClassView()
        case .settings: SettingsView()
        case .deviceInfo: DeviceInfoView()
        case .notifications: NotificationsView()
        }
    }

    // MARK: Sheets

    @ViewBuilder
    private func sheetContent(_ sheet: SheetRoute) -> some View {
        switch sheet {
        case .nfcCheckIn(let classId):
            NfcCheckInSheet(classId: classId)
                .presentationDetents([.height(520)])
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(BaliRadius.sheet)
        case .emergencyUnlock:
            EmergencyUnlockSheet()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationCornerRadius(BaliRadius.sheet)
        }
    }
}

#Preview {
    MainTabView()
        .injectBaliEnvironment(AppEnvironment())
}
