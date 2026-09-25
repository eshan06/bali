import BaliOutbox
import Foundation
import ManagedSettings
import ManagedSettingsUI
import UIKit

// Bali's own shield over a blocked app or website (ARCHITECTURE, "iOS app structure"; B5c), in
// D1's approved look — light, the ring mark — as far as `ShieldConfiguration` carries it: a
// background, an icon, a title and a subtitle, and a button. What it says is `ShieldWords`, tested
// on Linux; this only carries it out. The shield blocks every app and website a third party can
// (`.all()`), so iOS asks for each of these four. Its principal class, named in its Info.plist.
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
        #if DEBUG
            let cap = Bell.deviceCheckCap ?? SyncState.tapCap
        #else
            let cap = SyncState.tapCap
        #endif
        let words = ShieldWords(outboxAt: Outbox.appGroupURL, over: over, now: Date(), cap: cap)
        // D1's light tokens, whatever the phone's appearance: the page (stone-50) over a light
        // material, so no dark default shows through; text-primary and text-secondary; and the
        // primary action, green-700 and white. D1's font, sizes and layout are iOS's to choose.
        return ShieldConfiguration(
            backgroundBlurStyle: .systemThickMaterialLight,
            backgroundColor: .bali(0xF7F5F2),
            // The ring mark, without its tile (D1), never tinted.
            icon: UIImage(named: "BaliMark")?.withRenderingMode(.alwaysOriginal),
            title: .init(text: words.title, color: .bali(0x211F1B)),
            subtitle: .init(text: words.subtitle, color: .bali(0x5B564E)),
            // With no shield action extension, iOS's own action: the blocked app closes. The
            // shield cannot open Bali, where Emergency Unlock is (C5) — the subtitle says so.
            primaryButtonLabel: .init(text: "OK", color: .white),
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
