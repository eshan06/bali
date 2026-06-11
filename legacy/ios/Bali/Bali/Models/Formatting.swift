//
//  Formatting.swift
//  Bali — models
//
//  Pure formatting helpers for the ISO-8601 timestamps and integer percentages
//  the API returns. Nonisolated so they're usable from any context. Formatters
//  are created locally (not cached statics) to stay Sendable-clean — call volume
//  here is a handful of rows per refresh, so the allocation cost is negligible.
//

import Foundation

nonisolated enum BaliFormat {
    /// Parse an ISO-8601 timestamp (tolerant of fractional seconds).
    static func date(_ iso: String?) -> Date? {
        guard let iso, !iso.isEmpty else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: iso) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: iso)
    }

    /// "9:41 AM"
    static func timeOfDay(_ iso: String?) -> String {
        guard let d = date(iso) else { return "—" }
        let f = DateFormatter()
        f.dateFormat = "h:mm a"
        return f.string(from: d)
    }

    /// "May 28"
    static func shortDate(_ iso: String?) -> String {
        guard let d = date(iso) else { return "—" }
        let f = DateFormatter()
        f.dateFormat = "MMM d"
        return f.string(from: d)
    }

    /// "Mon, May 28"
    static func weekdayDate(_ iso: String?) -> String {
        guard let d = date(iso) else { return "—" }
        let f = DateFormatter()
        f.dateFormat = "EEE, MMM d"
        return f.string(from: d)
    }

    /// "Just now", "3m ago", "2h ago", "Yesterday", then falls back to a date.
    static func relative(_ iso: String?, now: Date = Date()) -> String {
        guard let d = date(iso) else { return "—" }
        let secs = now.timeIntervalSince(d)
        if secs < 45 { return "Just now" }
        let mins = Int(secs / 60)
        if mins < 60 { return "\(mins)m ago" }
        let hours = mins / 60
        if hours < 24 { return "\(hours)h ago" }
        let days = hours / 24
        if days == 1 { return "Yesterday" }
        if days < 7 { return "\(days)d ago" }
        return shortDate(iso)
    }

    /// "Today" / "Yesterday" / "Wed" / "May 12" relative to now (session history).
    static func dayLabel(_ iso: String?, now: Date = Date()) -> String {
        guard let d = date(iso) else { return "—" }
        let cal = Calendar.current
        if cal.isDateInToday(d) { return "Today" }
        if cal.isDateInYesterday(d) { return "Yesterday" }
        let days = cal.dateComponents([.day], from: d, to: now).day ?? 0
        if days >= 0 && days < 7 {
            let f = DateFormatter(); f.dateFormat = "EEE"
            return f.string(from: d)
        }
        return shortDate(iso)
    }

    /// "Started just now" / "Started 12m ago" / "Started 1h 5m ago".
    static func startedAgo(_ iso: String?, now: Date = Date()) -> String {
        guard let d = date(iso) else { return "" }
        let secs = max(0, now.timeIntervalSince(d))
        let mins = Int(secs / 60)
        if mins < 1 { return "Started just now" }
        if mins < 60 { return "Started \(mins)m ago" }
        let h = mins / 60, m = mins % 60
        return m == 0 ? "Started \(h)h ago" : "Started \(h)h \(m)m ago"
    }

    /// "94%" from an integer-percent value (0...100).
    static func percent(_ value: Double) -> String {
        "\(Int(value.rounded()))%"
    }
}
