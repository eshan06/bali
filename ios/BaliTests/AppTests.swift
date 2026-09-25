import BaliCore
import Foundation
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
        "The shield extension ships D1's ring mark, the icon of Bali's shield (B5c): drawn as D1 has it — the arc, and the track in its gap at the upper left, around nothing — and never tinted"
    )
    func mark() throws {
        let plugins = try #require(Bundle.main.builtInPlugInsURL)
        let shield = try #require(Bundle(url: plugins.appending(path: "BaliShield.appex")))
        let mark = try #require(UIImage(named: "BaliMark", in: shield, with: nil))
        #expect(mark.size == CGSize(width: 64, height: 64))
        #expect(mark.renderingMode == .alwaysOriginal)
        // Drawn at 1×, then read as sRGB bytes — red, green, blue, alpha — row by row from the top.
        let format = UIGraphicsImageRendererFormat()
        (format.scale, format.preferredRange) = (1, .standard)
        let drawn = UIGraphicsImageRenderer(size: mark.size, format: format).image { _ in
            mark.draw(at: .zero)
        }
        let image = try #require(drawn.cgImage)
        var bytes = [UInt8](repeating: 0, count: 64 * 64 * 4)
        let read = bytes.withUnsafeMutableBytes { buffer in
            let context = CGContext(
                data: buffer.baseAddress, width: 64, height: 64, bitsPerComponent: 8,
                bytesPerRow: 64 * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            context?.draw(image, in: CGRect(x: 0, y: 0, width: 64, height: 64))
            return context != nil
        }
        #expect(read)
        func pixel(_ x: Int, _ y: Int) -> [Int] {
            (0..<4).map { Int(bytes[(y * 64 + x) * 4 + $0]) }
        }
        func opaque(_ hex: Int) -> [Int] { [hex >> 16 & 0xFF, hex >> 8 & 0xFF, hex & 0xFF, 255] }
        func near(_ found: [Int], _ wanted: [Int]) -> Bool {
            zip(found, wanted).allSatisfy { abs($0 - $1) <= 4 }
        }
        let (arc, track) = (opaque(0x2C6F51), opaque(0xBCDCCA))
        // On the ring's middle line: right, bottom and lower left the arc; upper left its gap.
        for (x, y) in [(56, 32), (32, 56), (15, 49)] {
            #expect(near(pixel(x, y), arc), "\(x), \(y): \(pixel(x, y))")
        }
        #expect(near(pixel(15, 15), track), "\(pixel(15, 15))")
        #expect(pixel(32, 32)[3] == 0 && pixel(1, 1)[3] == 0)
    }
}
