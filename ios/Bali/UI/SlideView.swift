import BaliCore
import PDFKit
import SwiftUI

/// The deck of the slide a lesson shows, as this phone has it (M8): its SHA-256 and where its fetch
/// stands — on its way, failed, or in, its document parsed from the bytes in memory, never a file.
struct SlideDeck {
    enum Phase: Equatable {
        case loading, failed
        case ready(PDFDocument)

        /// `result` as the slide shows it: the document, once PDFKit opens it, else failed — each
        /// failure the canvas's one line with Try again.
        init(_ result: DeckResult) {
            guard case .ready(let bytes) = result, let document = PDFDocument(data: bytes),
                !document.isLocked, document.pageCount > 0
            else { self = .failed; return }
            self = .ready(document)
        }
    }

    let sha256: String
    var phase: Phase
}

/// The slide a screen shows (M8): the page the teacher shows, and its deck as this phone has it.
struct SlideShown: Equatable {
    let slide: Slide
    let phase: SlideDeck.Phase
}

/// The slide (M8; the app canvas's FocusSlide, SlideLoading and SlideFailed, in D1's look): which
/// slide of how many over the page, in a 16:9 frame the width of the screen (`PageView`), its deck
/// asked for as it shows (`Phone.loadDeck`); before it is in, Loading the slides…, and one that
/// didn't come, Bali couldn't load the slides. with Try again (rule 5).
struct SlideView: View {
    let shown: SlideShown
    let phone: Phone

    var body: some View {
        let slide = shown.slide
        let which = "Slide \(slide.page) of \(slide.pageCount)"
        let page: PDFPage? = if case .ready(let deck) = shown.phase { deck.page(at: slide.page - 1) } else { nil }
        VStack(alignment: .leading, spacing: 8) {
            // Side by side, or the hint under once the phone's text size outgrows the row.
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    label(which)
                    Spacer(minLength: 12)
                    if page != nil { hint }
                }
                VStack(alignment: .leading, spacing: 4) {
                    label(which)
                    if page != nil { hint }
                }
            }
            if let page {
                PageView(page: page, said: page.said ?? which)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .clipShape(.rect(cornerRadius: Theme.Radius.md))
                    .overlay(RoundedRectangle(cornerRadius: Theme.Radius.md).strokeBorder(Theme.border))
                    .background(
                        Theme.card.shadow(.drop(color: Theme.shadow, radius: 1, y: 1)),
                        in: .rect(cornerRadius: Theme.Radius.md))
            } else {
                waiting(failed: shown.phase != .loading, slide)
            }
        }
        .task(id: slide.sha256) { phone.loadDeck(for: slide) }
    }

    /// Which slide of how many.
    private func label(_ which: String) -> some View {
        Text(which).textStyle(.label).textCase(.uppercase).foregroundStyle(Theme.brand)
    }

    /// Beside the page, once it is in.
    private var hint: some View {
        Text("Pinch to zoom").textStyle(.caption).foregroundStyle(Theme.textTertiary)
    }

    /// The frame before its page is in: on its way, or — `failed` — not coming, with Try again. At
    /// least the page's 16:9, and taller once the phone's text size needs it, so no line is cut.
    private func waiting(failed: Bool, _ slide: Slide) -> some View {
        ZStack {
            Color.clear.aspectRatio(16 / 9, contentMode: .fit)
            VStack(spacing: 4) {
                Text(failed ? "Bali couldn't load the slides." : "Loading the slides…").textStyle(.body)
                    .foregroundStyle(failed ? Theme.text : Theme.textSecondary)
                if failed {
                    Button("Try again") { phone.loadDeck(for: slide, again: true) }.buttonStyle(.plain)
                        .textStyle(TextStyle(size: 15, line: 22, weight: .semibold))
                        .foregroundStyle(Theme.brand).padding(.horizontal, 12)
                        .frame(minHeight: 44).contentShape(.rect)
                }
            }
            .multilineTextAlignment(.center).padding(24)
        }
        .frame(maxWidth: .infinity)
        .background(Theme.sunken, in: .rect(cornerRadius: Theme.Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.md).strokeBorder(Theme.border))
    }
}

extension PDFPage {
    /// The page's text as VoiceOver reads it, nil when it has none (decision 8).
    var said: String? {
        let text = string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return text.isEmpty ? nil : text
    }
}

/// The slide's page in PDFKit's view (ARCHITECTURE, "Live lesson", decision 8), alone in a document
/// of its own, its links and fields taken out of reach and a touch on it given to a clear view over
/// it (markup mode), never to PDFKit's links, fields or text selection, whose Look Up and Share
/// sheets would cover Emergency Unlock (decision 1). As large as fits, pinched up to four times
/// that; VoiceOver reads it as one element, `said`.
private struct PageView: UIViewRepresentable {
    let page: PDFPage
    let said: String

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> SlidePDFView {
        let view = SlidePDFView()
        (view.displayMode, view.displaysPageBreaks, view.autoScales) = (.singlePage, false, true)
        view.backgroundColor = .white
        view.delegate = context.coordinator
        (view.pageOverlayViewProvider, view.isInMarkupMode) = (context.coordinator, true)
        view.isAccessibilityElement = true
        return view
    }

    func updateUIView(_ view: SlidePDFView, context: Context) {
        view.accessibilityLabel = said
        guard context.coordinator.page !== page else { return }
        context.coordinator.page = page
        view.document = alone(page)
        view.autoScales = true
    }

    final class Coordinator: NSObject, PDFViewDelegate, PDFPageOverlayViewProvider {
        /// The deck's page shown: a change of page or deck makes a document of the new one.
        var page: PDFPage?

        /// PDFKit's own answer to a tap on a link opens it, which a delegate's replaces: here,
        /// nothing (decision 8).
        func pdfViewWillClick(onLink sender: PDFView, with url: URL) {}

        /// The clear view over the page that a touch lands on in markup mode; pinching and
        /// scrolling stay PDFKit's. Asked on the main thread, as PDFKit lays the page out.
        func pdfView(_ view: PDFView, overlayViewFor page: PDFPage) -> UIView? {
            MainActor.assumeIsolated { UIView() }
        }
    }
}

/// `page`, copied alone into a document of its own, with no link annotation, nothing that acts, and
/// no field to type in.
private func alone(_ page: PDFPage) -> PDFDocument {
    let document = PDFDocument()
    guard let copy = page.copy() as? PDFPage else { return document }
    for annotation in copy.annotations {
        if annotation.type == "Link" || annotation.action != nil || annotation.url != nil {
            copy.removeAnnotation(annotation)
        } else if annotation.type == "Widget" {
            annotation.isReadOnly = true
        }
    }
    document.insert(copy, at: 0)
    return document
}

/// PDFKit's view, its zoom kept from the page as large as fits to four times that.
final class SlidePDFView: PDFView {
    override func layoutSubviews() {
        super.layoutSubviews()
        let fit = scaleFactorForSizeToFit
        guard fit > 0, minScaleFactor != fit else { return }
        (minScaleFactor, maxScaleFactor) = (fit, fit * 4)
    }
}
