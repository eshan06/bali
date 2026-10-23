import BaliCore
import Foundation
import Testing

@testable import BaliOutbox

/// A question as `GET /v1/sessions/{id}/presentation` gives one: four answers, `open` or closed,
/// answer `correct` once shown, and the student's own `answer`, if any, under `eventId`.
private func question(
    open: Bool = true, correct: Int? = nil, answer: Int? = nil, eventId: String = "e1"
) throws -> StudentQuestion {
    let held = answer.map { #"{"option":\#($0),"eventId":"\#(eventId)"}"# } ?? "null"
    return try BaliJSON.makeDecoder().decode(
        StudentQuestion.self,
        from: Data(
            #"{"id":"q","prompt":"Which value of x solves x² − 5x + 6 = 0?","options":["x = 1","x = 2","x = 4","x = 6"],"open":\#(open),"correctOption":\#(correct.map(String.init) ?? "null"),"answer":\#(held)}"#
                .utf8))
}

/// The card for `question`, with the last poll's `problem`, a pick `sending` and what the last
/// one `said`.
private func card(
    _ question: StudentQuestion, problem: PollProblem? = nil, sending: Int? = nil,
    said: AnswerCard.Said? = nil
) -> AnswerCard {
    AnswerCard(question, problem: problem, sending: sending, said: said)
}

/// The engine's truth standing `standing`, with `GET /v1/me` listing class p3's running session
/// `live`, ending `endsAt` seconds after `t0`, and class p5 in none.
private func listing(_ standing: Standing, live: String = "live", endsAt: TimeInterval = 3000) throws
    -> SyncState
{
    var state = SyncState()
    state.standing = standing
    state.me = try BaliJSON.makeDecoder().decode(
        MeResponse.self,
        from: Data(
            #"{"user":{"id":"ana","role":"student","displayName":"Ana"},"classes":[{"id":"p5","name":"Period 5"},{"id":"p3","name":"Period 3","liveSession":{"id":"\#(live)","endsAt":"\#(iso(at(endsAt)))"}}],"session":null}"#
                .utf8))
    return state
}

@Suite("A live lesson on the phone (L8)")
struct LessonTests {
    @Test(
        "The lesson followed: the session the phone stands in, else the first class in session by `GET /v1/me`, tapped in or not — each only while its bell is ahead by the phone's clock, and never one a read said is over"
    )
    func lessonSession() throws {
        #expect(try listing(.out).lessonSession(at: t0, over: []) == "live")
        #expect(try listing(.waiting).lessonSession(at: t0, over: []) == "live")
        // In a session, that one, whatever its state.
        for state in [ParticipationState.focused, .unlocked, .protectionOff] {
            let standing = try listing(.inSession(session("tapped"), state))
            #expect(standing.lessonSession(at: t0, over: []) == "tapped", "\(state)")
        }
        // Its bell rung by the phone's clock, or said over: the class in session instead.
        let rung = try listing(.inSession(session("tapped", endsAt: 60), .focused))
        #expect(rung.lessonSession(at: at(61), over: []) == "live")
        let tapped = try listing(.inSession(session("tapped"), .focused))
        #expect(tapped.lessonSession(at: t0, over: ["tapped"]) == "live")
        // None running: none.
        #expect(try listing(.out, endsAt: 60).lessonSession(at: at(60), over: []) == nil)
        #expect(try listing(.out).lessonSession(at: t0, over: ["live"]) == nil)
        #expect(SyncState().lessonSession(at: t0, over: []) == nil)
    }

    @Test(
        "An open question, as the canvas draws it: nothing picked and Tap an answer; a tap on its way picked and Sending; the answer Bali holds picked and Your answer is in — never a mark of the correct answer, which the API sends only once shown"
    )
    func open() throws {
        let fresh = card(try question())
        #expect(fresh.open && fresh.looks == Array(repeating: .open(picked: false), count: 4))
        #expect(fresh.line == "Tap an answer. You can change it until the question closes.")
        #expect(!fresh.alert && !fresh.offline)
        let sending = card(try question(answer: 0), sending: 1)
        #expect(sending.looks == [.open(picked: false), .open(picked: true), .open(picked: false), .open(picked: false)])
        #expect(sending.line == "Sending your answer…" && !sending.alert)
        let answered = card(try question(answer: 1))
        #expect(answered.looks[1] == .open(picked: true) && answered.looks.filter { $0 == .open(picked: true) }.count == 1)
        #expect(answered.line == "Your answer is in. You can change it until the question closes.")
    }

    @Test(
        "What a pick's request said (CardFailed, CardTooLate): taken says nothing, the answer held showing; too late closes the card at once, though the last read says open, and says it wasn't counted; anything else didn't send, in the primary ink with the way on, until Bali holds an answer made since"
    )
    func said() throws {
        let answer = try BaliJSON.makeDecoder().decode(
            StudentAnswer.self, from: Data(#"{"option":2,"eventId":"e2"}"#.utf8))
        #expect(AnswerCard.Said(.answered(answer), held: "e1") == nil)
        #expect(AnswerCard.Said(.questionClosed, held: "e1") == .tooLate)
        let failures: [AnswerResult] = [
            .invalidOption, .eventIdConflict, .accountDeleted, .unreachable(.unreachable),
            .unreachable(.noToken), .refused(status: 500, reason: nil), .refused(status: 429, reason: nil),
        ]
        for failure in failures {
            #expect(AnswerCard.Said(failure, held: "e1") == .failed(held: "e1"), "\(failure)")
        }
        let failed = card(try question(), said: .failed(held: nil))
        #expect(failed.open && failed.alert && !failed.offline)
        #expect(failed.line == "Bali couldn't send your answer. Check your connection and tap it again.")
        // Bali holds an answer made since — the pick landed, its reply lost: it's in.
        let landed = card(try question(answer: 1, eventId: "e2"), said: .failed(held: "e1"))
        #expect(landed.line == "Your answer is in. You can change it until the question closes.")
        #expect(!landed.alert)
        let late = card(try question(answer: 0), said: .tooLate)
        #expect(!late.open && late.alert)
        #expect(late.line == "This question closed before your answer reached Bali, so it wasn't counted.")
        #expect(late.looks == [.closed(right: false, mine: true)] + Array(repeating: .closed(right: false, mine: false), count: 3))
    }

    @Test(
        "The poll's no answer, while the question is open (CardOffline): its own line with its icon, in the primary ink, whatever the problem — a pick's own line said first, and none once the question is closed"
    )
    func offline() throws {
        let problems: [PollProblem] = [
            .unreachable(.unreachable), .rateLimited, .refused(status: 503, reason: nil),
        ]
        for problem in problems {
            let offline = card(try question(), problem: problem)
            #expect(offline.offline && offline.alert, "\(problem)")
            #expect(offline.line == "No connection right now, so Bali can't send your answer. It keeps trying.")
        }
        let failed = card(try question(), problem: .rateLimited, said: .failed(held: nil))
        #expect(!failed.offline && failed.line.hasPrefix("Bali couldn't send your answer."))
        let sending = card(try question(), problem: .rateLimited, sending: 0)
        #expect(!sending.offline && sending.line == "Sending your answer…")
        let closed = card(try question(open: false), problem: .rateLimited)
        #expect(!closed.offline && closed.line == "Your teacher closed this question.")
    }

    @Test(
        "A closed question (CardClosed, FocusRevealed, CardRight, CardNoAnswer): no answer open to a tap; the student's own marked as theirs; once shown, the correct one marked, the student's too where it was theirs; never red, never a count — the teacher's close said, with the answer shown or not; a pick on its way says nothing then"
    )
    func closed() throws {
        let closed = card(try question(open: false, answer: 3))
        #expect(!closed.open && !closed.alert && !closed.offline)
        #expect(closed.looks == Array(repeating: .closed(right: false, mine: false), count: 3) + [.closed(right: false, mine: true)])
        #expect(closed.line == "Your teacher closed this question.")
        let revealed = card(try question(open: false, correct: 1, answer: 3))
        #expect(revealed.looks == [.closed(right: false, mine: false), .closed(right: true, mine: false), .closed(right: false, mine: false), .closed(right: false, mine: true)])
        #expect(revealed.line == "Your teacher closed it and showed the answer.")
        let right = card(try question(open: false, correct: 1, answer: 1))
        #expect(right.looks[1] == .closed(right: true, mine: true))
        let none = card(try question(open: false, correct: 1))
        #expect(none.looks == [.closed(right: false, mine: false), .closed(right: true, mine: false), .closed(right: false, mine: false), .closed(right: false, mine: false)])
        let sending = card(try question(open: false), sending: 2)
        #expect(sending.line == "Your teacher closed this question." && sending.looks[2] == .closed(right: false, mine: false))
    }
}
