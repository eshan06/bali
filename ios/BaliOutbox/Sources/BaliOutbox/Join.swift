import BaliCore
import Foundation

/// The Join screen (C2b) as the phone keeps it: the code as the student typed it; what it opens,
/// once looked up (`GET /v1/join-codes/{code}`) — the class, its teacher, whether they are in it
/// already — which the preview shows before anything is joined; and why the last look or join did
/// not finish, in words (rule 5). Its rules, so they run on Linux; the app sends the calls.
public struct Joining: Sendable, Hashable {
    /// Every class's code is this long: `JOIN_CODE_LENGTH` in `@bali/shared`.
    public static let codeLength = 6

    public var code = ""
    /// What the code opens: the preview shows while it is set, the code's entry while it is nil.
    public var preview: JoinCodePreviewResponse?
    public var failure: String?

    public init() {}

    /// The student typed `text`: kept as a code is written — letters and digits, upper case, at
    /// most a code's length — so a pasted `kwx 49q` is `KWX49Q`. What went wrong with the code
    /// before no longer applies.
    public mutating func type(_ text: String) {
        let kept = text.filter { $0.isASCII && ($0.isLetter || $0.isNumber) }.uppercased()
        (code, failure) = (String(kept.prefix(Self.codeLength)), nil)
    }

    /// A whole code, which Continue looks up.
    public var complete: Bool { code.count == Self.codeLength }

    /// The preview of `code` came back: what it opens, or why not. One for a code the student has
    /// typed over since is dropped — its class is not the one they would join.
    public mutating func looked(_ response: APIResponse<JoinCodePreviewResponse>, for code: String) {
        guard code == self.code else { return }
        preview = response.answer
        failure =
            response.answer == nil ? Self.words(response.result, response.error?.error.reason) : nil
    }

    /// The join came back: true once the student is in the class — joined, or in it already —
    /// and the screen starts over. Else why not, said on the preview; a code that opens no class
    /// any more (archived, or its teacher made a new one) goes back to the code.
    public mutating func joined(_ response: APIResponse<EnrollmentJoinResponse>) -> Bool {
        if response.answer != nil {
            self = Joining()
            return true
        }
        let reason = response.error?.error.reason
        failure = Self.words(response.result, reason)
        if reason == .classNotFound { preview = nil }
        return false
    }

    /// Back, or "Not my class": the code again, as typed.
    public mutating func back() { (preview, failure) = (nil, nil) }

    /// A screen's own call, `send`: sent once more when the API refused its token and `refresh` —
    /// the sign-in's — renewed it, as the engine does for its own calls, which a screen's never
    /// passes through; a refresh that gives none leaves the 401, said. Nothing else refreshes. It
    /// runs on its caller's actor, so the two closures never leave it.
    public static func send<Answer: Decodable & Sendable>(
        renewing refresh: () async -> Bool, _ send: () async -> APIResponse<Answer>,
        isolation: isolated (any Actor)? = #isolation
    ) async -> APIResponse<Answer> {
        let answer = await send()
        guard answer.result == .status(401), await refresh() else { return answer }
        return await send()
    }

    /// What the screen says when a look or a join gave no class (rule 5): the kind of failure in
    /// plain words, and the way on — keyed on the status and the error's `reason`, never its
    /// message.
    public static func words(_ result: SendResult, _ reason: ApiErrorReason?) -> String {
        if reason == .classNotFound {
            return "No class has that code. Check it with your teacher and try again."
        }
        switch result {
        case .networkError: return "Can't reach the server. Check your connection and try again."
        case .status(401): return "Bali couldn't check your sign-in. Try again."
        case .status(403): return "This is a teacher's account, and only students can join a class."
        case .status(429): return "Too many tries for now. Wait a minute, then try again."
        case .status: return "Something went wrong at Bali. Try again in a moment."
        }
    }
}
