import Foundation

/// Base-URL resolution — the proven legacy convention:
/// DEBUG reads BALI_DEV_API_HOST (env or UserDefaults), defaulting to localhost,
/// and talks to the Mac's API on :3001. Release talks HTTPS (set before shipping).
enum APIConfig {
    static var baseURL: URL {
        #if DEBUG
        let host = ProcessInfo.processInfo.environment["BALI_DEV_API_HOST"]
            ?? UserDefaults.standard.string(forKey: "BALI_DEV_API_HOST")
            ?? "localhost"
        return URL(string: "http://\(host):3001/v1")!
        #else
        return URL(string: "https://api.bali.app/v1")! // TODO: production host
        #endif
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

    private func request<T: Decodable, B: Encodable>(_ method: String, _ path: String, body: B?, as _: T.Type) async throws -> T {
        var req = URLRequest(url: APIConfig.baseURL.appendingPathComponent(path))
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
