import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

/// A fixture's answer: the API's real status and body.
private struct Fixture: Decodable {
    let status: Int
    let body: Contract.Body
}

/// `DELETE /v1/enrollments/{id}` answered with `contracts/fixtures/enrollments/<name>` — or, with
/// none named, no answer; or `status` alone.
private func answered(_ name: String? = nil, status: Int? = nil) async throws
    -> APIResponse<EndEnrollmentResponse>
{
    var (answer, body): (Int?, Data) = (status, Data())
    if let name {
        let url = Contract.repoRoot.appending(path: "contracts/fixtures/enrollments/\(name)")
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        (answer, body) = (fixture.status, fixture.body.data)
    }
    let client = APIClient(
        baseURL: URL(string: "https://api.bali.test")!, tokens: Signed(),
        transport: Canned(status: answer, body: body))
    return await client.leave(enrollment: "e3", EndEnrollmentRequest(eventId: "x"))
}

/// Class `id`, named `name`, as `GET /v1/me` gives it — with the enrollment `e<id>`, or none.
private func row(_ id: String, _ name: String, enrolled: Bool = true) throws -> MeClass {
    let enrollment = enrolled ? #","enrollmentId":"e\#(id)""# : ""
    let json = #"{"id":"\#(id)","name":"\#(name)","teacher":{"displayName":"Ms. Rivera"}\#(enrollment)}"#
    return try BaliJSON.makeDecoder().decode(MeClass.self, from: Data(json.utf8))
}

private let (unreachable, generic, lost) = (
    "Can't reach the server. Check your connection and try again.",
    "Something went wrong at Bali. Try again in a moment.",
    "Bali couldn't find you in this class. Your classes are being read again."
)

@Suite("Leaving a class (C6c)")
struct LeaveTests {
    @Test(
        "D1's words, and the question asked under a class before it is left: in plain words, with no new em-dash of Bali's own — a class's name keeps its own"
    )
    func words() throws {
        let p3 = try row("3", "Period 3 — Algebra II")
        #expect(Leaving.question(p3) == "Leave Period 3 — Algebra II?")
        #expect(Leaving.consequence == "You'll need the class code to join it again.")
        #expect(Leaving.recorded == "Leaving a class is recorded, and your teacher sees it.")
        #expect(
            Leaving.inSession(p3)
                == "Period 3 — Algebra II is in session. You can leave it once class is over.")
        let named = try row("5", "Chemistry")
        let bali = [
            Leaving.question(named), Leaving.consequence, Leaving.recorded,
            Leaving.inSession(named), lost,
        ]
        for words in bali { #expect(!words.contains("—") && !words.contains("–"), "\(words)") }
    }

    @Test(
        "Leave asks first: the question under the class pressed, what went wrong before gone; Cancel takes it away; no question for a class named with no enrollment (an older API's), nor while a leave is under way, which Cancel waits out too"
    )
    func asking() throws {
        var leaving = Leaving()
        let (p3, p5) = (try row("3", "Period 3"), try row("5", "Period 5"))
        leaving.ask(try row("6", "Period 6", enrolled: false))
        #expect(leaving.asking == nil)
        leaving.ask(p3)
        #expect(leaving.asking == p3 && !leaving.busy)
        leaving.cancel()
        #expect(leaving == Leaving())
        leaving.ask(p3)
        leaving.failure = generic
        leaving.ask(p5)
        #expect(leaving.asking == p5 && leaving.failure == nil)
        _ = leaving.send(at: t0)
        leaving.ask(p3)
        leaving.cancel()
        #expect(leaving.asking == p5 && leaving.busy)
    }

    @Test(
        "A leave goes under one event id while it is the same class's — a try after no answer is its replay (rule 4) — and another class's under its own; one at a time, and an answer to a leave the question did not send is dropped"
    )
    func sending() async throws {
        var leaving = Leaving()
        let (p3, p5) = (try row("3", "Period 3"), try row("5", "Period 5"))
        let unasked = leaving.send(at: t0)
        #expect(unasked == nil)
        leaving.ask(p3)
        let sent = leaving.send(at: t0)
        let first = try #require(sent)
        let twice = leaving.send(at: t0)
        #expect(first.enrollmentId == "e3" && leaving.busy && twice == nil)
        let none = try await answered()
        #expect(!leaving.left(none, for: "e5") && leaving.busy)
        #expect(!leaving.left(none, for: "e3") && !leaving.busy && leaving.failure == unreachable)
        #expect(leaving.asking == p3)
        let resent = leaving.send(at: t0.addingTimeInterval(5))
        let retry = try #require(resent)
        #expect(retry.request.eventId == first.request.eventId && leaving.failure == nil)
        leaving.left(none, for: "e3")
        leaving.cancel()
        leaving.ask(p5)
        let otherSent = leaving.send(at: t0.addingTimeInterval(9))
        let other = try #require(otherSent)
        #expect(other.enrollmentId == "e5" && other.request.eventId != first.request.eventId)
        let left = try await answered("left.json")
        #expect(leaving.left(left, for: "e5") && leaving == Leaving())
        // Nothing asked, nothing sent: an answer changes nothing.
        #expect(!leaving.left(left, for: "e5") && leaving == Leaving())
    }

    @Test(
        "A leave as the API answers it (A19's fixtures): out — it ended, or they were out already — the question goes; refused — the class in session, an enrollment not theirs or not known — or no answer, 401, 429 or a server error, each said under the question, to try again or cancel"
    )
    func answers() async throws {
        let p3 = try row("3", "Period 3 — Algebra II")
        for name in ["left.json", "already-removed.json"] {
            var leaving = Leaving()
            leaving.ask(p3)
            _ = leaving.send(at: t0)
            let out = leaving.left(try await answered(name), for: "e3")
            #expect(out && leaving == Leaving(), "\(name)")
        }
        let refusals: [(APIResponse<EndEnrollmentResponse>, String)] = [
            (try await answered("409-class-in-session.json"), Leaving.inSession(p3)),
            (try await answered("404-enrollment-not-found.json"), lost),
            (try await answered("403-enrollment-not-yours.json"), lost),
            (try await answered("403-unknown-user.json"), lost),
            (try await answered(), unreachable),
            (try await answered(status: 401), "Bali couldn't check your sign-in. Try again."),
            (try await answered(status: 429), "Too many tries for now. Wait a minute, then try again."),
            (try await answered(status: 500), generic),
        ]
        for (answer, words) in refusals {
            var leaving = Leaving()
            leaving.ask(p3)
            _ = leaving.send(at: t0)
            let out = leaving.left(answer, for: "e3")
            #expect(!out && leaving.failure == words && leaving.asking == p3, "\(answer.result)")
        }
    }

    @Test(
        "The phone holds a class's Leave, saying why, while it stands in that class's lesson and the bell has not rung by its own clock — never another class's, nor once the bell has rung, nor out of a session"
    )
    func held() throws {
        let p3 = try row("c", "Period 3")
        var state = SyncState()
        state.standing = .inSession(session(endsAt: 3000), .focused)
        #expect(Leaving.held(p3, state, now: at(10)) == Leaving.inSession(p3))
        #expect(Leaving.held(p3, state, now: at(3000)) == nil)
        #expect(Leaving.held(try row("d", "Period 5"), state, now: at(10)) == nil)
        state.standing = .inSession(session(endsAt: 3000), nil)
        #expect(Leaving.held(p3, state, now: at(10)) != nil)
        for standing in [Standing.out, .waiting] {
            state.standing = standing
            #expect(Leaving.held(p3, state, now: at(10)) == nil, "\(standing)")
        }
    }
}

/// The route a leave of `e3` goes to.
private let leaveRoute = "DELETE /v1/enrollments/e3"

@Suite("Leaving through the engine (C6c)", .timeLimit(.minutes(3)))
struct LeaveEngineTests {
    private let request = EndEnrollmentRequest(eventId: EventID.mint(at: t0))

    @Test(
        "A class left is gone from `me` at once, its other classes kept, and the truth is read again; a leave refused keeps the class, said, and reads again all the same; a 401 renews the token once and sends the same leave"
    )
    func left() async throws {
        let rig = try Rig()
        let classes = [Answer.inClass("c", enrollment: "e3"), Answer.inClass("d", enrollment: "e5")]
        try await rig.foreground(Answer.me(nil, classes: classes))
        async let refused = rig.engine.leave(enrollment: "e3", request)
        try await rig.server.next(leaveRoute).reply(409, Answer.refused("class_in_session"))
        #expect(await refused.error?.error.reason == .classInSession)
        #expect(await rig.engine.state.me?.classes.map(\.id) == ["c", "d"])
        try await rig.server.next(meRoute).reply(200, Answer.me(nil, classes: classes))
        async let answer = rig.engine.leave(enrollment: "e3", request)
        try await rig.server.next(leaveRoute).reply(401)
        let again = try await rig.server.next(leaveRoute)
        #expect(again.token == "Bearer token-2" && again.eventId == request.eventId)
        again.reply(200, #"{"outcome":"ended","reason":"left_class","endedParticipation":false}"#)
        #expect(await answer.answer?.outcome == .known(.ended))
        #expect(await rig.engine.state.me?.classes.map(\.id) == ["d"])
        try await rig.server.next(meRoute).reply(200, Answer.me(nil, classes: [classes[1]]))
        await rig.stop()
    }

    @Test(
        "A read of the truth sent before the leave and answered after it never brings the class back — it is older; a leave that got no answer changes nothing and reads nothing"
    )
    func staleRead() async throws {
        let rig = try Rig()
        let classes = [Answer.inClass("c", enrollment: "e3"), Answer.inClass("d", enrollment: "e5")]
        try await rig.foreground(Answer.me(nil, classes: classes))
        async let lost = rig.engine.leave(enrollment: "e3", request)
        try await rig.server.next(leaveRoute).reply(nil)
        #expect(await lost.result == .networkError)
        #expect(await rig.engine.state.me?.classes.count == 2)
        await rig.engine.setForeground(true)
        let before = try await rig.server.next(meRoute)
        async let answer = rig.engine.leave(enrollment: "e3", request)
        try await rig.server.next(leaveRoute)
            .reply(200, #"{"outcome":"already_removed","reason":"left_class","endedParticipation":false}"#)
        _ = await answer
        before.reply(200, Answer.me(nil, classes: classes))
        // Sent once the stale answer is in: it has brought nothing back.
        let after = try await rig.server.next(meRoute)
        #expect(await rig.engine.state.me?.classes.map(\.id) == ["d"])
        after.reply(200, Answer.me(nil, classes: [classes[1]]))
        await rig.until { $0.me?.classes.map(\.id) == ["d"] }
        await rig.stop()
    }
}
