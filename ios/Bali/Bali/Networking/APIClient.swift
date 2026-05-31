//
//  APIClient.swift
//  Bali — networking
//
//  Thin async REST client. Attaches the Cognito JWT as `Authorization: Bearer`
//  on authed requests (token vended lazily so it's always fresh), encodes/decodes
//  JSON, and maps non-2xx responses to typed APIError. This is the single seam
//  every feature store calls — no view touches URLSession directly.
//
//  Student JWT routes only. Never teacher routes, never x-api-key/hardware
//  endpoints (`/api/checkin`, `/blocking/policy/:id`, `.../report`).
//

import Foundation

protocol APIClient: Sendable {
    func get<T: Decodable>(_ path: String, as type: T.Type) async throws -> T
    @discardableResult
    func post<T: Decodable>(_ path: String, body: (any Encodable)?, as type: T.Type) async throws -> T
    /// POST with no response body of interest (2xx = success).
    func postVoid(_ path: String, body: (any Encodable)?) async throws
    /// HEAD-style existence/role probe: returns the HTTP status without decoding.
    func probeStatus(_ method: String, _ path: String) async throws -> Int
}

/// Vends the current bearer token (nil when signed out / stub).
typealias TokenProvider = @Sendable () async -> String?

struct LiveAPIClient: APIClient {
    let config: APIConfig
    let tokenProvider: TokenProvider
    private let session: URLSession

    init(config: APIConfig, tokenProvider: @escaping TokenProvider, session: URLSession = .shared) {
        self.config = config
        self.tokenProvider = tokenProvider
        self.session = session
    }

    private static let decoder = JSONDecoder()
    private static let encoder = JSONEncoder()

    func get<T: Decodable>(_ path: String, as type: T.Type) async throws -> T {
        let data = try await requestData("GET", path, body: nil)
        return try decode(type, from: data)
    }

    @discardableResult
    func post<T: Decodable>(_ path: String, body: (any Encodable)?, as type: T.Type) async throws -> T {
        let data = try await requestData("POST", path, body: body)
        return try decode(type, from: data)
    }

    func postVoid(_ path: String, body: (any Encodable)?) async throws {
        _ = try await requestData("POST", path, body: body)
    }

    func probeStatus(_ method: String, _ path: String) async throws -> Int {
        let (status, _) = try await rawRequest(method, path, body: nil)
        return status
    }

    // MARK: - Core

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        if T.self == EmptyResponse.self, data.isEmpty {
            return EmptyResponse() as! T
        }
        do {
            return try Self.decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    /// Returns the body for a 2xx response, or throws a typed APIError.
    private func requestData(_ method: String, _ path: String, body: (any Encodable)?) async throws -> Data {
        let (status, data) = try await rawRequest(method, path, body: body)
        guard (200..<300).contains(status) else {
            if status == 401 { throw APIError.unauthorized }
            throw APIError.http(status: status, message: Self.serverMessage(from: data))
        }
        return data
    }

    /// Performs the request and returns (statusCode, body) without status checks.
    private func rawRequest(_ method: String, _ path: String, body: (any Encodable)?) async throws -> (Int, Data) {
        let url = config.baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try Self.encoder.encode(AnyEncodable(body))
        }
        if let token = await tokenProvider() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        do {
            let (data, response) = try await session.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            return (status, data)
        } catch {
            throw APIError.transport(error.localizedDescription)
        }
    }

    /// Pull the server's `error` / `message` field out of an error body.
    private static func serverMessage(from data: Data) -> String? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return (obj["message"] as? String) ?? (obj["error"] as? String)
    }
}

/// Marker for endpoints whose body we don't care about.
struct EmptyResponse: Decodable {}

/// Type-erasing wrapper so `(any Encodable)` can be JSON-encoded.
private struct AnyEncodable: Encodable {
    private let encodeFn: (Encoder) throws -> Void
    init(_ wrapped: any Encodable) { encodeFn = wrapped.encode }
    func encode(to encoder: Encoder) throws { try encodeFn(encoder) }
}
