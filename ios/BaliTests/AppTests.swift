import BaliCore
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
        "A Debug launch names a fixture — `-bali-screen <name>` — rendered in place of the live phone, frozen: never started, and an ask for the permission on it changes nothing (C1b). A name not known, or none, is the live app; and every fixture shows the screen it is named for (C1a), then a state of it"
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
        #expect(failed.screen == .screenTime && failed.askFailed?.words != nil)
        await failed.askScreenTime()
        #expect(failed.askFailed?.words != nil)
    }

    @Test(
        "The permission once read approved is kept in the phone's own defaults (C1b) — set at a read of approved, cleared at one of denied, left at not determined — and a fresh Phone reads it back; with it, not determined routes as approved. The flag as it was before is put back after"
    )
    func everApproved() throws {
        let defaults = UserDefaults.standard
        let before = defaults.object(forKey: Phone.everApprovedKey)
        defer { defaults.set(before, forKey: Phone.everApprovedKey) }
        defaults.removeObject(forKey: Phone.everApprovedKey)
        let phone = Phone(fixture: try #require(PreviewFixtures.all["screenTime"]))
        #expect(!phone.everApproved && phone.screen == .screenTime)
        phone.remember(.notDetermined)
        #expect(!phone.everApproved && !Phone().everApproved)
        phone.remember(.approved)
        #expect(phone.everApproved && Phone().everApproved && phone.screen == .home)
        phone.remember(.notDetermined)
        #expect(phone.everApproved && phone.screen == .home)
        phone.remember(.denied)
        #expect(!phone.everApproved && !Phone().everApproved && phone.screen == .screenTime)
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
