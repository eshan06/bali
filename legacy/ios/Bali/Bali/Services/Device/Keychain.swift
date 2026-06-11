//
//  Keychain.swift
//  Bali — services/device
//
//  Minimal generic-password keychain wrapper for the few small, stable secrets
//  the app persists (today: the device identity). Nonisolated — Security's
//  SecItem APIs are thread-safe.
//

import Foundation
import Security

nonisolated enum Keychain {
    private static let service = "com.bali.Bali"

    static func string(for key: String) -> String? {
        guard let data = data(for: key) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func set(_ value: String, for key: String) {
        set(Data(value.utf8), for: key)
    }

    static func data(for key: String) -> Data? {
        var query = baseQuery(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
        return result as? Data
    }

    static func set(_ data: Data, for key: String) {
        let query = baseQuery(key)
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    private static func baseQuery(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }
}
