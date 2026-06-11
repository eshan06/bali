//
//  LoginView.swift
//  Bali — Login (screen 01)
//
//  Student sign-in. Blue gradient hero band ("bali" + tagline) with a white
//  form sheet overlapping it by 26pt: email + password fields, keep-signed-in +
//  Forgot, primary Sign in, an "or" divider, and Continue with Google. Drives
//  AuthStore; errors render inline. Matches design_handoff screenshot 01.
//

import SwiftUI

struct LoginView: View {
    @Environment(AuthStore.self) private var auth

    @State private var email = ""
    @State private var password = ""
    @State private var keepSignedIn = true

    private let heroHeight: CGFloat = 312

    var body: some View {
        ScrollView {
            VStack(spacing: -26) {
                hero
                formSheet
            }
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .background(BaliColor.bg.ignoresSafeArea())
        .ignoresSafeArea(edges: .top)
    }

    // MARK: Hero band

    private var hero: some View {
        ZStack(alignment: .bottomLeading) {
            BaliGradient.loginHero
                .overlay(alignment: .topTrailing) {
                    // Soft radial highlight.
                    Circle()
                        .fill(Color.white.opacity(0.18))
                        .frame(width: 260, height: 260)
                        .blur(radius: 80)
                        .offset(x: 80, y: -40)
                }

            VStack(alignment: .leading, spacing: BaliSpacing.s) {
                Wordmark(size: 40, color: .white)
                BaliText("Focus, made effortless.", .h2, color: .white)
                BaliText("Tap in. Lock in. Bali handles the rest while you're in class.",
                         .body, color: .white.opacity(0.85))
                    .frame(maxWidth: 280, alignment: .leading)
            }
            .padding(.horizontal, BaliSpacing.screenH)
            .padding(.bottom, 48)
        }
        .frame(height: heroHeight)
        .frame(maxWidth: .infinity)
    }

    // MARK: Form sheet

    private var formSheet: some View {
        VStack(alignment: .leading, spacing: BaliSpacing.l) {
            Eyebrow("Student sign in")
                .padding(.top, BaliSpacing.xxl)

            VStack(alignment: .leading, spacing: BaliSpacing.s) {
                FieldLabel("School email")
                BaliTextField(placeholder: "you@school.edu", text: $email,
                              icon: "envelope", keyboard: .emailAddress,
                              textContentType: .username)
            }

            VStack(alignment: .leading, spacing: BaliSpacing.s) {
                FieldLabel("Password")
                BaliTextField(placeholder: "Password", text: $password,
                              icon: "lock", isSecure: true,
                              textContentType: .password)
            }

            HStack {
                CheckboxRow(isOn: $keepSignedIn, label: "Keep me signed in")
                Spacer()
                Button("Forgot?") {}
                    .font(BaliFont.at(15, 600))
                    .foregroundStyle(BaliColor.blue)
            }

            if let error = auth.errorMessage {
                InlineError(message: error)
            }

            BaliButton(title: "Sign in", trailingIcon: "arrow.right",
                       size: .lg) {
                Task { await auth.signIn(email: email, password: password) }
            }
            .disabled(auth.isWorking)
            .overlay {
                if auth.isWorking {
                    ProgressView().tint(.white)
                }
            }

            orDivider

            Button {
                Task { await auth.signInWithGoogle() }
            } label: {
                HStack(spacing: BaliSpacing.s) {
                    GoogleGGlyph(size: 18)
                    Text("Continue with Google")
                        .font(BaliFont.at(16.5, 650))
                        .foregroundStyle(BaliColor.ink)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(BaliColor.surface)
                .clipShape(Capsule())
                .overlay { Capsule().strokeBorder(BaliColor.line, lineWidth: 1.5) }
            }
            .buttonStyle(.plain)
            .disabled(auth.isWorking)

            footer
        }
        .padding(.horizontal, BaliSpacing.screenH)
        .padding(.bottom, BaliSpacing.xxxl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            BaliColor.surface
                .clipShape(.rect(topLeadingRadius: 26, topTrailingRadius: 26))
        )
    }

    private var orDivider: some View {
        HStack(spacing: BaliSpacing.m) {
            Rectangle().fill(BaliColor.line).frame(height: 1)
            BaliText("or", .foot, color: BaliColor.ink4)
            Rectangle().fill(BaliColor.line).frame(height: 1)
        }
    }

    private var footer: some View {
        (Text("Bali is for ")
         + Text("students").bold()
         + Text(". Teachers manage classes on the web dashboard."))
            .font(BaliFont.at(13, 400))
            .foregroundStyle(BaliColor.ink3)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.top, BaliSpacing.s)
    }
}

// MARK: - Checkbox row (blue 18×18 with check)

private struct CheckboxRow: View {
    @Binding var isOn: Bool
    let label: String

    var body: some View {
        Button {
            isOn.toggle()
        } label: {
            HStack(spacing: BaliSpacing.s) {
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(isOn ? BaliColor.blue : BaliColor.surface)
                    .frame(width: 18, height: 18)
                    .overlay {
                        if isOn {
                            Image(systemName: "checkmark")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.white)
                        } else {
                            RoundedRectangle(cornerRadius: 5, style: .continuous)
                                .strokeBorder(BaliColor.line, lineWidth: 1.5)
                        }
                    }
                BaliText(label, .body, color: BaliColor.ink2)
            }
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Inline error

struct InlineError: View {
    let message: String
    var body: some View {
        HStack(alignment: .top, spacing: BaliSpacing.s) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(BaliColor.coral)
            BaliText(message, .foot, color: BaliColor.badgeCoralText)
        }
        .padding(BaliSpacing.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BaliColor.coralTint)
        .clipShape(RoundedRectangle(cornerRadius: BaliRadius.sm, style: .continuous))
    }
}

#Preview {
    LoginView()
        .injectBaliEnvironment(.preview(phase: .unauthenticated))
}
