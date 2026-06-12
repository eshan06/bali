import SwiftUI

/// BaliTeacher — the light-theme companion (T1–T5). Email/password SRP only
/// (no new Cognito callback URIs); DEBUG keeps a dev sign-in for the Simulator.
@main
struct BaliTeacherApp: App {
    @StateObject private var store = TeacherStore()

    init() {
        AmplifyAuth.configure()
    }

    var body: some Scene {
        WindowGroup {
            TeacherRootView()
                .environmentObject(store)
                .task { await store.start() }
                .preferredColorScheme(.light)
        }
    }
}

struct TeacherRootView: View {
    @EnvironmentObject private var store: TeacherStore

    var body: some View {
        switch store.phase {
        case .loading:
            ZStack {
                Tokens.Light.page.ignoresSafeArea()
                ProgressView().tint(Tokens.Light.textSecondary)
            }
        case .signedOut:
            TeacherSignInView()
        case .ready:
            TeacherTabs()
        }
    }
}

struct TeacherTabs: View {
    var body: some View {
        TabView {
            T1HomeView()
                .tabItem { Label("Classes", systemImage: "square.grid.2x2") }
            T4TagsView()
                .tabItem { Label("Tags", systemImage: "wave.3.right") }
            T5PassesView()
                .tabItem { Label("Passes", systemImage: "ticket") }
        }
        .tint(Tokens.green700)
    }
}

// MARK: auth

struct TeacherSelf: Codable {
    var id: String
    var name: String
    var displayName: String
    var email: String
    var schoolName: String
}

@MainActor
final class TeacherStore: ObservableObject {
    enum Phase {
        case loading
        case signedOut
        case ready(TeacherSelf)
    }

    @Published var phase: Phase = .loading
    @Published var authError: String?

    private let tokenKey = "bali.teacher.devToken"
    private(set) lazy var api = APIClient { [weak self] in await self?.token() }

    private nonisolated func devToken() -> String? {
        UserDefaults.standard.string(forKey: tokenKey)
    }

    nonisolated func token() async -> String? {
        #if DEBUG
        if let dev = devToken() { return dev }
        #endif
        return await AmplifyAuth.idToken()
    }

    func start() async {
        #if DEBUG
        if devToken() != nil {
            await loadProfile()
            return
        }
        #endif
        if AmplifyAuth.isAvailable, await AmplifyAuth.isSignedIn() {
            await loadProfile()
        } else {
            phase = .signedOut
        }
    }

    func signIn(email: String, password: String) async {
        authError = nil
        do {
            let complete = try await AmplifyAuth.signIn(email: email, password: password)
            if complete {
                await loadProfile()
            } else {
                authError = "Confirm your account first — check your email, or sign in once on the web."
            }
        } catch {
            authError = AmplifyAuth.describe(error)
        }
    }

    func signInWithGoogle() async {
        authError = nil
        do {
            if try await AmplifyAuth.signInWithGoogle() {
                await loadProfile()
            }
        } catch {
            authError = AmplifyAuth.describe(error)
        }
    }

    func devSignIn() async {
        #if DEBUG
        UserDefaults.standard.set("dev:t-sandbox:sandbox-teacher@bali.dev:Sandbox Teacher", forKey: tokenKey)
        await loadProfile()
        #endif
    }

    func signOut() {
        UserDefaults.standard.removeObject(forKey: tokenKey)
        Task { await AmplifyAuth.signOut() }
        phase = .signedOut
    }

    private func loadProfile() async {
        struct Me: Decodable {
            var role: String?
            var teacher: TeacherSelf?
        }
        do {
            _ = try? await api.post("auth/bootstrap", body: BootstrapBody(role: "teacher", firstName: nil, lastName: nil), as: BootstrapResult.self)
            let me = try await api.get("me", as: Me.self)
            if let teacher = me.teacher {
                phase = .ready(teacher)
            } else {
                authError = "This account isn't a teacher account."
                UserDefaults.standard.removeObject(forKey: tokenKey)
                phase = .signedOut
            }
        } catch {
            phase = .signedOut
        }
    }
}

struct TeacherSignInView: View {
    @EnvironmentObject private var store: TeacherStore
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false

    private var canSubmit: Bool {
        email.contains("@") && password.count >= 8 && !busy
    }

    var body: some View {
        ZStack {
            Tokens.Light.page.ignoresSafeArea()
            VStack(spacing: 22) {
                Spacer()
                ArcMarkView(size: 56, trackColor: Tokens.Light.border, fillColor: Tokens.green600)
                Text("Bali")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundColor(Tokens.Light.textPrimary)
                Text("Focus sessions for your classroom")
                    .font(.system(size: 16))
                    .foregroundColor(Tokens.Light.textSecondary)
                Spacer()

                VStack(spacing: 12) {
                    TeacherField("Email", text: $email, contentType: .emailAddress, keyboard: .emailAddress)
                    TeacherField("Password", text: $password, contentType: .password, secure: true)

                    if let error = store.authError {
                        Text(error)
                            .font(.system(size: 13))
                            .foregroundColor(Tokens.Light.textSecondary)
                            .multilineTextAlignment(.center)
                    }

                    Button {
                        busy = true
                        Task {
                            await store.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
                            busy = false
                        }
                    } label: {
                        Group {
                            if busy { ProgressView().tint(.white) } else { Text("Sign in") }
                        }
                        .font(.system(size: 17, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(Tokens.Light.actionPrimaryBg)
                        .foregroundColor(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .disabled(!canSubmit)
                    .opacity(canSubmit ? 1 : 0.45)

                    Button {
                        busy = true
                        Task {
                            await store.signInWithGoogle()
                            busy = false
                        }
                    } label: {
                        Text("Continue with Google")
                            .font(.system(size: 17, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                            .background(Tokens.Light.card)
                            .foregroundColor(Tokens.Light.textPrimary)
                            .overlay(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .stroke(Tokens.Light.borderStrong, lineWidth: 1)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .disabled(busy)

                    Text("Students don't sign in here — they use the Bali app.")
                        .font(.system(size: 13))
                        .foregroundColor(Tokens.Light.textTertiary)

                    #if DEBUG
                    Button("Dev sign-in (local only)") {
                        Task { await store.devSignIn() }
                    }
                    .font(.system(size: 13, weight: .medium))
                    .foregroundColor(Tokens.Light.textTertiary)
                    .padding(.top, 10)
                    #endif
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 48)
            }
        }
    }
}

struct TeacherField: View {
    var placeholder: String
    @Binding var text: String
    var contentType: UITextContentType
    var keyboard: UIKeyboardType = .default
    var secure = false

    init(_ placeholder: String, text: Binding<String>, contentType: UITextContentType,
         keyboard: UIKeyboardType = .default, secure: Bool = false) {
        self.placeholder = placeholder
        self._text = text
        self.contentType = contentType
        self.keyboard = keyboard
        self.secure = secure
    }

    var body: some View {
        Group {
            if secure {
                SecureField("", text: $text, prompt: Text(placeholder).foregroundColor(Tokens.Light.textTertiary))
            } else {
                TextField("", text: $text, prompt: Text(placeholder).foregroundColor(Tokens.Light.textTertiary))
                    .keyboardType(keyboard)
                    .textInputAutocapitalization(.never)
            }
        }
        .textContentType(contentType)
        .autocorrectionDisabled()
        .font(.system(size: 17))
        .foregroundColor(Tokens.Light.textPrimary)
        .padding(.horizontal, 16)
        .frame(height: 50)
        .background(Tokens.Light.card)
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Tokens.Light.borderStrong, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
