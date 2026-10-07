import Foundation
import Testing

@testable import BaliOutbox

/// A day in the Gregorian calendar, at noon UTC, so the month a test names is the month read.
private func day(_ year: Int, _ month: Int, _ day: Int) -> Date {
    gregorian.date(from: DateComponents(year: year, month: month, day: day, hour: 12))!
}

private var gregorian: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    return calendar
}

/// Whether a birth in `month` of `year` passes on `today`, in that calendar.
private func passes(_ month: Int, _ year: Int, on today: Date) -> Bool {
    AgeCheck.passes(month: month, year: year, today: today, calendar: gregorian)
}

@Suite("The 13+ check (C7)")
struct AgeTests {
    @Test(
        "At month precision, 13 or older only once the month after the birth month has begun, 13 years on — the whole birth month, 13 years on, still says no, its last day included, since a student born on that day is 12 until then — across a year's end and a leap day; a month before the birth month says no, the month after yes, however many years on past 13"
    )
    func monthPrecision() {
        // Born in October 2013: 13 some day in October 2026, so the whole of October says no.
        #expect(!passes(10, 2013, on: day(2026, 10, 1)))
        #expect(!passes(10, 2013, on: day(2026, 10, 31)))
        #expect(passes(10, 2013, on: day(2026, 11, 1)))
        // Born in September 2013: 13 on every day of October 2026.
        #expect(passes(9, 2013, on: day(2026, 10, 1)))
        #expect(!passes(9, 2013, on: day(2026, 9, 30)))
        // The year's end: born in December 2012, 13 only from January 2026.
        #expect(!passes(12, 2012, on: day(2025, 12, 31)))
        #expect(passes(12, 2012, on: day(2026, 1, 1)))
        // Born in January 2013: 13 from February 2026, never in January.
        #expect(!passes(1, 2013, on: day(2026, 1, 31)))
        #expect(passes(1, 2013, on: day(2026, 2, 1)))
        // Born on 29 February 2012: 13 from 1 March 2025, whichever day the law counts the
        // birthday on; 28 February says no.
        #expect(!passes(2, 2012, on: day(2025, 2, 28)))
        #expect(passes(2, 2012, on: day(2025, 3, 1)))
        // A 12-year-old never passes, nor anyone younger; an adult always does.
        #expect(!passes(10, 2014, on: day(2026, 10, 15)))
        #expect(!passes(10, 2026, on: day(2026, 10, 15)))
        #expect(!passes(12, 2027, on: day(2026, 10, 15)))
        #expect(passes(10, 2000, on: day(2026, 10, 15)))
        #expect(passes(1, 1950, on: day(2026, 10, 15)))
    }

    @Test(
        "The rule and the menus count in the Gregorian calendar whatever calendar the phone shows its dates in (santa's round 1): a phone on the Islamic calendar, whose year is eleven days short of a solar one, would otherwise pass a 12-year-old after thirteen of them, and one on the Japanese calendar would offer era years; only the phone's time zone and language are its own, so the month names come in its language"
    )
    func gregorianWhateverThePhoneShows() {
        let today = day(2026, 10, 5)
        for identifier in [Calendar.Identifier.islamicUmmAlQura, .islamic, .japanese, .buddhist, .chinese] {
            var phone = Calendar(identifier: identifier)
            phone.timeZone = TimeZone(identifier: "UTC")!
            // Born in January 2014: 12 years and 9 months old, thirteen lunar years on.
            #expect(!AgeCheck.passes(month: 1, year: 2014, today: today, calendar: phone), "\(identifier)")
            #expect(
                !AgeCheck.passes(month: 10, year: 2013, today: day(2026, 10, 31), calendar: phone),
                "\(identifier)")
            #expect(
                AgeCheck.passes(month: 10, year: 2013, today: day(2026, 11, 1), calendar: phone),
                "\(identifier)")
            #expect(Birth().months(at: today, calendar: phone) == Array(1...12), "\(identifier)")
            let years = Birth().years(at: today, calendar: phone)
            #expect(years.first == 2026 && years.last == 1926, "\(identifier)")
            #expect(Birth(year: 2026).months(at: today, calendar: phone) == Array(1...10), "\(identifier)")
            #expect(Birth(month: 12).years(at: today, calendar: phone).first == 2025, "\(identifier)")
            #expect(
                Birth.monthName(3, calendar: phone) == Birth.monthName(3, calendar: gregorian),
                "\(identifier)")
        }
        var french = Calendar(identifier: .japanese)
        french.locale = Locale(identifier: "fr_FR")
        #expect(Birth.monthName(3, calendar: french) == "mars")
        var english = Calendar(identifier: .islamicUmmAlQura)
        english.locale = Locale(identifier: "en_US")
        #expect(Birth.monthName(1, calendar: english) == "January")
        #expect(Birth.monthName(12, calendar: english) == "December")
    }

    @Test(
        "13 or older keeps one flag, that the check passed, in the defaults given — never the month or the year — and a fresh check reads it back as passed; under 13 keeps nothing at all: no key of any kind is written, the next launch reads not answered, and the answer stands in memory alone; a check given no defaults, a frozen fixture's, writes nowhere either"
    )
    func keeps() throws {
        let suite = "BaliOutboxTests.age.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let before = Set(defaults.dictionaryRepresentation().keys)
        #expect(AgeCheck(defaults: defaults).answer == .unanswered)

        var young = AgeCheck(defaults: defaults)
        young.answered(month: 10, year: 2014, today: day(2026, 10, 15), defaults: defaults)
        #expect(young.answer == .tooYoung)
        #expect(Set(defaults.dictionaryRepresentation().keys) == before)
        #expect(defaults.object(forKey: AgeCheck.key) == nil)
        #expect(AgeCheck(defaults: defaults).answer == .unanswered)

        var frozen = AgeCheck(.unanswered)
        frozen.answered(month: 10, year: 2000, today: day(2026, 10, 15), defaults: nil)
        #expect(frozen.answer == .passed)
        #expect(Set(defaults.dictionaryRepresentation().keys) == before)

        var passed = AgeCheck(defaults: defaults)
        passed.answered(month: 10, year: 2000, today: day(2026, 10, 15), defaults: defaults)
        #expect(passed.answer == .passed)
        #expect(Set(defaults.dictionaryRepresentation().keys) == before.union([AgeCheck.key]))
        #expect(defaults.bool(forKey: AgeCheck.key))
        #expect(AgeCheck(defaults: defaults).answer == .passed)
        for key in defaults.dictionaryRepresentation().keys where !before.contains(key) {
            let kept = String(describing: defaults.object(forKey: key) ?? "")
            #expect(!kept.contains("2000") && !kept.contains("10"), "\(key): \(kept)")
        }
    }

    @Test(
        "Sign up pressed asks the check (the approved Sign in & sign up design): not passed, the question shows and no page may open, however often it is pressed; answered 13 or older, the way to the page goes on; under 13, none may and the stop screen stays"
    )
    func asks() {
        var check = AgeCheck(.unanswered)
        #expect(!check.ask() && check.answer == .asked)
        #expect(!check.ask() && check.answer == .asked)
        check.answered(month: 10, year: 2000, today: day(2026, 10, 15), defaults: nil)
        #expect(check.ask() && check.answer == .passed)
        var young = AgeCheck(.asked)
        young.answered(month: 10, year: 2014, today: day(2026, 10, 15), defaults: nil)
        #expect(!young.ask() && young.answer == .tooYoung)
    }

    @Test(
        "What the menus offer at a day in October 2026: every month and this year with a hundred before it, newest first — with this year picked, only the months to October; with a month past October picked, the years from last year; a pick made, the other menu still offers what was picked; complete once both are picked"
    )
    func menus() {
        let today = day(2026, 10, 15)
        var birth = Birth()
        #expect(!birth.complete)
        #expect(birth.months(at: today, calendar: gregorian) == Array(1...12))
        let years = birth.years(at: today, calendar: gregorian)
        #expect(years.first == 2026 && years.last == 1926 && years.count == 101)
        birth.year = 2026
        #expect(birth.months(at: today, calendar: gregorian) == Array(1...10))
        #expect(!birth.complete)
        birth = Birth(month: 12)
        #expect(birth.years(at: today, calendar: gregorian).first == 2025)
        #expect(birth.years(at: today, calendar: gregorian).count == 101)
        #expect(birth.months(at: today, calendar: gregorian) == Array(1...12))
        birth = Birth(month: 10)
        #expect(birth.years(at: today, calendar: gregorian).first == 2026)
        birth.year = 2026
        #expect(birth.complete)
        #expect(birth.months(at: today, calendar: gregorian).contains(10))
        #expect(birth.years(at: today, calendar: gregorian).contains(2026))
        #expect(Birth(month: 3, year: 2009).complete)
    }
}
