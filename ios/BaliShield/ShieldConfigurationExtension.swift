import ManagedSettings
import ManagedSettingsUI

// The shield a student sees over a blocked app or website (ARCHITECTURE, "iOS app structure").
// The shield blocks every app and website a third party can (`.all()`), so iOS asks for each of
// these four. Its principal class, named in its Info.plist.
final class ShieldConfigurationExtension: ShieldConfigurationDataSource {
    override func configuration(shielding application: Application) -> ShieldConfiguration {
        shield()
    }

    override func configuration(
        shielding application: Application, in category: ActivityCategory
    ) -> ShieldConfiguration {
        shield()
    }

    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
        shield()
    }

    override func configuration(
        shielding webDomain: WebDomain, in category: ActivityCategory
    ) -> ShieldConfiguration {
        shield()
    }

    // B5: Bali's own shield, "Focused with Bali until 9:42"; until then, iOS's default.
    private func shield() -> ShieldConfiguration { ShieldConfiguration() }
}
