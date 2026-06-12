import SwiftUI

@main
struct BaliApp: App {
    @StateObject private var auth = AuthStore()
    @StateObject private var deepLinks = DeepLinks()

    init() {
        AmplifyAuth.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(auth)
                .environmentObject(deepLinks)
                .task { await auth.start() }
                .onOpenURL { deepLinks.handle($0) }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var auth: AuthStore
    @AppStorage(OnboardingView.doneKey) private var onboarded = false

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
            if onboarded {
                HomeView(student: student)
            } else {
                OnboardingView { onboarded = true }
            }
        }
    }
}
