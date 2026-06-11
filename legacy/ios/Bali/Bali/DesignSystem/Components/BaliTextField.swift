//
//  BaliTextField.swift
//  Bali — design system
//
//  Input field (.field): height 54, radius 15, white, 1.5 line border; focus →
//  2px blue border with the leading icon tinting blue. Plus a secure variant
//  with an eye toggle and a read-only variant (grey bg, trailing lock).
//

import SwiftUI

struct BaliTextField: View {
    let placeholder: String
    @Binding var text: String
    var icon: String? = nil
    var isSecure: Bool = false
    var keyboard: UIKeyboardType = .default
    var textContentType: UITextContentType? = nil
    var autocapitalization: TextInputAutocapitalization = .never

    @FocusState private var focused: Bool
    @State private var reveal = false

    private var showSecure: Bool { isSecure && !reveal }

    var body: some View {
        HStack(spacing: BaliSpacing.s10) {
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(focused ? BaliColor.blue : BaliColor.ink4)
                    .frame(width: 20)
            }

            Group {
                if showSecure {
                    SecureField(placeholder, text: $text)
                } else {
                    TextField(placeholder, text: $text)
                }
            }
            .font(BaliFont.at(16.5, 400))
            .foregroundStyle(BaliColor.ink)
            .tint(BaliColor.blue)
            .focused($focused)
            .keyboardType(keyboard)
            .textContentType(textContentType)
            .textInputAutocapitalization(autocapitalization)
            .autocorrectionDisabled()

            if isSecure {
                Button {
                    reveal.toggle()
                } label: {
                    Image(systemName: reveal ? "eye.slash" : "eye")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(BaliColor.ink4)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, BaliSpacing.l)
        .frame(height: 54)
        .background(BaliColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: BaliRadius.field, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: BaliRadius.field, style: .continuous)
                .strokeBorder(focused ? BaliColor.blue : BaliColor.line,
                              lineWidth: focused ? 2 : 1.5)
        }
        .animation(.easeOut(duration: 0.15), value: focused)
    }
}

/// Read-only field: grey background, no border, trailing lock.
struct BaliReadOnlyField: View {
    let value: String
    var icon: String? = nil

    var body: some View {
        HStack(spacing: BaliSpacing.s10) {
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(BaliColor.ink4)
                    .frame(width: 20)
            }
            Text(value)
                .font(BaliFont.at(16.5, 400))
                .foregroundStyle(BaliColor.ink3)
            Spacer(minLength: 0)
            Image(systemName: "lock.fill")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(BaliColor.ink4)
        }
        .padding(.horizontal, BaliSpacing.l)
        .frame(height: 54)
        .background(BaliColor.fieldReadOnlyBg)
        .clipShape(RoundedRectangle(cornerRadius: BaliRadius.field, style: .continuous))
    }
}

/// Field label (.label): 13/650, ink-2.
struct FieldLabel: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        BaliText(text, .label).frame(maxWidth: .infinity, alignment: .leading)
    }
}

#Preview {
    struct Demo: View {
        @State private var email = "maya.chen@lincoln.edu"
        @State private var password = "password"
        var body: some View {
            VStack(alignment: .leading, spacing: 14) {
                FieldLabel("School email")
                BaliTextField(placeholder: "you@school.edu", text: $email,
                              icon: "envelope", keyboard: .emailAddress)
                FieldLabel("Password")
                BaliTextField(placeholder: "Password", text: $password,
                              icon: "lock", isSecure: true)
                FieldLabel("School email · read only")
                BaliReadOnlyField(value: "maya.chen@lincoln.edu", icon: "envelope")
            }
            .padding()
            .background(BaliColor.bg)
        }
    }
    return Demo()
}
