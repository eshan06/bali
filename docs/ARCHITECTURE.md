# Bali v3 — Architecture

Decisions live here. Changing one means discussing it first.

## What Bali is

A teacher taps their Bali block (an NFC tag) to start a timed focus session for the class.
Each student's iPhone locks itself for the session using Screen Time shields — everything
blocked except a short allow-list the student picked once. The teacher sees a live grid of
who's focused. Afterward: reports, including every emergency unlock.

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
   a retry — do nothing. This makes retries safe to repeat (idempotency). An `event_id`
   already recorded in `events` for a *different* event — another student's, another
   kind of event, or this student's tap under another teacher — is not a retry but a
   client bug, and gets `409` instead: a `200` would tell the phone to delete a record
   the server never kept (step 10). When the tap is saved as armed (decision 5), the same
   goes for an id already held by a waiting tap that is not this student's for this
   teacher. Blocks cannot move yet; the endpoint that lets them must revisit the
   other-teacher case, because after a move an honest retry looks exactly like it.
10. Respond `200 OK`. Only now does the phone delete the record from local storage.
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
- `schools` — one row per school, so users and classes can be grouped under one.
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
  participation unless its tap had already landed; it expires at the end of the school
  day. Transient — not the permanent history that lives in `events`.

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
breaks; screens simply skip rows where `removed_at` is set. Really deleting the row is
exactly how v2 stranded a student in a locked session with no way out.

**4. A student can be in only one session at a time.** If a student in one session taps
into another, their first participation is ended and recorded in the `events` table as
`left_for_other_session` — its own kind of event, so switching classes is never counted
as an emergency unlock in any report.

**5. A tap before the teacher has started is saved and waits — an "armed" tap.** It's
7:58, the bell hasn't rung, and a student taps the block walking to their seat — no
session exists yet. Rejecting the tap punishes normal behavior; shielding now locks the
phone before class starts. So the server just saves "this student tapped this teacher's
block" and the phone shows "Ready — waiting for your teacher." When the teacher presses
Start, every waiting tap becomes a participation and those phones shield — nobody taps
twice. The one exception is a tap that was already honoured (ruled 2026-09-22): a waiting
tap whose `event_id` is already recorded as that student's own `tap_in` is the retry of a
tap that landed in another session, and joining it would shield the student in a session
they never tapped into. It is consumed without joining and recorded as an
`armed_tap_skipped` event in the session that declined it, so the history says why that
student is not there. It's saved as student + teacher, since one block serves all of a
teacher's classes and the class is only knowable once a session starts. It expires at the
end of the school day.

**6. Sessions end themselves.** The phone knows the session's end time, so it removes the
shields at that moment using its own clock, even with no internet. On the server, a small
scheduled program marks the session and its participations as ended and adds a
`session_expired` event. If the teacher adds time, that is recorded as its own
`session_extended` event, so reports show exactly what happened.

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

- What happens when a family legally asks for their child's data to be deleted. That
  collides with "unlock records are never lost," so it needs a deliberate policy decision,
  not a quick rule.

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
roughly once, ever. Our `users` table stores each row's Cognito ID, linking "who Cognito
says this is" to our data about them.

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
- **A saved emergency unlock outlives an expired token.** If a student's token expired
  while they were offline, the app refreshes the token first and then sends the queued
  record. An auth problem is never a reason to throw a record away.
- **Sign-in limits are sized for a school.** Sign-in happens before we know who's asking,
  so it's limited by internet address — with budgets sized for a whole school behind one
  address, slowing requests down before ever blocking them (ISSUES.md #1).
- **Under-13 consent is a flagged policy decision.** Accounts for young students carry
  legal requirements (parental consent). It's parked next to data deletion in "decided
  later, on purpose" — to be settled deliberately, not mid-sprint.

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
  call quietly creates the student's `users` row.
- `POST /v1/taps` — the tap; the response says which outcome happened: joined, armed,
  or switched sessions.
- `POST /v1/sessions/{id}/checkin` — the every-30-seconds "still here"; the response
  carries the current truth (state, end time) so the phone can reconcile.
- `POST /v1/sessions/{id}/unlock` and `POST /v1/sessions/{id}/refocus` — emergency
  unlock, and coming back from one.
- `POST /v1/enrollments` — join a class by code.
- `DELETE /v1/enrollments/{id}` — leave a class; recorded as its own event and visible
  to the teacher, so quietly leaving to dodge a session is always on the record.
- `GET /v1/me/history` — the student's own timeline screens.

Teacher app and web portal:
- `GET /v1/me` — same boot call, role-aware.
- `POST` / `GET` / `PATCH` `/v1/classes…` — create and manage classes.
- `GET /v1/classes/{id}/roster` — the roster; `DELETE /v1/enrollments/{id}` — remove a
  student (the one-transaction removal).
- `POST /v1/classes/{id}/sessions` — start a session; if one is already open for this
  class, the response returns that session instead of creating a duplicate.
- `POST /v1/sessions/{id}/end` and `POST /v1/sessions/{id}/extend`.
- `GET /v1/sessions/{id}/events?after={number}` — catch-up reads of the event log.
  (The live stream endpoint is decided in the live-updates section.)
- `GET /v1/classes/{id}/reports/…` — focus minutes and unlocks.
- `POST /v1/blocks` — register a physical block to a teacher.

**4. Every request is checked; every error has one shape.** No request body is trusted:
each endpoint validates its input (right types, sane sizes) before touching the
database. Failures return one standard JSON error shape with the right status code —
`400` bad input, `401` bad token, `403` signed in but not allowed, `409` conflict,
`429` over budget (per-user budgets on signed-in endpoints, per-address on sign-in,
per ISSUES.md #1) — so every screen can show something honest instead of guessing.

### Rules that keep the API honest

- **The response is the reconciliation channel.** Every student-action response carries
  the server's current truth — that's how a phone discovers "you were removed,"
  "session ended," or "you're armed, not joined." An API that only says "ok" recreates
  v2's drift.
- **For unlock records, no response ever means "discard."** The contract spells out
  which errors mean retry later and which mean recorded-with-a-note. v2's lost-unlock
  bug lived exactly at this gap. The engine implements this: `unlock` always commits
  the event, tagging it `payload.recorded_as` (`no_live_participation` /
  `after_session_end` / `unknown_session` / `not_enrolled`) when there is no live
  participation to flip; the outbox disposition (`recorded` / `retry` / `reauth`) is
  the typed table in `@bali/shared`. "Never refuse" is not "never check": a caller
  with no participation row in the session **and** no active enrollment in its class
  has no standing there, so their unlock records as an orphan (`not_enrolled`, no
  session or class attached, the claimed id in the payload) rather than writing into
  a stranger's history and live grid. A student removed mid-session keeps their ended
  participation row, so the case this rule exists for is untouched.
- **Old apps call forever.** `/v1` plus additive-only is a discipline held in code
  review, not a feature.

## Live updates

How a new row in the `events` table reaches the teacher's screen within a second or two.
Only teacher screens get a live feed — student phones learn the truth from the responses
to their own requests — so live connections ≈ one per running class, not one per student.

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

**3. The session-expiry sweep runs as a Railway cron job** calling an internal
endpoint. The sweep is idempotent, so an accidental double-run is harmless.

**4. Database safety from day one.** Automatic daily backups with point-in-time
recovery, and the database in the same region as the API.

**5. The deploy sets `TZ` to the school's zone.** The server's local time is the
school's: bell times render in it (carried over from v2) and an armed tap's
"end of the school day" expiry is computed against it. Railway defaults to UTC,
so this must be set explicitly per environment.

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

### Rules that keep the phone honest

- **Turning off Screen Time permission is handled by being honest, not by fighting it.** iOS
  itself drops all shields the instant the permission is revoked — we can't prevent it. So the
  next check-in notices, the server records it as its own event, and the grid shows "turned
  protection off" (a distinct state — never green, never an unlock). Returning to focus needs
  an explicit re-tap. This permanently kills v2's worst bug, which was pretending to be
  shielded after exactly this.
- **A closed app still shows the truth fast.** When the app is force-quit, check-ins stop and
  within about a minute the grid shows "app closed" honestly. (What should happen to the
  shields themselves in that case is in "decided later" below.)
- **A changed phone clock is detected, not prevented.** iOS scheduling follows wall-clock
  time, so a clock change is a real bypass family; the server compares against its own clock
  (rule 1) and surfaces it to the teacher rather than trusting it.

### Decided later, on purpose

- **What the shields do when the app is force-quit.** Two options: (a) shields stay until the
  session ends — the extension guarantees the unlock at the bell even with the app closed, and
  Emergency Unlock is the one-tap sanctioned exit during the session; or (b) a watchdog turns
  shields off after force-quit, but iOS's coarse wake clock makes the honest promise "off
  within ~15 minutes," not instant. Leaning (a). The teacher-portal half ("app closed" within
  a minute) is locked regardless.
- **A second enforcement layer: a local VPN filter.** The app installs a VPN profile whose
  traffic loops through a small filter on the phone itself, refusing connections to blocked
  destinations. It adds what Screen Time can't: starving apps of internet, blocking websites
  in every browser, instant server-updated block lists, and a backup layer that still works if
  Screen Time permission is revoked. Catches: the student can switch the VPN off in Settings
  (detect and mark it), offline apps/games are untouched, a VPN badge shows in the status bar,
  and it means seeing traffic on a minor's phone (a deliberate privacy call). Not in the launch
  path, but a genuine candidate for production as a layer-2 enforcement engine alongside
  Screen Time.
- **Applied for now:** the Family Controls distribution entitlement (longest lead time, weeks
  to months) — submitted per bundle ID including the monitor extension.

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

**4. The grid states its own health.** On a dropped stream it shows "reconnecting — last
updated 40s ago" instead of freezing green, then catches up by event number. Only a real
`401` signs a teacher out; a network blip shows "can't reach the server — retry."

**5. Deploys on Vercel when we ship.** A new project watching `main`; removing the
`vercel.json` deploy block is the deliberate flip. Two open tabs are fine (each stream
has its own cursor; capped at 5 per account), and a tab left open across a deploy gets a
"new version — refresh" banner.

## The six rules

Each exists because v2 broke it and shipped a real bug
(`docs/AUDIT-2026-09-09.md` on `v2-archive`).

1. **The server owns the clock.** Phone timestamps are accepted only for offline catch-up,
   and always clamped into the session's real window. (v2: a backdated phone clock erased
   unlocks from reports and inflated focus minutes.) The clamp orders *events*; it is not a
   substitute for the server's own clock. `participations.last_seen_at` — the input to
   silence, and so to every green chip — is stamped server-side, never from the device's
   claim: a clock running fast would clamp to `ends_at`, a time in the future, and the phone
   would never go silent however long it had been gone.
2. **One shared state function.** Student app, teacher grid, and reports all compute
   "what state is this student in" with the same shared code. (v2: teacher saw
   "No device" while the student saw "Focused.")
3. **Verify shields on every check-in.** Each time the app sends its every-30-seconds
   request, it also checks the shields are actually on and re-applies them if not; the
   screen only claims what was verified. (v2: showed a ticking focus timer while nothing
   was shielded.)
4. **Every write carries an `event_id`.** Sending twice counts once. Retrying is always
   safe. (v2: had no such IDs on some paths.)
5. **No silent failures.** Every failure is shown to the user with a way to retry. (v2:
   "Revoke link" could fail and close as if it had worked.)
6. **Live updates are rows, not broadcasts.** Every change is inserted as a numbered event
   row. Live screens stream those rows and, after a disconnect, resume from the last number
   they received — nothing missed, nothing duplicated. (v2: held one event in memory and
   dropped simultaneous ones.)

## Status

- **Decided:** direct writes + local-first phone; the data model (its tables, seven
  decisions, and honesty rules); auth (Cognito sign-in, JWT tokens, join codes); the API
  surface (REST, `/v1` additive-only, one error shape — endpoint list itself not final);
  the six rules; live updates (SSE + Postgres LISTEN/NOTIFY); hosting (Railway, two
  environments); iOS app structure (native, app + extension, mirror-not-cage); web portal
  (Next.js thin client on Vercel); both items in [ISSUES.md](ISSUES.md) are requirements.
- **Open:** nothing — the design is complete. Next: the build plan (what gets coded
  first). Items deliberately parked live in each section's "decided later" list.
- **Deploys:** the demo site builds from `v2-archive` (Vercel's production branch);
  `main` is v3 only.
