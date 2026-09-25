import Foundation
import Testing

@testable import BaliCore

#if canImport(Security)
    import Security
#endif

// B4c: the Keychain on a locked phone. A package's tests cannot reach the Keychain itself — it
// refuses them (errSecMissingEntitlement, -34018) — so the rule is pinned at the store's seam: what
// `SignIn` does with each answer a `TokenStore` gives, and, where there is a Keychain, which answer
// each of its statuses is.

/// A Keychain that always reads as `read`, counting the writes asked of it.
final class FixedStore: TokenStore, @unchecked Sendable {
    private let read: @Sendable () throws -> Data?
    private let lock = NSLock()
    private var asked = 0

    init(_ read: @escaping @Sendable () throws -> Data?) { self.read = read }

    var writes: Int { lock.withLock { asked } }
    func load() throws -> Data? { try read() }
    func save(_ tokens: Data) throws { lock.withLock { asked += 1 } }
    func clear() throws { lock.withLock { asked += 1 } }
}

/// The Keychain's read while the phone is locked, or before its first unlock:
/// `errSecInteractionNotAllowed`.
struct InteractionNotAllowed: Error {}

@Suite("The Keychain on a locked phone (B4c)", .timeLimit(.minutes(3)))
struct LockedKeychainTests {
    @Test(
        "a Keychain that cannot be read — the phone locked, or not unlocked since it started — is no token right now: never signed out, never cleared"
    )
    func unreadable() async {
        let store = FixedStore { throw InteractionNotAllowed() }
        let endpoint = TransportDouble(status: 200, body: granted(jwt("a2")))
        let signIn = SignIn(cognito: cognito, store: store, transport: endpoint)

        #expect(await signIn.accessToken() == nil)
        #expect(await signIn.refresh() == false)
        #expect(await nothingYet(signIn.signedIn()))  // not known: neither in nor out
        #expect(store.writes == 0)  // nothing cleared, nothing saved over what is there
        #expect(await endpoint.sent.isEmpty)
    }

    @Test("only a Keychain with nothing in it is nobody signed in")
    func readable() async throws {
        let endpoint = TransportDouble(status: 500)
        let nobody = SignIn(cognito: cognito, store: FixedStore { nil }, transport: endpoint)
        #expect(await first(nobody.signedIn()) == false)
        #expect(await nobody.accessToken() == nil)

        let saved = try JSONEncoder().encode(Tokens(access: jwt("a1"), refresh: "r", at: Date()))
        let store = FixedStore { saved }
        let someone = SignIn(cognito: cognito, store: store, transport: endpoint)
        #expect(await first(someone.signedIn()) == true)
        #expect(await someone.accessToken() == jwt("a1"))
        #expect(store.writes == 0)
    }

    #if canImport(Security)
        @Test(
            "the Keychain's statuses: only errSecItemNotFound is nothing saved; a locked phone's throws"
        )
        func statuses() throws {
            let saved = Data("tokens".utf8)
            #expect(try KeychainTokenStore.read(errSecSuccess, saved as CFData) == saved)
            #expect(try KeychainTokenStore.read(errSecItemNotFound, nil) == nil)
            for status in [
                errSecInteractionNotAllowed, errSecMissingEntitlement, errSecNotAvailable,
            ] {
                #expect(throws: KeychainTokenStore.Failure(status: status)) {
                    try KeychainTokenStore.read(status, nil)
                }
            }
            #expect(throws: KeychainTokenStore.Failure(status: errSecDecode)) {
                try KeychainTokenStore.read(errSecSuccess, nil)
            }
        }
    #endif
}
