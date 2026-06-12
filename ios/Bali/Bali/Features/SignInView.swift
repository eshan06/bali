import SwiftUI

/// S0 — student sign-in/sign-up (design gap noted in WIRING_PLAN §8.1; token-styled,
/// dark-first). Real path: Cognito SRP email+password, with the email-code
/// confirmation step. DEBUG keeps the dev sign-in that adopts a seeded student.
struct SignInView: View {
    @EnvironmentObject private var auth: AuthStore

    enum Mode: String, CaseIterable {
        case signIn = "Sign in"
        case create = "Create account"
    }

    @State private var mode: Mode = .signIn
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var showDev = false

    private var trimmedFirst: String { firstName.trimmingCharacters(in: .whitespaces) }
    private var trimmedLast: String { lastName.trimmingCharacters(in: .whitespaces) }
    private var trimmedEmail: String { email.trimmingCharacters(in: .whitespaces) }

    private var canSubmit: Bool {
        if busy { return false }
        let credsOk = trimmedEmail.contains("@") && password.count >= 8
        switch mode {
        case .signIn: return credsOk
        case .create: return credsOk && !trimmedFirst.isEmpty && !trimmedLast.isEmpty
        }
    }

    var body: some View {
        ZStack {
            Tokens.Dark.page.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 24) {
                    Spacer(minLength: 60)
                    ArcMarkView(size: 56)
                    Text("Bali")
                        .font(.system(size: 28, weight: .semibold))
                        .foregroundColor(Tokens.Dark.textPrimary)
                    Text("Your class, focused together")
                        .font(.system(size: 16))
                        .foregroundColor(Tokens.Dark.textSecondary)

                    Picker("", selection: $mode) {
                        ForEach(Mode.allCases, id: \.self) { Text($0.rawValue) }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 20)

                    VStack(spacing: 12) {
                        if mode == .create {
                            HStack(spacing: 12) {
                                AuthField("First name", text: $firstName, contentType: .givenName)
                                AuthField("Last name", text: $lastName, contentType: .familyName)
                            }
                        }
                        AuthField("Email", text: $email, contentType: .emailAddress, keyboard: .emailAddress)
                        AuthField("Password", text: $password, contentType: mode == .create ? .newPassword : .password, secure: true)

                        if let error = auth.authError {
                            Text(error)
                                .font(.system(size: 13))
                                .foregroundColor(Tokens.Dark.textSecondary)
                                .multilineTextAlignment(.center)
                                .padding(.top, 2)
                        }

                        Button {
                            busy = true
                            Task {
                                switch mode {
                                case .signIn:
                                    await auth.signIn(email: trimmedEmail, password: password)
                                case .create:
                                    await auth.signUp(
                                        email: trimmedEmail, password: password,
                                        firstName: trimmedFirst, lastName: trimmedLast
                                    )
                                }
                                busy = false
                            }
                        } label: {
                            PrimaryButtonLabel(title: mode == .signIn ? "Sign in" : "Create account", busy: busy)
                        }
                        .disabled(!canSubmit)
                        .opacity(canSubmit ? 1 : 0.45)

                        Text("Bali never sees your screen, apps, messages, or location.")
                            .font(.system(size: 13))
                            .foregroundColor(Tokens.Dark.textTertiary)
                            .multilineTextAlignment(.center)
                            .padding(.top, 4)

                        #if DEBUG
                        Button("Dev sign-in (local only)") { showDev = true }
                            .font(.system(size: 13, weight: .medium))
                            .foregroundColor(Tokens.Dark.textTertiary)
                            .padding(.top, 14)
                        #endif
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 48)
                }
            }
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showDev) { DevSignInSheet() }
    }
}

/// Confirmation-code step (Cognito emailed a 6-digit code at sign-up).
struct ConfirmCodeView: View {
    @EnvironmentObject private var auth: AuthStore
    var email: String
    var password: String

    @State private var code = ""
    @State private var busy = false

    var body: some View {
        ZStack {
            Tokens.Dark.page.ignoresSafeArea()
            VStack(spacing: 22) {
                Spacer()
                ArcMarkView(size: 48)
                Text("Check your email")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundColor(Tokens.Dark.textPrimary)
                Text("We sent a 6-digit code to \(email).")
                    .font(.system(size: 15))
                    .foregroundColor(Tokens.Dark.textSecondary)
                    .multilineTextAlignment(.center)

                AuthField("Code", text: $code, contentType: .oneTimeCode, keyboard: .numberPad)
                    .frame(width: 200)

                if let error = auth.authError {
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundColor(Tokens.Dark.textSecondary)
                        .multilineTextAlignment(.center)
                }

                Button {
                    busy = true
                    Task {
                        await auth.confirmSignUp(email: email, password: password, code: code.trimmingCharacters(in: .whitespaces))
                        busy = false
                    }
                } label: {
                    PrimaryButtonLabel(title: "Confirm", busy: busy)
                }
                .disabled(code.trimmingCharacters(in: .whitespaces).count < 6 || busy)
                .opacity(code.trimmingCharacters(in: .whitespaces).count < 6 ? 0.45 : 1)
                .padding(.horizontal, 60)

                Button("Use a different account") { auth.signOut() }
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(Tokens.Dark.textTertiary)
                Spacer()
            }
            .padding(.horizontal, 20)
        }
        .preferredColorScheme(.dark)
    }
}

/// Signed in to Cognito but no student row yet — one question, then in.
struct NameView: View {
    @EnvironmentObject private var auth: AuthStore
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var busy = false

    var body: some View {
        ZStack {
            Tokens.Dark.page.ignoresSafeArea()
            VStack(spacing: 22) {
                Spacer()
                ArcMarkView(size: 48)
                Text("What's your name?")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundColor(Tokens.Dark.textPrimary)
                Text("Your teacher sees it next to your focus status — that's all.")
                    .font(.system(size: 15))
                    .foregroundColor(Tokens.Dark.textSecondary)
                    .multilineTextAlignment(.center)

                AuthField("First name", text: $firstName, contentType: .givenName)
                AuthField("Last name", text: $lastName, contentType: .familyName)

                if let error = auth.authError {
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundColor(Tokens.Dark.textSecondary)
                }

                Button {
                    busy = true
                    Task {
                        await auth.submitName(
                            firstName: firstName.trimmingCharacters(in: .whitespaces),
                            lastName: lastName.trimmingCharacters(in: .whitespaces)
                        )
                        busy = false
                    }
                } label: {
                    PrimaryButtonLabel(title: "Continue", busy: busy)
                }
                .disabled(firstName.trimmingCharacters(in: .whitespaces).isEmpty
                    || lastName.trimmingCharacters(in: .whitespaces).isEmpty || busy)

                Button("Sign out") { auth.signOut() }
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(Tokens.Dark.textTertiary)
                Spacer()
            }
            .padding(.horizontal, 20)
        }
        .preferredColorScheme(.dark)
    }
}

#if DEBUG
/// The Simulator slice path: adopts a seeded roster student by name.
private struct DevSignInSheet: View {
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    @State private var firstName = "Jordan"
    @State private var lastName = "Park"
    @State private var busy = false

    var body: some View {
        ZStack {
            Tokens.Dark.page.ignoresSafeArea()
            VStack(spacing: 14) {
                Text("Dev sign-in")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundColor(Tokens.Dark.textPrimary)
                    .padding(.top, 28)
                Text("Local API only. Matching a seeded roster name adopts that student.")
                    .font(.system(size: 13))
                    .foregroundColor(Tokens.Dark.textTertiary)
                    .multilineTextAlignment(.center)
                AuthField("First name", text: $firstName, contentType: .givenName)
                AuthField("Last name", text: $lastName, contentType: .familyName)
                Button {
                    busy = true
                    Task {
                        await auth.devSignIn(
                            firstName: firstName.trimmingCharacters(in: .whitespaces),
                            lastName: lastName.trimmingCharacters(in: .whitespaces)
                        )
                        busy = false
                        dismiss()
                    }
                } label: {
                    PrimaryButtonLabel(title: "Continue", busy: busy)
                }
                .disabled(firstName.isEmpty || lastName.isEmpty || busy)
                Spacer()
            }
            .padding(.horizontal, 20)
        }
        .presentationDetents([.medium])
    }
}
#endif

// ---------- shared S0 pieces ----------

struct AuthField: View {
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
                SecureField("", text: $text, prompt: Text(placeholder).foregroundColor(Tokens.Dark.textTertiary))
            } else {
                TextField("", text: $text, prompt: Text(placeholder).foregroundColor(Tokens.Dark.textTertiary))
                    .keyboardType(keyboard)
                    .textInputAutocapitalization(contentType == .emailAddress ? .never : .words)
            }
        }
        .textContentType(contentType)
        .autocorrectionDisabled()
        .font(.system(size: 17))
        .foregroundColor(Tokens.Dark.textPrimary)
        .padding(.horizontal, 16)
        .frame(height: 50)
        .background(Tokens.Dark.card)
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Tokens.Dark.borderStrong, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct PrimaryButtonLabel: View {
    var title: String
    var busy: Bool

    var body: some View {
        Group {
            if busy {
                ProgressView().tint(Tokens.Dark.actionPrimaryFg)
            } else {
                Text(title)
            }
        }
        .font(.system(size: 17, weight: .semibold))
        .frame(maxWidth: .infinity)
        .frame(height: 50)
        .background(Tokens.Dark.actionPrimaryBg)
        .foregroundColor(Tokens.Dark.actionPrimaryFg)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
