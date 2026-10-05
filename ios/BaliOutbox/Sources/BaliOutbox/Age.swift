import Foundation

/// The 13+ check (C7; the owner's rulings, 2026-10-04 and 2026-10-05): the student app's first
/// screen on a first launch, before the intro, asking the birth month and year neutrally, by the
/// FTC's COPPA guidance — nothing on it says 13, hints at the cutoff or preselects an answer. 13 or
/// older keeps one flag in the phone's own defaults, that the check passed, never the date, and is
/// not asked again. Under 13 keeps nothing anywhere — no flag, no date, no counter, on the phone,
/// in the app group, the Keychain or the server — and sees a kind stop screen, with no way back to
/// the question until the app is reopened: held here, in memory, for the run. The rules, so they
/// run on Linux; the app's `Phone` keeps one and the screens call it.
public struct AgeCheck: Sendable, Hashable {
    public enum Answer: Sendable, Hashable {
        /// Never passed on this phone and not answered this run: the question shows.
        case unanswered
        /// 13 or older: kept, and never asked again.
        case passed
        /// Under 13, this run: the stop screen, until the app is reopened.
        case tooYoung
    }

    public private(set) var answer: Answer
    /// The one key the check writes, in the phone's own defaults: true once passed.
    public static let key = "ageChecked"

    public init(_ answer: Answer) { self.answer = answer }

    /// As the phone's own defaults say: passed before, or not yet — never under 13, which no
    /// launch ever kept.
    public init(defaults: UserDefaults) {
        answer = defaults.bool(forKey: Self.key) ? .passed : .unanswered
    }

    /// Whether someone born in `month` of `year` is 13 or older on `today`, at month precision:
    /// only once the month after their birth month has begun, 13 years on, when whoever was born
    /// in that month — on its last day too — has had their 13th birthday. In the birth month
    /// itself, 13 years on, a student born on its last day is still 12 until that day, so no one
    /// passes: a 12-year-old never does. By the phone's own calendar.
    public static func passes(month: Int, year: Int, today: Date, calendar: Calendar = .current)
        -> Bool
    {
        let now = calendar.dateComponents([.year, .month], from: today)
        guard let thisYear = now.year, let thisMonth = now.month else { return false }
        return thisYear * 12 + thisMonth > (year + 13) * 12 + month
    }

    /// The question answered with `month` and `year`, judged at `today`: passed, the one flag is
    /// written to `defaults` — nil writes nowhere, a frozen fixture's — and under 13 writes
    /// nothing at all, anywhere.
    public mutating func answered(
        month: Int, year: Int, today: Date = Date(), calendar: Calendar = .current,
        defaults: UserDefaults?
    ) {
        if Self.passes(month: month, year: year, today: today, calendar: calendar) {
            answer = .passed
            defaults?.set(true, forKey: Self.key)
        } else {
            answer = .tooYoung
        }
    }
}

/// The age screen's picks (C7): the birth month and year as the student picks them, and what each
/// menu offers — every month and a hundred years, so the list hints at no cutoff — short of the
/// future: with this year picked, the months to this one; with a month past this one picked, the
/// years to last year. So no pick can be a month that has not come, and the question needs no
/// error of its own.
public struct Birth: Sendable, Hashable {
    public var month: Int?
    public var year: Int?

    public init(month: Int? = nil, year: Int? = nil) { (self.month, self.year) = (month, year) }

    /// Both picked: Continue answers.
    public var complete: Bool { month != nil && year != nil }

    /// The months the month menu offers at `today`: all twelve, or, with this year picked, those
    /// up to this one.
    public func months(at today: Date, calendar: Calendar = .current) -> [Int] {
        let now = calendar.dateComponents([.year, .month], from: today)
        guard let thisYear = now.year, let thisMonth = now.month else { return Array(1...12) }
        return Array(1...(year == thisYear ? thisMonth : 12))
    }

    /// The years the year menu offers at `today`, this year first and a hundred back — or, with a
    /// month past this one picked, last year first.
    public func years(at today: Date, calendar: Calendar = .current) -> [Int] {
        let now = calendar.dateComponents([.year, .month], from: today)
        guard let thisYear = now.year, let thisMonth = now.month else { return [] }
        let newest = month.map { $0 > thisMonth } == true ? thisYear - 1 : thisYear
        return Array(((newest - 100)...newest).reversed())
    }
}
