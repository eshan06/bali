import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

/// A fixture's answer: the API's real status and body.
private struct Fixture: Decodable {
    let status: Int
    let body: Contract.Body
}

/// `PATCH /v1/me` answered with `contracts/fixtures/name/<name>` — or, with none named, no answer.
private func renamed(_ name: String? = nil) async throws -> APIResponse<UpdateMeResponse> {
    var (status, body): (Int?, Data) = (nil, Data())
    if let name {
        let url = Contract.repoRoot.appending(path: "contracts/fixtures/name/\(name)")
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        (status, body) = (fixture.status, fixture.body.data)
    }
    let client = APIClient(
        baseURL: URL(string: "https://api.bali.test")!, tokens: Signed(),
        transport: Canned(status: status, body: body))
    return await client.updateMe(UpdateMeRequest(displayName: "Eve", eventId: "e"))
}

private let (taken, invalid, teacher, unreachable, generic) = (
    "A classmate already uses that name. Try another, like adding your last initial.",
    "Bali can't use that name. Try another.",
    "This is a teacher's account, and only students change their name here.",
    "Can't reach the server. Check your connection and try again.",
    "Something went wrong at Bali. Try again in a moment."
)

@Suite("The Me screen's rules (C6b)")
struct MeTests {
    @Test(
        "A name is kept to the whole characters within DISPLAY_NAME_MAX_LENGTH code points — no emoji cut in two — and a blank one is nothing to save; typing clears what went wrong before"
    )
    func typing() throws {
        var naming = Naming()
        naming.edit("Ana")
        #expect(naming.editing && naming.name == "Ana" && naming.complete)
        naming.type(" \n ")
        #expect(!naming.complete)
        // A thumbs-up with its skin tone is two code points: at 63 + 2 it does not fit, whole.
        naming.type(String(repeating: "a", count: 63) + "👍🏽b")
        #expect(naming.name == String(repeating: "a", count: 63))
        naming.type(String(repeating: "\u{E9}", count: 70))
        #expect(naming.name.unicodeScalars.count == Naming.maxLength)
        naming.failure = taken
        naming.type("Ana R.")
        #expect(naming.failure == nil && naming.name == "Ana R.")
        let shared = Contract.repoRoot.appending(path: "packages/shared/src/index.ts")
        let source = try String(contentsOf: shared, encoding: .utf8)
        #expect(source.contains("export const DISPLAY_NAME_MAX_LENGTH = \(Naming.maxLength);"))
    }

    @Test(
        "A save goes under one event id while the name is the one it sent — a retry after no answer is its replay (rule 4) — and a name typed since is a new one; the name is fixed while it runs, and an answer to a save this editing did not send is dropped"
    )
    func saving() async throws {
        var naming = Naming()
        naming.edit("Ana")
        naming.type("Ana R.")
        let first = naming.save(at: t0)
        #expect(naming.busy && first.displayName == "Ana R.")
        naming.type("Bea")
        #expect(naming.name == "Ana R.")
        let (none, applied) = (try await renamed(), try await renamed("applied.json"))
        var saved = naming.saved(none, for: first)
        #expect(!saved && !naming.busy && naming.editing && naming.failure == unreachable)
        let retry = naming.save(at: t0.addingTimeInterval(5))
        #expect(retry.eventId == first.eventId && naming.failure == nil)
        naming.saved(none, for: retry)
        naming.type("Ana Ro.")
        let other = naming.save(at: t0.addingTimeInterval(9))
        #expect(other.eventId != first.eventId)
        saved = naming.saved(applied, for: first)
        #expect(!saved && naming.busy && naming.editing)
        saved = naming.saved(applied, for: other)
        #expect(saved && naming == Naming())
        // Not editing, nothing sent: an answer changes nothing.
        saved = naming.saved(applied, for: other)
        #expect(!saved && naming == Naming())
    }

    @Test(
        "A save as the API answers it (A8's fixtures): set — applied, or a replay's name now — editing ends; refused — taken in a class, invalid, a teacher's account, the sign-in, a client's bug — or no answer, 429 or a server error, each said with the name kept to try again"
    )
    func answers() async throws {
        for name in ["applied.json", "replay.json"] {
            var naming = Naming()
            naming.edit("Eve")
            let request = naming.save(at: t0)
            let answer = try await renamed(name)
            let saved = naming.saved(answer, for: request)
            #expect(saved && naming == Naming(), "\(name)")
        }
        let refusals = [
            ("409-display-name-taken.json", taken), ("400-display-name-invalid.json", invalid),
            ("403-teacher.json", teacher),
            ("401-unauthorized.json", "Bali couldn't check your sign-in. Try again."),
            ("400-invalid-request.json", generic), (nil, unreachable),
        ]
        for (name, words) in refusals {
            var naming = Naming()
            naming.edit("Eve")
            let request = naming.save(at: t0)
            let answer = try await renamed(name)
            let saved = naming.saved(answer, for: request)
            #expect(!saved && naming.failure == words && naming.editing && naming.name == "Eve", "\(name)")
        }
        #expect(Naming.words(.status(429), nil) == "Too many tries for now. Wait a minute, then try again.")
        #expect(Naming.words(.status(500), nil) == generic)
    }

    @Test(
        "Sign out waits while an Emergency Unlock is unsent — a session's, one under a tap, one not filed yet — and for nothing else the phone has queued: signed out, the unlock would go under whoever signs in next"
    )
    func signOutHeld() throws {
        let (outbox, _) = try makeOutbox()
        var state = SyncState()
        #expect(SignOutWords.held(state) == nil)
        try record(outbox, .tap(tagId: "tag"))
        try record(outbox, .refocus(session: "s"))
        try record(outbox, .protectionOff(session: "s"))
        state.queued = try outbox.records()
        #expect(state.queued.count == 3 && SignOutWords.held(state) == nil)
        let unlocks: [Change] = [
            .unlock(session: "s", reason: nil), .unlockUnderTap(tap: "t", reason: nil),
            .unlockUnfiled(reason: nil),
        ]
        for unlock in unlocks {
            let (outbox, _) = try makeOutbox()
            try record(outbox, unlock)
            state.queued = try outbox.records()
            #expect(SignOutWords.held(state)?.contains("Emergency Unlock") == true, "\(unlock)")
        }
    }
}

private let renameRoute = "PATCH /v1/me"

/// `PATCH /v1/me`'s answer: the student named `name` now.
private func named(_ name: String) -> String {
    #"{"outcome":"applied","user":{"id":"u","role":"student","displayName":"\#(name)"}}"#
}

@Suite("The name and the sign-in through the engine (C6b)", .timeLimit(.minutes(3)))
struct MeEngineTests {
    private let request = UpdateMeRequest(displayName: "Eve Park", eventId: EventID.mint(at: t0))

    @Test(
        "A name set is the engine's at once — `me`'s user, its classes kept — so Home and Me show it; one refused changes nothing and reads nothing; a 401 renews the token once"
    )
    func renamed() async throws {
        let rig = try Rig()
        try await rig.foreground(Answer.me(nil, classes: [Answer.inClass("c")]))
        async let refused = rig.engine.rename(request)
        try await rig.server.next(renameRoute).reply(409, Answer.refused("display_name_taken"))
        #expect(await refused.error?.error.reason == .displayNameTaken)
        #expect(await rig.engine.state.me?.user.displayName == nil)
        async let answer = rig.engine.rename(request)
        try await rig.server.next(renameRoute).reply(401)
        let again = try await rig.server.next(renameRoute)
        #expect(again.token == "Bearer token-2" && again.eventId == request.eventId)
        again.reply(200, named("Eve Park"))
        #expect(await answer.answer?.user.displayName == "Eve Park")
        let me = await rig.engine.state.me
        #expect(me?.user.displayName == "Eve Park" && me?.classes.map(\.id) == ["c"])
        // Neither asked for a read, which would have gone by the loop's next wake and kept it from
        // sleeping on.
        rig.clock.advance(by: 30)
        try await rig.sleeping([at(60)])
        #expect(await rig.server.waiting.isEmpty)
        await rig.stop()
    }

    @Test(
        "A read of the truth sent before the name was set and answered after it never takes the name back — it is older; the next read then applies"
    )
    func staleRead() async throws {
        let rig = try Rig()
        try await rig.foreground(Answer.me(nil))
        await rig.engine.setForeground(true)
        let before = try await rig.server.next(meRoute)
        async let answer = rig.engine.rename(request)
        try await rig.server.next(renameRoute).reply(200, named("Eve Park"))
        _ = await answer
        before.reply(200, Answer.me(nil))
        await rig.engine.setForeground(true)
        // Sent once the stale answer is in: it has taken nothing back.
        let after = try await rig.server.next(meRoute)
        #expect(await rig.engine.state.me?.user.displayName == "Eve Park")
        after.reply(
            200,
            #"{"user":{"id":"u","role":"student","displayName":"Eve P."},"classes":[],"session":null}"#)
        await rig.until { $0.me?.user.displayName == "Eve P." }
        await rig.stop()
    }

    @Test(
        "Someone signing in where someone signed out forgets the last student's `me` — their name and classes — at once, a read on its way with it, and reads it again; a name the last student set, answered after, is not kept"
    )
    func forgetMe() async throws {
        let rig = try Rig()
        try await rig.foreground(Answer.me(nil, classes: [Answer.inClass("c")]))
        async let answer = rig.engine.rename(request)
        let rename = try await rig.server.next(renameRoute)
        await rig.engine.setForeground(true)
        let before = try await rig.server.next(meRoute)
        await rig.engine.forgetMe()
        var state = await rig.engine.state
        #expect(state.me == nil && state.hasClasses == nil)
        rename.reply(200, named("Eve Park"))
        _ = await answer
        before.reply(200, Answer.me(nil, classes: [Answer.inClass("c")]))
        // Sent once the answer on its way is in: it has brought nothing back.
        let after = try await rig.server.next(meRoute)
        #expect(await rig.engine.state.me == nil)
        after.reply(200, Answer.me(nil, classes: [Answer.inClass("d")]))
        state = await rig.until { $0.me != nil }
        #expect(state.me?.classes.map(\.id) == ["d"] && state.me?.user.displayName == nil)
        await rig.stop()
    }
}
