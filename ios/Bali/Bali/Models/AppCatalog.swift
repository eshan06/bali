//
//  AppCatalog.swift
//  Bali — models (presentation helper)
//
//  Maps a policy's bundle IDs to an on-brand `AppVisual` (category SF Symbol +
//  tint) for the blocked/allowed app grids. Real category data only — never a
//  third-party brand logo (the prototype's "Chatter"/"Glimpse" were stand-ins).
//  Names mirror `packages/shared` constants; unknown IDs fall back to a
//  humanized name + a neutral category glyph.
//
//  Main-actor (the target default) because it reads the BaliColor palette and
//  builds the @MainActor `AppVisual` — it's only ever called from view code.
//

import SwiftUI

enum AppCatalog {
    /// Build a tile visual from a policy app entry (preferred — uses the
    /// server-provided name when present).
    static func visual(for entry: BlockingAppEntry) -> AppVisual {
        let meta = metadata(for: entry.bundleId)
        let name = entry.appName.isEmpty ? displayName(for: entry.bundleId) : entry.appName
        return AppVisual(id: entry.bundleId, name: name, systemImage: meta.symbol, fill: meta.fill)
    }

    /// Build a tile visual from a bare bundle id.
    static func visual(forBundleId bundleId: String) -> AppVisual {
        let meta = metadata(for: bundleId)
        return AppVisual(id: bundleId, name: displayName(for: bundleId),
                         systemImage: meta.symbol, fill: meta.fill)
    }

    /// Display-name fallback mirroring shared `appNameForBundleId`.
    static func displayName(for bundleId: String) -> String {
        if let known = names[bundleId] { return known }
        let last = bundleId.split(separator: ".").last.map(String.init) ?? bundleId
        return last.isEmpty ? bundleId : last.capitalized
    }

    // MARK: - Internals

    private struct Meta { let symbol: String; let fill: Color }

    private static func metadata(for bundleId: String) -> Meta {
        if let m = table[bundleId] { return m }
        let id = bundleId.lowercased()
        if id.contains("game") || id.contains("supercell") || id.contains("roblox")
            || id.contains("mojang") || id.contains("innersloth") {
            return Meta(symbol: "gamecontroller.fill", fill: BaliColor.violet)
        }
        return Meta(symbol: "app.dashed", fill: BaliColor.ink3)
    }

    /// Known bundle IDs (from packages/shared constants). Category glyphs only.
    private static let table: [String: Meta] = [
        // Essentials (Full Focus allow-list)
        "com.apple.mobilephone":  Meta(symbol: "phone.fill",   fill: BaliColor.green),
        "com.apple.MobileSMS":    Meta(symbol: "message.fill", fill: BaliColor.green),
        "com.apple.calculator":   Meta(symbol: "plusminus",    fill: BaliColor.ink2),
        "com.apple.camera":       Meta(symbol: "camera.fill",  fill: BaliColor.ink2),
        "com.apple.clock":        Meta(symbol: "clock.fill",   fill: BaliColor.ink3),
        "com.apple.mobilesafari": Meta(symbol: "safari.fill",  fill: BaliColor.blue),
        "com.apple.mobilenotes":  Meta(symbol: "note.text",    fill: BaliColor.amber),
        // Social
        "com.burbn.instagram":      Meta(symbol: "camera.circle.fill",     fill: BaliColor.violet),
        "com.zhiliaoapp.musically": Meta(symbol: "music.note",             fill: BaliColor.ink),
        "com.toyopagroup.picaboo":  Meta(symbol: "bolt.fill",              fill: BaliColor.amber),
        "com.facebook.Facebook":    Meta(symbol: "person.2.fill",          fill: BaliColor.blue),
        "com.atebits.Tweetie2":     Meta(symbol: "at",                     fill: BaliColor.ink),
        "com.google.ios.youtube":   Meta(symbol: "play.rectangle.fill",    fill: BaliColor.coral),
        // Media
        "com.netflix.Netflix":      Meta(symbol: "play.tv.fill",           fill: BaliColor.coral),
        "com.spotify.client":       Meta(symbol: "music.note",             fill: BaliColor.green),
        // Games
        "com.supercell.laser":      Meta(symbol: "gamecontroller.fill",    fill: BaliColor.violet),
        "com.innersloth.amongus":   Meta(symbol: "gamecontroller.fill",    fill: BaliColor.coral),
        "com.mojang.minecraftpe":   Meta(symbol: "gamecontroller.fill",    fill: BaliColor.green),
        "com.roblox.robloxmobile":  Meta(symbol: "gamecontroller.fill",    fill: BaliColor.ink2),
        "com.supercell.scroll":     Meta(symbol: "gamecontroller.fill",    fill: BaliColor.blue),
    ]

    private static let names: [String: String] = [
        "com.apple.mobilephone": "Phone",
        "com.apple.MobileSMS": "iMessage",
        "com.apple.calculator": "Calculator",
        "com.apple.camera": "Camera",
        "com.apple.clock": "Clock",
        "com.apple.mobilesafari": "Safari",
        "com.apple.mobilenotes": "Notes",
        "com.burbn.instagram": "Instagram",
        "com.zhiliaoapp.musically": "TikTok",
        "com.toyopagroup.picaboo": "Snapchat",
        "com.facebook.Facebook": "Facebook",
        "com.atebits.Tweetie2": "Twitter/X",
        "com.google.ios.youtube": "YouTube",
        "com.netflix.Netflix": "Netflix",
        "com.spotify.client": "Spotify",
        "com.supercell.laser": "Brawl Stars",
        "com.innersloth.amongus": "Among Us",
        "com.mojang.minecraftpe": "Minecraft",
        "com.roblox.robloxmobile": "Roblox",
        "com.supercell.scroll": "Clash Royale",
    ]
}
