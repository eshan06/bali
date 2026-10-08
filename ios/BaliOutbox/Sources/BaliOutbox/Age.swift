import Foundation

/// The 13+ check (C7; the owner's rulings, 2026-10-04, 2026-10-05 and 2026-10-07): asked at every
/// Sign up — before the intro and the sign-up page (the approved Sign in & sign up design), no
/// account existing yet to have passed it — the birth month and year, neutrally, by the FTC's
/// COPPA guidance: nothing on it says 13, hints at the cutoff or preselects an answer. 13 or older
/// keeps "passed" per account, in the phone's own defaults under the account's Cognito id, never the
/// date: the account a Sign up's page signs in is filed as it lands. Under 13 keeps nothing
/// anywhere — no flag, no date, no counter, on the phone, in the app group, the Keychain or the
/// server — and sees a kind stop screen, with no way back to the question until the app is
/// reopened: held here, in memory, for the run. A sign-in into an account that has not passed on
/// this phone — made on Cognito's own pages around the question, or an existing account new to the
/// phone — is asked first too, and gives Bali's API nothing until answered; under 13 there, the
/// account is deleted (the gap's fallback, the owner's decision 2026-10-06). The rules, so they run
/// on Linux; the app's `Phone` keeps one and the screens call it.
public struct AgeCheck: Sendable, Hashable {
    /// The question as it stands this run, in memory only.
    public enum Answer: Sendable, Hashable {
        /// Not asked: Sign in shows — signed in, the question, where the account has not passed.
        case unanswered
        /// Sign up pressed: the question shows — and stays, answered 13 or older, while the
        /// sign-up page it opens is open.
        case asked
        /// 13 or older, this run: the Sign up under way goes on, and an account it was answered
        /// under is filed as passed.
        case passed
        /// Under 13, this run: the stop screen, until the app is reopened — signed in, its account
        /// deleted first.
        case tooYoung
    }

    public private(set) var answer: Answer
    /// The one key the check writes, in the phone's own defaults: the Cognito ids of the accounts
    /// that passed on this phone. The single phone-wide flag builds before kept (`ageChecked`)
    /// is no longer read or written: it said someone on the phone passed, never which account, so
    /// it vouches for none (the owner's ruling, 2026-10-07).
    public static let key = "ageCheckedAccounts"
    /// The stop screen's title and line (the owner's words, 2026-10-05): an answer under 13's, and
    /// the title of each step of the account's deletion after a sign-in
    /// (`Deleting.saidUnderThirteen`).
    public static let notYet = "Bali isn't available for you yet"
    public static let askTeacher = "Ask your teacher how to take part in class without the app."

    public init(_ answer: Answer) { self.answer = answer }

    /// Whether `account`, a Cognito id, has passed on this phone, as `defaults` keep it; no account
    /// named never has.
    public static func passed(_ account: String?, in defaults: UserDefaults) -> Bool {
        account.map { defaults.stringArray(forKey: key)?.contains($0) == true } ?? false
    }

    /// Files `account` as passed on this phone, in `defaults`: its Cognito id alone.
    public static func pass(_ account: String, in defaults: UserDefaults) {
        let accounts = defaults.stringArray(forKey: key) ?? []
        if !accounts.contains(account) { defaults.set(accounts + [account], forKey: key) }
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

    /// The question answered with `month` and `year`, judged at `today`: passed or under 13, in
    /// memory alone. Nothing is written here: an account is filed where it is known (`pass`), and
    /// an answer under 13 is written nowhere, ever.
    public mutating func answered(
        month: Int, year: Int, today: Date = Date(), calendar: Calendar = .current
    ) {
        answer =
            Self.passes(month: month, year: year, today: today, calendar: calendar)
            ? .passed : .tooYoung
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
