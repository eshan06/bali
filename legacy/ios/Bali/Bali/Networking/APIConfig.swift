//
//  APIConfig.swift
//  Bali — networking
//
//  Base-URL strategy. The iOS Simulator shares the Mac's network, so dev points
//  at localhost:3001 (where `npm run dev:api` runs). A physical device on a LAN
//  needs the Mac's LAN IP instead — overridable at runtime via the
//  `BALI_DEV_API_HOST` env var / launch arg without a rebuild. Production points
//  at the deployed API Gateway (mirrors web's NEXT_PUBLIC_API_URL).
//

import Foundation

struct APIConfig {
    /// Fully-qualified API base, e.g. `http://localhost:3001/api`.
    let baseURL: URL

    static let current: APIConfig = {
        #if DEBUG
        // Allow `-BALI_DEV_API_HOST 192.168.1.20` (device on LAN) to override
        // the default localhost host without touching code.
        let host = ProcessInfo.processInfo.environment["BALI_DEV_API_HOST"]
            ?? UserDefaults.standard.string(forKey: "BALI_DEV_API_HOST")
            ?? "localhost"
        let urlString = "http://\(host):3001/api"
        #else
        // TODO(backend): set the deployed API Gateway base URL (parallels web's
        // NEXT_PUBLIC_API_URL). Placeholder until prod wiring is confirmed.
        let urlString = "https://api.bali.app/api"
        #endif
        return APIConfig(baseURL: URL(string: urlString)!)
    }()
}
