import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

/// How a phone set to `locale`, in `zone`, writes a time.
private func phone(_ locale: String, in zone: String = "America/New_York") -> Date.FormatStyle {
    Date.FormatStyle(
        date: .omitted, time: .shortened, locale: Locale(identifier: locale),
        timeZone: TimeZone(identifier: zone)!)
}

/// `text` with plain spaces: ICU writes a narrow no-break one before "AM", or a no-break one.
private func plain(_ text: String) -> String {
    text.replacing("\u{202F}", with: " ").replacing("\u{A0}", with: " ")
}

/// The shield's title over an app for `state` at `now`, on a US phone in New York.
private func title(
    _ state: SyncState?, at now: Date = t0, on time: Date.FormatStyle = phone("en_US")
) -> String {
    plain(ShieldWords(state, over: .app, now: now, time: time).title)
}

/// Standing `standing`, with `changes` queued at `t0`, as the file keeps them.
private func kept(_ standing: Standing, _ changes: [Change] = []) throws -> SyncState {
    let (outbox, _) = try makeOutbox()
    for change in changes { try record(outbox, change) }
    var state = SyncState()
    (state.standing, state.queued) = (standing, try outbox.records())
    return state
}

/// A session whose bell is at 10:42 AM in New York, where `t0` is 10:13:20 AM.
private let class1042 = session(endsAt: 1720)

private let focusedWithBali = "Focused with Bali"
private let waiting = "Focused with Bali — waiting for your class"

@Suite("What Bali's own shield says, from where the phone stands (B5c)")
struct ShieldWordsTests {
    @Test(
        "Focused in a session: until its bell, as the phone writes a time — in its own locale, 12- or 24-hour as it is set, and its own time zone"
    )
    func bell() throws {
        let focused = try kept(.inSession(class1042, .focused))
        #expect(title(focused) == "Focused with Bali until 10:42 AM")
        #expect(title(focused, on: phone("en_US@hours=h23")) == "Focused with Bali until 10:42")
        #expect(title(focused, on: phone("en_GB")) == "Focused with Bali until 10:42")
        #expect(
            title(focused, on: phone("en_US", in: "Asia/Kolkata"))
                == "Focused with Bali until 8:12 PM")
        let afternoon = try kept(.inSession(session(endsAt: 13900), .focused))
        #expect(title(afternoon) == "Focused with Bali until 2:05 PM")
        #expect(title(afternoon, on: phone("en_GB")) == "Focused with Bali until 14:05")
    }

    @Test(
        "A tap not yet answered, under its cap: no time, whatever the phone stood in — the tap's answer may move the bell — and past the cap, the words of the standing"
    )
    func pending() throws {
        let tapped = try kept(.out, [.tap(tagId: "tag")])
        #expect(title(tapped) == waiting)
        #expect(title(tapped, at: at(SyncState.tapCap - 1)) == waiting)
        #expect(title(tapped, at: at(SyncState.tapCap)) == focusedWithBali)
        let retapped = try kept(.inSession(class1042, .focused), [.tap(tagId: "tag")])
        #expect(title(retapped) == waiting)
        let later = try kept(.inSession(session(endsAt: 4000), .focused), [.tap(tagId: "tag")])
        #expect(title(later, at: at(SyncState.tapCap)) == "Focused with Bali until 11:20 AM")
        let unlocked = try kept(.inSession(class1042, .unlocked), [.tap(tagId: "tag")])
        #expect(title(unlocked) == waiting)
        // A device check's shorter cap is the one kept to.
        var check = tapped
        check.cap = Bell.floor
        #expect(title(check, at: at(Bell.floor - 1)) == waiting)
        #expect(title(check, at: at(Bell.floor)) == focusedWithBali)
    }

    @Test(
        "A tap the student unlocked after (decision 11), or a refused one, keeps nothing on: the words of the standing"
    )
    func tapEnded() async throws {
        let unlock = Change.unlock(session: "s", reason: nil)
        let focused = try kept(.inSession(class1042, .focused), [.tap(tagId: "tag"), unlock])
        #expect(title(focused) == "Focused with Bali until 10:42 AM")
        let unlocked = try kept(.inSession(class1042, .unlocked), [.tap(tagId: "tag"), unlock])
        #expect(title(unlocked) == focusedWithBali)
        let (outbox, _) = try makeOutbox()
        let tap = try record(outbox, .tap(tagId: "tag"))
        try await send(outbox, tap, 409, Answer.refused("session_not_running"))
        var stuck = SyncState()
        stuck.queued = try outbox.records()
        #expect(stuck.queued.first?.stuck == true)
        #expect(title(stuck) == focusedWithBali)
    }

    @Test(
        "Nothing says when the shields come off — not read, the bell past, or nothing keeping them on: Bali's name alone, never a wrong time"
    )
    func noTime() throws {
        #expect(title(nil) == focusedWithBali)
        let focused = try kept(.inSession(class1042, .focused))
        #expect(title(focused, at: at(1720)) == focusedWithBali)
        #expect(title(focused, at: at(1800)) == focusedWithBali)
        let standings: [Standing] = [
            .inSession(class1042, .unlocked), .inSession(class1042, .protectionOff),
            .inSession(class1042, nil), .waiting, .out, .unread,
        ]
        for standing in standings {
            #expect(title(try kept(standing)) == focusedWithBali, "\(standing)")
        }
    }

    @Test("Under the title, D1's words — over an app, or a website")
    func subtitle() {
        let app = ShieldWords(nil, over: .app, now: t0, time: phone("en_US")).subtitle
        #expect(
            app
                == "This app is paused for class. Calls, FaceTime, Messages and Emergency SOS always work. If you need out, Emergency Unlock is always in the Bali app."
        )
        let website = ShieldWords(nil, over: .website, now: t0, time: phone("en_US")).subtitle
        #expect(website == app.replacing("This app", with: "This website"))
    }
}

@Suite("The shield reads the file the app keeps, as the monitor does (B5c)", .timeLimit(.minutes(3)))
struct ShieldFileTests {
    /// The title over the file at `url`, waiting for it as long as the tests wait for anything: a
    /// stall of the iOS Simulator's never reads as the file held.
    func title(_ url: URL?, at now: Date = t0, cap: TimeInterval = SyncState.tapCap) -> String {
        let bound = TimeInterval(patience.components.seconds)
        return plain(
            ShieldWords(
                outboxAt: url, over: .app, now: now, cap: cap, time: phone("en_US"), within: bound
            ).title)
    }

    @Test("From the app's own file, the app closed: tapped in, until the bell")
    func bell() async throws {
        let (outbox, url) = try makeOutbox()
        let rig = try Rig(outbox: outbox)
        try await rig.tapIn(class1042)
        await rig.stop()
        #expect(title(url) == "Focused with Bali until 10:42 AM")
        #expect(title(url, at: at(1720)) == focusedWithBali)
    }

    @Test(
        "A tap offline, never answered: waiting — to the cap the shield is given, the device check's too"
    )
    func tap() async throws {
        let (outbox, url) = try makeOutbox()
        let rig = try Rig(outbox: outbox)
        try await rig.engine.record(.tap(tagId: "tag"))
        try await rig.server.next(tapRoute).reply(nil)
        await rig.stop()
        #expect(title(url) == waiting)
        #expect(title(url, at: at(SyncState.tapCap)) == focusedWithBali)
        #expect(title(url, at: at(Bell.floor - 1), cap: Bell.floor) == waiting)
        #expect(title(url, at: at(Bell.floor), cap: Bell.floor) == focusedWithBali)
    }

    @Test(
        "No app group, a standing the file cannot give back, or a file a newer build migrated: Bali's name alone"
    )
    func unread() throws {
        #expect(title(nil) == focusedWithBali)
        let (spoiled, spoiledURL) = try makeOutbox()
        try spoiled.keep(.inSession(class1042, .focused))
        try spoilStanding(spoiled)
        #expect(title(spoiledURL) == focusedWithBali)
        let (newer, newerURL) = try makeOutbox()
        try newer.keep(.inSession(class1042, .focused))
        try newer.pool.write {
            try $0.execute(sql: "INSERT INTO grdb_migrations (identifier) VALUES ('v99')")
        }
        #expect(title(newerURL) == focusedWithBali)
    }
}
