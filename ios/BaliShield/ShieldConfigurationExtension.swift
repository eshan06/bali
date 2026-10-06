import BaliOutbox
import ManagedSettings
import ManagedSettingsUI
import UIKit

// Bali's own shield over a blocked app or website (ARCHITECTURE, "iOS app structure"; B5c), in
// the redesign (D2k) as far as `ShieldConfiguration` carries it: a background, an icon, a title
// and a subtitle, and a button, each in the design system's light tokens. Soft premium's shapes,
// spacing and type are iOS's to draw here. What it says is `ShieldWords`, tested on Linux; this
// only carries it out, reading nothing: iOS's sandbox refuses it the outbox file (B5c-2). The
// shield blocks every app and website a third party can (`.all()`), so iOS asks for each of these
// four. Its principal class, named in its Info.plist; the app's tests compile it too, to hold what
// it hands iOS to the words and the tokens (`AppTests.shield`, `AppTests.tokens`).
final class ShieldConfigurationExtension: ShieldConfigurationDataSource {
    override func configuration(shielding application: Application) -> ShieldConfiguration {
        shield(over: .app)
    }

    override func configuration(
        shielding application: Application, in category: ActivityCategory
    ) -> ShieldConfiguration {
        shield(over: .app)
    }

    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
        shield(over: .website)
    }

    override func configuration(
        shielding webDomain: WebDomain, in category: ActivityCategory
    ) -> ShieldConfiguration {
        shield(over: .website)
    }

    private func shield(over: ShieldWords.Over) -> ShieldConfiguration {
        let words = ShieldWords(over: over)
        // The light tokens, whatever the phone's appearance (DESIGN.md §1, light-only): the page
        // (surface-page) over a light material, so no dark default shows through; text-primary
        // and text-secondary; and the primary action, action-primary-bg and -fg. Never red.
        return ShieldConfiguration(
            backgroundBlurStyle: .systemThickMaterialLight,
            backgroundColor: .bali(0xF7F5F2),
            // The ring mark, without its tile (D1), never tinted.
            icon: UIImage(named: "BaliMark")?.withRenderingMode(.alwaysOriginal),
            title: .init(text: words.title, color: .bali(0x211F1B)),
            subtitle: .init(text: words.subtitle, color: .bali(0x5B564E)),
            // With no shield action extension, iOS's own action: the blocked app closes. The
            // shield cannot open Bali, where Emergency Unlock is (C5) — the subtitle says so.
            primaryButtonLabel: .init(text: words.button, color: .white),
            primaryButtonBackgroundColor: .bali(0x245A43))
    }
}

extension UIColor {
    /// A colour of the Bali Design System's, from its sRGB hex.
    fileprivate static func bali(_ hex: UInt32) -> UIColor {
        UIColor(
            red: CGFloat(hex >> 16 & 0xFF) / 255, green: CGFloat(hex >> 8 & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}
