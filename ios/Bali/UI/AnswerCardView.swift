import BaliOutbox
import SwiftUI

/// The answer card (L8; the app canvas's "The answer card, state by state"), one view for every
/// screen a question shows on: Focus here; Unlocked, Screen Time off and Home in L8c. A tap on an
/// answer sends it and another changes it until the close, with no Submit; closed, Hide, and the
/// correct answer marked once shown and the student's own as Your answer, never red; never a
/// count. Its looks and its line are `AnswerCard`'s.
struct AnswerCardView: View {
    let card: AnswerCard
    let phone: Phone
    /// An answer's letter disc, 28 pt at the default text size, growing with the text.
    @ScaledMetric(relativeTo: .body) private var discSize: CGFloat = 28

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 12) {
                        Text(card.open ? "Question" : "Question · Closed").textStyle(.label)
                            .textCase(.uppercase)
                            .foregroundStyle(card.open ? Theme.brand : Theme.textTertiary)
                        Spacer(minLength: 0)
                        if !card.open {
                            Button("Hide") { phone.hideQuestion() }.buttonStyle(.plain)
                                .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                                .foregroundStyle(Theme.brand).padding(.horizontal, 8)
                                .frame(minHeight: 44).contentShape(.rect)
                                .padding(.vertical, -14).padding(.trailing, -8)
                                .accessibilityLabel("Hide this question")
                        }
                    }
                    Text(card.question.prompt).textStyle(.h3)
                }
                VStack(spacing: 8) {
                    ForEach(Array(zip(card.question.options, card.looks).enumerated()), id: \.offset) {
                        index, option in answer(index, option.0, option.1)
                    }
                }
                HStack(alignment: .top, spacing: 8) {
                    if card.offline { Image(systemName: "wifi.slash").accessibilityHidden(true) }
                    Text(card.line)
                }
                .textStyle(.caption).foregroundStyle(card.alert ? Theme.text : Theme.textTertiary)
                VStack(alignment: .leading, spacing: 12) {
                    Rectangle().fill(Theme.border).frame(height: 1)
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "eye.slash").accessibilityHidden(true)
                        Text("Your teacher sees the class's totals, never which answer is yours.")
                    }
                    .textStyle(.caption).foregroundStyle(Theme.textTertiary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .multilineTextAlignment(.leading)
    }

    /// Answer `index` as `look` draws it: open, a button — picked, the brand's fill and a check —
    /// or closed: the correct one green-edged and marked, the student's own grey and marked.
    @ViewBuilder private func answer(_ index: Int, _ text: String, _ look: AnswerCard.Look) -> some View {
        let letter = String(UnicodeScalar(UInt8(65 + index)))
        switch look {
        case .open(let picked):
            Button {
                Task { await phone.answer(index) }
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    disc(letter, picked ? Theme.card : Theme.sunken, picked ? Theme.brand : Theme.text)
                    Text(text).textStyle(TextStyle(size: 17, line: 26, weight: picked ? .semibold : .regular))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if picked { Image(systemName: "checkmark").fontWeight(.bold).accessibilityHidden(true) }
                }
                .foregroundStyle(picked ? Color.white : Theme.text)
                .modifier(Box(fill: picked ? Theme.brand : Theme.page, edge: picked ? Theme.brand : Theme.border))
            }
            .buttonStyle(.plain)
            .accessibilityValue(picked ? "Your answer" : "")
            .accessibilityAddTraits(picked ? .isSelected : [])
        case .closed(let right, let mine):
            // Its letter centred on the words and their marks, as the closed boards draw it.
            HStack(spacing: 12) {
                disc(
                    letter, right ? Chip.Kind.focused.look.fill : mine ? Theme.card : Theme.sunken,
                    right ? Theme.brand : mine ? Theme.text : Theme.textSecondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(text).textStyle(TextStyle(size: 17, line: 26, weight: right ? .semibold : .regular))
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 12) { marks(right, mine) }
                        VStack(alignment: .leading, spacing: 2) { marks(right, mine) }
                    }
                    .textStyle(.label).textCase(.uppercase)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .foregroundStyle(right || mine ? Theme.text : Theme.textSecondary)
            .modifier(
                Box(
                    fill: right ? Theme.optionRight : mine ? Theme.sunken : Theme.card,
                    edge: right ? Theme.arc : mine ? Theme.borderStrong : Theme.border, width: right ? 2 : 1)
            )
            .accessibilityElement(children: .combine)
        }
    }

    /// An answer's letter on its disc, in whole points: a fraction left the answer's words a width
    /// they round up past, the card a pixel wider than the screen at the larger text sizes.
    private func disc(_ letter: String, _ fill: Color, _ ink: Color) -> some View {
        Text(letter).textStyle(TextStyle(size: 14, line: 20, weight: .semibold)).foregroundStyle(ink)
            .frame(width: discSize.rounded(), height: discSize.rounded()).background(fill, in: .circle)
    }

    /// A closed answer's marks: Correct answer, once shown, and Your answer.
    @ViewBuilder private func marks(_ right: Bool, _ mine: Bool) -> some View {
        if right {
            HStack(spacing: 4) {
                Image(systemName: "checkmark.circle").accessibilityHidden(true)
                Text("Correct answer")
            }
            .foregroundStyle(Theme.brand)
        }
        if mine { Text("Your answer").foregroundStyle(Chip.Kind.notIn.look.ink) }
    }
}

/// An answer's box: `fill` inside a 10-pt corner, its `edge` drawn inside it, the content 13 × 17
/// in from its outside, as the canvas's 12 × 16 padding inside its 1-pt border.
private struct Box: ViewModifier {
    let fill: Color
    let edge: Color
    var width: CGFloat = 1

    func body(content: Content) -> some View {
        content.padding(.vertical, 13).padding(.horizontal, 17)
            .background(fill, in: .rect(cornerRadius: Theme.Radius.sm))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.sm).strokeBorder(edge, lineWidth: width))
    }
}
