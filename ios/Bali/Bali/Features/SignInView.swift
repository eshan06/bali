import SwiftUI

/// S0 — minimal student sign-in (design gap noted in WIRING_PLAN §8.1).
/// Token-styled, dark-first. Production: Cognito SRP (Amplify) — lands with the
/// device pass; DEBUG offers the dev sign-in that adopts a seeded student by name.
struct SignInView: View {
    @EnvironmentObject private var auth: AuthStore
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var busy = false

    var body: some View {
        ZStack {
            Tokens.Dark.page.ignoresSafeArea()
            VStack(spacing: 24) {
                Spacer()
                ArcMarkView(size: 56)
                Text("Bali")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundColor(Tokens.Dark.textPrimary)
                Text("Your class, focused together")
                    .font(.system(size: 16))
                    .foregroundColor(Tokens.Dark.textSecondary)
                Spacer()

                VStack(spacing: 12) {
                    field("First name", text: $firstName, contentType: .givenName)
                    field("Last name", text: $lastName, contentType: .familyName)

                    Button {
                        busy = true
                        Task {
                            await auth.devSignIn(
                                firstName: firstName.trimmingCharacters(in: .whitespaces),
                                lastName: lastName.trimmingCharacters(in: .whitespaces)
                            )
                            busy = false
                        }
                    } label: {
                        Group {
                            if busy {
                                ProgressView().tint(Tokens.Dark.actionPrimaryFg)
                            } else {
                                Text("Continue")
                            }
                        }
                        .font(.system(size: 17, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                        .background(Tokens.Dark.actionPrimaryBg)
                        .foregroundColor(Tokens.Dark.actionPrimaryFg)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .disabled(firstName.trimmingCharacters(in: .whitespaces).isEmpty
                        || lastName.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                    .opacity(firstName.isEmpty || lastName.isEmpty ? 0.45 : 1)

                    Text("Bali never sees your screen, apps, messages, or location.")
                        .font(.system(size: 13))
                        .foregroundColor(Tokens.Dark.textTertiary)
                        .multilineTextAlignment(.center)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 48)
            }
        }
        .preferredColorScheme(.dark)
    }

    private func field(_ placeholder: String, text: Binding<String>, contentType: UITextContentType) -> some View {
        TextField("", text: text, prompt: Text(placeholder).foregroundColor(Tokens.Dark.textTertiary))
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

/// Brand arc mark (SVG recipe from the tokens doc, drawn natively).
struct ArcMarkView: View {
    var size: CGFloat
    var trackColor: Color = Tokens.Dark.border
    var fillColor: Color = Tokens.green400

    var body: some View {
        ZStack {
            Circle().stroke(trackColor, lineWidth: size * 0.15)
            Circle()
                .trim(from: 0, to: 0.72)
                .stroke(fillColor, style: StrokeStyle(lineWidth: size * 0.15, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: size, height: size)
    }
}
