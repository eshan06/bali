import Foundation

/// The 13+ check (C7; the owner's rulings, 2026-10-04, 2026-10-05, 2026-10-07 and 2026-10-08):
/// asked at every Sign up — before the intro and the sign-up page (the approved Sign in & sign up
/// design), no account existing yet to have passed it — the birth month and year, neutrally, by the
/// FTC's COPPA guidance: nothing on it says 13, hints at the cutoff or preselects an answer. 13 or
/// older is kept as a yes per account on Bali's server (C7-server), never the date: the sign-in a
/// Sign up's page makes is kept through the check, its yes recorded once it can be. Under 13 keeps
/// nothing anywhere — no flag, no date, no counter, on the phone, in the app group, the Keychain or
/// the server — and sees a kind stop screen, with no way back to the question until the app is
/// reopened: held here, in memory, for the run. A sign-in into an account Bali's server holds no
/// yes for — made on Cognito's own pages around the question, or never confirmed — is asked first
/// too, and gives Bali's API nothing until answered; under 13 there, the account is deleted (the
/// gap's fallback, the owner's decision 2026-10-06). The rules, so they run on Linux; the app's
/// `Phone` keeps one and the screens call it.
public struct AgeCheck: Sendable, Hashable {
    /// The question as it stands this run, in memory only.
    public enum Answer: Sendable, Hashable {
        /// Not asked: Sign in shows — signed in, the question, where Bali's server has no yes.
        case unanswered
        /// Sign up pressed: the question shows — and stays, answered 13 or older, while the
        /// sign-up page it opens is open.
        case asked
        /// 13 or older, this run: the Sign up under way goes on, and an account it was answered
        /// under has its yes recorded.
        case passed
        /// Under 13, this run: the stop screen, until the app is reopened — signed in, its account
        /// deleted first.
        case tooYoung
        /// Signed in, the sign-in not through the check yet: Bali's server asked whether the
        /// account has its yes (C7-server) — the starting mark meanwhile.
        case checking
    }

    public private(set) var answer: Answer
    /// The age notes builds before kept in the phone's own defaults: build 8's per account (the
    /// Cognito ids of the accounts that passed on the phone), and the phone-wide flag before it,
    /// which vouched for no account. Read once and deleted (`forgetNotes`): the phone keeps no age
    /// note any more (the owner's decision, 2026-10-08).
    public static let notes = ["ageCheckedAccounts", "ageChecked"]
    /// The stop screen's title and line (the owner's words, 2026-10-05): an answer under 13's, and
    /// the title of each step of the account's deletion after a sign-in
    /// (`Deleting.saidUnderThirteen`).
    public static let notYet = "Bali isn't available for you yet"
    public static let askTeacher = "Ask your teacher how to take part in class without the app."

    public init(_ answer: Answer) { self.answer = answer }

    /// Build 8's note, let go (the owner's decision, 2026-10-08): whether it holds a yes for
    /// `account`, the one signed in now — the only yes the phone can still send, under that
    /// account's own sign-in — and then every note deleted from `defaults`, whoever is signed in.
    /// Another account listed is asked once more at its next sign-in, where Bali's server has no
    /// yes for it.
    public static func forgetNotes(in defaults: UserDefaults, keeping account: String?) -> Bool {
        let listed = account.map { defaults.stringArray(forKey: notes[0])?.contains($0) == true }
        for note in notes { defaults.removeObject(forKey: note) }
        return listed ?? false
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
    /// memory alone. Nothing is written here: a yes goes to Bali's server with its sign-in
    /// (`SignIn.passed`), and an answer under 13 is written nowhere, ever.
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
