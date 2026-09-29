import Foundation
import Testing

@testable import BaliOutbox

@Suite("What Bali's own shield says: the same words, whatever the phone stands in (B5c, B5c-2)")
struct ShieldWordsTests {
    @Test(
        "Over an app, and over a website: Bali's name, never a time, and D1's line beneath — what always works, and that Bali, where Emergency Unlock is, says when class ends"
    )
    func words() {
        let app = ShieldWords(over: .app)
        #expect(app.title == "Focused with Bali")
        #expect(
            app.subtitle
                == "This app is paused for class. Calls, FaceTime, Messages and Emergency SOS always work. Open Bali to see when class ends — Emergency Unlock is always there."
        )
        let website = ShieldWords(over: .website)
        #expect(website.title == "Focused with Bali")
        #expect(website.subtitle == app.subtitle.replacing("This app", with: "This website"))
    }

    @Test(
        "The shield reads nothing to say them — iOS's sandbox refuses a shield extension the outbox file, its file coordinator and SQLite's locks both (B5c-2): the extension asks for the words over what it shields, and reads no file, no defaults and no clock"
    )
    func readsNothing() throws {
        let shield = try sourceCode("BaliShield/ShieldConfigurationExtension.swift")
        #expect(shield.contains("ShieldWords(over: over)"))
        for read in [
            "Outbox.", "Bell.", "SyncState", "UserDefaults", "FileManager", "contentsOf",
            "NSFileCoordinator", "Date(",
        ] {
            #expect(!shield.contains(read), "the shield reads through \(read)")
        }
    }
}
