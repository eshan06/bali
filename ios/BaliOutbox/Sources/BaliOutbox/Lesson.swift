import BaliCore
import Foundation

// A live lesson on the phone (L8; ARCHITECTURE, "Live lesson", decisions 1, 2, 5, 11): which
// session's lesson it follows, and what the answer card says, in the approved app canvas's words.

extension SyncState {
    /// The running session whose lesson the phone follows at `now` by its own clock: the one it
    /// stands in, else the first class in session by `GET /v1/me`, tapped in or not (decision 2);
    /// never one of `over`, a read having said it is over.
    public func lessonSession(at now: Date, over: Set<String>) -> String? {
        var running = (me?.classes ?? []).compactMap(\.liveSession).map { ($0.id, $0.endsAt) }
        if case .inSession(let session, _) = standing { running.insert((session.id, session.endsAt), at: 0) }
        return running.first { $0.1 > now && !over.contains($0.0) }?.0
    }

    /// The class of the lesson the phone follows at `now` (`lessonSession`), headed as a session's
    /// screens head theirs: its name, and under it its teacher and bell — the line over the card and
    /// the slide on the Screen Time ask (M8b; the app canvas's ScreenTimeAskQuestion, Unlocked's top
    /// line). Nil with no lesson to follow, or a class `GET /v1/me` doesn't name.
    public func lessonHeading(
        at now: Date, over: Set<String>, time: Date.FormatStyle = .init(date: .omitted, time: .shortened)
    ) -> (title: String, subtitle: String)? {
        var sessions = (me?.classes ?? []).compactMap { row in
            row.liveSession.map { SessionView(id: $0.id, classId: row.id, endsAt: $0.endsAt) }
        }
        if case .inSession(let session, _) = standing { sessions.insert(session, at: 0) }
        let id = lessonSession(at: now, over: over)
        guard let session = sessions.first(where: { $0.id == id }) else { return nil }
        let heading = heading(session, time)
        return heading.title.map { ($0, heading.subtitle) }
    }
}

/// The answer card as the canvas draws it, state by state (L8): each answer's look and the line
/// under them. A tap answers and another changes it until the close; closed, the correct answer is
/// marked once shown and the student's own as Your answer, never red; no count ever.
public struct AnswerCard: Sendable, Hashable {
    /// An answer open to a tap, `picked` — the one on its way, else the one Bali holds — or closed:
    /// `right`, the correct one once shown, and `mine`, the student's own.
    public enum Look: Sendable, Hashable {
        case open(picked: Bool)
        case closed(right: Bool, mine: Bool)
    }

    /// What the last pick's request said, other than taken: too late (`409 question_closed`), or
    /// that it didn't send, with the answer Bali held as it was made.
    public enum Said: Sendable, Hashable {
        case tooLate
        case failed(held: String?)

        /// `result` for the card: nil once taken, the answer held then showing; else as above.
        public init?(_ result: AnswerResult, held: String?) {
            switch result {
            case .answered: return nil
            case .questionClosed: self = .tooLate
            default: self = .failed(held: held)
            }
        }
    }

    public let question: StudentQuestion
    /// Open until a read says it closed, or Bali said the last pick came too late.
    public let open: Bool
    public let looks: [Look]
    /// The line under the answers; `alert`, in the primary ink: something didn't go; `offline`, the
    /// poll's no answer, drawn with its icon (CardOffline).
    public let line: String
    public let alert: Bool, offline: Bool

    /// `question` as the last read shows it, with `problem`, the last poll's, and the pick on its
    /// way, `sending`, and what the last one said, both the card's own on this phone.
    public init(_ question: StudentQuestion, problem: PollProblem?, sending: Int?, said: Said?) {
        self.question = question
        open = question.open && said != .tooLate
        // A pick that didn't send is no news once Bali holds an answer made since: it landed, its
        // reply lost, or one from another device stands.
        let failed = if case .failed(let held) = said { held == question.answer?.eventId } else { false }
        let picked = sending ?? question.answer?.option
        looks = question.options.indices.map { [open] index in
            open
                ? .open(picked: index == picked)
                : .closed(right: index == question.correctOption, mine: index == question.answer?.option)
        }
        (line, alert, offline) =
            if !open {
                said == .tooLate
                    ? ("This question closed before your answer reached Bali, so it wasn't counted.", true, false)
                    : question.correctOption == nil
                        ? ("Your teacher closed this question.", false, false)
                        : ("Your teacher closed it and showed the answer.", false, false)
            } else if sending != nil {
                ("Sending your answer…", false, false)
            } else if failed {
                ("Bali couldn't send your answer. Check your connection and tap it again.", true, false)
            } else if problem != nil {
                ("No connection right now, so Bali can't send your answer. It keeps trying.", true, true)
            } else if question.answer != nil {
                ("Your answer is in. You can change it until the question closes.", false, false)
            } else {
                ("Tap an answer. You can change it until the question closes.", false, false)
            }
    }
}
