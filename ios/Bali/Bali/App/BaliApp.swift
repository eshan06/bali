import SwiftUI

@main
struct BaliApp: App {
    @StateObject private var auth = AuthStore()

    init() {
        AmplifyAuth.configure()
    }

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
        case .signedOut:
            SignInView()
        case .needsName:
            NameView()
        case let .needsConfirmation(email, password):
            ConfirmCodeView(email: email, password: password)
        case let .ready(student):
            HomeView(student: student)
        }
    }
}
