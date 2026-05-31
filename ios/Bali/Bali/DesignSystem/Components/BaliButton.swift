//
//  BaliButton.swift
//  Bali — design system
//
//  Pill buttons matching .btn and its variants. Height 52 (sm 42, lg 56),
//  weight 650, 8pt icon/label gap, active scale 0.97, disabled opacity .45.
//

import SwiftUI

enum BaliButtonVariant {
    case primary, secondary, ghost, dark, danger, dangerSoft, glass, glassStrong

    var background: Color {
        switch self {
        case .primary:     return BaliColor.blue
        case .secondary:   return BaliColor.blueTint
        case .ghost:       return BaliColor.surface
        case .dark:        return BaliColor.ink
        case .danger:      return BaliColor.coral
        case .dangerSoft:  return BaliColor.coralTint
        case .glass:       return Color.white.opacity(0.10)
        case .glassStrong: return .white
        }
    }

    var foreground: Color {
        switch self {
        case .primary:     return .white
        case .secondary:   return BaliColor.blue
        case .ghost:       return BaliColor.ink
        case .dark:        return .white
        case .danger:      return .white
        case .dangerSoft:  return BaliColor.coral
        case .glass:       return .white
        case .glassStrong: return BaliColor.focusBg
        }
    }

    var shadow: BaliShadow? {
        switch self {
        case .primary: return .blue
        case .danger:  return .danger
        default:       return nil
        }
    }

    /// Inset border (ghost = 1.5 line; glass = 1 translucent white).
    var border: (color: Color, width: CGFloat)? {
        switch self {
        case .ghost: return (BaliColor.line, 1.5)
        case .glass: return (Color.white.opacity(0.14), 1)
        default:     return nil
        }
    }
}

enum BaliButtonSize {
    case sm, md, lg
    var height: CGFloat { self == .sm ? 42 : self == .lg ? 56 : 52 }
    var fontSize: CGFloat { self == .sm ? 15 : self == .lg ? 17.5 : 16.5 }
}

private struct PressScaleStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

struct BaliButton: View {
    let title: String
    var icon: String? = nil
    var trailingIcon: String? = nil
    var variant: BaliButtonVariant = .primary
    var size: BaliButtonSize = .md
    var fullWidth: Bool = true
    let action: () -> Void

    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Button(action: action) {
            HStack(spacing: BaliSpacing.s) {
                if let icon { Image(systemName: icon) }
                Text(title)
                if let trailingIcon { Image(systemName: trailingIcon) }
            }
            .font(BaliFont.at(size.fontSize, 650))
            .tracking(size.fontSize * -0.01)
            .foregroundStyle(variant.foreground)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .frame(height: size.height)
            .padding(.horizontal, fullWidth ? 0 : 22)
            .background(variant.background)
            .clipShape(Capsule())
            .overlay {
                if let border = variant.border {
                    Capsule().strokeBorder(border.color, lineWidth: border.width)
                }
            }
            .modifier(ConditionalShadow(shadow: isEnabled ? variant.shadow : nil))
            .opacity(isEnabled ? 1 : 0.45)
            .contentShape(Capsule())
        }
        .buttonStyle(PressScaleStyle())
    }
}

/// Applies a Bali shadow only when present (disabled buttons drop their shadow).
private struct ConditionalShadow: ViewModifier {
    let shadow: BaliShadow?
    func body(content: Content) -> some View {
        if let shadow {
            content.baliShadow(shadow)
        } else {
            content
        }
    }
}

#Preview {
    ScrollView {
        VStack(spacing: 14) {
            BaliButton(title: "Sign in", trailingIcon: "arrow.right", action: {})
            BaliButton(title: "Continue with Google", variant: .ghost, action: {})
            BaliButton(title: "Secondary", variant: .secondary, action: {})
            BaliButton(title: "View Focus Mode", variant: .dark, action: {})
            BaliButton(title: "Send request", variant: .danger, action: {})
            BaliButton(title: "Request emergency unlock", variant: .dangerSoft, action: {})
            BaliButton(title: "Disabled", action: {}).disabled(true)
            HStack {
                BaliButton(title: "Small", size: .sm, fullWidth: false, action: {})
                BaliButton(title: "Large", size: .lg, fullWidth: false, action: {})
            }
        }
        .padding()
    }
    .background(BaliColor.bg)
}
