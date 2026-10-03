#if DEBUG && os(iOS)
    import Foundation
    import os

    /// PROBE — #144's experiment build ("[experiment — do not merge]"), never merged: which signal,
    /// if any, tells a running Bali its Screen Time access was taken back. Each line goes to the
    /// unified log, subsystem `com.bali.probe`, every message starting "BaliProbe " and the phone's
    /// time to the millisecond, and to a ring of the last `kept` lines in the app group — written by
    /// the app (`AppProbe`), the enforcer and the monitor, shown in the Debug readout's "Probe"
    /// section. Debug builds only.
    public enum Probe {
        static let kept = 40
        private static let logger = Logger(subsystem: "com.bali.probe", category: "probe")
        private static let lock = OSAllocatedUnfairLock()

        /// Logs `message`. In the ring, a heartbeat replaces one just before it, so steady minutes
        /// never push the changes out; the unified log keeps every line.
        public static func log(_ message: String) {
            let line = "BaliProbe \(stamp(Date())) \(message)"
            logger.notice("\(line, privacy: .public)")
            // ponytail: the lock is this process's alone — the app and the monitor writing at the
            // same instant can lose a ring line, never a unified log's.
            lock.withLock {
                guard let shared = UserDefaults(suiteName: Outbox.appGroup) else { return }
                var ring = shared.stringArray(forKey: "probe") ?? []
                if message.hasPrefix("heartbeat"), ring.last?.contains(" heartbeat · ") == true {
                    ring.removeLast()
                }
                ring.append(line)
                shared.set(Array(ring.suffix(kept)), forKey: "probe")
            }
        }

        /// The ring, oldest first.
        public static var ring: [String] {
            UserDefaults(suiteName: Outbox.appGroup)?.stringArray(forKey: "probe") ?? []
        }

        /// `date` in the phone's time zone, to the millisecond: 16:23:36.123.
        static func stamp(_ date: Date) -> String {
            let at = Calendar.current.dateComponents([.hour, .minute, .second, .nanosecond], from: date)
            return String(
                format: "%02d:%02d:%02d.%03d", at.hour ?? 0, at.minute ?? 0, at.second ?? 0,
                (at.nanosecond ?? 0) / 1_000_000)
        }
    }
#endif
