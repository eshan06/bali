//
//  DeviceIdentity.swift
//  Bali — services/device
//
//  A stable per-install device identifier, generated once and keychain-persisted
//  so it survives reinstalls and teachers can keep a seat paired (PLAN.md §9.5 —
//  the student app has no server register endpoint, so the id is local for now).
//  Nonisolated; reads ProcessInfo / utsname (no UIDevice) so it's main-actor-free.
//

import Foundation

nonisolated enum DeviceIdentity {
    private static let idKey = "bali.device.id"
    private static let registeredKey = "bali.device.registered"

    /// Stable id like "BALI-7F3A-22C9". Generated + persisted on first read.
    static var current: String {
        if let existing = Keychain.string(for: idKey) { return existing }
        let id = generate()
        Keychain.set(id, for: idKey)
        return id
    }

    /// Whether the student has tapped "Register this iPhone" (local MVP).
    static var isRegistered: Bool {
        get { UserDefaults.standard.bool(forKey: registeredKey) }
        set { UserDefaults.standard.set(newValue, forKey: registeredKey) }
    }

    /// Best-effort marketing name; falls back to a generic "iPhone".
    static var modelName: String {
        marketingNames[modelIdentifier] ?? "iPhone"
    }

    /// e.g. "17.0" — from ProcessInfo (UIDevice is @MainActor; this isn't).
    static var systemVersion: String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return "\(v.majorVersion).\(v.minorVersion)"
    }

    // MARK: - Internals

    private static func generate() -> String {
        // Crockford-ish alphabet (no ambiguous 0/O/1/I).
        let chars = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        func block() -> String { String((0..<4).map { _ in chars.randomElement()! }) }
        return "BALI-\(block())-\(block())"
    }

    private static var modelIdentifier: String {
        if let sim = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
            return sim
        }
        var info = utsname()
        uname(&info)
        let machine = withUnsafeBytes(of: &info.machine) { raw -> String in
            let bytes = raw.prefix { $0 != 0 }
            return String(decoding: bytes, as: UTF8.self)
        }
        return machine
    }

    private static let marketingNames: [String: String] = [
        "iPhone15,4": "iPhone 15", "iPhone15,5": "iPhone 15 Plus",
        "iPhone16,1": "iPhone 15 Pro", "iPhone16,2": "iPhone 15 Pro Max",
        "iPhone17,3": "iPhone 16", "iPhone17,4": "iPhone 16 Plus",
        "iPhone17,1": "iPhone 16 Pro", "iPhone17,2": "iPhone 16 Pro Max",
    ]
}
