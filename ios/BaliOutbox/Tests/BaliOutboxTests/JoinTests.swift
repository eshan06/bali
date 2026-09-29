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
        "While a look-up or a join is under way the code cannot change, nor can the preview be left — the answer is for the code as sent, and is never dropped with nothing said (#106's review); once it is over, both again"
    )
    func busy() async throws {
        var joining = try await previewing()
        joining.busy = true
        joining.type("ZZZZZZ")
        joining.back()
        #expect(joining.code == "6BVZA5" && joining.preview != nil)
        joining.busy = false
        joining.back()
        joining.busy = true
        joining.type("ZZZZZZ")
        let answer = try await fixture("join-codes/found.json").previewJoinCode("6BVZA5")
        joining.busy = false
        joining.looked(answer, for: "6BVZA5")
        #expect(joining.code == "6BVZA5" && joining.preview != nil && joining.failure == nil)
        joining.type("ZZZZZZ")
        #expect(joining.code == "ZZZZZZ")
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
        "A screen's own call whose token the API refused (401): the sign-in's refresh asked once, and a fresh token sends it once more — once only; no fresh token leaves the 401, said; any other answer, or none, never refreshes"
    )
    func renewing() async throws {
        let (refused, found) = (client(401), try fixture("join-codes/found.json"))
        /// `send` over answers in turn — the last again once they run out — and the refresh
        /// giving `fresh`: the answer, how many sends, how many refreshes.
        func run(_ answers: [APIClient], fresh: Bool) async
            -> (APIResponse<JoinCodePreviewResponse>, sends: Int, refreshes: Int)
        {
            var (sends, refreshes) = (0, 0)
            let answer = await Joining.send(
                renewing: {
                    refreshes += 1
                    return fresh
                },
                {
                    sends += 1
                    return await answers[min(sends, answers.count) - 1].previewJoinCode("6BVZA5")
                })
            return (answer, sends, refreshes)
        }
        let renewed = await run([refused, found], fresh: true)
        #expect(renewed.0.answer?.class.name == "Class fx-enroll")
        #expect(renewed.sends == 2 && renewed.refreshes == 1)
        let again = await run([refused], fresh: true)
        #expect(again.0.result == .status(401) && again.sends == 2 && again.refreshes == 1)
        let none = await run([refused, found], fresh: false)
        #expect(none.0.result == .status(401) && none.sends == 1 && none.refreshes == 1)
        var joining = Joining()
        joining.type("6BVZA5")
        joining.looked(none.0, for: "6BVZA5")
        #expect(joining.failure == "Bali couldn't check your sign-in. Try again.")
        for others in [[found], [client(404)], [client(nil)], [client(500)]] {
            let other = await run(others, fresh: true)
            #expect(other.sends == 1 && other.refreshes == 0, "\(other.0.result)")
        }
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

private let (joinRoute, lookUpRoute) = ("POST /v1/enrollments", "GET /v1/join-codes/6BVZA5")

@Suite("Joining through the engine: the class at once (C3)", .timeLimit(.minutes(3)))
struct JoinEngineTests {
    @Test(
        "A join answered in is the engine's at once — the class in `me`, so `hasClasses` is true and the router moves on — and the truth is read again, which names its teacher; a join into a class already there adds it no second time"
    )
    func joined() async throws {
        let rig = try Rig()
        try await rig.foreground(Answer.me(nil))
        #expect(await rig.engine.state.hasClasses == false)
        async let answer = rig.engine.join(request)
        try await rig.server.next(joinRoute).reply(200, Answer.joinedClass("c"))
        #expect(await answer.answer?.class.id == "c")
        var state = await rig.engine.state
        #expect(state.hasClasses == true && state.me?.classes.map(\.id) == ["c"])
        #expect(state.me?.classes.first?.teacher == nil)
        try await rig.server.next(meRoute)
            .reply(200, Answer.me(nil, classes: [Answer.inClass("c")]))
        state = await rig.until { $0.me?.classes.first?.teacher != nil }
        #expect(state.me?.classes.map(\.id) == ["c"])
        async let again = rig.engine.join(request)
        try await rig.server.next(joinRoute)
            .reply(200, Answer.joinedClass("c", outcome: "already_enrolled"))
        _ = await again
        #expect(await rig.engine.state.me?.classes.count == 1)
        try await rig.server.next(meRoute)
            .reply(200, Answer.me(nil, classes: [Answer.inClass("c")]))
        await rig.stop()
    }

    @Test(
        "A read of the truth sent before the join and answered after it never takes the class away — its classes are older than the join; the read the join asks for then applies"
    )
    func staleRead() async throws {
        let rig = try Rig()
        try await rig.foreground(Answer.me(nil))
        await rig.engine.setForeground(true)
        let before = try await rig.server.next(meRoute)
        async let answer = rig.engine.join(request)
        try await rig.server.next(joinRoute).reply(200, Answer.joinedClass("c"))
        _ = await answer
        before.reply(200, Answer.me(nil))
        // Sent once the stale answer is in: it has taken nothing away.
        let after = try await rig.server.next(meRoute)
        #expect(await rig.engine.state.me?.classes.map(\.id) == ["c"])
        after.reply(200, Answer.me(nil, classes: [Answer.inClass("c"), Answer.inClass("d")]))
        let state = await rig.until { $0.me?.classes.count == 2 }
        #expect(state.hasClasses == true)
        await rig.stop()
    }

    @Test("A join refused adds no class and reads nothing: why is the screen's to say")
    func refused() async throws {
        let rig = try Rig()
        try await rig.foreground(Answer.me(nil))
        async let answer = rig.engine.join(request)
        try await rig.server.next(joinRoute).reply(404, Answer.refused("class_not_found"))
        #expect(await answer.error?.error.reason == .classNotFound)
        #expect(await rig.engine.state.hasClasses == false)
        // A read asked for would have gone by the loop's next wake, and kept it from sleeping on.
        rig.clock.advance(by: 30)
        try await rig.sleeping([at(60)])
        #expect(await rig.server.waiting.isEmpty)
        await rig.stop()
    }

    @Test(
        "A look-up goes through the engine's one client, its token renewed once on a 401 by the engine's own refresh"
    )
    func lookUp() async throws {
        let rig = try Rig()
        async let answer = rig.engine.lookUp("6BVZA5")
        try await rig.server.next(lookUpRoute).reply(401)
        let again = try await rig.server.next(lookUpRoute)
        #expect(again.token == "Bearer token-2")
        again.reply(
            200,
            #"{"class":{"id":"c","name":"Class c"},"teacher":{"displayName":"Ms. Rivera"},"alreadyEnrolled":false}"#
        )
        #expect(await answer.answer?.teacher.displayName == "Ms. Rivera")
        #expect(await rig.tokens.refreshes == 1)
        await rig.stop()
    }
}
