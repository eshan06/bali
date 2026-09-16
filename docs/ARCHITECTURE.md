# Bali v3 — Architecture

Decisions live here. Changing one means discussing it first.

## What Bali is

A teacher taps their Bali block (an NFC tag) to start a timed focus session for the class.
Each student's iPhone locks itself for the session using Screen Time shields — everything
blocked except a short allow-list the student picked once. The teacher sees a live grid of
who's focused. Afterward: reports, including every emergency unlock. Parents can get a
view-only link.

v3 is a from-scratch rebuild. The v2 code and its bug audit live on the `v2-archive` branch.

## The system

```
Student iPhones     Teacher web + iPhone
      │                    │
      ▼                    ▼
┌───────────────────────────────┐
│ API — identical server copies │
└───────────────┬───────────────┘
                ▼
           PostgreSQL
    (single source of truth)
```

- **Apps** — student iPhone app, teacher iPhone app, teacher web portal.
- **API** — stateless servers: they keep nothing in memory worth keeping, so every copy is
  interchangeable and scaling means adding copies behind a load balancer.
- **PostgreSQL** — the database. If anything else disagrees with it, the database is right.

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
   a retry — do nothing. This makes retries safe to repeat (idempotency).
10. Respond `200 OK`. Only now does the phone delete the record from local storage.
11. Insert an event row so the teacher's live grid updates (see rule 6).

**Why no queue in the middle.** A queue (e.g. Redis) between the API and the database means
the server replies "got it" before the row is actually written. If the queue crashes first,
the record is gone — after the phone already deleted its copy. Disqualifying for a product
built on trustworthy records. Also unnecessary: a whole school tapping at the bell is a few
hundred INSERTs spread over a minute, and Postgres handles thousands per second. The
tap-saving code lives in one module, so if real load ever demands a queue, adding one is a
contained change.

## The six rules

Each exists because v2 broke it and shipped a real bug
(`docs/AUDIT-2026-09-09.md` on `v2-archive`).

1. **The server owns the clock.** Phone timestamps are accepted only for offline catch-up,
   and always clamped into the session's real window. (v2: a backdated phone clock erased
   unlocks from reports and inflated focus minutes.)
2. **One shared state function.** Student app, teacher grid, reports, and parent page all
   compute "what state is this student in" with the same shared code. (v2: teacher saw
   "No device" while the student saw "Focused.")
3. **Verify shields on every heartbeat.** A heartbeat is the app's small status request
   every ~30s. On each one, the app checks the shields are actually on and re-applies them
   if not; the screen only claims what was verified. (v2: showed a ticking focus timer
   while nothing was shielded.)
4. **Every write carries an `event_id`.** Sending twice counts once. Retrying is always
   safe. (v2: had no such IDs on some paths.)
5. **No silent failures.** Every failure is shown to the user with a way to retry. (v2:
   "Revoke link" could fail and close as if it had worked.)
6. **Live updates are rows, not broadcasts.** Every change is inserted as a numbered event
   row. Live screens stream those rows and, after a disconnect, resume from the last number
   they received — nothing missed, nothing duplicated. (v2: held one event in memory and
   dropped simultaneous ones.)

## Status

- **Decided:** the system shape; direct writes + local-first phone; the six rules; both
  items in [ISSUES.md](ISSUES.md) are requirements, not nice-to-haves.
- **Open:** hosting provider for the API and database.
- **Deploys:** the demo site builds from `v2-archive` (Vercel's production branch);
  `main` is v3 only.
