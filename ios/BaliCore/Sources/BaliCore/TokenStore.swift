import Foundation

/// Where `SignIn` keeps its tokens between launches: the Keychain on the phone, memory in the tests.
public protocol TokenStore: Sendable {
    /// What was saved; nil when nothing is. Throws when it cannot be read right now.
    func load() throws -> Data?
    func save(_ tokens: Data) throws
    /// Forgets what was saved; nothing saved is no failure.
    func clear() throws
}

#if canImport(Security)
    import Security

    /// The Keychain: one item of the app's own, readable only while the phone is unlocked and never
    /// leaving it — no backup restored to another phone, no iCloud Keychain
    /// (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`). The engine sends only while the app is in
    /// the foreground, so the phone is unlocked whenever a token is needed (a send made behind a
    /// locked phone would need `AfterFirstUnlock`); and the extensions only record to the outbox,
    /// never send, so no access group is shared with them.
    public struct KeychainTokenStore: TokenStore {
        public struct Failure: Error { public let status: OSStatus }

        public init() {}

        private var item: [String: Any] {
            [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: "com.bali.Bali.sign-in",
                kSecAttrAccount as String: "cognito",
            ]
        }

        public func load() throws -> Data? {
            var query = item
            query[kSecReturnData as String] = true
            var data: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &data)
            if status == errSecItemNotFound { return nil }
            try check(status)
            return data as? Data
        }

        public func save(_ tokens: Data) throws {
            let status = SecItemUpdate(
                item as CFDictionary, [kSecValueData as String: tokens] as CFDictionary)
            guard status == errSecItemNotFound else { return try check(status) }
            var add = item
            add[kSecValueData as String] = tokens
            add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            try check(SecItemAdd(add as CFDictionary, nil))
        }

        public func clear() throws {
            let status = SecItemDelete(item as CFDictionary)
            if status != errSecItemNotFound { try check(status) }
        }

        private func check(_ status: OSStatus) throws {
            guard status == errSecSuccess else { throw Failure(status: status) }
        }
    }
#endif
