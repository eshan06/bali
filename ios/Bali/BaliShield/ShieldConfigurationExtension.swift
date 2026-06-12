//
//  ShieldConfigurationExtension.swift — S10, strictly within Apple's six
//  ShieldConfiguration primitives: background blur/color, icon, title, subtitle,
//  primary button, secondary label. The subtitle names the emergency path —
//  the shield never traps.
//

import ManagedSettings
import ManagedSettingsUI
import UIKit

class ShieldConfigurationExtension: ShieldConfigurationDataSource {
    private enum Palette {
        static let ink = UIColor(red: 0.945, green: 0.937, blue: 0.922, alpha: 1) // #F1EFEB
        static let secondary = UIColor(red: 0.690, green: 0.667, blue: 0.631, alpha: 1) // #B0AAA1
        static let green600 = UIColor(red: 0.173, green: 0.435, blue: 0.318, alpha: 1) // #2C6F51
        static let green300 = UIColor(red: 0.573, green: 0.765, blue: 0.663, alpha: 1) // #92C3A9
        static let green400 = UIColor(red: 0.384, green: 0.643, blue: 0.514, alpha: 1) // #62A483
        static let track = UIColor(red: 0.180, green: 0.169, blue: 0.153, alpha: 1) // #2E2B27
        /// Green-tinted darkness layered over the blur.
        static let tint = UIColor(red: 0.043, green: 0.075, blue: 0.051, alpha: 0.55)
    }

    /// The app writes {teacher, endsAt} into the shared group when focus starts.
    private var context: (teacher: String, until: String?) {
        let suite = UserDefaults(suiteName: "group.com.bali.shared")
        let teacher = suite?.string(forKey: "shield.teacher") ?? "your class"
        var until: String?
        if let ts = suite?.object(forKey: "shield.endsAt") as? TimeInterval {
            let date = Date(timeIntervalSince1970: ts)
            if date > Date() {
                let fmt = DateFormatter()
                fmt.timeStyle = .short
                until = fmt.string(from: date)
            }
        }
        return (teacher, until)
    }

    private func config() -> ShieldConfiguration {
        let (teacher, until) = context
        let subtitle = until.map { "Until \($0) · Emergency? Open Bali" } ?? "Emergency? Open Bali"
        return ShieldConfiguration(
            backgroundBlurStyle: .dark,
            backgroundColor: Palette.tint,
            icon: Self.arcIcon(),
            title: .init(text: "Focused with \(teacher)", color: Palette.ink),
            subtitle: .init(text: subtitle, color: Palette.secondary),
            primaryButtonLabel: .init(text: "OK", color: Palette.ink),
            primaryButtonBackgroundColor: Palette.green600,
            secondaryButtonLabel: .init(text: "Open Bali", color: Palette.green300)
        )
    }

    /// The brand arc, drawn at runtime — no asset catalog needed in the extension.
    private static func arcIcon(size: CGFloat = 64) -> UIImage {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: size, height: size))
        return renderer.image { ctx in
            let line = size * 0.15
            let rect = CGRect(x: line / 2, y: line / 2, width: size - line, height: size - line)
            let track = UIBezierPath(ovalIn: rect)
            track.lineWidth = line
            Palette.track.setStroke()
            track.stroke()

            let center = CGPoint(x: size / 2, y: size / 2)
            let radius = (size - line) / 2
            let arc = UIBezierPath(
                arcCenter: center,
                radius: radius,
                startAngle: -.pi / 2,
                endAngle: -.pi / 2 + 2 * .pi * 0.72,
                clockwise: true
            )
            arc.lineWidth = line
            arc.lineCapStyle = .round
            Palette.green400.setStroke()
            arc.stroke()
            _ = ctx
        }
    }

    override func configuration(shielding application: Application) -> ShieldConfiguration {
        config()
    }

    override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration {
        config()
    }

    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
        config()
    }

    override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration {
        config()
    }
}
