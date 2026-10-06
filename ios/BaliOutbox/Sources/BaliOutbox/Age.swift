import Foundation

/// The 13+ check (C7; the owner's rulings, 2026-10-04 and 2026-10-05): asked when the student taps
/// Sign in with it not passed on the phone — after the intro, before the sign-in page opens (the
/// owner's decision, 2026-10-06) — the birth month and year, neutrally, by the FTC's COPPA
/// guidance: nothing on it says 13, hints at the cutoff or preselects an answer. 13 or older keeps
/// one flag in the phone's own defaults, that the check passed, never the date, and is not asked
/// again. Under 13 keeps nothing anywhere — no flag, no date, no counter, on the phone, in the app
/// group, the Keychain or the server — and sees a kind stop screen, with no way back to the
/// question until the app is reopened: held here, in memory, for the run. The rules, so they run
/// on Linux; the app's `Phone` keeps one and the screens call it.
public struct AgeCheck: Sendable, Hashable {
    public enum Answer: Sendable, Hashable {
        /// Never passed on this phone and not asked this run: Sign in shows.
        case unanswered
        /// Sign in pressed, not answered yet: the question shows.
        case asked
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
    /// passes: a 12-year-old never does. In the Gregorian calendar, in the phone's time zone
    /// (`calendar`, the phone's own, lends only that: `gregorian(like:)`).
    public static func passes(month: Int, year: Int, today: Date, calendar: Calendar = .current)
        -> Bool
    {
        let now = gregorian(like: calendar).dateComponents([.year, .month], from: today)
        guard let thisYear = now.year, let thisMonth = now.month else { return false }
        return thisYear * 12 + thisMonth > (year + 13) * 12 + month
    }

    /// The Gregorian calendar in the time zone and the language of `phone`, the calendar the
    /// phone shows its dates in: the rule and the menus count in it whatever that is (santa's
    /// round 1). An Islamic year is eleven days short of a solar one, so thirteen of them would
    /// pass a 12-year-old; a Japanese year is its era's, so the year menu would offer era years.
    /// Only the time zone and the language are the phone's own.
    static func gregorian(like phone: Calendar) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = phone.timeZone
        calendar.locale = phone.locale ?? .current
        return calendar
    }

    /// Sign in pressed: whether its sign-in page may open — the check passed on this phone. Else
    /// the question shows, or the stop screen an answer under 13 got stays.
    public mutating func ask() -> Bool {
        if answer == .unanswered { answer = .asked }
        return answer == .passed
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

/// The age screen's picks (C7): the birth month and year as the student picks them, Gregorian,
/// and what each menu offers — every month and a hundred years, so the list hints at no cutoff —
/// short of the future: with this year picked, the months to this one; with a month past this one
/// picked, the years to last year. So no pick can be a month that has not come, and the question
/// needs no error of its own. Counted in the Gregorian calendar in the phone's time zone, whatever
/// calendar the phone shows (`AgeCheck.gregorian(like:)`); the names in its language.
public struct Birth: Sendable, Hashable {
    public var month: Int?
    public var year: Int?

    public init(month: Int? = nil, year: Int? = nil) { (self.month, self.year) = (month, year) }

    /// Both picked: Continue answers.
    public var complete: Bool { month != nil && year != nil }

    /// The months the month menu offers at `today`: all twelve, or, with this year picked, those
    /// up to this one.
    public func months(at today: Date, calendar: Calendar = .current) -> [Int] {
        let now = AgeCheck.gregorian(like: calendar).dateComponents([.year, .month], from: today)
        guard let thisYear = now.year, let thisMonth = now.month else { return Array(1...12) }
        return Array(1...(year == thisYear ? thisMonth : 12))
    }

    /// The years the year menu offers at `today`, this year first and a hundred back — or, with a
    /// month past this one picked, last year first.
    public func years(at today: Date, calendar: Calendar = .current) -> [Int] {
        let now = AgeCheck.gregorian(like: calendar).dateComponents([.year, .month], from: today)
        guard let thisYear = now.year, let thisMonth = now.month else { return [] }
        let newest = month.map { $0 > thisMonth } == true ? thisYear - 1 : thisYear
        return Array(((newest - 100)...newest).reversed())
    }

    /// Gregorian month `month`'s name in the phone's language, whatever calendar it shows.
    public static func monthName(_ month: Int, calendar: Calendar = .current) -> String {
        AgeCheck.gregorian(like: calendar).monthSymbols[month - 1]
    }
}
