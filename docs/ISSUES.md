# Bali v3 — Known issues and how we plan to handle them

A running list of the problems that could genuinely hurt Bali, and the plan for each.
New issues get added as we find them. Plain language on purpose.

---

## 1. The whole school shares one internet address

**The problem.** On school Wi-Fi, all ~600 phones reach the internet through **one shared
address** — like an apartment building where every letter shows the same street address.
Servers normally protect themselves with a rule like "too many requests from one address =
block it, it's probably an attack." At the bell, 600 honest taps arrive from one address in
one minute. A naive rule blocks the entire school at the exact moment everyone needs us.

**The plan.**
- Count request budgets **per signed-in student account**, not per address. 600 students
  tapping once each = everyone comfortably within their own budget. One bad actor flooding
  us hits *their* limit and gets stopped without anyone else noticing.
- Only trust the account after the sign-in is **verified**. (v2 counted requests by a label
  the phone wrote on itself, without checking it — an attacker could change the label every
  request and get a fresh budget each time, making the limit useless.)
- Requests where nobody is signed in yet (signing in): budget by address, but sized
  generously for "a whole school at once," and slow requests down before ever blocking
  them.
- Phones retry with a small random delay, so even a server hiccup doesn't cause everyone
  to retry in lockstep and pile the crowd back up.

**Done when:** a simulated school — hundreds of accounts behind one address — can all tap
in the same minute with zero blocks, while a single flooding account still gets stopped.

## 2. An emergency unlock record must never be lost

**The problem.** Emergency Unlock means shields drop immediately, no permission needed.
The deal that makes that freedom okay: it's always allowed, but it's **always recorded**.
If a record can silently vanish, the button becomes a secret off-switch and every report
we show a teacher is untrustworthy. v2 really did this: a student removed from class
mid-session hit Emergency Unlock; the server answered "you're not in this class," and the
app threw the record away. Unshielded phone, zero trace, nobody ever knew.

**The plan.**
- The phone **saves the record to its own storage first**, before telling anyone — like
  writing it in a notebook before mailing the letter.
- The phone retries sending — minutes, hours, days if needed — until the server confirms
  "saved for real." Only then does it cross the record out of its notebook.
- The server **never throws an unlock record away**, even in weird situations. Removed
  from the class? Session already over? It gets recorded with a note attached. No server
  reply may ever mean "delete this."
- Every record carries a unique ID, so retries and double-sends count once, never twice.

**Done when:** killing the Wi-Fi mid-unlock, force-quitting the app, and the
"removed from class" case all still end with the record visible to the teacher.

**Status (Phase 2 — server half done):** the transition engine's `unlock` now
always commits the event. A live participation flips to `unlocked` as before —
unless its protection is off, which an unlock never softens: the unlock is then
recorded with the note `protection_off` and the state left alone (Phase 3, A2) — or
unless the student's own refocus or tap there came after it: a late unlock, stuck on the
phone while that return went ahead of it, is recorded with the note `superseded` and
the state left alone too (Phase 3, A10).
With no live participation to flip, the event is still written with a
`payload.recorded_as` note —
`no_live_participation` (removed from the class mid-session), `after_session_end`
(the session is already over), `unknown_session` (an unrecognized session id,
recorded as an orphan event), or `not_enrolled` (a caller with no participation
row here and no active enrollment in the class — recorded as an orphan too, so a
stranger who merely knows a session id cannot write into someone else's history
or live grid) — and the call returns `recorded`, never a refusal that could let
the phone discard the record. The retry side of the contract —
which responses let the phone delete the record versus keep retrying — is the
typed table in `@bali/shared` (`unlockDisposition`), so the Phase 3 iOS outbox
implements against an explicit rule. The phone-side "save first, retry until
confirmed" half lands with iOS (Phase 3). One residual: an `unknown_session`
unlock is durable but, lacking a session/class, shows only in the student's own
history rather than a teacher report — an ops surface for these orphan records is
an API-layer follow-up, bounded meanwhile by the per-account rate limits of #1.

---

## Considered and set aside (so we don't re-argue them)

- **Copying the NFC tag.** Not an issue in our setup: the block belongs to the *teacher* —
  it is not stuck on desks — so students never get quiet access to clone it. Revisit only
  if a tap ever needs to prove physical presence (attendance-style claims).
- **Bell-minute load testing.** Real, but it's a testing task, not a design issue — it will
  be part of pre-launch testing.
