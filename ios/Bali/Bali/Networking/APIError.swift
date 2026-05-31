//
//  APIError.swift
//  Bali — networking
//
//  Typed API failures. The server returns `{ "error": "...", "message"?: "..." }`
//  bodies; `.http` carries the status + decoded message so callers can map
//  specific cases (e.g. 403 → "not a student", 404 → "needs profile") to UI.
//

import Foundation

enum APIError: Error, Equatable {
    case invalidURL
    /// No connectivity / transport failure (server unreachable, timeout, etc.).
    case transport(String)
    /// Non-2xx response. `message` is the server's `error`/`message` field if present.
    case http(status: Int, message: String?)
    /// 2xx but the body didn't decode to the expected type.
    case decoding(String)
    /// 401 specifically — token missing/expired; triggers a refresh-or-signout.
    case unauthorized

    var userMessage: String {
        switch self {
        case .invalidURL:
            return "Something went wrong. Please try again."
        case .transport:
            return "Couldn't reach the Bali server. Check your connection and try again."
        case .http(_, let message):
            return message ?? "Something went wrong. Please try again."
        case .decoding:
            return "We got an unexpected response. Please try again."
        case .unauthorized:
            return "Your session expired. Please sign in again."
        }
    }
}
