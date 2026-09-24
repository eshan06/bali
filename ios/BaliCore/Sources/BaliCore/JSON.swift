import Foundation

/// The coders for every request and response body.
///
/// A time crosses the wire as ISO 8601 the way JS `toISOString()` writes it,
/// `2000-01-01T00:01:00.000Z`. `JSONDecoder`'s own `.iso8601` refuses the milliseconds on iOS 17,
/// so these decode a time with or without them, and encode one with them, as the API does.
public enum BaliJSON {
    public static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            // Both styles, in turn: which of them accepts the other's form differs by platform.
            if let date = try? withMilliseconds.parse(text) { return date }
            if let date = try? withoutMilliseconds.parse(text) { return date }
            throw DecodingError.dataCorruptedError(
                in: container, debugDescription: "Not an ISO 8601 time: \(text)")
        }
        return decoder
    }

    public static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(date.formatted(withMilliseconds))
        }
        return encoder
    }

    private static let withMilliseconds = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    private static let withoutMilliseconds = Date.ISO8601FormatStyle()
}

/// Any JSON value: a field `@bali/shared` types as `unknown`, such as an error's `details`.
public enum JSONValue: Codable, Sendable, Hashable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        self =
            if container.decodeNil() { .null }
            else if let value = try? container.decode(Bool.self) { .bool(value) }
            else if let value = try? container.decode(Double.self) { .number(value) }
            else if let value = try? container.decode(String.self) { .string(value) }
            else if let value = try? container.decode([JSONValue].self) { .array(value) }
            else { .object(try container.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }
}
