import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

/// A fixture's answer: the API's real status and body.
private struct Fixture: Decodable {
    let status: Int
    let body: Contract.Body
}

/// A client answering every request with `status` and `body` — nothing at all when `status` is
/// nil — over `tokens`.
private func client(_ status: Int?, _ body: Data = Data(), tokens: any TokenProvider = Signed())
    -> APIClient
{
    APIClient(
        baseURL: URL(string: "https://api.bali.test")!, tokens: tokens,
        transport: Canned(status: status, body: body))
}

/// A client answering with `contracts/fixtures/<path>`.
private func fixture(_ path: String) throws -> APIClient {
    let url = Contract.repoRoot.appending(path: "contracts/fixtures/\(path)")
    let answer = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    return client(answer.status, answer.body.data)
}

private struct NoToken: TokenProvider {
    func accessToken() async -> String? { nil }
}

private let request = EnrollmentJoinRequest(
    joinCode: "6BVZA5", eventId: EventID.mint(at: t0), deviceTime: t0)

private let (notFound, unreachable, generic) = (
    "No class has that code. Check it with your teacher and try again.",
    "Can't reach the server. Check your connection and try again.",
    "Something went wrong at Bali. Try again in a moment."
)

/// The screen with `6BVZA5` typed and looked up, its preview showing.
private func previewing() async throws -> Joining {
    var joining = Joining()
    joining.type("6BVZA5")
    let answer = try await fixture("join-codes/found.json").previewJoinCode("6BVZA5")
    joining.looked(answer, for: "6BVZA5")
    try #require(joining.preview != nil)
    return joining
}

@Suite("The Join screen's rules (C2b)")
struct JoinTests {
    @Test(
        "A code is kept as codes are written — letters and digits, upper case, at most JOIN_CODE_LENGTH — and only a whole one is looked up; typing clears what went wrong with the code before"
    )
    func typing() throws {
        var joining = Joining()
        joining.type("kwx 49q")
        #expect(joining.code == "KWX49Q" && joining.complete)
        joining.type("KWX-49Q-ZZ")
        #expect(joining.code == "KWX49Q")
        joining.type("kwx4")
        #expect(joining.code == "KWX4" && !joining.complete)
        joining.type("é9ß!")
        #expect(joining.code == "9")
        joining.failure = notFound
        joining.type("9A")
        #expect(joining.failure == nil)
        let shared = Contract.repoRoot.appending(path: "packages/shared/src/index.ts")
        let source = try String(contentsOf: shared, encoding: .utf8)
        #expect(source.contains("export const JOIN_CODE_LENGTH = \(Joining.codeLength);"))
    }

    @Test(
        "A code's preview as the API answers it (A6's fixtures): what the code opens — a teacher with no name, and a class the student is in already, too — or why not, in words"
    )
    func looked() async throws {
        let found = try await previewing()
        #expect(found.preview?.class.name == "Class fx-enroll" && found.failure == nil)
        #expect(found.preview?.teacher.displayName == "Ms. Rivera")
        #expect(found.preview?.alreadyEnrolled == false)
        let cases: [(String, (Joining) -> Bool)] = [
            ("already-enrolled", { $0.preview?.alreadyEnrolled == true && $0.failure == nil }),
            ("unnamed-teacher", { $0.preview != nil && $0.preview?.teacher.displayName == nil }),
            ("404-class-not-found", { $0.preview == nil && $0.failure == notFound }),
            ("400-bad-input", { $0.preview == nil && $0.failure == generic }),
            (
                "401-unauthorized",
                { $0.failure == "Bali couldn't check your sign-in. Try again." }
            ),
        ]
        for (name, holds) in cases {
            var joining = Joining()
            joining.type("6BVZA5")
            let answer = try await fixture("join-codes/\(name).json").previewJoinCode("6BVZA5")
            joining.looked(answer, for: "6BVZA5")
            #expect(holds(joining), "\(name): \(joining)")
        }
        // No answer, no token to send, an answer that does not decode.
        let others: [(APIClient, String)] = [
            (client(nil), unreachable), (client(200, tokens: NoToken()), unreachable),
            (client(200, Data("{}".utf8)), generic),
        ]
        for (client, words) in others {
            var joining = Joining()
            joining.type("6BVZA5")
            joining.looked(await client.previewJoinCode("6BVZA5"), for: "6BVZA5")
            #expect(joining.preview == nil && joining.failure == words)
        }
    }

    @Test(
        "An answer for a code the student has typed over since is dropped: its class is not the one they would join"
    )
    func stale() async throws {
        var joining = Joining()
        joining.type("6BVZA5")
        let answer = try await fixture("join-codes/found.json").previewJoinCode("6BVZA5")
        joining.type("6BVZA")
        joining.looked(answer, for: "6BVZA5")
        #expect(joining.preview == nil && joining.failure == nil && joining.code == "6BVZA")
    }

    @Test(
        "The join as the API answers it: joined, or in the class already, is in — and the screen starts over; a code that opens no class any more goes back to the code, said; anything else stays on the preview, said, to try again"
    )
    func joined() async throws {
        for name in ["joined", "already-enrolled"] {
            var joining = try await previewing()
            let answer = try await fixture("enrollments/\(name).json").join(request)
            let inClass = joining.joined(answer)
            #expect(inClass && joining == Joining(), "\(name)")
        }
        var gone = try await previewing()
        let refused = try await fixture("enrollments/404-class-not-found.json").join(request)
        let goneIn = gone.joined(refused)
        #expect(!goneIn && gone.preview == nil && gone.failure == notFound && gone.code == "6BVZA5")
        var offline = try await previewing()
        let offlineIn = offline.joined(await client(nil).join(request))
        #expect(!offlineIn && offline.preview != nil && offline.failure == unreachable)
        offline.back()
        #expect(offline.preview == nil && offline.failure == nil && offline.code == "6BVZA5")
    }

    @Test(
        "Every refusal in words keyed on its status and reason, never its message: a teacher's account, too many tries, and anything else the way on"
    )
    func words() {
        #expect(
            Joining.words(.status(403), nil)
                == "This is a teacher's account, and only students can join a class.")
        #expect(
            Joining.words(.status(429), nil)
                == "Too many tries for now. Wait a minute, then try again.")
        #expect(Joining.words(.status(404), .classNotFound) == notFound)
        for (status, reason) in [(404, nil), (409, .eventIdConflict), (500, nil), (503, nil)]
            as [(Int, ApiErrorReason?)]
        {
            #expect(Joining.words(.status(status), reason) == generic, "\(status)")
        }
    }
}
