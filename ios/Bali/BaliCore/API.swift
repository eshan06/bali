import Foundation

/// Base-URL resolution.
///
/// DEBUG reads `BALI_DEV_API_HOST` (launch env first, then the persisted UserDefaults
/// copy) and accepts EITHER form:
///   • a bare host — `10.0.0.68` → `http://10.0.0.68:3001/v1` (the LAN `demo.sh` convention)
///   • a full URL  — `https://foo.trycloudflare.com` → `https://foo.trycloudflare.com/v1`
/// The full-URL form is what lets the phone reach the Mac's API from a network that
/// blocks client-to-client traffic (campus Wi-Fi) or from cellular, via a tunnel.
///
/// Release reads `BALIAPIBaseURL` from Info.plist, which the `BALI_API_BASE_URL` build
/// setting substitutes — so a TestFlight archive can be pointed at a staging host with
/// no code change:  xcodebuild … BALI_API_BASE_URL=https://foo.trycloudflare.com
enum APIConfig {
    /// The API's only version prefix; callers pass paths relative to it.
    private static let versionPath = "v1"

    static var baseURL: URL {
        #if DEBUG
        // devicectl launches pass the host as env; persist it so plain icon-tap
        // launches keep talking to the same Mac afterwards.
        if let env = ProcessInfo.processInfo.environment["BALI_DEV_API_HOST"], !env.isEmpty {
            UserDefaults.standard.set(env, forKey: "BALI_DEV_API_HOST")
        }
        let override = ProcessInfo.processInfo.environment["BALI_DEV_API_HOST"]
            ?? UserDefaults.standard.string(forKey: "BALI_DEV_API_HOST")
        if let override, let url = resolve(override) { return url }
        return URL(string: "http://localhost:3001/\(versionPath)")!
        #else
        if let configured = infoPlistBaseURL, let url = resolve(configured) { return url }
        return URL(string: "https://api.bali.app/\(versionPath)")! // TODO: production host
        #endif
    }

    /// The Info.plist value, ignoring an empty or unsubstituted build setting.
    private static var infoPlistBaseURL: String? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "BALIAPIBaseURL") as? String else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty || trimmed.hasPrefix("$(") ? nil : trimmed
    }

    /// Accepts a bare host or a full URL and guarantees exactly one `/v1` suffix.
    private static func resolve(_ value: String) -> URL? {
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        // No scheme means a bare host — apply the LAN dev convention (http, :3001).
        let text = trimmed.contains("://") ? trimmed : "http://\(trimmed):3001"
        guard let url = URL(string: text), url.host != nil else { return nil }
        var path = url.path
        while path.hasSuffix("/") { path.removeLast() }
        // Tolerate a host that already carries the version prefix.
        return path.hasSuffix("/\(versionPath)") ? url : url.appendingPathComponent(versionPath)
    }
}

struct APIError: Error, LocalizedError {
    var status: Int
    var code: String
    var message: String
    var errorDescription: String? { message }
}

/// Minimal async REST client with Bearer injection. One instance app-wide.
final class APIClient {
    private let tokenProvider: () async -> String?
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(tokenProvider: @escaping () async -> String?) {
        self.tokenProvider = tokenProvider
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { d in
            let s = try d.singleValueContainer().decode(String.self)
            let fmt = ISO8601DateFormatter()
            fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fmt.date(from: s) { return date }
            fmt.formatOptions = [.withInternetDateTime]
            if let date = fmt.date(from: s) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "bad date \(s)"))
        }
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
    }

    func get<T: Decodable>(_ path: String, as type: T.Type) async throws -> T {
        try await request("GET", path, body: nil as String?, as: type)
    }

    func post<T: Decodable, B: Encodable>(_ path: String, body: B?, as type: T.Type) async throws -> T {
        try await request("POST", path, body: body, as: type)
    }

    func patch<T: Decodable, B: Encodable>(_ path: String, body: B?, as type: T.Type) async throws -> T {
        try await request("PATCH", path, body: body, as: type)
    }

    @discardableResult
    func postVoid<B: Encodable>(_ path: String, body: B?) async throws -> Bool {
        _ = try await request("POST", path, body: body, as: OkResponse.self)
        return true
    }

    @discardableResult
    func delete(_ path: String) async throws -> Bool {
        _ = try await request("DELETE", path, body: nil as String?, as: OkResponse.self)
        return true
    }

    /// Build a request URL, keeping any `?query=...` out of the path component (otherwise
    /// `appendingPathComponent` percent-encodes `?`/`&` and the query is lost).
    private func url(for path: String) -> URL {
        let parts = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        let base = APIConfig.baseURL.appendingPathComponent(String(parts[0]))
        guard parts.count > 1, var comps = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
            return base
        }
        comps.percentEncodedQuery = String(parts[1])
        return comps.url ?? base
    }

    private func request<T: Decodable, B: Encodable>(_ method: String, _ path: String, body: B?, as _: T.Type) async throws -> T {
        var req = URLRequest(url: url(for: path))
        req.httpMethod = method
        req.timeoutInterval = 15
        if let token = await tokenProvider() {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try encoder.encode(body)
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ..< 300).contains(status) else {
            let parsed = try? decoder.decode(ErrResponse.self, from: data)
            throw APIError(status: status, code: parsed?.error ?? "error", message: parsed?.message ?? "Request failed (\(status))")
        }
        if data.isEmpty, let empty = "{}".data(using: .utf8) {
            return try decoder.decode(T.self, from: empty)
        }
        return try decoder.decode(T.self, from: data)
    }
}

private struct OkResponse: Decodable {}
private struct ErrResponse: Decodable {
    var error: String?
    var message: String?
}

/// Bodies
struct EmptyBody: Encodable {}
struct JoinBody: Encodable { var code: String }
struct ResolveBody: Encodable { var code: String }
struct TapInBody: Encodable { var clientEventId: String; var tappedAt: Date? }
struct HeartbeatBody: Encodable { var permissionOk: Bool; var shieldsApplied: Bool }
struct UnlockBody: Encodable { var clientEventId: String; var at: Date? }
struct ReasonBody: Encodable { var reason: String }
struct BootstrapBody: Encodable { var role: String; var firstName: String?; var lastName: String? }
