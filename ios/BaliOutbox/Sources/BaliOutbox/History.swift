import BaliCore
import Foundation

/// The History screen (C6a; D1's History) as the phone keeps it: the student's own moments, as the
/// pages of `GET /v1/me/history` came — newest first, each moment once — the next page's cursor,
/// and why the last read did not finish, in words (rule 5). Its rules, so they run on Linux; the
/// app sends the calls (C6a-2's screen).
public struct History: Sendable, Hashable {
    public var events: [HistoryEvent] = []
    /// The next, older page's cursor: nil at the end, and before any answer.
    public var nextBefore: String?
    /// Whether a page has answered: until then the screen says it is reading, or why it could not.
    public var read = false
    public var busy = false
    public var failure: String?

    public init() {}

    /// A page came back — the first, into a new `History` (a read from the top starts from one: a
    /// newer moment added after older ones would be drawn out of order), or the one after
    /// `nextBefore` — its moments after those read, each once, or why not.
    /// True when the history must be read again from the top: a cursor it does not hold
    /// (`unknown_cursor`), whose Try again would only be refused again — only where one was sent,
    /// the page after `nextBefore`: a read from the top answered so would be read again forever
    /// (C6a-2's review), so it is said as any other failure is.
    public mutating func answered(_ response: APIResponse<HistoryPage>) -> Bool {
        busy = false
        guard let page = response.answer else {
            if response.error?.error.reason == .unknownCursor, nextBefore != nil {
                self = History()
                return true
            }
            failure = Self.words(response.result)
            return false
        }
        let known = Set(events.map(\.eventId))
        events += page.events.filter { !known.contains($0.eventId) }
        (nextBefore, read, failure) = (page.nextBefore, true, nil)
        return false
    }

    /// What the screen says when a read gave no page (rule 5): in the Join screen's words — a
    /// teacher's account's own.
    public static func words(_ result: SendResult) -> String {
        result == .status(403)
            ? "This is a teacher's account, and History is only for students."
            : Joining.words(result, nil)
    }

    /// A day as D1 draws it: its title, and its cards.
    public struct Day: Sendable, Hashable {
        public let title: String
        public let cards: [Card]
    }

    /// One class's moments in a row, under its name and its teacher's (none when unnamed).
    public struct Card: Sendable, Hashable {
        public let name: String
        public let teacher: String?
        public let moments: [Moment]
    }

    /// A moment's line: its time, its kind — for its icon — its words, and a note where the record
    /// changed nothing (A7's `recordedAs`).
    public struct Moment: Sendable, Hashable {
        public let id: String
        public let type: HistoryEventType
        public let time: String
        public let words: String
        public let note: String?
    }

    /// The moments read, in D1's grouping: days newest first — Today, Yesterday, then the date —
    /// each oldest first, the page reversed and never re-sorted (A7: a switch's two moments share
    /// one instant), in cards of one class's moments in a row. `time` is the phone's locale, time
    /// zone and calendar unless a test says otherwise; a moment of a kind this build does not know
    /// is left out.
    public func days(
        now: Date, time: Date.FormatStyle = .init(date: .omitted, time: .shortened)
    ) -> [Day] {
        var calendar = time.calendar
        calendar.timeZone = time.timeZone
        let shown = events.compactMap { event in
            Moment(event, time).map { (event: event, moment: $0) }
        }
        return runs(shown) { calendar.startOfDay(for: $0.event.occurredAt) }.map { day in
            let cards = runs(day.reversed()) { $0.event.class.id }.map { run in
                Card(
                    name: run[0].event.class.name, teacher: run[0].event.teacher.displayName,
                    moments: run.map(\.moment))
            }
            return Day(title: title(day[0].event.occurredAt, now, calendar, time), cards: cards)
        }
    }

    private func title(_ date: Date, _ now: Date, _ calendar: Calendar, _ time: Date.FormatStyle)
        -> String
    {
        if calendar.isDate(date, inSameDayAs: now) { return "Today" }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now),
            calendar.isDate(date, inSameDayAs: yesterday)
        {
            return "Yesterday"
        }
        let style = Date.FormatStyle(
            locale: time.locale, calendar: calendar, timeZone: time.timeZone
        ).weekday(.wide).month(.wide).day()
        let thisYear = calendar.isDate(date, equalTo: now, toGranularity: .year)
        return date.formatted(thisYear ? style : style.year())
    }
}

extension History.Moment {
    /// A moment in D1's words, at its time; nil for a kind this build does not know.
    init?(_ event: HistoryEvent, _ time: Date.FormatStyle) {
        guard let type = event.type.known else { return nil }
        (id, self.type, self.time) = (event.eventId, type, event.occurredAt.formatted(time))
        words =
            switch type {
            case .tapIn: "Tapped in"
            case .refocus: "Back to focus"
            case .unlock:
                ["Unlocked", event.reason?.known?.rawValue.capitalized].compactMap { $0 }
                    .joined(separator: " · ")
            case .protectionOff: "Screen Time off"
            case .leftForOtherSession: "Switched to another class"
            case .enrollmentLeft: "Left the class"
            case .enrollmentRemoved: "Removed from the class"
            // D1's words, in two sentences on the owner's ruling (2026-09-30): a class named with a
            // dash of its own read as one line of two dashes.
            case .armedTapSkipped:
                "Tap not used. It already counted in \(event.countedIn?.name ?? "another class")."
            case .sessionEnded, .sessionExpired: "Class ended"
            }
        note =
            switch event.recordedAs?.known {
            case .afterSessionEnd?: "Arrived after class ended"
            case .superseded?: "Arrived late, so it changed nothing"
            case .noLiveParticipation?: "Arrived after you left this class"
            case .protectionOff?: "Screen Time was off, so it changed nothing"
            // Never in a class's history (kept with none), or a note this build does not know.
            default: nil
            }
    }
}

/// `items` in runs of neighbours with the same `key`, in order.
private func runs<Item, Key: Equatable>(_ items: some Sequence<Item>, by key: (Item) -> Key)
    -> [[Item]]
{
    items.reduce(into: []) { runs, item in
        if let last = runs.last?.last, key(last) == key(item) {
            runs[runs.count - 1].append(item)
        } else {
            runs.append([item])
        }
    }
}
