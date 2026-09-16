# Bali v3 — Architecture

The plan we build on. Decisions get recorded here; changing one means discussing it first.
Plain language on purpose.

---

## What Bali is

A teacher taps their Bali block to run a timed focus session for their class. Each student's
iPhone locks itself down for the session (everything shielded except a small allow-list the
student picked once). The teacher watches a live grid of who's focused, and gets honest
reports afterward — including every emergency unlock. Parents can get a view-only link.

v3 is a from-scratch rebuild of v2. The v2 code and its bug audit live on the `v2-archive`
branch. The goal of v3: the same product, built so it stays correct and honest when many
schools use it at the same time.

## The shape

```
 Student iPhones          Teacher (web + iPhone)
       │                          │
       ▼                          ▼
 ┌─────────────────────────────────────┐
 │    API — identical server copies    │   need more capacity? add copies
 └──────────────────┬──────────────────┘
                    ▼
          ┌──────────────────┐
          │     Postgres     │   the single source of truth
          └──────────────────┘
```

Three parts:

- **The apps** (student iPhone app, teacher iPhone app, teacher web portal) — what people touch.
- **The API** — a row of identical servers. None of them keeps anything important in its own
  memory; everything worth keeping goes in the database. That's what makes them identical —
  any copy can answer any request, and handling more schools just means adding copies.
- **The database (Postgres)** — the single source of truth. If the database and anything
  else ever disagree, the database is right.

## Decision: how a tap gets saved — A + C (decided 2026-09-15)

**A — straight into the book.** Every tap is written directly into the database while the
student waits (a fraction of a second). When the phone hears "you're in," the tap is saved
for real — no maybes.

**C — the phone waits for nobody.** The phone locks itself the instant the student taps,
then reports to the server whenever it can — immediately on good Wi-Fi, later with retries
on bad Wi-Fi. Retries use a small random delay so a whole school's reports arrive spread
out instead of as one stampede.

**Why not B (a waiting line in the middle)?** A waiting line ("we'll write it to the
database in a moment") makes "got it" stop meaning "saved it" — if the line crashes,
records vanish and nobody knows. That trade only makes sense at a scale we don't have:
our biggest moment, a whole school tapping at the bell, is a few hundred small writes
spread over a minute, which the database handles easily. For a product whose value is
records people trust, we don't trade certainty for crowd-handling we don't need.
Escape hatch: the "save a tap" code lives in one tidy spot, so if we ever truly need a
waiting line, adding it later is a small surgery, not a rebuild.

## The rules every part follows

These exist because v2 broke each one, and each break became a real bug (see
`docs/AUDIT-2026-09-09.md` on the `v2-archive` branch).

1. **The server owns the clock.** Phone-supplied times are only accepted for offline
   catch-up, and always clipped to fit inside the session's real time window. (v2 let a
   student's backdated clock erase unlocks from reports and inflate focus minutes.)
2. **One brain for student state.** Every screen — student app, teacher grid, reports,
   parent view — computes "what state is this student in" using the same single piece of
   shared code. (v2 showed the teacher "No device" while the student saw "Focused.")
3. **The phone proves, never assumes.** Every heartbeat, the app checks that shields are
   *actually* on and re-applies them if not. The screen only ever claims what it can prove.
   (v2's worst bug: phone showed a ticking focus timer while nothing was shielded.)
4. **Every action has an ID.** Taps, unlocks, and retries carry a unique ID, so sending
   twice counts once. Retrying must always be safe.
5. **No silent failures.** If something fails, the person sees it and can retry. An error
   the user isn't told about is itself a bug. (v2's "Revoke link" could fail and close as
   if it worked.)
6. **Live updates are saved events, not shouted messages.** Every change is written into
   the database as a numbered event. Teacher screens read the stream and, after any
   disconnect, catch up from their last number — nothing missed, nothing doubled.
   (v2 could only hold one event at a time and dropped simultaneous ones.)

## Status

- **Decided:** A + C; the shape above; the six rules; issues #1 and #2 in
  [ISSUES.md](ISSUES.md) are design requirements, not nice-to-haves.
- **Open:** which cloud hosts the API and database; whether extra realtime infrastructure
  is ever needed (only with measurements proving it).
