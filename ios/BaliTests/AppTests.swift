import BaliCore
import Foundation
import Testing

@testable import Bali

// The app target's own tests (B5b-2), hosted in the app on the iOS Simulator: what only the app
// holds. Everything the app only wires up is tested in its packages, on Linux too.

@MainActor
@Suite("The app")
struct AppTests {
    @Test(
        "This build's Info.plist gives the config reader every value ios/project.yml sets: sign-in is set up (#84's review)"
    )
    func config() throws {
        let config = try #require(AppConfig(info: Bundle.main.infoDictionary ?? [:]))
        #expect(config.cognito.redirectURI == URL(string: "bali://auth/callback"))
        #expect(config.api.scheme == "https" && config.cognito.domain.scheme == "https")
    }

    @Test(
        "Each hop the scene's phase makes reads the phase as it runs (#90's review): in front, then behind at once, runs no check and leaves the engine behind; in front, one check"
    )
    func phase() async {
        @MainActor final class Heard {
            var phases: [Bool] = []
            var checks = 0
        }
        let heard = Heard()
        let phone = Phone()
        phone.onPhase = ({ heard.phases.append($0) }, { heard.checks += 1 })
        phone.setForeground(true)
        phone.setForeground(false)
        // A hop queued on the main actor after theirs: once it has run, so have they.
        await Task {}.value
        #expect(heard.checks == 0)
        #expect(heard.phases == [false, false])
        phone.setForeground(true)
        await Task {}.value
        #expect(heard.checks == 1)
        #expect(heard.phases == [false, false, true])
    }
}
