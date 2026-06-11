import SwiftUI

@main
struct BaliApp: App {
    @StateObject private var auth = AuthStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(auth)
                .task { await auth.start() }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var auth: AuthStore

    var body: some View {
        switch auth.phase {
        case .loading:
            ZStack {
                Tokens.Dark.page.ignoresSafeArea()
                ProgressView().tint(Tokens.Dark.textSecondary)
            }
        case .signedOut, .needsName:
            SignInView()
        case let .ready(student):
            HomeView(student: student)
        }
    }
}
