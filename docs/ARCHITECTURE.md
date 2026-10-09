# Bali v3 — Architecture

Decisions live here. Changing one means discussing it first.

## What Bali is

A teacher taps their Bali block (an NFC tag) to start a timed focus session for the class.
Each student's iPhone locks itself for the session using Screen Time shields — every app a
third-party app can block is blocked, and there is no allow-list for the student to pick
(ruled 2026-09-24). iOS itself keeps calls, FaceTime, Messages and Emergency SOS working.
The teacher sees a live grid of who's focused. Afterward: reports, including every
emergency unlock.

v3 is a from-scratch rebuild. The v2 code and its bug audit live on the `v2-archive` branch.

## How a tap works

Decided 2026-09-15: **direct database writes + local-first phone.** (A message queue in the
middle was considered and rejected — see below.)

**Step 1 — on the phone, instantly, no internet required:**
1. The app reads the tag's ID over NFC.
2. It writes a tap record to local storage (a small database on the phone itself):
   `{event_id, tag_id, timestamp}` — `event_id` is a random unique ID the phone generates.
3. It turns on the Screen Time shields.
4. The student sees "You're in" — total time under a second, even with zero signal.

**Step 2 — in the background, whenever there's internet:**
5. The app sends the record to the API: `POST /taps` (an HTTP request carrying that same
   JSON).
6. If the request fails, the app retries with exponential backoff plus jitter — wait 2s,
   4s, 8s… with a random extra delay so 600 phones never retry in unison. The record stays
   in local storage until a retry succeeds.

**Step 3 — on the server:**
7. Verify the student's auth token, and that the tag belongs to a class they're enrolled in.
8. Check the timestamp against the server's own clock; anything outside the session's
   window gets clamped to it (see rule 1).
9. `INSERT` one row into the `taps` table. If a row with that `event_id` already exists —
   a retry — do nothing, and answer it as step 10 says. This makes retries safe to repeat
   (idempotency). An `event_id` already recorded in `events` for a *different* event —
   another student's, or another kind of event — is not a retry but a client bug, and gets
   `409` instead: a `200` would tell the phone to delete a record the server never kept.
   On the arm path (decision 5, nothing joinable running) the same goes for this
   student's tap recorded under another teacher — and on the join path too, once that
   tap is no longer current (step 10) — and for an id already held by a waiting tap that
   is not this student's for this teacher. Blocks cannot move yet; the endpoint that lets
   them must revisit the other-teacher case, because after a move an honest retry looks
   exactly like it.
10. Respond `200 OK`. Only now does the phone delete the record from local storage. The
    retry of a tap that already landed gets that `200` with what was recorded — even when
    the server now resolves the tag to a different running session — but it names that
    session only while it is still true: the participation live, its session running.
    Once that session has ended or the student has left it (switched away, left or was
    removed from the class), the retry is answered `replay` with no session (ruled
    2026-09-24, replacing 2026-09-22's `409`): recorded, with no window to shield to, so
    the phone deletes it and re-reads the truth — a `200` naming the old session would
    keep a backgrounded phone shielded to a window that is over. The retry of a tap still
    waiting for Start (decision 5) is answered `already_armed`, so the phone keeps showing
    "waiting for your teacher". The phone keeps a `409`'s record and keeps retrying it,
    and shows it (rule 5) while re-reading the truth; the typed table is `tapDisposition`
    in `@bali/shared`.
11. Insert an event row so the teacher's live grid updates (see rule 6).

**Why there's no queue between the API and the database.** A queue (usually Redis — a
database that keeps everything in RAM: very fast, but wiped by a crash) would change the
flow to: tap goes into the queue → API replies `200 OK` → a worker writes it to Postgres
moments later. The danger is that gap: the phone deletes its local copy at `200 OK`
(step 10), so a queue crash inside the gap silently destroys the last copy of the tap.
That risk is only worth it when the database can't keep up — ours can (a school at the
bell ≈ a few hundred INSERTs over a minute; Postgres does thousands per second). If that
ever changes, a queue slots in at step 9 without touching the rest of the flow.

## Data model

This section decides what Bali remembers. Everything the product knows lives in tables in
Postgres. A table is like a spreadsheet: each row is one record, each column is one fact
about that record. Every screen in the app is just a read of these tables — if a fact was
never stored here, no screen can ever show it.

### The tables

- `users` — one row per teacher or student, with a `role` column saying which.
- `schools` — one row per school, so users and classes can be grouped under one, with the
  day its data agreement was signed (none on record: no teacher invite is minted for it).
- `blocks` — one row per physical Bali block: the ID its NFC tag broadcasts, and which
  teacher owns it.
- `classes` — one row per class. Each class belongs to a teacher and a school.
- `enrollments` — one row saying "this student is in this class." (Connecting students to
  classes needs its own table because a student has many classes and a class has many
  students.)
- `sessions` — one row per focus session: which class, when it started, when it ends.
- `participations` — one row saying "this student is part of this session, and here is
  their state right now" (focused, unlocked, and so on). The row is overwritten as the
  student's state changes.
- `events` — one row for every single thing that happens: a tap-in, an emergency unlock, a
  refocus. Rows here are only ever added, never changed — this table is the permanent
  history.
- `armed_taps` — one row per tap made before a session was running (decision 5): saved as
  student + teacher and waiting. When the teacher presses Start, each becomes a
  participation unless its tap had already landed, or a later tap of the student's went
  ahead of it (A14); it expires at the end of the school day. Transient — not the
  permanent history that lives in `events`.
- `teacher_invites` — one row per invite code the owner mints for a school (Phase 4, T1a):
  the code's hash, never the code, its expiry 14 days on, and the one account that redeemed
  it, once (T1b) — after which the row is never changed or deleted.
- `age_checks` — one row per account that confirmed it is 13 or older (C7-server, 2026-10-08):
  the request's `event_id` and when the server recorded it, never a birth date or an age, and none
  for an answer under 13, which the phone never sends. Never unset: it goes only with the account
  (C3, C6a, C6b), and is in the student's export (C5).
- `questions`, `responses`, `decks`, `session_presentations` — a live lesson's questions,
  each student's answer now, the teacher's PDF decks and the slide a session shows (Phase 7;
  "Live lesson", decision 4). Written only by the transition engine, except `decks.object_deleted_at`,
  which the API stamps after the commit once it has deleted the object (or the sweep, for a
  leftover); an answer never writes to `events`.

### The decisions (2026-09-15)

**1. The current picture and the history are two different tables, always updated
together.** "Who is focused right now" is answered by the `participations` table in one
cheap read. "What happened during this session" is answered by the `events` table, whose
rows are never overwritten. Whenever a student's state changes, the server updates their
`participations` row and adds an `events` row inside one transaction — a database feature
meaning both writes happen or neither does — so the two tables can never disagree. One
shared function performs every state change; no other code is allowed to touch these
tables. The reason for the strictness: v2's most common bug was the same fact stored in
two places drifting apart, like the teacher's screen saying "No device" while the
student's phone said "Focused." This structure makes that impossible.

**2. Every row's ID is a UUIDv7.** An ID is a row's permanent, unique name — what other
tables and API requests use to point at it. UUIDv7 is an ID format that a phone can
generate by itself with no internet (needed for offline taps), that can't be guessed from
a URL, and that begins with a timestamp, which keeps the database's lookup structures
fast.

**3. Nothing is truly deleted; it is marked as removed.** Removing a student from a class
sets a `removed_at` date on their `enrollments` row instead of deleting the row. History
stays answerable ("who was in this class in March?") and nothing pointing at the row
breaks; screens simply skip rows where `removed_at` is set — except a session's live grid,
which keeps a student removed from the class mid-session who was in that session (a
participation or an unlock there), so their unlock stays visible (ruled 2026-09-24, A9).
Really deleting the row is exactly how v2 stranded a student in a locked session with no
way out.
*Amended 2026-10-04 (C3, the owner's ruling; ISSUES #5):* an account can delete itself
(`DELETE /v1/me`, App Store 5.1.1(v)). Through the engine, in one transaction: each class is
left as a leave leaves it, in session too; the `users` row stays, so every event of theirs
still counts in its class's reports, but it loses its name and its Cognito subject and is
marked removed; a tap of theirs still waiting for a Start is consumed; a rename's payload, the
one place an event carried their name, is emptied
(the one rewrite of `events` the database allows, migration 0015); and an `account_deleted`
event with no personal data records it. So the history stays answerable in counts and
names no one. A teacher with a class or a block is refused: that account goes through the
school. "Never lost" keeps its meaning from the phone to the server — the phone sends its
outbox before it deletes (C4).

**4. A student can be in only one session at a time.** If a student in one session taps
into another, their first participation is ended and recorded in the `events` table as
`left_for_other_session` — its own kind of event, so switching classes is never counted
as an emergency unlock in any report. A tap the phone made before a later tap of its own
into another session switches nothing when it lands after it (A14; rule 1's order).

**5. A tap before the teacher has started is saved and waits — an "armed" tap.** It's
7:58, the bell hasn't rung, and a student taps the block walking to their seat — no
session exists yet. Rejecting the tap punishes normal behavior; shielding now locks the
phone before class starts. So the server just saves "this student tapped this teacher's
block" and the phone shows "Ready, waiting for your teacher." When the teacher presses
Start, every waiting tap becomes a participation and those phones shield — nobody taps
twice. Two exceptions. A tap that was already honoured (ruled 2026-09-22): a waiting tap
whose `event_id` is already recorded as that student's own `tap_in` is the retry of a tap
that landed in another session, and joining it would shield the student in a session they
never tapped into. It is consumed without joining and recorded as an `armed_tap_skipped`
event in the session that declined it, so the history says why that student is not there.
And a tap a later one went ahead of (ruled 2026-09-25, A14): a waiting tap older, by the
phone's order, than a tap of the student's since recorded in another session — converting
it would switch them back out of where that later tap put them. It is consumed without
joining and recorded in the session that declined it as its `tap_in`, noted `superseded`;
a tap that would only arm once such a later tap is recorded never waits at all. It's saved
as student + teacher, since one block serves all of a teacher's classes and the class is
only knowable once a session starts. It expires at the end of the school day, and the phone
stops waiting with it (#166): `GET /v1/me` says whether a tap of the student's still waits for a
Start that would join them, and offline the phone's own clock ends the wait at that day's end.
"Waiting" is never shown where no Start would lock the phone.

**6. Sessions end themselves.** The phone knows the session's end time, so it removes the
shields at that moment using its own clock, even with no internet. On the server, a small
scheduled program marks the session and its participations as ended and adds a
`session_expired` event. If the teacher adds time, that is recorded as its own
`session_extended` event, so reports show exactly what happened. Time is added only before
the bell by the server's clock: past it, the phones have let go, so the session is over even
before the sweep marks it, and an extend is refused as one for a session already ended (ruled
2026-09-30). The teacher starts a new one instead: a Start past the old one's bell ends it as
the sweep would and starts the new one in the same request (A18, ruled 2026-09-30), so
back-to-back classes never wait for the sweep. Nor does anyone join a
session past its bell, or return to focus in it (A17 — one rule for all three): a tap then arms
for the teacher's next Start, as when nothing runs, and a refocus is refused as after the sweep.
What a phone reports there — an unlock, protection off — is recorded by its own rules.

**7. The every-30-seconds "still here" message only updates one column — it never adds
history rows.** During a session, each app tells the server every ~30 seconds: "still
here, shields still on." That's useful — it's how we notice a phone going silent — but
nothing *changed*, so it isn't history. The server just overwrites `last_seen_at` on that
student's `participations` row with the time the *server* heard from the phone. The `events` table gets a row only when something really
changes: tapped in, unlocked, went silent, came back. Otherwise a 1,000-student school
would add ~720,000 useless rows a day to the table every screen reads. The "went
silent" / "came back" pair is server-minted, not sent by the phone: the per-minute
sweep opens an episode by stamping a `silent_since` marker on the row (emitting one
`went_silent`) once a focused phone passes the 90-second threshold, and the next
check-in clears the marker (emitting one `came_back`). That marker exists only to make
the pair fire exactly once per episode — a grid still derives the live "silent" badge
from `last_seen_at` (rule 2), never from the column.

### Rules that keep the data honest

- **The database itself refuses duplicates.** Every event carries an `event_id` made by
  the phone, and the `events` table has a unique constraint on that column — a rule the
  database enforces during the write itself. If the same tap arrives twice (a retry, or
  two servers handling it at once), one insert wins and the other is refused, no matter
  how the timing falls. Our code never has to win a race.
- **A screen that reconnects asks for a little more than it missed.** Live screens
  receive events by number and remember the last one they got — say 480. The timing
  quirk: an event's number is handed out when its write starts, but the row only appears
  when the write finishes, so a slow 481 can show up *after* a fast 482. A screen that
  asked "everything after 482" would then never see 481 — one event skipped forever, with
  no error anywhere. So on reconnect the screen asks from slightly before its remembered
  number and throws away rows it already has (it recognizes them by `event_id`).
  Receiving an event twice costs nothing; silently missing one is how a teacher's grid
  loses an emergency unlock.
- **Changes that touch several tables happen in one transaction.** Removing a student
  mid-session must update the enrollment, end the participation, and record the events —
  all together or not at all. A halfway-done removal is exactly the v2 bug that left a
  phone locked while refusing to record its emergency unlock.
- **One class can't have two sessions running.** The `sessions` table has a rule for this
  (a partial unique index — uniqueness that applies only to rows not yet ended), so a
  teacher who starts a session twice, from a phone and a laptop at once, gets the
  already-running session back instead of a duplicate.

### Decided later, on purpose

- The retention schedule (ISSUES #5) is decided (C6b, 2026-10-05): each school's year end
  is a day the owner records; after it, the owner's retention run de-identifies, as an
  account deletion does, everyone whose records all lie on or before it (anyone with a later
  record, at another school, or a teacher with a live class or block is kept named), logged
  as a `retention_applied` event of counts; lessons and their history stay. A student's own
  deletion is decided (decision 3's amendment), and so is a school's written request to
  dispose of its data
  (C6a, 2026-10-04): every person of the school de-identified as an account deletion leaves
  one, its classes, blocks, open invites and pre-bell taps removed, the school marked
  removed, and a `school_disposed` event of counts naming no one; its lessons and their
  history stay, naming no one.

## Auth

This section decides how the server knows who it's talking to. Signing in proves who you
are; what you're allowed to do is then checked against our tables — a teacher can end a
session, a student can't, a stranger can do nothing. Every flow in this document starts
with this check.

### The decisions (2026-09-16)

**1. Sign-in is run by AWS Cognito, not by us.** Cognito is Amazon's managed sign-in
service: it stores the passwords, runs "Sign in with Google," handles resets, and hands
the app a token after a successful sign-in. We chose it because our users include
minors — password security should be a giant company's liability, not a solo
developer's — and because it's free until 50,000 monthly users and already proven in v2
(v2's auth bugs were in our code around Cognito, not in Cognito). If its clunkiness
becomes real pain during the iOS build, the named fallback is Clerk.

**2. Every request carries a JWT — a signed identity note.** The server doesn't remember
anyone between requests, so each request must say who it's from without re-sending a
password. At sign-in, Cognito gives the app a JWT: a small note saying "this is user
82f3, valid until 3:00," signed so that changing a single character breaks the
signature. The app attaches it to every request, and any of our servers verifies the
signature with math alone — no database lookup — which matters when every student's
phone checks in every 30 seconds. A JWT can't be taken back early, so it expires after
about an hour and a refresh token quietly fetches the next one; a student signs in
roughly once on each install of the app (a reinstall starts signed out: rules, below). Our
`users` table stores each row's Cognito ID, linking "who Cognito says this is" to our data
about them.

**3. Students join a class with a join code.** The teacher's class screen shows a short
code; a student types it in once, and the server creates their `enrollments` row. No
email invites, no setup. Importing whole rosters (CSV or Google Classroom) is a later
feature, built when a school asks for it. The code is server-generated from an
unambiguous alphabet (no `0`/`O`, `1`/`I`/`L`) and unique among *live* classes only, so
an archived class never reserves its code forever; a teacher can regenerate it (`PATCH
/v1/classes/{id}`), which invalidates the old one immediately.

### Rules that keep auth honest

- **Only a real "no" signs anyone out.** A timeout or server error is not proof that a
  sign-in is invalid — the app keeps the session and shows "can't reach the server —
  retry." Only a definitive `401 Unauthorized` (Cognito rejecting the token) ends a
  session. v2 got this wrong: one network blip signed the teacher out into a login page
  that then rejected their correct password.
- **A reinstall starts signed out** (the owner's ruling, 2026-10-08, found on TestFlight
  build 8). iOS keeps the Keychain, where the phone keeps its sign-in, after an app is
  deleted, while it deletes the app's own files and its app group's: a reinstall opened
  signed in as whoever used the deleted copy, and asked them the 13+ question first. So an
  install's first start forgets that sign-in, on the phone alone, before any screen reads
  it: a fresh install, a reinstall and a new phone all open on Sign up or sign in, and an
  update keeps its sign-in. The phone tells the two apart by its outbox file in the app
  group, which every build makes at its start before any sign-in, and an update keeps:
  with none there, nothing in the Keychain is this install's.
- **A saved emergency unlock outlives an expired token.** If a student's token expired
  while they were offline, the app refreshes the token first and then sends the queued
  record. An auth problem is never a reason to throw a record away.
- **Sign-in limits are sized for a school.** Sign-in happens before we know who's asking,
  so it's limited by internet address — with budgets sized for a whole school behind one
  address, slowing requests down before ever blocking them (ISSUES.md #1).
- **Under 13: not yet.** Accounts for young students carry legal requirements (parental
  consent). *Decided 2026-10-04 (C7, the owner's ruling; built 2026-10-05):* 13+ is the
  school's agreement plus a neutral in-app age screen — shown when the student taps Sign up,
  before the intro and Cognito's sign-up page (the
  approved Sign in & sign up design, built 2026-10-07; at Sign in from 2026-10-06, a first
  launch's first screen before that), asking the birth month and year by the FTC's
  COPPA guidance — that keeps "passed" on the
  phone when the answer is 13 or older (never the date; per account since 2026-10-07, below) and
  nothing at all when it is not: the
  student sees a stop screen, and the server never learns the question was asked. Under-13
  consent itself stays a later decision, for the K-12 pilot.
  *Amended 2026-10-07 (the owner's decision of 2026-10-06, the gap's fallback):* Cognito's own
  sign-in page links to its sign-up, and the classic hosted UI cannot hide that link for the app
  alone, so an account can be made around the question. A sign-in that comes back to a phone that
  has not passed the check gets the question first, and the sign-in gives Bali's API no token
  until it is answered. 13 or older carries on as after any sign-in. Under 13 deletes the account
  by Delete account's own steps (C4): what the phone queued goes first, every Emergency Unlock
  first, and one the server has not recorded holds the deletion back, never let go; then `DELETE
  /v1/me`, then Cognito's DeleteUser; then the outbox lets go of the rest, so nothing is ever
  filed under whoever signs in next, whose account is always another (amended 2026-10-07, Claude
  Review). With nothing queued, as a sign-up made around the question comes back, the server
  never sees the account: `DELETE /v1/me` looks its caller up and creates no one. A record queued
  under a sign-in the server never saw makes the account as it lands, and the deletion
  de-identifies it a moment later, as C3 de-identifies any. An existing student on a new phone
  answers it once.
  *Amended 2026-10-07 (the owner's rulings; the approved design's version 8): the question per
  account* (where the phone kept "passed", superseded 2026-10-08, below). Every Sign up asks it, a
  second in the same run too, since no account exists yet to
  have passed it and a second person must never sign up unasked. The phone keeps "passed" per
  account, the Cognito ids (`sub`) of the accounts that passed on it, never the date: a Sign up's
  answer files the account its page signs in as the sign-in lands, before Bali's API gets its
  token, and an answer after a sign-in files that account. A sign-in skips the question only for an
  account that passed on this phone; any other — another student on a shared phone, an existing
  student on a new phone, an account made around the question — is asked by the fallback above.
  The single phone-wide flag builds before kept vouches for no account.
  *Amended 2026-10-08 (the owner's decision, C7-server): the yes kept per account, on the server.*
  So that Sign up or sign in can always be the app's first screen and a student is never asked
  again on a new phone or after a reinstall, the server keeps, per account, only that the account
  confirmed 13 or older, never the date or an age: recorded by `PUT /v1/me/age-check`, read by
  `GET /v1/me/age-check` (API surface). The read makes no account. The app asks it right after a
  sign-in, one made through Cognito's own sign-up link too, before the question; an account the
  server has no row for reads not passed, so an under-13 leaves no record in Bali. A teacher's
  account always reads passed and records nothing: it comes from the school's invite, and the app
  asks before it knows the role. Once recorded, the yes is never unset; it goes only with the
  account (C3, C6a, C6b). **The app reads and records the server's yes; the phone keeps none**
  (built 2026-10-08). Right after a sign-in not yet through the check, the app reads it, the one
  Bali call a sign-in makes before its age is settled, the starting mark meanwhile: passed, it goes
  on; not passed, or the server not reached (the safe side, no screen of its own), the question. A
  Sign up's answer of 13 or older, or the question's after a sign-in, is recorded by `PUT`, kept
  with the sign-in until the server answers it, sent at the engine's wakes and never during an
  account deletion; under 13 sends nothing. What the phone holds is the sign-in's own: whether it is
  through the check, and a yes not yet sent, in the Keychain with its tokens, so a relaunch neither
  asks the server again nor holds a record back, and both go with the sign-in (Sign out, a
  reinstall). Build 8's per-account list is read once: a yes it holds for the account signed in is
  kept to send, then the list is deleted, whoever is signed in.

## API surface

The API is the server's front door: the complete list of requests the apps are allowed
to make. Each entry is an endpoint — a URL plus a verb, with JSON going in and out
(`GET /v1/me` reads who you are; `POST /v1/taps` records a tap). The apps can only do
what an endpoint permits. Two facts drive everything here: every endpoint is a promise
to shipped apps (iPhones update slowly, so old app versions will call us for months),
and every endpoint is attack surface — a small, boring list is the security strategy.

### The decisions (2026-09-16)

**1. The style is REST.** Resource-shaped URLs with standard verbs, as above. Boring,
universal, easy to rate-limit, and a log line reads like a sentence. GraphQL (one
endpoint where clients compose custom queries) earns its complexity with many varied
screens and teams — we have neither. tRPC's TypeScript magic doesn't reach our most
important client, which speaks Swift.

**2. Every path starts with `/v1`, and changes are additive only.** If behavior must
ever change, we add `/v2` endpoints alongside instead of breaking phones still calling
`/v1`. New optional fields are allowed; renaming or removing anything shipped is not.
Correcting a wrong answer is not a behaviour change in this sense (ruled 2026-09-22):
this decision exists so old phones keep working, not to preserve a response that told a
client something false — "your tap is recorded" when it was not. Such a correction may
change a status in place, `200` to `409` included, and each one is recorded in PLAN.md's
decision log.

**3. The endpoint list — NOT final.** A working set, expected to change as the screens
get designed; edits land here as they're decided.

Student app:
- `GET /v1/me` — boot call: who am I, my classes, my live session if any. The first-ever
  call quietly creates the student's `users` row; a later call fills in a display name
  the row was created without, and never changes one it has. Each class carries its
  teacher (`teacher.displayName`, null when their account has none — the preview's and
  the history's shape; added 2026-09-26, C2a, additive): what Home and Me show under a
  class, and Focus says "with". And the caller's enrollment in it (`enrollmentId`, null on
  a teacher's own class; added 2026-09-30, A19, additive): what leaving it deletes. And its
  session running now by the server's clock, with its bell (`liveSession`, null when none runs
  and on a teacher's own class; added 2026-09-30, C3c, additive): Home says the class is in
  session to a student not in it. And whether a tap of the caller's waits for a Start that would
  join them (`armed`; added 2026-10-03, #166, additive): not taken by a Start, not past the end
  of its school day by the server's clock, for a teacher of a class they are in — the taps a
  Start converts; false for a teacher. A phone waiting for its teacher's Start stops waiting once
  it is false.
- `DELETE /v1/me` — the caller deletes their own account (C3, added 2026-10-04, additive):
  `{ eventId }`, through the engine (data-model decision 3's amendment), answered `deleted`;
  a retry, or any call from a sign-in with no account here, is `already_deleted`, and makes
  none — a retry reaching an account a boot call made since deletes that one too. A teacher
  with a live class or block is `409 teacher_has_classes`. A join, rename, tap (joining or
  arming), invite redeem, or class or block create still on its way under the deleted account is
  `409 account_deleted`; an unlock is recorded, never refused. The Cognito sign-in is the phone's to delete with its own access token once this
  answers (C4): the API holds no AWS credential. From that answer the phone sends the API
  nothing more — any request would make a fresh account under the same sign-in — and leaves its
  session with no Emergency Unlock (the owner's ruling).
- `PATCH /v1/me` — the student sets their own display name (A8): `{ displayName, eventId }`,
  stored trimmed with each run of spaces made one, answered with the user as `/v1/me`
  gives it. Unique within each class (owner decision 8): a name another student in any
  live class the caller is in already uses — compared ignoring case, spacing, Unicode
  compatibility forms and characters that draw nothing — is `409 display_name_taken`,
  never a silent rename; the engine serialises it by locking the caller's row, then
  their classes in id order. A join is never refused over a name, a name filled from
  sign-in claims is not policed, and a collision a later join makes is left for the
  teacher to see. Recorded as a `display_name_changed` event (the name and the one it
  replaced) with no session: a grid shows the new name at its next snapshot. A replay
  applies nothing and answers the name now; a teacher is `403`.
- `GET /v1/me/age-check` — whether the caller's account confirmed it is 13 or older (C7-server,
  added 2026-10-08, additive): `{ passed }`. A read that creates nothing: a sign-in the server has
  no account for, a deleted account's too, is `false`, so the app asks it right after any sign-in,
  before the 13+ question. A teacher's account is always `true`.
- `PUT /v1/me/age-check` — the caller's yes, recorded: `{ eventId }`, answered `{ passed: true }`,
  the account's row made as the boot call makes it. Only that the account passed is kept, with the
  `eventId` and the server's time, never a birth date or an age. Idempotent on the `eventId`; an
  account that passed already, under any `eventId`, keeps its first; a teacher's records nothing.
  An `eventId` another account's yes holds is `409 event_id_conflict`, and one reaching an account
  deleted on its way `409 account_deleted`, nothing recorded.
- `POST /v1/taps` — the tap; the response says which outcome happened: joined, armed,
  or switched sessions.
- **The order the phone acted in** (A12): every record the phone's outbox sends — the
  tap, both unlocks, the refocus, protection off and Screen Time back on — may carry `order`,
  `{ install, seq }`:
  its outbox file's id, minted once when the file is made, and the record's place in that
  file, a counter no clock moves. It orders the student's own unlock against their return
  to focus, both ways (rule 1): an unlock their return went ahead of is late (A10, A12),
  and so is a return — a refocus, or a tap into a session — their unlock went ahead of
  (A13, owner ruling 2026-09-24); each is recorded, noted `superseded`, never applied.
  It orders their taps too (A14, owner ruling 2026-09-25): a tap older than one of theirs
  already recorded in another session — into a running session, arming, or converting at
  a Start — is late, recorded and noted the same way, so no tap ever takes a student back
  out of where their later tap put them. Optional — old builds send none — and never a
  reason to refuse: one the server cannot use (not a UUID install, not a positive safe
  integer seq) is taken as none.
- `POST /v1/sessions/{id}/checkin` — the every-30-seconds "still here"; the response
  carries the current truth (state, end time) so the phone can reconcile.
- `POST /v1/sessions/{id}/unlock` and `POST /v1/sessions/{id}/refocus` — emergency
  unlock, and coming back from one. The unlock may carry an optional reason (bathroom,
  nurse, other); one the server does not recognise is recorded as none rather than refused.
  The student may change it while the unlock stands (`PATCH /v1/unlocks/{eventId}`, below).
  A refocus replayed after the student's participation ended while the session runs
  (removed, left the class, switched away) is answered `replay` with no session and no
  state (ruled 2026-09-24), never with that ended row's last state and a window. A late
  return — a refocus, or a tap, that the phone made before an unlock of the student's own
  in that session the server already has, by the phone's order (A13) — is recorded but
  never applied, so the unlock stands; it is answered as its retry is, `replay` with the
  truth now: the session and the state the unlock left while the student is in it, none
  once they are not. With no order to compare, or another install's, it applies as it
  arrives. Protection off is never late: it reports the permission, not the student.
- `POST /v1/taps/{eventId}/unlock` — an emergency unlock made while the phone's own tap is
  unanswered (owner decision 11): sent under the tap's `event_id`, with the session
  unlock's body and answer. It is filed in whatever session that tap landed in, by that
  session's unlock rules — the tap looked up among the caller's own taps only, so another
  student's id files nothing into their session — or, with no session to file it in, kept
  unattached as an unknown session's is: `tap_armed` (the tap is on the arm path: waiting
  for Start, which then joins the student without it — or a late one, A14, kept consumed,
  which no Start converts) or `unknown_tap` (no tap of the caller's has that id). A tap
  landing after an unlock sent under it files it then, so both arrival orders end alike;
  the two serialise on the tap. Never refused; a retry is answered where it was recorded.
- `PATCH /v1/unlocks/{eventId}` — the student changes their unlock's reason (A20, the owner's
  ruling 2026-09-30): `{ reason, eventId }`, the unlock named by its own event id. Recorded as
  an `unlock_reason_changed` event of its own naming the unlock — the unlock's event is never
  rewritten — and the grid, its stream and the history show the latest. Only while that unlock
  is the one the teacher's grid shows (the student's latest turn in the session: no return to
  focus, tap or other unlock of theirs there since, and not itself late) and the session runs
  by the server's clock: else `409 unlock_superseded` or `409 session_not_running`; an id that
  names no unlock of the caller's in a session — someone else's, one kept with none — is `404
  unlock_not_found`. A refusal records nothing. A replay answers the reason now, whatever came
  since, and so does the unlock's own replay. A reason outside the vocabulary is a `400`: this
  is no unlock record.
- `POST /v1/sessions/{id}/protection-off` — the phone found its Screen Time permission revoked
  (iOS app structure, rules); strict like refocus, and only a re-tap or Screen Time back on
  (below) leaves the state. A
  report that first reaches the server after the session ended, from a student who was in
  it at the end, is recorded like a late unlock instead of refused (ruled 2026-09-24): noted
  `after_session_end` in `payload.recorded_as`, the key and value an unlock uses, and
  answered `recorded` with no session, so no answer hands a phone a window to shield to.
- `POST /v1/sessions/{id}/protection-on` — Screen Time back on in the class the student tapped
  into (#167, the owner's decision 2026-10-02; iOS app structure, rules): out of protection off
  to the state before it, as the student's latest turn there says (A9's rule, `latestTurn`) —
  focused, or unlocked after an unlock — recorded as a `protection_on` event of its own, the
  same body as refocus's and answered as one is. Strict like refocus: refused past the bell,
  swept or not (A17), and for anyone not live in the session (`409 not_participating`); a
  participation not in protection off — a re-tap left it, or it never went — is `409
  protection_not_off`, nothing recorded. A replay after the student left the session names no
  session (A4). One the phone made before a protection off of its own the server already has,
  by its order (A12), is late — recorded, noted `superseded`, never applied — so the protection
  off it made last stands.
- `GET /v1/join-codes/{code}` — what a code opens, before joining it (the consent preview):
  the class, its teacher's display name, and whether the caller is in it already. A read
  that creates and writes nothing. It matches a code as the join does — one schema, to which
  case and surrounding whitespace are noise — so the two never name different classes, and
  it refuses what the join refuses: an unknown, archived or regenerated code is `404
  class_not_found`, a teacher `403`. It reveals what a join to that code would, plus the
  teacher's name; per-account budgets on guessing codes arrive with ISSUES #1 (Phase 4).
- `POST /v1/enrollments` — join a class by code, matched ignoring case and surrounding
  whitespace (A6); a code longer than every minted one is `400` before any lookup. A teacher
  is `403`, judged inside the join's transaction under the caller's `users` row (FOR SHARE,
  taken before the class, as a rename takes them), the row the redeem holds: a join and the
  same account's redeem run one at a time, so a new teacher is never enrolled (T1c).
- `DELETE /v1/enrollments/{id}` — leave a class; recorded as its own event and visible
  to the teacher, so quietly leaving to dodge a session is always on the record. Never
  while the class has a session running by the server's clock, the student in it or not:
  `409 class_in_session`, nothing recorded (owner, 2026-09-30; A19). Past its bell, not yet
  swept, a leave ends the student's participation there at the bell, as a removal does. The
  body's optional `eventId` is what the leave is recorded under; a retry of one that landed
  is answered `already_removed`, never refused.
- `GET /v1/me/history` — the student's own timeline screens (A7): what was recorded about
  them that the consent screen says a teacher sees, in every class they have been in,
  left ones too — tapped in, back to focus, unlocked (with its reason), protection off and
  Screen Time back on (#167), a switch to another class, leaving or being removed, the class
  ending while they were
  in it, and a tap a Start declined (`armed_tap_skipped`: it already counted in another
  class, named — never a join). A late unlock or protection off carries its `recordedAs`
  note. Silence, joining and an unlock kept with no class are not shown
  (`HISTORY_EVENT_TYPES`). Newest first by `occurred_at`; at one instant a leave comes
  before anything else, since a switch mints the join first and stamps both with one
  time; then `seq`. Paged: at most 50 a page, and `nextBefore`, the last event's id, to
  pass as `before` — a cursor that names a row, so a moment recorded between pages never
  shifts one; a `before` the history does not hold is `400 unknown_cursor` (reload from
  the top), a malformed query `400 invalid_request`. A read that creates nothing:
  no row yet is an empty history. Only ever the caller's own; a teacher is `403`.

Teacher app and web portal:
- `GET /v1/me` — same boot call, role-aware.
- `POST /v1/teacher-invites/redeem` — how an account becomes a teacher (T1b): `{ code, eventId }`,
  the code the owner minted for a school (data model, `teacher_invites`), matched as the command
  printed it with its case, spaces and dashes set aside, and looked up by its hash; in the body,
  never the URL, so no request log holds it. In one transaction the account becomes a teacher at
  the code's school and the invite is marked redeemed by it, by one UPDATE guarded by `redeemed_at
  IS NULL`, so of two accounts racing for a code one wins; answered with the user as `/v1/me`
  gives it, and a replay with the user now. The account is judged first: a teacher already is `409
  already_teacher`, a student in a live class `409 student_in_class` (the owner's ruling: a
  separate account for teaching). Then the code: none with it `404 invite_not_found`, used `409
  invite_used`, expired `409 invite_expired`; one that can't be a code `400 invite_code_invalid`.
  A refusal redeems nothing and changes an account only as the boot call would: a first-time caller
  keeps the student row the boot call would have made, and an account with no display name gets the
  one its sign-in carries, as `GET /v1/me` fills it. Tries are budgeted per account and misses per
  address, as the join's are. No event: the invite row is the record, kept by the database from
  change or deletion.
- `POST` / `GET` / `PATCH` `/v1/classes…` — create and manage classes. A class named by its id is
  the caller's own: an unknown one is `404 class_not_found` on every route under
  `/v1/classes/{id}` (added 2026-10-04, R3, additive: one condition, one shape), another
  teacher's `403`.
- `GET /v1/classes/{id}/roster` — the roster; `DELETE /v1/enrollments/{id}` — remove a
  student (the one-transaction removal).
- `POST /v1/classes/{id}/sessions` — start a session; if one is already open for this
  class, the response returns that session instead of creating a duplicate; one
  past its bell, not yet swept, is ended as the sweep would end it and the new one starts (A18).
- `POST /v1/sessions/{id}/end` and `POST /v1/sessions/{id}/extend`.
- `GET /v1/sessions/{id}/events?after={number}` — catch-up reads of the event log.
  (The live stream endpoint is decided in the live-updates section.)
- `GET /v1/classes/{id}/reports/sessions/{sessionId}` — one session's report (R2), for the
  class's own teacher: who joined, by their display name now, the class's focus minutes (total,
  and the average per student who joined) and silent minutes, and every unlock and protection off
  with its note — aggregates only, never one student's minutes. Read from the session's own
  events (rule 2's `sessionReport`), so a student removed from the class since is still named.
  Whole minutes, each rounded from its exact figure: the total never a sum of rounded parts. A
  session not yet marked over is answered too, counted to now or to its bell, with `ended: false`.
  Another teacher and a student are `403`; a session not in the class is the unknown session's
  `404 session_not_found`, an unknown class `404 class_not_found`.
- `GET /v1/classes/{id}/reports/sessions` — the class's sessions (R3), for the class's own
  teacher: newest first by when each started, the running one too, each with its window
  (`startedAt`, `endsAt`, `endedAt`), R2's `ended`, and its totals — how many joined, the class's
  focus minutes (total, and the average per student who joined), silent minutes, and how many
  unlocks and protection offs. Counted on each read from the session's own events, by the same
  `sessionReport` and rounded as R2 rounds, so a row never disagrees with its session's report.
  Paged as the history is: at most 20 a page, and `nextBefore`, the last session's id, to pass as
  `before` — a cursor that names a row, so a session started between pages never shifts one; a
  `before` the class does not hold is `400 unknown_cursor`, a malformed request `400
  invalid_request`. Another teacher and a student are `403`, an unknown class `404
  class_not_found`.
- `POST /v1/blocks` — register a physical block to a teacher. A tag another teacher's live
  block holds is a `409`; re-registering one's own tag returns that block (the retry of a
  lost response).
- `GET /v1/blocks` — the caller's own live blocks, oldest first (P3): never another teacher's,
  never a soft-removed one. A student is `403`.

Live lesson (Phase 7, planned 2026-10-05): the question, answer, results, presentation, deck
and slide routes are listed in "Live lesson (Phase 7)", decision 6.

**4. Every request is checked; every error has one shape.** No request body is trusted:
each endpoint validates its input (right types, sane sizes) before touching the
database. Failures return one standard JSON error shape with the right status code —
`400` bad input, `401` bad token, `403` signed in but not allowed, `409` conflict,
`429` over budget (per-user budgets on signed-in endpoints, per-address on sign-in,
per ISSUES.md #1) — so every screen can show something honest instead of guessing.
The shape is `{ error: { code, reason?, message, details? } }`: `code` is the status's
class, and `reason` says which refusal it was where one status covers several — a
refocus's `409` is protection off, not in the session, the session over or a spent id —
from one closed, additive-only vocabulary in `@bali/shared` (`API_ERROR_REASONS`, one
value per refusal the transition engine makes, and per refusal a route makes itself where
one status covers several; decided 2026-09-24). A client keys on
`reason`, never on the message, and reads a value it does not know as none. An error
with no finer meaning than its status carries none.

### Rules that keep the API honest

- **The response is the reconciliation channel.** Every student-action response carries
  the server's current truth — that's how a phone discovers "you were removed,"
  "session ended," or "you're armed, not joined." An API that only says "ok" recreates
  v2's drift.
- **For unlock records, no response ever means "discard."** The contract spells out
  which errors mean retry later and which mean recorded-with-a-note. v2's lost-unlock
  bug lived exactly at this gap. The engine implements this: `unlock` always commits
  the event, tagging it `payload.recorded_as` (`no_live_participation` /
  `after_session_end` / `unknown_session` / `not_enrolled`, and for one sent under its
  tap `tap_armed` / `unknown_tap`) when there is no live participation to flip,
  `protection_off` when there is one but its protection is off (never softened into an
  unlock while it is off; Screen Time back on returns the student to it, #167), and
  `superseded` when the student's own refocus or tap in that session came
  after it — ahead of `protection_off`, so Screen Time back on never returns to it (#167) —
  a late unlock, recorded and answered with the state it left alone, or with
  none once the student has left the session (ruled 2026-09-24, A10: "after" by the
  clamped times, a return's never later than the server recorded it, and a tie flips;
  A11: after the end too, never "left unlocked" over a phone shielded at it; A12: by the
  phone's own order instead when the two carry one from the same install); the
  outbox disposition (`recorded` / `retry` / `reauth`) is the typed table in
  `@bali/shared`. "Never refuse" is not "never check": a caller
  with no participation row in the session **and** no active enrollment in its class
  has no standing there, so their unlock records as an orphan (`not_enrolled`, no
  session or class attached, the claimed id in the payload) rather than writing into
  a stranger's history and live grid. A student removed mid-session keeps their ended
  participation row, so the case this rule exists for is untouched.
- **Taps and state changes have typed tables too** (`@bali/shared`). A tap record is
  deleted only on a `2xx`, and the phone shields only to a session the answer names —
  `armed` waits for Start, and a recorded tap or change naming none re-reads the truth;
  a refused tap (a `4xx` but `401`, `408`, `429`) is kept, retried and shown
  (`tapDisposition`) — shown while it is the phone's newest tap: once the student taps again,
  that later tap is the one that counts, and the refused one is kept and retried unsaid
  (decided 2026-10-01, #146). A refused refocus, protection-off report or Screen Time back on is
  dropped and the truth re-read, never resent — final for its `event_id`
  (`stateChangeDisposition`). A read — a
  check-in, `GET /v1/me` — never overrides a newer state change of the phone's
  (`readMayReconcile`). The one exception is a record stuck after repeated failures
  (refused, or left unsettled by 8 answers): it stops holding reads back, so the phone
  can reconcile again — while an unrecorded unlock still keeps any read or answer from turning its
  own session's shields back on, unless the student has refocused or re-tapped there
  since (ruled 2026-09-24; B3a, B3b-2; the answer's half B6b-2).
- **Old apps call forever.** `/v1` plus additive-only is a discipline held in code
  review, not a feature — and in CI, whose check of the API's surface against
  `contracts/openapi.json` (generated from the app: every route and the request schema it
  parses) fails a change that removes a `/v1` route, method or request field (Phase 4, O1).
- **The fixtures are the phone's contract.** `contracts/fixtures/` holds the API's real
  answer to every student request, for each outcome a phone decodes — captured in memory,
  ids and times normalised — and a test fails when one drifts. BaliCore decodes every one
  (Phase 3, B1), so a response cannot change without the phone's contract changing with it.

## Live updates

How a new row in the `events` table reaches the teacher's screen within a second or two.
Only teacher screens get a live feed — student phones learn the truth from the responses
to their own requests — so live connections ≈ one per running class, not one per student.
*Amended 2026-10-06:* one push notification, a visible "class started" alert, rings a
waiting student's phone when the Start converts their armed tap; it is a doorbell, never
the truth, and no stream (see "Push: a doorbell for students" below).

### The decisions (2026-09-16)

**1. Teacher screens stream over SSE (Server-Sent Events).** The screen makes one HTTP
request and the server never finishes the response; each new event is written down the
open connection as a line. One-way fits us (teacher actions are ordinary POSTs), plain
HTTP passes school networks, and after a drop the browser reconnects with the last event
number it saw — which plugs straight into the catch-up endpoint and the overlap-window
rule.

**2. Servers hear about new rows through Postgres LISTEN/NOTIFY — a doorbell, not a
mailbox.** The server that writes an event sends a notify for that session; any server
holding streams for it gets pinged, reads the actual rows from the `events` table, and
pushes them out. The table stays the single source of truth, and no Redis is needed.

**3. Three protections.** Correctness never depends on the doorbell: every stream also
re-checks the table on a slow timer (~20s). The server writes a no-op comment line every
~20s so proxies don't kill idle-looking connections. Streams are capped per teacher
account so a bug can't leak thousands of connections.

The engine's `insertEvent` is the single place that rings the doorbell (a `pg_notify`
after a genuinely new event that belongs to a session), so no writer can forget it; it
fires inside the write's transaction, so Postgres delivers it on commit, never for a
rolled-back event. The overlap window is `EVENT_RESUME_OVERLAP` in `@bali/shared`: a
`seq` is handed out when a row is inserted but only becomes visible on commit, so a slow
transaction can make a lower seq appear after a higher one. The stream re-reads a sliding
`lastSeq − overlap` window and a reconnecting client resumes from `lastSeq − overlap`,
both de-duping by `event_id`, so a late-committing event is still delivered exactly once.
The boot snapshot (`GET /v1/sessions/{id}`) returns the latest seq to stream from, so the
grid loads and goes live in one round trip. The stream reads the Authorization header only
— never a token in the query string — so the portal drives it with `fetch`, not
`EventSource`.

*Amended 2026-10-05 (Phase 7, Live lesson, decision 7):* students still get no stream — a
phone follows a live lesson by polling `GET /v1/sessions/{id}/presentation` in the
foreground, about every 2 s with an ETag. The teacher stream gains the lifecycle events
`question_opened`, `question_closed` and `slide_shown`; a question's live counts are polled
by the portal from the results endpoint, so no per-student answer enters the stream.

### Push: a doorbell for students (2026-10-06)

The owner's decision with the Mac session. A student whose armed tap (data-model decision 5)
waits for the Start learns of it only at the phone's next 30 s read or return to the front
(PLAN's open product decision 6). One push closes that gap without changing who owns the truth.

- **A visible notification only.** No silent or background push, and nothing that locks a
  phone remotely: a teacher-triggered remote lock is exactly the open §3.3.3(P) question to
  Apple (ISSUES #3). The student still chooses to act — opening Bali is what shields.
- **Who gets it:** only the students whose waiting armed tap *this* Start converts into a
  participation. A student who taps after the Start joins at once and gets nothing; a tap the
  Start declines (`armed_tap_skipped`, or noted `superseded`) gets nothing either.
- **The words (final):** title "{class name} has started", body "Open Bali to lock your
  apps." No other personal data in the payload — no student name, no ids.
- **A doorbell, never the truth.** Opened, the phone reads the truth from the API, as the
  portal's stream reads the `events` table after a LISTEN/NOTIFY ping. No code — server or
  phone — may assume a notification arrived; the 30 s read and the return to the front stay.
- **Sent after the Start's transaction commits** — never inside it, never from the
  transition engine. One alert per converted student's tokens, over APNs HTTP/2 with token
  auth (a `.p8` key): topic `com.bali.Bali`, team `H535678UF8`, `apns-push-type: alert`,
  priority 10, `interruption-level: time-sensitive`, a short `apns-expiration`, and an
  `apns-collapse-id` per session. A Start replay re-reads and sends nothing. A send failure
  never fails or delays the Start; it is logged without the token. A token APNs reports gone
  (`410`, or `BadDeviceToken`) is deleted. With the APNs configuration unset the sender is
  off, as Sentry is.
- **Device tokens.** An additive `/v1` endpoint lets a student register and remove its APNs
  token with its APNs environment (`sandbox` for Debug builds, `production` for TestFlight
  and the App Store), idempotent on a client-minted UUIDv7 `eventId`. A new table keyed by
  the token; students only for now. Tokens are personal data: deleted by `deleteAccount`
  (C3), a school's disposal (C6a) and the retention run (C6b); placed by C5's export and the
  schema tests that place every foreign key to `users`; never logged.
- **Not on the pilot's critical path.** It never delays C2 or the external TestFlight steps.
  The app's half (registering, the `aps-environment` entitlement, the Time Sensitive
  capability, the words) is the Mac session's.

## Hosting

Where everything physically runs.

### The decisions (2026-09-16)

**1. The API and database run on Railway.** A container platform: connect the GitHub
repo, every push to the deploy branch builds and deploys itself, Postgres is managed on
the same platform, and secrets live in its dashboard — never in git. Roughly $10–20 a
month at our stage. Named fallback: Render (near-identical). AWS (ECS + RDS) is the
"later, if big" path — using Cognito does not require hosting there. Serverless
platforms are ruled out by our long-lived SSE connections.

**2. Two environments: production and dev.** Each has its own API and database, so a
bad change can never touch a real school's data.

**3. The API runs the sweep itself, every minute; a Railway cron is its backup** (amended
2026-09-29, A15). The sweep ends each session past its end time and opens a silence episode
for each phone gone quiet, so it must run every minute — and Railway's cron runs at most every
5 minutes, and not to the minute (a session on dev closed 19 minutes after its bell). So each
API process sweeps every 60 s on its own clock: a run still going when the next is due makes
that tick skip, a failed run is logged and the next tick runs as usual, and shutdown stops the
ticks and waits out a run in flight. A Railway cron still calls the internal endpoint, every 5
minutes, as the backup. The sweep is idempotent, so two instances, or the API and the cron,
sweeping at once is harmless.

**4. Database safety from day one.** Automatic daily backups with point-in-time
recovery, and the database in the same region as the API. *Exception, the owner's ruling
(2026-10-05):* prod runs without backups for the Vanderbilt pilot (Railway's need its Pro
plan), an accepted risk for an informal pilot of adults; this decision holds again before
any K-12 school (`docs/DECISIONS.md`, 2026-10-05).

**5. The deploy sets `TZ` to the school's zone.** The server's local time is the
school's: bell times render in it (carried over from v2) and an armed tap's
"end of the school day" expiry is computed against it. Railway defaults to UTC,
so this must be set explicitly per environment.

**6. Uploaded decks live in a private bucket per environment** (Phase 7, Slice 2; "Live
lesson", decision 8): AWS S3 recommended, reached by presigned URLs, behind a storage
interface with an in-memory fake for CI and the demo. The API's credential reaches that one
bucket only.

Context from v2: Cognito was AWS (kept for v3) and an RDS Postgres instance existed,
but the v2 API itself was never deployed — it only ran locally, with the website on
Vercel. The old RDS instance should be decommissioned once v2 is fully retired.

## iOS app structure

How the student app is organized so the phone can read the tap, enforce the shields, work
offline, and never lose a record. The iPhone is where Bali's promise is physically kept.
Guiding philosophy (owner, 2026-09-16): Bali is a mirror, not a cage — the phone doesn't
fight the student, it makes sure the teacher always sees the truth.

### The decisions (2026-09-16)

**1. Native Swift + SwiftUI.** The shield technology (Family Controls / Screen Time) exists
only as native Apple APIs, so cross-platform frameworks can't reach it. Not really a choice.

**2. It's a main app plus an extension — enforcement never depends on the app being open.**
An extension is a small separate program iOS runs for us at set moments, even if the student
swiped the app away. The main app handles screens, sign-in, reading the NFC tap, and turning
shields on; a DeviceActivity monitor extension is registered with the session's time window,
so iOS runs our code at the session's start and end regardless of the app being closed. Built
first, not last.

**3. The phone's own records live in a small SQLite database in a shared app group.** SQLite
is a tiny on-phone database; it holds the current session and the outbox (unsent taps and
unlocks waiting for internet). An app group is a shared folder Apple lets related programs
use — required because the extension is a separate program and otherwise couldn't read what
the app wrote. Library: GRDB (battle-tested; SwiftData is still flaky in extensions).

**4. One sync engine owns all server communication.** It drains the outbox with retry and
backoff, runs the every-30-seconds check-in while the app is open, and applies the server's
answer (the reconcile step). iOS won't let us run a timer forever in the background, so
check-ins are best-effort, enforcement never requires network (decision 2 guarantees that),
and the grid shows "last seen 4m ago" rather than pretending silence is focus.

**5. The teacher iOS app is a thin client sharing a `BaliCore` Swift package.** Same API as
the web portal, no enforcement machinery. Both apps share one package holding the API client
and data types, so the two apps can't drift out of type-agreement.

**6. A live lesson shows on the app's own screen** (Phase 7, "Live lesson"): the open
question's answer card and the current slide, polled in the foreground while a session of
the student's class runs, and rendered natively (PDFKit). It needs no Family Controls,
never covers or delays Emergency Unlock, and its answers never enter the outbox.

### Rules that keep the phone honest

- **Turning off Screen Time permission is handled by being honest, not by fighting it.** iOS
  itself drops all shields the instant the permission is revoked — we can't prevent it. So the
  next check — at each check-in, and as the app starts or comes back to the front — notices and
  reports it (`POST /v1/sessions/{id}/protection-off`), the server
  records it as its own event, and the grid shows "turned protection off" (a distinct state —
  never green, never an unlock: an unlock arriving then is recorded without softening it).
  Screen Time turned back on in the class the student tapped into puts them back where they
  stood before it, with no re-tap (#167, the owner's decision 2026-10-02, replacing A2's re-tap):
  focused, the shields back on, if they were focused; still unlocked if their latest turn there
  is an Emergency Unlock, one recorded while it was off included, never a late one (A10)
  (`POST /v1/sessions/{id}/protection-on`). Relocking only makes things stricter, the student
  proved they were in the room with that class's tap, and the history keeps the protection off
  beside the return, its own event. Out of a class, or past the bell, nothing changes; refocus
  is still refused out of it, and a re-tap still leaves it. A report that
  only reaches the server after the bell is still recorded, with a note, so the history says
  why the phone went quiet. This permanently kills v2's worst bug, which was pretending to be
  shielded after exactly this. The phone notices by a marker, never by the permission's own
  read, which a running app keeps reading approved: a setting of no effect, written once iOS
  confirms the grant, which iOS deletes with the shields (F1b, #144). It never puts shields back
  while the marker is gone — iOS would keep them without enforcing them — and, taken back with
  the app closed, the monitor notes it for the app to report at its next run.
- **A closed app still shows the truth fast, and keeps its shields to the bell.** When the app is
  force-quit, check-ins stop and within about a minute the grid shows "app closed" honestly. The
  shields stay until the session ends (decided 2026-09-30, the owner's ruling: option (a) of the
  two once parked here): the monitor extension takes them off at the bell with the app closed —
  seen on the owner's iPhone, round 2 of the device check, 31 s after the bell with the app
  force-quit — and Emergency Unlock is the sanctioned exit during the session: a one-second hold
  (ruled 2026-09-29), quick, yet no pocket touch files one, and one step under VoiceOver. Not
  (b), a watchdog turning the shields off after a force-quit: iOS's coarse wake clock makes its
  honest promise "off within ~15 minutes", not instant.
- **The 13+ check never stands between a student and Emergency Unlock** (C7, 2026-10-05; at
  Sign up since 2026-10-07). The router shows the age screen, and the stop screen under 13
  gets, in Sign in's place once Sign up was pressed, and, signed in with a sign-in not through it
  (the gap's fallback, 2026-10-06; read from Bali's server since 2026-10-08, the starting mark while
  it is asked), before Screen Time and Home. The shields' Focus and the home a standing not read
  keeps, which hold the exit, come before both, and so do a session's own screens: Unlocked,
  Protection off and Session over.
  Every way to the hosted UI starts at one call (`Phone.signIn`), which, for the sign-up page,
  asks the check first, every time; only that question's Continue and then the intro, shown where
  this run has not shown it since its last sign-out (once per account, not per phone: the owner's
  rulings, 2026-10-07), go on to the page, after an answer of 13 or older that same time
  (`Phone.answerAge`, `sawIntro`, through the private `Phone.open`); the sign-in page opens at
  once, and after an answer under 13 neither opens that run. A first launch
  opens on Sign in. The sign-in gives Bali's API no token until it is through the check (`SignIn`'s
  `Tokens.checked`: the server's yes read, or 13 or older answered), but the check's own read and
  an account deletion's (`deletionToken`): Delete account's steps, the outbox and then `DELETE
  /v1/me`, go whether or not it is.
  The check counts in the Gregorian calendar whatever calendar the phone shows its dates in.
- **A teacher always sees a real name** (the owner's decision, 2026-10-07; the approved Sign in &
  sign up design's Your name). A student's account `GET /v1/me` names with no name, as
  production's sign-up leaves every new one, gets "What's your name?" after any sign-up or
  sign-in: where the 13+ question would show, after it, so before Screen Time and Home and
  never over a session's screens nor the home a standing not read keeps. Required: Continue saves
  the name as Me does (`PATCH /v1/me`, its refusals Me's), and Sign out is the only other way on.
  Known only from a read: after a sign-in made this run, or one the 13+ check let through, the
  starting screen holds until the first read answers or fails, so no other screen flashes before it
  (the owner's ruling, 2026-10-07); a failed read, or a sign-in kept from the last run, lets the
  screens go on, and it shows once a read names none. A teacher's account never gets it.
- **A changed phone clock is detected, not prevented.** iOS scheduling follows wall-clock
  time, so a clock change is a real bypass family; the server compares against its own clock
  (rule 1) and surfaces it to the teacher rather than trusting it. Which of a student's own
  actions came last — their unlock, or their return to focus — is not a clock's to say: the
  phone numbers what it does with its outbox's counter, and the server orders the two by it
  (A12, owner ruling 2026-09-24), so a clock turned back between them never undoes a real
  unlock — nor does a return the phone made before it, however late it lands (A13), nor a
  tap it made before its tap into another class (A14). The clock still decides for a build
  that sends no order, and only for a late unlock: a return or a tap with none applies as
  it arrives.

### Decided later, on purpose

- **A second enforcement layer: a local VPN filter.** The app installs a VPN profile whose
  traffic loops through a small filter on the phone itself, refusing connections to blocked
  destinations. It adds what Screen Time can't: starving apps of internet, blocking websites
  in every browser, instant server-updated block lists, and a backup layer that still works if
  Screen Time permission is revoked. Catches: the student can switch the VPN off in Settings
  (detect and mark it), offline apps/games are untouched, a VPN badge shows in the status bar,
  and it means seeing traffic on a minor's phone (a deliberate privacy call). Not in the launch
  path, but a genuine candidate for production as a layer-2 enforcement engine alongside
  Screen Time.
- **An exception for an app a student medically needs.** The shield blocks every app it can
  (What Bali is), so a glucose monitor or an assistive-communication app is blocked too. At
  launch the exit is Emergency Unlock — always allowed, always recorded. Any carve-out is a
  later product decision for the owner (2026-09-24).
- **Granted (owner, 2026-09-24):** the Family Controls distribution entitlement, which Apple
  approves per bundle ID — the app and both extensions have it (`com.bali.Bali`,
  `com.bali.Bali.BaliMonitor`, `com.bali.Bali.BaliShield`).

## Web portal

The teacher's website: classes, sessions, the live grid, reports — plus the static
marketing pages. The phone is where enforcement lives; the portal is where trust lives.

### The decisions (2026-09-16)

**1. Next.js, as in v2.** React for the interactive screens, plus free static marketing
pages in the same project.

**2. A thin client — the API stays the only brain.** Portal screens run in the browser,
calling the same `/v1` API as the iPhone apps, with the same JWT and the same SSE stream.
No second mini-backend inside Next.js. One brain, three thin clients.

**3. It imports `packages/shared` directly.** The same TypeScript state function and
types the API uses — on web, "one shared state function" is literally the same file.
(iOS mirrors it in `BaliCore` with contract tests, since Swift can't import TypeScript.)

**4. The grid states its own health.** On a dropped stream it shows "Reconnecting… last
updated 40s ago" (the words since D2f) instead of freezing green, then catches up by event
number. Only a real
`401` signs a teacher out; a network blip shows "Couldn't reach Bali. Check your connection,
then try again." with its retry (the words since D2c-2).

**5. Deploys on Vercel when we ship.** A new project watching `main` (`bali-portal`, rooted at
`apps/web`); the root `vercel.json` that blocked `main` deploys was deleted 2026-10-06. Two open tabs are fine (each stream
has its own cursor; capped at 5 per account), and a tab left open across a deploy gets a
"new version — refresh" banner.

**6. Live lesson's screens are the portal's too** (Phase 7): asking a question and its
results, the projector's view, the deck library and the presenter — thin client screens on
the same `/v1` API, under the rules of "Live lesson (Phase 7)" below.

## Live lesson (Phase 7)

During a running session the teacher can ask the class a question (Slice 1) and present
slides (Slice 2); each student follows on their own phone, on Bali's own screen. Planned
2026-10-05 from the research in `docs/ROADMAP-RESEARCH.md` (B); the build is Phase 7 in
`docs/PLAN.md`, and its decision entry is `docs/DECISIONS.md`, 2026-10-05. **The build is on
hold by the owner (2026-10-05):** nothing starts until the owner says so; when resumed,
backend only first (no UI, app or portal changes). The owner's picks of 2026-10-09 (the
screens' design, the defaults confirmed, and saved questions) follow the ten decisions
(decisions 11 and 12).

### The decisions (2026-10-05)

**1. What it is.** While a session runs, the teacher opens a question and the students
answer it, and (Slice 2) the teacher shows a page of a PDF deck and the students see that
page. Both appear on Bali's own screen, which works while the phone is shielded: the
authorizing app is not shielded in practice (`PhoneScreenTime.swift` shields `.all()`, and
Bali's Focus screen and Emergency Unlock already work mid-session). Slides render natively
with PDFKit, never in a `WKWebView`. Live lesson never depends on Family Controls: it works
the same for a student who is unlocked, whose protection is off, or who never granted
Screen Time access. **Emergency Unlock is never covered or delayed by it:** the answer card
and the slide view leave the Unlock control where it is, its one-second hold unchanged, and
nothing of a live lesson sits in the outbox ahead of an unlock (decision 5).

**2. The owner's rulings (2026-10-05).**
- **Results are totals only.** No screen, stream, report or export shown to a teacher or a
  projector ever names who answered what, or which students answered at all: a teacher sees
  counts. The one record that holds a student's answers by name is the student's own export
  (C5), which shows that student their own.
- **Phones follow by foreground polling**, about every 2 s with an ETag and `304`, not by a
  student stream (Live updates stays teacher-only).
- **Any student enrolled in the class whose session is running may answer**: tapped in or
  not, unlocked or focused, protection off included.
- **Questions and presenting exist only within a running session**, for now: nothing is
  opened or shown outside one, and a session's end closes what it had open. A teacher's saved
  questions (decision 12) are drafts kept outside any session, never shown to a student until
  one is asked.

**3. Defaults recorded as decisions (confirmed by the owner, 2026-10-09).**
- **One question kind in Slice 1: single choice**, 2–6 options, with an optional correct
  option the teacher may reveal when closing it. The prompt is at most 500 characters, each
  option at most 200; plain text.
- **One open question per session.** Opening a new one closes the previous one in the same
  transaction. The session ending — End, the bell, the sweep, a Start past the bell (A18) —
  closes any open question, in the transaction that ends it; past the bell, before the
  sweep, a question already counts as closed (A17's rule: the server's clock decides).
- **The small-group guard.** The per-option breakdown is shown only once at least **3**
  students have answered; before that a teacher sees "N answered" only, open or closed. The
  teacher sees "N of M answered", and never which students answered or didn't. **One
  population for N, the per-option counts and the guard:** everyone with a response to this
  question, counted from `responses`. An answer stays counted when its student leaves or is
  removed mid-session, as A9 keeps such a student on the grid, so the bars always total N and
  a breakdown once shown never vanishes because of a removal. M is the union of the students
  enrolled in the class now, the session's participants (a removed one included) and everyone
  counted in N, so N never exceeds M. No answer's time is exposed to a teacher (the
  student's own export, C5, has each of theirs whole, `answered_at` included).
- **No leaderboards, no grading, no per-student participation** in any report, recap or
  export a teacher reads. Totals-only governs what Bali shows. **Its known limit:** a teacher
  watching the live counts change while watching one student answer in the room can
  attribute that one step, and 3 answers all on one option tell everyone's. The guard removes
  the trivial cases; showing the breakdown only once the question closes would remove the
  live one too. The owner kept the live breakdown on the teacher's own screen and took it off
  the projector, which shows the counts only once the question closes (2026-10-09, decision 11).

**4. The data model (additive).** Four tables, each row's id a UUIDv7 (data-model decision 2):
- `questions` — one row per question: `id`, `session_id`, `prompt`, `options` (jsonb, an
  array of 2–6 strings, answered by index), `correct_option` (nullable index), `event_id`
  (unique: the open's, also its `question_opened` event's), `opened_at`, `closed_at`
  (nullable), `revealed` (bool), `created_by` (the teacher). A partial unique index on
  `session_id` where `closed_at` is null is the database's backstop for one open question
  per session.
- `responses` — one row per student per question, their answer now: `question_id`,
  `student_id`, `option` (an index into the question's options), `event_id` (unique),
  `answered_at` (the server's clock, when it received the answer); unique (`question_id`,
  `student_id`). While the question is open a student's later answer replaces their
  earlier one — only when its `event_id` sorts after the stored one: a UUIDv7 begins with
  the minting phone's time, so a slow first answer landing after the second never undoes it.
  An older or equal id changes nothing and is answered with the answer now. This is weaker
  than A12's counter, on purpose: a phone whose clock was turned back, or a second device,
  can mint an id that sorts first, and that answer is then not taken. It harms only the
  student's own answer, and never silently: the card shows the answer the server holds, and
  answer now carries its own `event_id`, so the phone's retry mints one after it. A replaced answer's id is no longer kept, so
  only a stored id is checked against another student's.
- `decks` (Slice 2) — one row per uploaded PDF: `id`, `teacher_id`, `school_id`, `title`,
  `storage_key`, `sha256`, `bytes`, `page_count`, `status` (`pending` / `ready` /
  `rejected`), `created_at`, `removed_at` (decision 3's soft removal), `object_deleted_at`
  (when its stored object was confirmed deleted; decision 8).
- `session_presentations` (Slice 2) — at most one row per session, keyed by `session_id`:
  `deck_id` (nullable: nothing shown), `page`, `updated_at`, and the `event_id` of the
  slide change that set it. **A row of its own, not columns on `sessions`:** `sessions` is
  read and locked on every tap, check-in, unlock and the sweep, and a teacher paging through
  60 slides would rewrite that hot row 60 times; the separate row keeps those paths
  untouched (additive in fact, not only in name) while a slide change still takes the
  session row FOR SHARE to serialise with its end.

Retention, disposal, deletion and export (ISSUES #5). The coverage guards
(`STUDENT_RECORD_COVERAGE`, `SCHOOL_DISPOSAL_COVERAGE`, `RETENTION_COVERAGE`) fail CI until
every new key to `users` or `schools` is placed, so the PR that adds a key places it:
- **Responses are education records.** Account deletion (C3) keeps them under the
  de-identified user, so the counts stay and name no one; the student's export (C5) includes
  every response of theirs with its question's prompt, options and session; a school's
  disposal (C6a) and the retention run (C6b) keep them under the person they de-identify.
  **A response answered after the school's year end is a record after the year:** as
  `RETENTION_COVERAGE` already says of `armed_taps.teacher_id` ("one made after the year
  keeps them named") and `teacher_invites.redeemed_by`, the retention run keeps that student
  named and continuing (their enrollment not ended). An enrolled student who answers but
  never taps in has no other record after the year, so without this the run would end the
  enrollment and de-identify a student still in class. `responses.student_id`'s coverage
  entry says so.
- **Questions are the teacher's words.** Kept with their session. The disposal empties each
  question's prompt and option texts, as it empties class names, since a prompt can name a
  person (the counts by option index stay); the retention run does the same for the
  questions of a teacher it de-identifies. In a student's export only as the question one of
  their responses answers.
- **Decks are the teacher's content, not a student's record.** Not in a student's export.
  A teacher removing a deck sets `removed_at`; so do the disposal, the retention run for a
  teacher it de-identifies, and the account deletion of a teacher with decks but no class or
  block (C3), each emptying the deck's `title` too, since a title can name a person. A
  presentation row is kept, pointing at a removed deck, as the history of what was shown.
  **The stored object goes after the commit, never inside the transaction:** the engine marks
  the row, and once it commits the API deletes the object and stamps `object_deleted_at`; the
  sweep deletes any removed or rejected deck's object still unstamped, so a crash between the
  two leaves no object behind for long. A disposal or retention preview, rolled back, never
  touches storage.

**5. Writers.** Questions, responses, decks and presentation state are written only by the
transition engine (`packages/db/src/transitions.ts`), with one named exception:
`decks.object_deleted_at`, stamped outside any engine transaction by the API after the commit
that removed or rejected the deck, once the stored object is deleted, or by the sweep for a
leftover (decision 4) — it records a fact about storage, never a state change, and no other
field of `decks` is written outside the engine. Each mutation runs in one transaction with
a client-minted UUIDv7 `event_id`, idempotent on it: a replay writes nothing and answers the
current truth. Locks are taken session row first, then question row, then deck row, in
every transition: an open takes the session row FOR UPDATE, so two opens run one at a time.
Its two unique constraints are backstops with different outcomes, and neither is ever a
`500`: a violation of `questions.event_id` is a replay, answered with the question that
`eventId` opened (the caller's own; another teacher's is `409 event_id_conflict`); a
violation of the partial unique index on the open question means another question opened
under another `eventId` meanwhile, so the transaction is retried, and the retry closes that
question and opens this one, as a later open always does. An answer takes the session and the question FOR SHARE; a close and a
session's end take the question FOR UPDATE. So an answer racing a close or the session's end
either commits before it and counts, or sees it and is refused. A question the session's end
closes is closed at the session's end — the bell when the sweep or a Start past it ends it
(A17, A18) — never at the sweep's own time. A slide change reads its deck FOR SHARE and a
deck's removal takes it FOR UPDATE, so a deck is never removed under a session showing it.
**A deck's removal is the one transition whose only lock is the deck row:** it takes no
session row (it can't know which session shows the deck before it looks), takes the deck
FOR UPDATE first, then reads the presentation rows without locking them to answer `409
deck_in_use`. That keeps the order: a slide change's FOR SHARE on the same deck row is the
single place the two meet, so they serialise there and never deadlock.
- **Answers never write to `events`.** The events feed streams to the teacher's browser
  (Live updates), so a per-student answer event would put who answered what on the
  teacher's screen and break totals-only. The `responses` row is the record; its own
  `event_id` is its idempotency key.
- **Session lifecycle events with no student go through `insertEvent`** (rule 6; the
  doorbell rings for them), additive to `EVENT_TYPES`: `question_opened` (payload: the
  question's id), `question_closed` (its id, whether it was revealed, and by what: the
  teacher, a newer question, or the session's end) and, in Slice 2, `slide_shown` (the
  deck's id and page, or none when the teacher stops presenting). No `user_id`, and no
  answer counts: the timeline reads them, and counts are read through the guard (decision
  6). None is in `HISTORY_EVENT_TYPES`; `sessionReport`, the grid and the phones skip a type
  they don't count, so old clients ignore them.
- **The server owns the clock.** An answer counts only if the server receives it while the
  question is open and the session is running by the server's clock; otherwise it is `409
  question_closed` and nothing is recorded. No device time is stored for an answer.
- **Answers are not queued in the phone's outbox.** Unlike taps and unlocks, an answer is
  not a must-never-lose record, and one landing after the question closed would be refused
  anyway. The phone sends it as one request; a failure is said honestly on the card with a
  retry (rule 5), and the outbox never holds an answer ahead of an unlock.

**6. The API (additive `/v1`).** Bodies validated at the boundary; every mutation carries
`eventId`; new refusal reasons join `API_ERROR_REASONS` in `@bali/shared`
(`question_not_found`, `question_closed`, `invalid_option`, and in Slice 2 `deck_not_found`,
`deck_not_ready`, `deck_rejected`, `deck_in_use`, `page_out_of_range`), never renamed.

Teacher (the class's own teacher only; another teacher and a student `403`):
- `POST /v1/sessions/{id}/questions` — open a question: `{ eventId, prompt, options,
  correctOption? }`, answered with the question, its correct option included. A session not
  running by the server's clock is `409 session_not_running`; an open question closes in the
  same transaction.
- `POST /v1/questions/{id}/close` — `{ eventId, reveal? }`: closes it, revealing the correct
  option when asked and one exists. A replay, or a close of a question already closed,
  answers the question now and changes nothing, recording nothing (its `eventId` is kept only
  when its `question_closed` event is written).
- `GET /v1/questions/{id}/results` — the aggregate over decision 3's one population:
  `answered` (N), `eligible` (M), whether
  it is open, the correct option and whether it is revealed, and `counts` per option — null
  until at least 3 have answered (the guard is the server's, never only the portal's).
  ETag and `304`.
- The session's boot snapshot (`GET /v1/sessions/{id}`) gains the open question, and in
  Slice 2 the presentation, as optional fields, so a reloaded portal finds them.

Student (enrolled in the session's class now; anyone else `403`, an unknown id `404`):
- `GET /v1/sessions/{id}/presentation` — what the phone shows: whether the session is
  running (false tells the phone to stop polling); the current question — the open one, or
  the last closed one until another opens — with its prompt and options, the correct option
  only once revealed, and never anyone's counts; the caller's own answer, if any; and in
  Slice 2 the slide (deck id, `sha256`, `page`, `page_count`), **never a URL**. A read that
  writes nothing. A strong ETag over the body; `If-None-Match` answers `304`. The body holds
  nothing minted per request, so an unchanged lesson is `304` on every poll.
- `GET /v1/decks/{id}/download` (Slice 2) — a short-lived presigned GET, for the deck's own
  teacher (the presenter), or for a student while a running session of their class shows
  that deck (anyone else `403`, a removed deck `404 deck_not_found`): what the phone calls only
  when the slide names a deck it has not cached, and again if the URL has expired. The phone
  checks the bytes against the slide's `sha256` before rendering them, and refuses a
  mismatch honestly with a retry.
- `POST /v1/questions/{id}/answers` — `{ eventId, option }`, answered with the caller's
  answer now. `400 invalid_option` for an index the question lacks; `409 question_closed`
  past its close or the bell; a replay (or an older answer, decision 4) answers the answer
  now. An `eventId` already spent elsewhere is `409 event_id_conflict`, nothing recorded,
  as for every other mutation (tap step 9). The check matches on the `eventId` alone: any
  `responses` row holding it except the caller's own answer to this question (the replay
  above), so another student's response and the caller's own answer to another question
  both conflict; and any row in `events` holding it, under anyone, the caller included
  (their own tap or unlock), since the answers route checks `events` too though an answer
  writes none. A concurrent insert that trips the `responses.event_id` unique index instead
  is re-read and answered the same way: a replay or `409 event_id_conflict`, never a `500`.

Slice 2, teacher:
- `POST /v1/decks` — `{ eventId, title, bytes, sha256 }`: a `pending` deck and a presigned
  PUT, signed for `application/pdf` and that exact length, the browser uploads to directly.
  More than 25 MB is refused before any URL is minted.
- `POST /v1/decks/{id}/complete` — `{ eventId }`: the API reads the object and checks it —
  the `%PDF-` magic bytes, its size ≤ 25 MB and equal to the declared, the `sha256`, ≤ 200
  pages, not encrypted — then marks it `ready` with its page count, or `rejected` with the
  reason and its object deleted. One-way: a deck `ready` or `rejected` is never checked
  again, and its replay answers the verdict. The PUT expires in 5 minutes; a PUT over a
  `ready` deck's object before then changes bytes no client takes, since every client checks
  the `sha256` the server verified. The checks are bounded: the size cap first, the parse
  under a time limit, a PDF that exceeds either `rejected`. A deck left `pending` 24 hours is
  rejected by the sweep.
- `GET /v1/decks` — the caller's own decks, never a removed one; `DELETE /v1/decks/{id}` —
  remove one (`409 deck_in_use` while a running session shows it).
- `POST /v1/sessions/{id}/slide` — `{ eventId, deckId | null, page }`: show a page of one of
  the caller's own `ready` decks, or stop presenting; recorded as `slide_shown`.
  `400 page_out_of_range` past its page count; `409 session_not_running` as for questions.

Authorization: every new route gets its rows in S1's matrix
(`apps/api/test/authorization-matrix.test.ts`) — no token, another app's token, a student,
another student, a teacher who isn't the owner, the owner — and its request schema in
`contracts/openapi.json`; the student routes get fixtures in `contracts/fixtures/` that
BaliCore decodes. **Rate limits** (ISSUES #1): the 2 s poll is 30 requests a minute per
account, inside the 120-a-minute budget beside the check-in's two, and the poller stops at a
`429` until its `Retry-After`, so the poll never spends the headroom an Emergency Unlock
needs (an unlock refused `429` is still kept and resent, never lost); the portal polls results
from its one visible tab. L4 measures a class of polling phones in the load gate and adds a
dedicated budget only if it must.

**7. Live updates are amended, not replaced.** Students still have no stream; the poll is
their own request and its answer is the truth (Live updates' opening paragraph). The teacher
stream carries decision 5's lifecycle events. Live result counts are polled by the portal,
about every 2 s while a question is open, from the results endpoint, so no per-student data
and no count below the guard ever enters the stream.

**8. Storage (Slice 2).** A private bucket per environment, made by the owner (AWS S3 in the
Cognito account recommended; M0), with no public access and CORS for the portal's origins
only. Uploads go by presigned PUT; clients read by short-lived presigned GET (minutes),
minted by the download route for a caller allowed to see the deck, never in the polled body. It sits behind a storage interface
in the API with an in-memory fake, so CI and `npm run demo` need no AWS. This is the API's
first AWS credential (C3's "the API holds no AWS credential" was about Cognito): an IAM
identity allowed only to put, get and delete objects in that one bucket, its keys Railway
secrets. The portal renders with PDF.js ≥ 4.2.67 (the fix for CVE-2024-4367),
`isEvalSupported: false`, its worker self-hosted (the CSP's `worker-src 'self'`, and the
bucket's origin in `connect-src`). The phone renders with PDFKit, a deck cached by its
`sha256` for the session and deleted when the session ends; links inside a deck are not
opened. Each page's text layer is its VoiceOver label (a page with none says which slide it
is).

**9. Apple and privacy.** Answers are Bali's own data, not Family Controls data, but the
feature strengthens the "organizational setting" reading of §3.3.3(P) (ISSUES #3), so the
owner's App Review question describes it. The steps that ship it update the privacy
manifest, `docs/APP-STORE.md`'s privacy table (answers as "Other User Content") and the
consent preview's "what your teacher sees" list (your answers count in the class's totals;
your teacher never sees your answer).

**10. Compatibility.** Everything is additive: no existing endpoint, field, table or event
changes behaviour. Old app builds can't answer and don't poll, so the count is only ever of
who answered: the portal never calls the rest "didn't answer" or implies the whole class
could.

### The owner's picks (2026-10-09)

The owner confirmed decision 3's defaults and decision 8's limits as written (the guard at 3
answers; the reveal at the teacher's choice on each close; the live breakdown on the teacher's
own screen once the guard allows; decks of at most 25 MB and 200 pages), picked the screens
below, and added saved questions (decision 12). The screens are drafts on two Claude Design
canvases, built only once the owner signs them off (CLAUDE.md, Working rules):
[Live lesson app screens](https://claude.ai/artifact/CZpFbFuxnRrLcuywtJGfVQ) and
[Live lesson portal screens](https://claude.ai/artifact/BxHbGud1xMeyXLUUvsewHM).

**11. What the screens do.**
- **The phone.** While a question or a slide shows, the Focus screen's ring becomes a strip
  under the class's name (the time left and the state's chip), and Emergency Unlock stays
  pinned at the bottom with the rest scrolling above it, at every text size (decision 1's
  "where it is"). A tap on an answer sends it, and another tap changes it until the close;
  there is no Submit. Once revealed, the correct option is marked with a check and the
  student's own as "Your answer", never red and never an X; no count ever reaches a phone. A
  closed question stays until another opens (decision 6's "last closed one"), with a Hide
  that only this phone keeps. With a question and a slide both showing, the question comes
  first. The same card shows on Unlocked, Screen Time off, and Home for an enrolled student
  not tapped in. Phones stay foreground-only: no push for a question, and the shield is
  unchanged.
- **The consent list** gains two lines: "Your answers to questions, counted only in the
  class's totals" under Sees, and "Which answer is yours, or whether you answered" under Never
  sees. The list promises it "never grows without asking you again", so a student who saw the
  old list sees a one-time screen after the update with the two new lines and Continue.
- **The portal.** One "Questions and slides" card between the session card and the live grid.
  While a question or a slide shows, Present shows it in place of the live grid; **while a
  question is open the projector shows only "N of M answered", and the counts per option only
  once it closes**, which removes the guard's known limit (decision 3) for the room while the
  teacher's own screen keeps the live breakdown. Decks live on one teacher-wide "Your slides"
  page; removing one is a plain button and a confirm line, never red (DESIGN.md keeps red for
  removing a student or deleting a class). The recap gains a Questions section: totals only,
  the guard applied.

**12. Saved questions.** A teacher may write questions ahead of class and ask one with a
click. They amend decision 2's "only within a running session": a saved question is the
teacher's own draft, kept outside any session and never shown to a student. Asking one opens a
question through `POST /v1/sessions/{id}/questions` with a copy of its text, so the asked
question is a snapshot and editing the draft later changes no result. Nothing on the phone
changes.
- **Data.** `saved_questions`: `id`, `teacher_id`, `prompt`, `options` (jsonb, 2–6
  strings), `correct_option` (nullable), `event_id` (unique: the mutation that last wrote it),
  `created_at`, `updated_at`, `removed_at`. The teacher's, usable in any of their classes;
  a question's limits (decision 3).
- **Writers.** The transition engine, as for decks: idempotent on `event_id`, a write locking
  the draft's row alone.
- **API** (the teacher's own drafts only; anyone else `403`): `GET /v1/saved-questions` (never a
  removed one, newest first); `POST /v1/saved-questions` `{ eventId, prompt, options,
  correctOption? }`; `PUT /v1/saved-questions/{id}` (the same body, replacing the draft whole);
  `DELETE /v1/saved-questions/{id}` `{ eventId }`. A new refusal, `saved_question_not_found`.
  S1 matrix rows and the OpenAPI snapshot, as for every route.
- **Privacy.** The teacher's words, like a question's prompt: the account deletion of a teacher
  removes their drafts; the disposal and the retention run empty a draft's texts and set
  `removed_at`; never in a student's export. The coverage guards place `teacher_id`.
- **In class** the ask card lists the drafts, each with a one-click Ask (no preview: a wrong
  one is closed), and "Write a new question". Drafts are edited only on the "Your questions"
  page, and a question written in class is not saved for later.

**Still open** (the owner's, settled before L1 is cut; the recommendation first):
- `event_id` uniqueness in both directions (PLAN's open design questions): every route that
  records an `eventId` refuses one that any `responses` or `saved_questions` row holds, as the
  answers route already checks `events`.
- The guard wherever counts are read: the recap and the reports read counts through the same
  guard as the results route.
- The portal checks a deck's `sha256` as the phone does, refusing a mismatch.
- The PDF check runs in a separate worker under a hard time limit, so a hostile file can stall
  only itself, never the API.
- The load gate measures several classes polling at once behind one school's address, not one
  class.
- Production backups are on before answers, education records, are stored on prod (none for
  the pilot today).
- The storage provider (decision 8): AWS S3.

## The six rules

Each exists because v2 broke it and shipped a real bug
(`docs/AUDIT-2026-09-09.md` on `v2-archive`).

1. **The server owns the clock.** Phone timestamps are accepted only for offline catch-up,
   and always clamped into the session's real window. (v2: a backdated phone clock erased
   unlocks from reports and inflated focus minutes.) The clamp orders *events*; it is not a
   substitute for the server's own clock. One order is not the clamp's: which of a student's
   own unlock and return to focus came last is the phone's own order to say when both carry
   one from the same install — its outbox's counter, which no clock moves (A12) — and it
   reads both ways: a late unlock and a late return are each recorded, never applied (A10,
   A12, A13), so a tampered clock can never undo a real unlock, nor can a return that came
   before it. It ranks two taps the same way: a tap older than one already recorded in
   another session is recorded, never applied (A14), so the student's latest tap says where
   they are, whatever order the two reach the server in. The times stay clamped, and a
   pair the order cannot place still judges an unlock by them — never a return or a tap,
   which then applies as it arrives.
   `participations.last_seen_at` — the input to silence, and so to every green chip — is
   stamped server-side, never from the device's claim: a clock running fast would clamp to
   `ends_at`, a time in the future, and the phone would never go silent however long it had
   been gone.
2. **One shared state function.** Student app, teacher grid, and reports all compute
   "what state is this student in" with the same shared code. (v2: teacher saw
   "No device" while the student saw "Focused.")
3. **Verify shields on every check-in.** Each time the app sends its every-30-seconds
   request, it also checks the shields are actually on and re-applies them if not — unless
   Screen Time access is gone, which it reports instead (iOS app structure, rules); the
   screen only claims what was verified. (v2: showed a ticking focus timer while nothing
   was shielded.)
4. **Every write carries an `event_id`.** Sending twice counts once. Retrying is always
   safe. (v2: had no such IDs on some paths.) A retried tap or refocus is answered with
   what was recorded while that is still true, and once it is not, with a `200` that names
   no session — never one that points a phone at a session it is no longer in (tap step
   10, ruled 2026-09-22 and 2026-09-24): the answer drives a shield.
5. **No silent failures.** Every failure is shown to the user with a way to retry. (v2:
   "Revoke link" could fail and close as if it had worked.)
6. **Live updates are rows, not broadcasts.** Every change is inserted as a numbered event
   row. Live screens stream those rows and, after a disconnect, resume from the last number
   they received — nothing missed, nothing duplicated. (v2: held one event in memory and
   dropped simultaneous ones.) A live lesson's answers are the one deliberate exception to
   "every change is an event": they are rows in `responses`, read only as totals, so the
   stream never names who answered what (Live lesson, decision 5); its lifecycle events
   are rows like any other.

## Status

- **Decided:** direct writes + local-first phone; the data model (its tables, seven
  decisions, and honesty rules); auth (Cognito sign-in, JWT tokens, join codes); the API
  surface (REST, `/v1` additive-only, one error shape — endpoint list itself not final);
  the six rules; live updates (SSE + Postgres LISTEN/NOTIFY); hosting (Railway, two
  environments); iOS app structure (native, app + extension, mirror-not-cage); web portal
  (Next.js thin client on Vercel); the items in [ISSUES.md](ISSUES.md) are requirements;
  the live lesson (Phase 7, 2026-10-05: questions and slides within a running session,
  totals only, phones polling), planned and not yet built; the Start's push to waiting
  students (2026-10-06, a visible doorbell, never the truth), planned and not yet built.
- **Open:** one design question, Phase 6: ISSUES #3's fallback, should Apple's answer
  call for one (the issue ranks the fallback designs, best fit first). Next: the build plan (what gets coded
  first). Items deliberately parked live in each section's "decided later" list.
- **Deploys:** the portal builds from `main` as the Vercel project `bali-portal`; the v2
  demo site is the older project `bali-web`, not connected to the repo.
