import Foundation
import Testing

@testable import BaliCore

@Suite("The app's config: the reader, the Info.plist and project.yml agree (#84's review)")
struct AppConfigTests {
    static let values: [String: String] = [
        "BaliAPIURL": "https://api.bali.test", "BaliCognitoDomain": "https://bali.auth.test",
        "BaliCognitoClientID": "client", "BaliCognitoRedirectURI": "bali://auth/callback",
    ]

    @Test("The four keys make the config; any one of them missing or empty, none: \"not set up\"")
    func reads() throws {
        let config = try #require(AppConfig(info: Self.values))
        #expect(config.api == URL(string: "https://api.bali.test"))
        #expect(
            config.cognito
                == Cognito(
                    domain: URL(string: "https://bali.auth.test")!, clientId: "client",
                    redirectURI: URL(string: "bali://auth/callback")!))
        for key in AppConfig.Key.allCases {
            var missing = Self.values
            missing[key.rawValue] = nil
            #expect(AppConfig(info: missing) == nil, "\(key)")
            var empty = Self.values
            empty[key.rawValue] = ""
            #expect(AppConfig(info: empty) == nil, "\(key)")
        }
    }

    @Test(
        "Every key the reader reads is in the app's Info.plist, set from a setting ios/project.yml gives — and every Bali key there is one it reads — and the values the build sets make a config"
    )
    func agree() throws {
        let ios = Contract.repoRoot.appending(path: "ios")
        let plist = try #require(
            try PropertyListSerialization.propertyList(
                from: Data(contentsOf: ios.appending(path: "Bali/Info.plist")), format: nil)
                as? [String: Any])
        let project = try String(contentsOf: ios.appending(path: "project.yml"), encoding: .utf8)
        #expect(
            Set(plist.keys.filter { $0.hasPrefix("Bali") })
                == Set(AppConfig.Key.allCases.map(\.rawValue)))
        var built: [String: Any] = [:]
        for key in AppConfig.Key.allCases {
            let value = try #require(plist[key.rawValue] as? String, "\(key)")
            let setting = try #require(value.wholeMatch(of: /\$\((\w+)\)/)?.1, "\(key): \(value)")
            let setIn = try Regex("\\n\\s+\(setting):\\s*'?([^'\\n]+?)'?[ \\t]*(?=\\n)")
            let line = try #require(
                project.firstMatch(of: setIn), "\(setting) is not set in project.yml")
            // Set once: a second, a Release configuration's say, would go unpinned (#92's review).
            #expect(project.matches(of: setIn).count == 1, "\(setting) is set more than once")
            built[key.rawValue] = line.output[1].substring.map(String.init)
        }
        let config = try #require(AppConfig(info: built))
        #expect(config.cognito.redirectURI == URL(string: "bali://auth/callback"))
        #expect(config.api.scheme == "https" && config.cognito.domain.scheme == "https")
    }
}
