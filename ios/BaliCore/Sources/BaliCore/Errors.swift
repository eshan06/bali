import Foundation

/// The body of every non-2xx answer, `ApiErrorBody` in packages/shared/src/errors.ts: one shape,
/// so every screen can say something honest. `message` is safe to show.
public struct ApiErrorBody: Codable, Sendable, Hashable {
    public struct ApiError: Codable, Sendable, Hashable {
        public let code: OrUnknown<ApiErrorCode>
        /// Which refusal this is, where `code` alone does not say — the app keys on it, never on
        /// `message`. A value this build does not know reads as none: a newer server may send one.
        public let reason: ApiErrorReason?
        public let message: String
        public let details: JSONValue?

        public init(from decoder: any Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            code = try container.decode(OrUnknown<ApiErrorCode>.self, forKey: .code)
            reason = try container.decodeIfPresent(OrUnknown<ApiErrorReason>.self, forKey: .reason)?
                .known
            message = try container.decode(String.self, forKey: .message)
            details = try container.decodeIfPresent(JSONValue.self, forKey: .details)
        }
    }
    public let error: ApiError
}
