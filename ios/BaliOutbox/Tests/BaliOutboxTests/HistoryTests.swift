import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

/// `contracts/fixtures/history/<name>`: the API's real answer to a history read, as the app's
/// client hands it over.
private func answer(_ name: String) async throws -> APIResponse<HistoryPage> {
    struct Fixture: Decodable {
        let status: Int
        let body: Contract.Body
    }
    let url = Contract.repoRoot.appending(path: "contracts/fixtures/history/\(name)")
    let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    return await client(fixture.status, fixture.body.data).history()
}

/// A client answering every read with `status` and `body` — no answer at all when nil.
private func client(_ status: Int?, _ body: Data = Data()) -> APIClient {
    APIClient(
        baseURL: URL(string: "https://api.bali.test")!, tokens: Signed(),
        transport: Canned(status: status, body: body))
}

/// A moment as `GET /v1/me/history` writes one: `type` at `time` (UTC), in Period `period` — 3
/// with Ms. Rivera, 5 with Mr. Okafor, 6 with a teacher who has no name.
private func moment(
    _ type: String, _ time: String, period: Int = 3, reason: String? = nil,
    recordedAs: String? = nil, countedIn: Int? = nil
) -> String {
    let names = [3: "Period 3 — Algebra II", 5: "Period 5 — Chemistry", 6: "Period 6 — Geometry"]
    let teachers = [3: #""Ms. Rivera""#, 5: #""Mr. Okafor""#, 6: "null"]
    func quoted(_ text: String?) -> String { text.map { #""\#($0)""# } ?? "null" }
    let counted = countedIn.map { #"{"id":"p\#($0)","name":"\#(names[$0]!)"}"# } ?? "null"
    return #"""
        {"eventId":"\#(UUID().uuidString)","type":"\#(type)","occurredAt":"\#(time)",
        "class":{"id":"p\#(period)","name":"\#(names[period]!)"},
        "teacher":{"displayName":\#(teachers[period]!)},"session":null,"reason":\#(quoted(reason)),
        "recordedAs":\#(quoted(recordedAs)),"countedIn":\#(counted)}
        """#
}

/// The screen with `moments` read — newest first, as the server gives them — and nothing after.
private func read(_ moments: [String]) throws -> History {
    var history = History()
    history.events = try BaliJSON.makeDecoder().decode(
        HistoryPage.self,
        from: Data(#"{"events":[\#(moments.joined(separator: ","))],"nextBefore":null}"#.utf8)
    ).events
    history.read = true
    return history
}

/// A US phone in `zone` writes a time so; `t0` is Monday, September 21, 2026, 10:13:20 AM in New
/// York.
private func us(_ zone: String = "America/New_York") -> Date.FormatStyle {
    Date.FormatStyle(
        date: .omitted, time: .shortened, locale: Locale(identifier: "en_US"),
        timeZone: TimeZone(identifier: zone)!)
}

/// What the screen draws: each day's title, and each card's name, teacher and lines.
private func drawn(_ days: [History.Day]) -> [String] {
    days.flatMap { day in
        [day.title]
            + day.cards.flatMap { card in
                ["[\(card.name) · \(card.teacher ?? "-")]"]
                    + card.moments.map { moment in
                        plain("\(moment.time) \(moment.words)")! + (moment.note.map { " (\($0))" } ?? "")
                    }
            }
    }
}

@Suite("The History screen's rules (C6a)")
struct HistoryTests {
    @Test(
        "D1's grouping: days newest first — Today, Yesterday, then the date, with its year once it is not this one — each day oldest first, in cards of one class's moments in a row; the day and the time in the phone's time zone and locale, so a moment late at night in New York is yesterday there and today in UTC"
    )
    func days() throws {
        let history = try read([
            moment("session_expired", "2026-09-21T13:45:00Z"),
            moment("refocus", "2026-09-21T13:16:00Z"),
            moment("unlock", "2026-09-21T13:12:00Z", reason: "bathroom"),
            moment("tap_in", "2026-09-21T12:58:00Z"),
            moment("enrollment_left", "2026-09-21T02:30:00Z"),
            moment("armed_tap_skipped", "2026-09-20T18:48:00Z", period: 6, countedIn: 5),
            moment("session_ended", "2026-09-20T17:50:00Z", period: 5),
            moment("tap_in", "2026-09-20T17:02:00Z", period: 5),
            moment("tap_in", "2026-09-16T15:00:00Z", period: 5),
            moment("tap_in", "2025-12-15T14:00:00Z"),
        ])
        #expect(
            drawn(history.days(now: t0, time: us())) == [
                "Today", "[Period 3 — Algebra II · Ms. Rivera]", "8:58 AM Tapped in",
                "9:12 AM Unlocked · Bathroom", "9:16 AM Locked apps again", "9:45 AM Class ended",
                "Yesterday", "[Period 5 — Chemistry · Mr. Okafor]", "1:02 PM Tapped in",
                "1:50 PM Class ended", "[Period 6 — Geometry · -]",
                "2:48 PM Tap not used. It already counted in Period 5 — Chemistry.",
                "[Period 3 — Algebra II · Ms. Rivera]", "10:30 PM Left the class",
                "Wednesday, September 16", "[Period 5 — Chemistry · Mr. Okafor]",
                "11:00 AM Tapped in", "Monday, December 15, 2025",
                "[Period 3 — Algebra II · Ms. Rivera]", "9:00 AM Tapped in",
            ])
        let utc = history.days(now: t0, time: us("UTC"))
        #expect(utc.map(\.title) == ["Today", "Yesterday", "Wednesday, September 16", "Monday, December 15, 2025"])
        #expect(
            drawn([utc[0]]).prefix(3)
                == ["Today", "[Period 3 — Algebra II · Ms. Rivera]", "2:30 AM Left the class"])
        // Just after midnight, yesterday's moments are two days back, named by their date.
        let tomorrow = t0.addingTimeInterval(14 * 3600)
        #expect(
            history.days(now: tomorrow, time: us()).map(\.title).prefix(2)
                == ["Yesterday", "Sunday, September 20"])
    }

    @Test(
        "Each card is known by its own id, its first moment's, so the screen keeps it as it is (#139): no two cards share one, through every day; read again from the top, a newer moment of its class joins it under the same id, and one of another class makes a card of its own after it, every card before kept"
    )
    func cardIds() throws {
        let moments = [
            moment("unlock", "2026-09-21T13:12:00Z", reason: "bathroom"),
            moment("tap_in", "2026-09-21T12:58:00Z"),
            moment("session_ended", "2026-09-20T17:50:00Z", period: 5),
            moment("tap_in", "2026-09-20T17:02:00Z", period: 5),
            moment("tap_in", "2026-09-20T15:00:00Z"),
        ]
        func cards(_ moments: [String]) throws -> [History.Card] {
            try read(moments).days(now: t0, time: us()).flatMap(\.cards)
        }
        let shown = try cards(moments)
        #expect(shown.map(\.id) == shown.map(\.moments[0].id) && Set(shown.map(\.id)).count == 3)
        let refocus = moment("refocus", "2026-09-21T13:16:00Z")
        let joined = try cards([refocus] + moments)
        #expect(joined.map(\.id) == shown.map(\.id) && joined[0].moments.count == 3)
        let after = try cards([moment("tap_in", "2026-09-21T13:20:00Z", period: 5), refocus] + moments)
        #expect(after.count == 4 && after[1].name == "Period 5 — Chemistry")
        #expect(after.map(\.id) == [shown[0].id, after[1].moments[0].id] + shown.dropFirst().map(\.id))
    }

    @Test(
        "Every kind of moment A7 shows, in D1's words or the step's: the page reversed, never re-sorted — a switch's leave comes before the tap it caused though they share one instant — a card per class in a row, a teacher with no name none, and a note where the record changed nothing: late, or after the class ended"
    )
    func everyKind() async throws {
        var history = History()
        #expect(!history.answered(try await answer("every-kind.json")))
        let days = history.days(now: t0, time: us())
        #expect(days.map(\.title) == ["Friday, December 31, 1999"])
        #expect(
            drawn(days).dropFirst() == [
                "[Class fx-hist-p3 · Ms. Rivera]", "7:25 PM Tapped in",
                "7:24 PM Unlocked · Bathroom", "7:23 PM Locked apps again", "7:22 PM Screen Time off",
                "7:21 PM Screen Time back on", "7:20 PM Tapped in",
                "7:19 PM Screen Time off (Arrived after class ended)",
                "7:17 PM Class ended", "7:17 PM Unlocked (Arrived after class ended)",
                "[Class fx-hist-p5 · Mr. Okafor]", "7:16 PM Tapped in",
                "7:15 PM Locked apps again (Arrived late, so it changed nothing)", "7:14 PM Unlocked",
                "7:13 PM Tapped in (Arrived late, so it changed nothing)",
                "7:12 PM Switched to another class", "[Class fx-hist-p6 · -]", "7:12 PM Tapped in",
                "7:09 PM Class ended", "[Class fx-hist-p3 · Ms. Rivera]", "7:08 PM Tapped in",
                "[Class fx-hist-p6 · -]",
                "7:07 PM Tap not used. It already counted in Class fx-hist-p3.",
                "[Class fx-hist-p3 · Ms. Rivera]", "7:05 PM Removed from the class",
                "[Class fx-hist-p5 · Mr. Okafor]", "7:04 PM Tapped in",
                "7:02 PM Removed from the class", "[Class fx-hist-p6 · -]",
                "7:01 PM Left the class",
            ])
    }

    @Test(
        "What this build does not know is read as none: a kind of moment is left out — its card with it — a reason or a note says nothing; a declined tap whose counted class is not named says another class; the notes of a record kept with no live participation, or over Screen Time off"
    )
    func unknowns() throws {
        let history = try read([
            moment("went_to_mars", "2026-09-21T13:30:00Z", period: 5),
            moment("unlock", "2026-09-21T13:20:00Z", reason: "dentist", recordedAs: "moonlit"),
            moment("unlock", "2026-09-21T13:16:00Z", recordedAs: "no_live_participation"),
            moment("unlock", "2026-09-21T13:14:00Z", reason: "nurse", recordedAs: "protection_off"),
            moment("armed_tap_skipped", "2026-09-21T13:12:00Z"),
        ])
        #expect(
            drawn(history.days(now: t0, time: us())) == [
                "Today", "[Period 3 — Algebra II · Ms. Rivera]",
                "9:12 AM Tap not used. It already counted in another class.",
                "9:14 AM Unlocked · Nurse (Screen Time was off at the time)",
                "9:16 AM Unlocked (Arrived after you left this class)", "9:20 AM Unlocked",
            ])
    }

    @Test(
        "Pages: the first read from the top, Show earlier's after it, each moment once should an answer come twice; the cursor the last page named, none at the end; a page that fails keeps what was read and says why in its own place, and the next answer clears it"
    )
    func pages() async throws {
        var history = History()
        #expect(!history.read && history.days(now: t0).isEmpty && history.fromTop)
        history.reading(more: false)
        #expect(history.busy && history.fromTop)
        #expect(!history.answered(try await answer("first-page.json")))
        #expect(history.read && !history.busy && history.events.count == 3)
        #expect(history.nextBefore == "00000000-0000-7000-8000-000000000006")
        history.reading(more: true)
        #expect(history.busy && !history.fromTop)
        #expect(!history.answered(try await answer("first-page.json")))
        #expect(history.events.count == 3)
        #expect(!history.answered(await client(nil).history(before: history.nextBefore)))
        #expect(history.events.count == 3 && history.read)
        #expect(history.failure == "Can't reach the server. Check your connection and try again.")
        // Show earlier's own: said where it was pressed, never above the moments as not updated.
        #expect(history.notUpdated == nil)
        #expect(!history.answered(try await answer("next-page.json")))
        #expect(history.events.count == 6 && history.failure == nil)
        #expect(history.nextBefore == "00000000-0000-7000-8000-000000000008")
        #expect(!history.answered(try await answer("empty.json")))
        #expect(history.events.count == 6 && history.nextBefore == nil)
    }

    @Test(
        "Read again from the top over the moments read (#141): they stay meanwhile, and its page takes their place — the newest moments in, the older pages back under Show earlier — and a read that fails keeps them, said above them as not updated with why (rule 5), Show earlier's pages meanwhile, come or not, leaving that said, until a read from the top starts again or answers"
    )
    func readAgain() async throws {
        var history = History()
        _ = history.answered(try await answer("first-page.json"))
        history.reading(more: true)
        _ = history.answered(try await answer("next-page.json"))
        #expect(history.events.count == 6 && history.notUpdated == nil)
        history.reading(more: false)
        #expect(history.events.count == 6 && history.read && history.busy)
        #expect(!history.answered(await client(nil).history()))
        #expect(history.events.count == 6 && history.read && !history.busy)
        #expect(history.nextBefore == "00000000-0000-7000-8000-000000000008")
        let notUpdated =
            "Bali couldn't update your history. Can't reach the server. Check your connection and try again."
        #expect(history.notUpdated == notUpdated && history.failure == nil)
        // Show earlier meanwhile: its own failure in its place, and the newest still not read.
        history.reading(more: true)
        #expect(!history.answered(await client(nil).history(before: history.nextBefore)))
        #expect(history.notUpdated == notUpdated && history.failure != nil)
        history.reading(more: true)
        #expect(!history.answered(try await answer("empty.json")))
        #expect(history.notUpdated == notUpdated && history.failure == nil && history.nextBefore == nil)
        // Try again from the top: the words go while it reads, and its page leaves none.
        history.reading(more: false)
        #expect(history.notUpdated == nil && history.events.count == 6)
        #expect(!history.answered(try await answer("first-page.json")))
        #expect(history.events.count == 3 && history.failure == nil && history.notUpdated == nil)
        #expect(history.nextBefore == "00000000-0000-7000-8000-000000000006" && history.read)
    }

    @Test(
        "A read that gave no page is said (rule 5), keyed on its status — the Join screen's words, a teacher's account its own — and Show earlier's cursor the history does not hold is read again from the top, the moments read shown meanwhile (#141), where a Try again would only be refused again"
    )
    func failures() async throws {
        var history = History()
        #expect(!history.answered(try await answer("401-unauthorized.json")))
        #expect(history.failure == "Bali couldn't check your sign-in. Try again." && !history.read)
        for (status, words) in [
            (403, "This is a teacher's account, and History is only for students."),
            (429, "Too many tries for now. Wait a minute, then try again."),
            (500, "Something went wrong at Bali. Try again in a moment."),
        ] {
            #expect(!history.answered(await client(status).history()))
            #expect(history.failure == words, "\(status)")
        }
        #expect(!history.answered(try await answer("400-bad-limit.json")))
        #expect(history.failure == "Something went wrong at Bali. Try again in a moment.")
        _ = history.answered(try await answer("first-page.json"))
        history.reading(more: true)
        #expect(history.answered(try await answer("400-bad-cursor.json")))
        #expect(history.events.count == 3 && history.read && !history.busy && history.failure == nil)
        // A read from the top — no cursor sent — so answered is said, never read again: that
        // would be refused again, forever (C6a-2's review) — over nothing read, or the moments kept.
        history.reading(more: false)
        #expect(!history.answered(try await answer("400-bad-cursor.json")))
        #expect(history.events.count == 3 && history.notUpdated != nil && !history.busy)
        var top = History()
        top.reading(more: false)
        #expect(!top.answered(try await answer("400-bad-cursor.json")))
        #expect(top.failure == "Something went wrong at Bali. Try again in a moment.")
        #expect(!top.read && !top.busy && top.notUpdated == nil)
    }
}

@Suite("History through the engine (C6a)", .timeLimit(.minutes(3)))
struct HistoryEngineTests {
    @Test(
        "A page goes through the engine's one client, older than the cursor it is given, its token renewed once on a 401 by the engine's own refresh"
    )
    func throughTheEngine() async throws {
        let rig = try Rig()
        async let answer = rig.engine.history(before: "e1")
        let refused = try await rig.server.next("GET /v1/me/history")
        #expect(refused.request.url?.query() == "before=e1")
        refused.reply(401)
        let again = try await rig.server.next("GET /v1/me/history")
        #expect(again.token == "Bearer token-2" && again.request.url?.query() == "before=e1")
        again.reply(200, #"{"events":[],"nextBefore":null}"#)
        #expect(await answer.answer?.events.isEmpty == true)
        #expect(await rig.tokens.refreshes == 1)
        await rig.stop()
    }
}
