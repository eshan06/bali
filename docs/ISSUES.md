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

**Status: done (Phase 4, L1 and L2b — 2026-10-04): the limits are built, and the simulated school
proved them.**
- Every signed-in request spends its own account's budget, counted only once the sign-in is
  verified (Cognito's `sub`), never its address's: 120 at once, then 120 a minute — 2.4 times
  the busiest honest client, a teacher with five portal tabs open.
- A request with no sign-in, or one Cognito refused, spends its address's budget: 1,200 at
  once, then 600 a minute — a whole school's phones, twice over.
- Guessing a class code: each account gets 20 tries, then 2 a minute; each address gets 100
  wrong codes, then 6 a minute, whichever accounts guess — so free accounts don't add guesses.
- Over a budget, the answer is "too many requests" (`429`) with how many seconds to wait. Phones
  retry on their own; nothing waiting on a phone, an Emergency Unlock included, is ever dropped.
- The address is the one Railway's edge reports (`X-Real-IP`), which a phone can't fake: on dev,
  the edge replaced every one a client sent (checked 2026-10-04).
- **Proven (L2b):** 600 accounts behind one address tapped in within the same minute, their
  teachers' Starts joined them, and each phone then checked in every 30 s, as phones do: 3,366
  requests in three minutes, not one refused, 95% of them answered within 8.5 ms (the gate
  allows 500 ms). At the same address and time, one account asking 50 times a second was
  stopped 2,762 times, each refusal saying when to come back. CI's load gate runs it again on
  every change to the API.
- Numbers and why: `docs/DECISIONS.md`, 2026-10-04 (L1, L2b).

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

**Status: done on hardware (2026-10-01).** On the owner's iPhone against dev (Phase 3's
E1), all three cases ended with the record visible to the teacher:
- **Wi-Fi off mid-unlock** (Airplane Mode): the unlock made at 3:40:07 PM was delivered at
  3:41:41 PM, once the phone was back online.
- **The app force-quit right after an unlock:** made offline at 3:56:43 PM; the relaunched
  app delivered it at 3:57:05 PM.
- **Removed from class mid-session:** an unlock made offline at 4:12:54 PM reached the
  server after the removal (4:13:09 PM) and was recorded with the note
  `no_live_participation`; the teacher saw the student as "left · unlocked".

The phone half — save first, retry until the server confirms — is the iOS app's outbox
(Phase 3).

**Status (Phase 2 — server half done):** the transition engine's `unlock` now
always commits the event. A live participation flips to `unlocked` as before —
unless its protection is off, which an unlock never softens: the unlock is then
recorded with the note `protection_off` and the state left alone (Phase 3, A2) — or
unless the student's own refocus or tap there came after it: a late unlock, stuck on the
phone while that return went ahead of it, is recorded with the note `superseded` and
the state left alone too (Phase 3, A10), whether or not the student is still in the
session. An unlock made while the phone's own tap was unanswered is sent under that tap
and filed in whatever session it landed in — or kept with no session, noted `tap_armed`
or `unknown_tap`, and filed by the tap if the tap arrives after it (Phase 3, A11).
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

## 3. Apple's terms for Screen Time apps may not fit a classroom

**The problem.** Since 2026-03-30, Apple's developer agreement limits apps that use the
Family Controls framework, the one Bali's shields run on (§3.3.3(P); the text of
2026-08-18). The app's primary purpose must be parental controls through Family Sharing,
or "offering individuals the ability to manage their devices to enable focus and
productivity". The framework "may not be used for other purposes, such as ad blocking, in
organizational settings, or for managing the device of another adult individual", and
device or usage data "received through the Family Controls Framework or otherwise" may not
be shared "beyond … the individual and their device". Bali's sessions are started by a
teacher at school, and the teacher's grid shows each student's state, "Screen Time off"
included. A reviewer could read that as both. Apple granted the distribution entitlement on
2026-09-24, after the clause existed: a good sign, not a ruling. External TestFlight builds
are reviewed too, so this can stop the pilot, not only the App Store. And that "or
otherwise" may reach what Bali records itself, not only what the framework hands it.

**What others do (researched 2026-10-04).** Doorman (doorman.school), the closest
competitor, mostly avoids the framework. Its Focus Mode "installs a secure and private VPN
profile, specific to your school" and blocks traffic at the network level: App Review
guideline 5.4's rules, not §3.3.3(P)'s, but a weaker lock (SMS gets through; a student can
switch the VPN off, which its dashboard shows as "Disconnected"). Its 2026 Lockdown Mode
"uses Apple's built-in on-device frameworks", unnamed. Its teachers still see live
per-student status and every bypass. Screen Time apps with per-student school dashboards
are live after the clause (Opal for Schools, Lockup, LockedIn, Yondr's tap-to-lock app), and
none has been reported removed or rejected under it; but Apple has pulled a category
before (parental-control apps, 2018–19), and it answers such questions only in App Review
consultations.

**The plan.**
- The owner asks App Review before the first external build (an App Review consultation),
  describing Bali as it is: the student installs it, grants Screen Time access to
  themselves, taps in, and holds the exit; the teacher sees what the app records.
- Fallback designs, settled with the owner before the answer comes, best fit first:
  school-owned devices under MDM (sanctioned, but never a student's own phone); a network
  filter like Doorman's, which is the local VPN filter ARCHITECTURE already parks as a second
  enforcement layer (iOS app structure, "Decided later, on purpose"), here made the only one:
  outside the framework, weaker, and an ARCHITECTURE change; Family Controls as a purely
  personal tool, no lock state leaving the phone. A grid showing only what Bali itself
  records may not be enough alone, because of "or otherwise".
- Phase 6 gates on it.

**Done when:** Apple's answer is on record, and the design matches it.

## 4. Phone bans at school

**The problem.** By March 2026, 33 states restricted students' phones at school. Texas
(HB 1481) has districts forbid personal devices for the whole school day; Oklahoma and
Arkansas ban them bell to bell; Kansas requires them stored away; Illinois starts in
2027–28. Tapping in is using the phone.

**Where the pilots are (owner, 2026-10-04).** The first pilot is preliminary and
unofficial: one professor's class at Vanderbilt University in Nashville (US Central, so
the deploy's `TZ` stays America/Chicago), with adult students on their own phones. There
is no school or district phone policy and no data agreement yet, and the states' K-12
phone laws don't apply to a university class of adults. The likely later K-12 pilot is in
Los Angeles or New Jersey; phones are still assumed to be the students' own.

**The plan.** Before the K-12 pilot, the owner confirms its state and the school's phone
policy, and the school's lawyer clears Bali against that state's law. For the lawyer then:
- **California:** SOPIPA (student online privacy), AB 1584's terms for a district's
  contract with a vendor holding pupil records, and the Phone-Free Schools Act (each
  district limits phones on campus by July 2026).
- **New Jersey:** its student-privacy rules (the state's student records regulations and
  any data agreement the district requires), and its 2025 law requiring districts to
  adopt a policy restricting phones during the school day.

**Done when:** the K-12 school confirms in writing that its policy allows Bali.

## 5. Deleting data, and "an unlock record is never lost"

**The problem.** The App Store requires that an account made in the app can be deleted in
the app (guideline 5.1.1(v)); a school's data agreement requires its data disposed of on
request; FERPA lets parents inspect a student's record; COPPA, once under-13 comes,
requires a written retention policy. Bali's architecture says nothing is ever truly
deleted (data-model decision 3), and ISSUES #2 says an unlock record is never lost.

**The plan.**
- "Never lost" keeps its meaning on the way from the phone to the server, which is what
  the unlock contract promises: no response ever means "discard".
- Records leave only through three doors: the student deleting their account, the
  school's written request, and a published retention schedule. Each deletion is logged
  without personal data, and none happens while a parent's inspection request is open.
- The owner ruled (2026-10-04, `docs/DECISIONS.md`): named records are kept through the
  school year, then de-identified, and aggregates stay (C6b); a student's in-app account
  deletion de-identifies their events and deletes the account, name and sign-in (C3).
  ARCHITECTURE's data-model decision 3 is amended (C3 landed 2026-10-04: the deletion
  is recorded as an `account_deleted` event naming no one); Phase 6 C4–C6 build the rest.

- A parent's inspection request (FERPA) is answered with the student's whole record by the
  owner's `npm run school -- export-student` (C5, landed 2026-10-04); while one is open the
  owner holds every disposal of that student's data (`docs/RUNBOOKS.md`, runbook 1, step 10).

- A school's written request is answered by the owner's `npm run school -- dispose` (C6a,
  landed 2026-10-05): its people de-identified as C3 leaves an account, its classes, blocks,
  open invites and pre-bell taps removed, logged as a `school_disposed` event of counts
  (`docs/RUNBOOKS.md`, runbook 1, step 11).

- The retention schedule (C6b, landed 2026-10-05): the owner records each school's year
  end (`npm run school -- year-end`); after it, `npm run school -- retention` de-identifies
  everyone whose records all lie in that year, kept counts and all, logged as a
  `retention_applied` event of counts naming no one (`docs/RUNBOOKS.md`, runbook 1, step 12).

**Done when:** the owner's policy is written, and C3–C6 have landed (C3, C5 and C6 have;
C4, the phone's Delete account, is next).

---

## Considered and set aside (so we don't re-argue them)

- **Copying the NFC tag.** Not an issue in our setup: the block belongs to the *teacher* —
  it is not stuck on desks — so students never get quiet access to clone it. Revisit only
  if a tap ever needs to prove physical presence (attendance-style claims).
- **Bell-minute load testing.** Real, but it's a testing task, not a design issue — it will
  be part of pre-launch testing.
