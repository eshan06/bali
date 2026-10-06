import BaliCore
import SafariServices
import SwiftUI

/// The portal's privacy policy and terms (C2b), as two quiet text links on the intro's last page,
/// on Sign in and on Me — the portal's own words for them (`/login`). Each opens its page in an
/// in-app Safari sheet, so the student stays in Bali and Done brings them back. The pages live on
/// the production portal alone, whose address is this build's `BaliPortalURL` (`ios/project.yml`,
/// read by `AppConfig`); a build not set up draws no links — its start fails and says so
/// (`Phone.start`, rule 5), so no screen that carries them is reached.
struct PolicyLinks: View {
    /// The portal's two policy pages, each at its path.
    enum Page: String, CaseIterable, Identifiable {
        case privacy, terms

        var id: Self { self }

        var title: String {
            switch self {
            case .privacy: "Privacy policy"
            case .terms: "Terms"
            }
        }

        /// The page's address on the portal at `portal`.
        func url(on portal: URL) -> URL { portal.appending(path: rawValue) }
    }

    /// The portal's address, as this build sets it; nil in a build not set up.
    static let portal = AppConfig(info: Bundle.main.infoDictionary ?? [:])?.portal

    /// Where the links sit: centred, under the intro's Continue and Sign in's caption; leading on Me.
    var alignment: HorizontalAlignment = .center
    @State private var opened: Page?

    var body: some View {
        if let portal = Self.portal {
            // Side by side, or one under the other once the phone's text size outgrows the row.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 24) { links }
                VStack(alignment: alignment, spacing: 0) { links }
            }
            .frame(maxWidth: .infinity, alignment: Alignment(horizontal: alignment, vertical: .center))
            .sheet(item: $opened) { page in SafariView(url: page.url(on: portal)).ignoresSafeArea() }
        }
    }

    /// Each page's link: caption text in the brand's ink (DESIGN.md's links), in a 44-pt target.
    private var links: some View {
        ForEach(Page.allCases) { page in
            Button {
                opened = page
            } label: {
                Text(page.title).textStyle(.caption).foregroundStyle(Theme.brand)
                    .frame(minWidth: 44, minHeight: 44).contentShape(.rect)
            }
            .buttonStyle(.plain)
        }
    }
}

/// A web page in Safari's own view inside the app (`SFSafariViewController`): its controls in the
/// brand's ink, light as the app is, and Done to come back.
struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let safari = SFSafariViewController(url: url)
        safari.preferredControlTintColor = UIColor(Theme.brand)
        safari.overrideUserInterfaceStyle = .light
        return safari
    }

    func updateUIViewController(_: SFSafariViewController, context: Context) {}
}
