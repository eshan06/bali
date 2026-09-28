import AuthenticationServices
import BaliCore
import BaliOutbox
import FamilyControls
import Foundation
import SwiftUI
import Testing
import UIKit

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

    @Test(
        "A phone that cannot read NFC — the simulator is one — is told so at once: no scan begins, and nothing waits on one (B6)",
        .disabled(
            if: BlockReader.canRead,
            "This phone reads NFC: a scan would begin here — round 4 checks the reader on it")
    )
    func noNFC() async {
        #expect(await BlockReader().read() == .unsupported)
    }

    @Test(
        "A Debug launch names a fixture — `-bali-screen <name>` — rendered in place of the live phone, frozen: never started, and an ask for the permission on it changes nothing (C1b), nor a join code's look-up or a join (C2b). A name not known, or none, is the live app; and every fixture shows the screen it is named for (C1a), then a state of it"
    )
    func fixtures() async throws {
        #expect(PreviewFixtures.chosen(from: ["Bali"]) == nil)
        #expect(PreviewFixtures.chosen(from: ["Bali", "-bali-screen"]) == nil)
        #expect(PreviewFixtures.chosen(from: ["Bali", "-bali-screen", "nope"]) == nil)
        let chosen = try #require(PreviewFixtures.chosen(from: ["Bali", "-bali-screen", "signIn"]))
        let phone = Phone(fixture: chosen)
        #expect(phone.screen == .signIn)
        await phone.start()
        #expect(phone.engine == nil && phone.screen == .signIn)
        for (name, state) in PreviewFixtures.all {
            let screen = String(describing: Phone(fixture: state).screen).prefix { $0 != "(" }
            #expect(name.hasPrefix(screen), "\(name): \(screen)")
        }
        let failed = Phone(fixture: try #require(PreviewFixtures.all["screenTimeError"]))
        #expect(failed.screen == .screenTime && failed.askFailed?.words(.notDetermined) != nil)
        await failed.askScreenTime()
        #expect(failed.askFailed?.words(.notDetermined) != nil)
        let previewing = Phone(fixture: try #require(PreviewFixtures.all["joinPreview"]))
        #expect(previewing.joining.preview?.teacher.displayName == "Ms. Rivera")
        await previewing.join()
        #expect(previewing.joining.preview != nil && previewing.hasClasses == false)
        let refused = Phone(fixture: try #require(PreviewFixtures.all["joinError"]))
        #expect(refused.joining.preview == nil && refused.joining.code == "KWX49Q")
        await refused.lookUp()
        #expect(refused.joining.failure == Joining.words(.status(404), .classNotFound))
    }

    @Test(
        "A Debug launch's `-bali-intro-page` opens a page that exists (#105's review): the one named, the nearest one to a number past either end, and the first when none is named or it is no number"
    )
    func introPage() {
        func page(_ named: String?) -> Int {
            IntroView.page(from: ["Bali"] + (named.map { ["-bali-intro-page", $0] } ?? []))
        }
        #expect(IntroView.pages == 0...2)
        #expect([nil, "0", "1", "2"].map(page) == [0, 0, 1, 2])
        #expect(["3", "99", "-1", "two", ""].map(page) == [2, 2, 0, 0, 0])
    }

    @Test(
        "Every colour `Theme` draws, and each chip's, is D1's light value of its token in `bali-tokens.json` — the design system's own file, a token's reference to another followed — shadow-1's opacity too, so the two cannot drift apart unnoticed (#101's review)"
    )
    func tokens() throws {
        let url = try #require(
            Bundle(for: TestsBundle.self).url(forResource: "bali-tokens", withExtension: "json"))
        let file = try #require(
            try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        /// A group's tokens, by name: each one's value.
        func values(_ group: String) throws -> [String: Any] {
            let group = file[group] as? [String: Any]
            let tokens = try #require(group?["tokens"] as? [[String: Any]])
            var values: [String: Any] = [:]
            for token in tokens {
                if let name = token["name"] as? String { values[name] = token["value"] }
            }
            return values
        }
        let colours = try values("color")
        /// `name`'s light value — a primitive's one value, or another token's through "{name}".
        func light(_ name: String) -> String? {
            let value = colours[name]
            guard let raw = (value as? [String: Any])?["light"] as? String ?? value as? String
            else { return nil }
            return raw.hasPrefix("{") ? light(String(raw.dropFirst().dropLast())) : raw.uppercased()
        }
        /// `colour` as sRGB bytes, red to blue — and as the file writes one, "#RRGGBB" — with its
        /// opacity.
        func drawn(_ colour: Color) -> (bytes: [Int], hex: String, opacity: Float) {
            let resolved = colour.resolve(in: EnvironmentValues())
            let bytes = [resolved.red, resolved.green, resolved.blue].map {
                Int(($0 * 255).rounded())
            }
            let hex = "#" + bytes.map { String(format: "%02X", $0) }.joined()
            return (bytes, hex, resolved.opacity)
        }
        let pinned: [(token: String, colour: Color)] = [
            ("surface-page", Theme.page), ("surface-card", Theme.card),
            ("surface-sunken", Theme.sunken), ("border-default", Theme.border),
            ("border-strong", Theme.borderStrong), ("text-primary", Theme.text),
            ("text-secondary", Theme.textSecondary), ("text-tertiary", Theme.textTertiary),
            ("action-primary-bg", Theme.brand), ("action-primary-bg-hover", Theme.brandPressed),
            ("arc-fill", Theme.arc), ("arc-track", Theme.arcTrack), ("green-200", Theme.markTrack),
            ("state-focused-bg", Chip.Kind.focused.look.fill),
            ("state-focused-fg", Chip.Kind.focused.look.ink),
            ("state-emergency-bg", Chip.Kind.unlocked.look.fill),
            ("state-emergency-fg", Chip.Kind.unlocked.look.ink),
            ("state-revoked-bg", Chip.Kind.protectionOff.look.fill),
            ("state-revoked-fg", Chip.Kind.protectionOff.look.ink),
            ("state-ended-bg", Chip.Kind.ended.look.fill),
            ("state-ended-fg", Chip.Kind.ended.look.ink),
            ("state-notjoined-bg", Chip.Kind.notIn.look.fill),
            ("state-notjoined-fg", Chip.Kind.notIn.look.ink),
        ]
        for (token, colour) in pinned {
            let found = drawn(colour)
            #expect(found.hex == light(token), "\(token): \(found.hex)")
            #expect(found.opacity == 1, "\(token)")
        }
        // shadow-1, a resting card's: "0 1px 2px rgba(33,28,21,0.06)".
        let shadow = drawn(Theme.shadow)
        let shadows = try values("shadow")
        let resting = try #require((shadows["shadow-1"] as? [String: Any])?["light"] as? String)
        let rgba = shadow.bytes.map(String.init) + [String(format: "%g", shadow.opacity)]
        #expect(resting.hasSuffix("rgba(\(rgba.joined(separator: ",")))"), "\(resting): \(rgba)")
    }

    @Test(
        "The permission once read approved is kept in the phone's own defaults (C1b) — set at a read of approved, cleared once the check judges the permission off (denied, or not determined for a check-in interval), left at a read not determined for a moment — and a fresh Phone reads it back; with it, not determined routes as approved. The flag as it was before is put back after"
    )
    func everApproved() throws {
        let defaults = UserDefaults.standard
        let before = defaults.object(forKey: Phone.everApprovedKey)
        defer { defaults.set(before, forKey: Phone.everApprovedKey) }
        defaults.removeObject(forKey: Phone.everApprovedKey)
        /// What a pass read: `permission`, judged off or not.
        func read(_ permission: Permission, off: Bool = false) -> Protection {
            var protection = Protection()
            (protection.checked, protection.permission, protection.permissionOff) =
                (true, permission, off)
            return protection
        }
        let phone = Phone(fixture: try #require(PreviewFixtures.all["screenTime"]))
        #expect(!phone.everApproved && phone.screen == .screenTime)
        phone.remember(read(.notDetermined))
        #expect(!phone.everApproved && !Phone().everApproved)
        phone.remember(read(.approved))
        #expect(phone.everApproved && Phone().everApproved && phone.screen == .home)
        phone.remember(read(.notDetermined))
        #expect(phone.everApproved && phone.screen == .home)
        // Not determined for a check-in interval: never granted, or a grant that did not come back
        // with a restored backup, which restores these defaults.
        phone.remember(read(.notDetermined, off: true))
        #expect(!phone.everApproved && !Phone().everApproved && phone.screen == .screenTime)
        phone.remember(read(.approved))
        phone.remember(read(.denied, off: true))
        #expect(!phone.everApproved && !Phone().everApproved && phone.screen == .screenTime)
    }

    @Test(
        "The student's own no is the only cancel (C1b): the browser session's canceledLogin is the sign-in's cancelled — typed, the NSError behind it, or another error type carrying its domain and code, however SwiftUI's session hands it over (#105's review) — and Family Controls' authorizationCanceled the ask's; any other failure is said, what the platform said kept: the session's other codes, its cancel's code in another domain, a cancel of another kind"
    )
    func cancels() {
        let (session, canceledLogin) = (
            ASWebAuthenticationSessionError.errorDomain,
            ASWebAuthenticationSessionError.canceledLogin.rawValue
        )
        /// An error of another type, bridging to the session's domain: the typed error's cast
        /// misses it.
        struct Carried: CustomNSError {
            static var errorDomain: String { ASWebAuthenticationSessionError.errorDomain }
            let errorCode: Int
        }
        #expect(SignInError(browser: ASWebAuthenticationSessionError(.canceledLogin)) == .cancelled)
        #expect(SignInError(browser: NSError(domain: session, code: canceledLogin)) == .cancelled)
        #expect(SignInError(browser: Carried(errorCode: canceledLogin)) == .cancelled)
        let unopened = SignInError(browser: ASWebAuthenticationSessionError(.presentationContextInvalid))
        guard case .notOpened(let why) = unopened else {
            Issue.record("\(unopened)")
            return
        }
        // The bridged error's own description — its domain and code — kept for the readout.
        #expect(why.contains("WebAuthenticationSession") && why.contains("Code=3"))
        let notProvided = ASWebAuthenticationSessionError.presentationContextNotProvided.rawValue
        let others: [any Error] = [
            NSError(domain: session, code: notProvided), Carried(errorCode: notProvided),
            NSError(domain: NSURLErrorDomain, code: canceledLogin), URLError(.cancelled),
            CancellationError(),
        ]
        for error in others {
            let said = SignInError(browser: error)
            if case .notOpened = said { continue }
            Issue.record("\(error): \(said)")
        }
        #expect(ScreenTimeAskError(familyControls: FamilyControlsError.authorizationCanceled) == .cancelled)
        let failed = ScreenTimeAskError(familyControls: FamilyControlsError.invalidAccountType)
        #expect(failed == .failed("\(FamilyControlsError.invalidAccountType)"))
        #expect(
            ScreenTimeAskError(familyControls: URLError(.notConnectedToInternet))
                .words(.notDetermined) != nil)
    }

    @Test(
        "The intro seen is kept in the phone's own defaults: a fresh Phone reads it back (C1a); the flag as it was before is put back after"
    )
    func introSeen() {
        let defaults = UserDefaults.standard
        let before = defaults.object(forKey: Phone.introSeenKey)
        defer { defaults.set(before, forKey: Phone.introSeenKey) }
        defaults.removeObject(forKey: Phone.introSeenKey)
        let phone = Phone()
        #expect(!phone.introSeen && phone.screen == .intro)
        phone.sawIntro()
        #expect(phone.introSeen && Phone().introSeen)
        #expect(phone.screen == .starting)
    }

    @Test(
        "The shield extension ships D1's ring mark, the icon of Bali's shield (B5c): drawn as D1 has it — the arc, and the track in its gap at the upper left, around nothing — and never tinted; and the app's `BaliMark`, drawn in SwiftUI, draws the same at 64 (C1b), so the two cannot drift apart unnoticed"
    )
    func mark() throws {
        let plugins = try #require(Bundle.main.builtInPlugInsURL)
        let shield = try #require(Bundle(url: plugins.appending(path: "BaliShield.appex")))
        let asset = try #require(UIImage(named: "BaliMark", in: shield, with: nil))
        #expect(asset.size == CGSize(width: 64, height: 64))
        #expect(asset.renderingMode == .alwaysOriginal)
        let renderer = ImageRenderer(content: BaliMark(size: 64))
        renderer.scale = 1
        let drawn = try #require(renderer.uiImage)
        #expect(drawn.size == CGSize(width: 64, height: 64))
        func opaque(_ hex: Int) -> [Int] { [hex >> 16 & 0xFF, hex >> 8 & 0xFF, hex & 0xFF, 255] }
        func near(_ found: [Int], _ wanted: [Int]) -> Bool {
            zip(found, wanted).allSatisfy { abs($0 - $1) <= 4 }
        }
        let (arc, track) = (opaque(0x2C6F51), opaque(0xBCDCCA))
        for (which, mark) in [("the asset", asset), ("BaliMark", drawn)] {
            let pixel = try pixels(of: mark)
            // On the ring's middle line: right, bottom and lower left the arc; upper left its gap.
            for (x, y) in [(56, 32), (32, 56), (15, 49)] {
                #expect(near(pixel(x, y), arc), "\(which) at \(x), \(y): \(pixel(x, y))")
            }
            #expect(near(pixel(15, 15), track), "\(which): \(pixel(15, 15))")
            #expect(pixel(32, 32)[3] == 0 && pixel(1, 1)[3] == 0, "\(which)")
        }
    }

    /// `mark`, 64 × 64, drawn at 1× and read as sRGB bytes — red, green, blue, alpha — at a point
    /// counted from the top left.
    private func pixels(of mark: UIImage) throws -> (Int, Int) -> [Int] {
        let size = CGSize(width: 64, height: 64)
        let format = UIGraphicsImageRendererFormat()
        (format.scale, format.preferredRange) = (1, .standard)
        let drawn = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            mark.draw(in: CGRect(origin: .zero, size: size))
        }
        let image = try #require(drawn.cgImage)
        var bytes = [UInt8](repeating: 0, count: 64 * 64 * 4)
        let read = bytes.withUnsafeMutableBytes { buffer in
            let context = CGContext(
                data: buffer.baseAddress, width: 64, height: 64, bitsPerComponent: 8,
                bytesPerRow: 64 * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            context?.draw(image, in: CGRect(origin: .zero, size: size))
            return context != nil
        }
        #expect(read)
        return { x, y in (0..<4).map { Int(bytes[(y * 64 + x) * 4 + $0]) } }
    }
}

/// A class of the tests' own, to find their bundle by: it carries D1's tokens (`ios/project.yml`).
private final class TestsBundle {}
