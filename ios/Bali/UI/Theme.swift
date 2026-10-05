import SwiftUI

// The Bali Design System as the student app draws it (D1, approved 2026-09-24; `docs/DECISIONS.md`,
// 2026-09-26): its light tokens only — D1 is light, and `RootView` renders light in every
// appearance (the owner's pick, 2026-10-04) — in the system font at D1's sizes, in the Soft premium
// shapes from D2h (DESIGN.md §1: pill buttons and chips, inputs as sunken wells at `radius-sm` under
// the focus ring, cards at `radius-lg` with shadow-1), and only the atoms the screens use.

enum Theme {
    // Colours, D1's light values in `bali-tokens.json`, beside this file — `AppTests.tokens` pins
    // each, the chips' too, and a colour added here joins its list: the page and cards; the
    // borders; the inks; the brand and its pressed shade; the countdown arc's fill, its last two
    // minutes' and its track, and the mark's own track — which D1's Focus ring draws too; and the
    // focus ring's, the arc's colour.
    static let page = Color(hex: 0xF7F5F2)
    static let card = Color.white
    static let sunken = Color(hex: 0xEFECE7)
    static let border = Color(hex: 0xE3DFD8)
    static let borderStrong = Color(hex: 0xD2CCC2)
    static let text = Color(hex: 0x211F1B)
    static let textSecondary = Color(hex: 0x5B564E)
    static let textTertiary = Color(hex: 0x6B665D)
    static let brand = Color(hex: 0x245A43)
    static let brandPressed = Color(hex: 0x1E4936)
    static let arc = Color(hex: 0x2C6F51)
    static let arcFinal = Color(hex: 0x62A483)
    static let arcTrack = border
    static let markTrack = Color(hex: 0xBCDCCA)
    /// action-destructive-bg, red-600, for the one destructive action: Me's Delete account (C4b;
    /// DESIGN.md §2, red reserved). Pressed, red-700: the tokens name no pressed shade for it, so
    /// the next red primitive stands in (`docs/DECISIONS.md`, C4b).
    static let destructive = Color(hex: 0xA93D31)
    static let destructivePressed = Color(hex: 0x8C342B)
    /// focus-ring-color, green-600: the arc's own, ringing a focused input (`focusRing`).
    static let focusRing = arc
    /// shadow-1, a resting card's: 0 1px 2px, warm black at 6 %.
    static let shadow = Color(hex: 0x211C15).opacity(0.06)

    /// The 4-pt grid's steps the screens use, and the page's side gutter.
    static let gutter: CGFloat = 24
    enum Radius {
        static let xs: CGFloat = 6, sm: CGFloat = 10, md: CGFloat = 14, lg: CGFloat = 20
    }

    /// A screen the student opens over another fading in, and the one under it fading back in as
    /// they go back (#150): the design system's `base`, 200 ms, on its `standard` easing. None under
    /// Reduce Motion, where every animation is off and a fade is instant (DESIGN.md).
    static func fade(reduceMotion: Bool) -> Animation? {
        reduceMotion ? nil : .timingCurve(0.2, 0, 0, 1, duration: 0.2)
    }
}

extension Color {
    /// A colour of the design system's, from its sRGB hex.
    init(hex: UInt32) {
        self.init(
            red: Double(hex >> 16 & 0xFF) / 255, green: Double(hex >> 8 & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255)
    }
}

/// D1's type scale — a size, a line height, a weight and a tracking in ems — in the system font;
/// its numerals rounded where the design system's are, and each digit one width (`tabular-nums`).
struct TextStyle {
    let size: CGFloat
    let line: CGFloat
    var weight = Font.Weight.regular
    var tracking: CGFloat = 0
    var design = Font.Design.default
    var tabular = false

    static let h1 = TextStyle(size: 32, line: 38, weight: .semibold, tracking: -0.01)
    static let h2 = TextStyle(size: 24, line: 30, weight: .semibold)
    static let h3 = TextStyle(size: 18, line: 24, weight: .semibold)
    static let bodyLg = TextStyle(size: 17, line: 26)
    static let body = TextStyle(size: 15, line: 22)
    static let caption = TextStyle(size: 13, line: 18)
    /// Chips and micro-labels: uppercase, which the view sets.
    static let label = TextStyle(size: 12, line: 16, weight: .semibold, tracking: 0.06)
    /// A button's label.
    static let button = TextStyle(size: 17, line: 22, weight: .semibold)
    /// Tables and stats; medium countdowns, rounded.
    static let data = TextStyle(size: 14, line: 20, weight: .medium, tabular: true)
    static let dataLg = TextStyle(
        size: 28, line: 32, weight: .semibold, design: .rounded, tabular: true)
    /// D1's Focus countdown, inside its ring.
    static let countdown = TextStyle(
        size: 64, line: 68, weight: .semibold, tracking: -0.02, design: .rounded, tabular: true)
}

extension View {
    /// Text in `style`, at the phone's text size.
    func textStyle(_ style: TextStyle) -> some View { modifier(Styled(style: style)) }
}

/// `style`'s font, tracking and line height — over the system font's own, about 1.2 times the
/// size — scaled as the phone scales body text (Dynamic Type).
private struct Styled: ViewModifier {
    let style: TextStyle
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    func body(content: Content) -> some View {
        let size = style.size * scale
        let font = Font.system(size: size, weight: style.weight, design: style.design)
        content.font(style.tabular ? font.monospacedDigit() : font)
            .tracking(size * style.tracking)
            .lineSpacing(max(0, (style.line - style.size * 1.2) * scale))
    }
}

/// The primary action, a pill (D2h) at D1's 56 pt: the brand's fill — pressed, its darker shade —
/// and a white 17 semibold label, 20 pt in from the round ends so a long label that wraps stays
/// clear of the curve (santa's round 1); dimmed while disabled, as a busy one is. `destructive`,
/// the same in DESIGN.md's destructive red: Delete account's confirm (C4b), and nothing else.
struct PrimaryButtonStyle: ButtonStyle {
    var destructive = false
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        let (fill, pressed) =
            destructive
            ? (Theme.destructive, Theme.destructivePressed) : (Theme.brand, Theme.brandPressed)
        configuration.label.pillLabel().foregroundStyle(.white)
            .background(configuration.isPressed ? pressed : fill, in: .capsule)
            .opacity(enabled ? 1 : 0.6)
    }
}

/// The secondary action: the primary's shape, white with a strong border and the primary ink —
/// pressed, the sunken fill; dimmed while disabled, as the primary is.
struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label.pillLabel().foregroundStyle(Theme.text)
            .background(configuration.isPressed ? Theme.sunken : Theme.card, in: .capsule)
            .overlay(Capsule().stroke(Theme.borderStrong))
            .opacity(enabled ? 1 : 0.6)
    }
}

extension View {
    /// A pill button's label: the button style, centred when it wraps, 20 pt in from the ends, in
    /// a full-width 56-pt pill.
    fileprivate func pillLabel() -> some View {
        textStyle(.button).multilineTextAlignment(.center).padding(.horizontal, 20)
            .frame(maxWidth: .infinity, minHeight: 56)
    }

    /// DESIGN.md's focus ring, `shown` while an input is focused: a 2-pt gap in the page's colour
    /// — drawn, so the ring reads the same on a card — then a 2-pt ring in `focus-ring-color`,
    /// around a shape of `radius`.
    func focusRing(_ shown: Bool, radius: CGFloat) -> some View {
        overlay(
            RoundedRectangle(cornerRadius: radius + 1)
                .stroke(shown ? Theme.page : .clear, lineWidth: 2).padding(-1)
        )
        .overlay(
            RoundedRectangle(cornerRadius: radius + 3)
                .stroke(shown ? Theme.focusRing : .clear, lineWidth: 2).padding(-3))
    }
}

/// A card: white, radius 20, shadow-1, D1's 20-pt padding unless a screen packs rows into it. Its
/// shadow is its shape's alone, drawn once at its edge: one over the whole card shadows every line,
/// chip and button inside it too, each redrawn as a screen scrolls (#139).
struct Card<Content: View>: View {
    var padding: CGFloat = 20
    @ViewBuilder let content: () -> Content

    var body: some View {
        content().padding(padding).frame(maxWidth: .infinity)
            .background(
                Theme.card.shadow(.drop(color: Theme.shadow, radius: 1, y: 1)),
                in: .rect(cornerRadius: Theme.Radius.lg))
    }
}

/// A state chip, as every surface shows a student's state: its colour, an icon and a label,
/// never the colour alone. D1's fill and ink per kind; 6 × 12 padding, a pill (D2h), the label
/// style in uppercase.
struct Chip: View {
    enum Kind {
        case focused, unlocked, protectionOff, ended, notIn

        /// The design system's fill and ink — red for protection off alone — and its SF Symbol.
        var look: (fill: Color, ink: Color, icon: String) {
            switch self {
            case .focused: (Color(hex: 0xDCEDE3), Theme.brand, "checkmark.circle.fill")
            case .unlocked: (Color(hex: 0xF7E6D2), Color(hex: 0x6F3F1B), "lock.open")
            case .protectionOff: (Color(hex: 0xFAE3E0), Color(hex: 0x8C342B), "shield.slash")
            case .ended: (Theme.sunken, Theme.textTertiary, "flag")
            case .notIn: (Theme.sunken, Color(hex: 0x524E47), "circle")
            }
        }
    }

    let kind: Kind
    /// An SF Symbol in place of the kind's own.
    var icon: String?
    let text: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon ?? kind.look.icon)
            Text(text)
        }
        .textStyle(.label).textCase(.uppercase).foregroundStyle(kind.look.ink)
        .padding(.vertical, 6).padding(.horizontal, 12)
        .background(kind.look.fill, in: .capsule)
    }
}

/// The Bali mark: the session arc as emblem — green-200's track ring, and green-600's arc with
/// round caps, open at the upper left, 296° of the ring (about 330° with its caps), stroked 10 of
/// 64 — drawn as the shield's `BaliMark` asset and D1's SVG draw it, at `size`.
struct BaliMark: View {
    let size: CGFloat

    var body: some View {
        let stroke = StrokeStyle(lineWidth: size * 10 / 64, lineCap: .round)
        ZStack {
            Circle().stroke(Theme.markTrack, style: stroke)
            // The SVG's arc: from 13° short of the top, clockwise to 13° above the left.
            Circle().trim(from: 0, to: 296 / 360).stroke(Theme.arc, style: stroke)
                .rotationEffect(.degrees(257))
        }
        .padding(size * 8 / 64)
        .frame(width: size, height: size)
        .accessibilityLabel("Bali")
    }
}

/// Back, at a screen's top left: an arrow in a 44-pt target, "Back" to VoiceOver.
struct BackButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.left").font(.system(size: 20, weight: .semibold))
                .frame(width: 44, height: 44)
        }
        .foregroundStyle(Theme.text).padding(.leading, -10).accessibilityLabel("Back")
    }
}

/// A screen's content laid out in its whole height — centred, or held apart by its spacers — and
/// scrolling only once the phone's text size outgrows it, so no line is ever cut off; as wide as
/// the screen, its content in the gutters (`screenWide`).
struct PageScroll<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                content().frame(maxWidth: .infinity, minHeight: geometry.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .screenWide()
    }
}

extension View {
    /// A scroll view out to the screen's edges, past `ScreenScaffold`'s gutters — its scroll bar at
    /// the edge, never over the cards — with its content inside them, as the rest of the screen is.
    /// Every scroll view in a scaffold takes it (`AppTests.scrollEdges`).
    func screenWide() -> some View {
        contentMargins(.horizontal, Theme.gutter, for: .scrollContent)
            .padding(.horizontal, -Theme.gutter)
    }
}

/// A screen as D1 lays one out: the page colour to the edges, 24-pt gutters — which its scroll
/// views reach past (`screenWide`) — and 16 pt between the status bar and the content (D1's 64
/// from the top of its 390 × 844 frame).
struct ScreenScaffold<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content() }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.horizontal, Theme.gutter).padding(.top, 16)
            .foregroundStyle(Theme.text)
            .background(Theme.page.ignoresSafeArea())
    }
}
