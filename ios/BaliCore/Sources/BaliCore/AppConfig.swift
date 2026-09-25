import Foundation

/// Where the app signs in and syncs, as its build sets it (B4c): `ios/project.yml`'s settings,
/// through the app's Info.plist — public values, no secret. Read here rather than in the app, so a
/// test pins these keys to both files (#84's review): a key misspelt on either side would otherwise
/// build green and only say "not set up" on a phone.
public struct AppConfig: Sendable, Hashable {
    /// The Info.plist keys, each set from a `project.yml` setting.
    public enum Key: String, CaseIterable, Sendable {
        case api = "BaliAPIURL"
        case cognitoDomain = "BaliCognitoDomain"
        case cognitoClientId = "BaliCognitoClientID"
        case cognitoRedirectURI = "BaliCognitoRedirectURI"
    }

    public let api: URL
    public let cognito: Cognito

    /// The build's, from its Info.plist (`info`); nil while one is not set — missing, empty, or
    /// not a URL where one is wanted.
    public init?(info: [String: Any]) {
        func value(_ key: Key) -> String? {
            (info[key.rawValue] as? String).flatMap { $0.isEmpty ? nil : $0 }
        }
        guard let api = value(.api).flatMap(URL.init(string:)),
            let domain = value(.cognitoDomain).flatMap(URL.init(string:)),
            let clientId = value(.cognitoClientId),
            let redirect = value(.cognitoRedirectURI).flatMap(URL.init(string:))
        else { return nil }
        self.api = api
        cognito = Cognito(domain: domain, clientId: clientId, redirectURI: redirect)
    }
}
