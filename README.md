# Bali

Tap a block, the phone locks into focus. This is the v3 rebuild; the design doc is
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Looking for the version that works today?** v2 — the app as it ran before this rebuild —
is on the [`v2-archive`](https://github.com/eshan06/bali/tree/v2-archive) branch. `main` is
v3 and isn't finished yet; [docs/PLAN.md](docs/PLAN.md) says where it stands.

## Layout

| Workspace         | What it is                                                        |
| ----------------- | ----------------------------------------------------------------- |
| `apps/api`        | The Fastify HTTP API                                              |
| `apps/web`        | The teacher web portal (Next.js) — see [docs/WEB.md](docs/WEB.md) |
| `packages/db`     | Drizzle schema, migrations, and the Postgres client               |
| `packages/shared` | Types and constants shared by server and clients                  |
| `ios/BaliCore`    | The iOS apps' shared Swift package (not an npm workspace)         |

## From zero

Requires Node 22 — `.nvmrc` pins it, `nvm use` picks it up.

```bash
npm ci
npm run typecheck && npm run lint && npm test
npm run dev:api        # then: curl localhost:3001/healthz
```

Configuration comes from a single `.env` at the repo root (`.env.example` lists every
variable with notes). Every variable the API reads is declared and validated in
`apps/api/src/env.ts`; a missing or malformed value fails the boot with a readable list
instead of a crash somewhere downstream.

`ios/BaliCore` needs Swift 6, on macOS or Linux: `swift test` there decodes every contract
fixture in `contracts/fixtures/` with the Swift types, in place, and checks its outbox tables
against the TypeScript's answers in the fixtures and in `contracts/outbox/`. `npm run fixtures`
regenerates both directories.

## The exit demo (phone simulator)

`npm run demo` runs the whole classroom flow end-to-end over the **real HTTP API**,
with no external services. It stands up a local server on a throwaway port backed
by an in-memory Postgres (or a real one when `TEST_DATABASE_URL` is set), mints its
own tokens against an in-process stand-in for Cognito, and then drives it exactly as
four phones and a teacher's browser would — or, with `DEMO_API_URL` set, it drives a
**deployed** API with real Cognito sign-ins instead (see below). The incidents are
identical either way:

- Ms. Rivera creates a class and a block, four students join by code, the session
  starts, and every phone taps in (all focused) and heartbeats.
- **Ana** hits emergency unlock, then refocuses. Then she switches Screen Time off:
  her phone reports **protection off** (never green, never an unlock), refocus is
  refused, and only a re-tap of the block returns her to focus.
- **Ben**'s phone goes quiet; the minute sweep opens a silence episode
  (`went_silent`), and his next check-in closes it (`came_back`) — while the plain
  heartbeats emit no events at all.
- **Cal** is removed mid-session; his phone, not yet knowing, still hits unlock —
  which is **recorded with a note** (`no_live_participation`), never a 404 or a
  discard (the ISSUES #2 guarantee) — and his next check-in learns he is `gone`.
- The teacher's grid watches all of it **live over SSE**: the stream is opened before
  the first incident, and the run asserts that every event written afterwards arrived
  on it, not merely that it could be read back later (rule 6).
- A second, one-minute session then **ends itself at the bell** — nobody presses
  anything; the sweep expires it, `session_expired` reaches the grid live, the
  participations close, and the phone learns the truth from its own next check-in
  (decision 6). A protection-off report that phone only sends after the bell is
  still **recorded with a note** (`after_session_end`), live on the grid, and
  answered with no session to shield to.

It prints the live grid and the permanent event log at the end, and it is
**self-checking**: each incident asserts the guarantee it exists to prove, so a
regression makes the command exit non-zero.

```bash
npm run demo                                    # in-memory Postgres, zero setup
TEST_DATABASE_URL=postgres://…@localhost/db npm run demo   # against real Postgres
```

### Running it against a deployed API

Setting `DEMO_API_URL` switches the demo to a deployed environment (Railway **dev** —
never production). Nothing about the incidents changes; what changes is that there is
no database handle, so the two things local mode fakes happen for real instead: the
actors sign in through **real Cognito**, and time compression becomes waiting, which is
what makes the run prove the _deployed_ sweep works rather than one the script poked.
A remote run therefore takes a few minutes and prints progress while it waits.

```bash
# Keep the password out of shell history and `ps` output: put the variables in
# `.env.demo` (already gitignored by the `.env.*` rule) and source it, prompting
# for the password itself. DEMO_INTERNAL_KEY is a real secret — never commit it.
set -a; . ./.env.demo; set +a
read -rsp 'demo password: ' DEMO_PASSWORD && export DEMO_PASSWORD
npm run demo
```

| Variable                 | Notes                                                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEMO_API_URL`           | The deployed API's base URL; must be `https` for any non-loopback host, since every request carries a bearer token. Its presence selects remote mode.                                                 |
| `DEMO_COGNITO_CLIENT_ID` | An app client id in the pool, one the API accepts (listed in `AUTH_AUDIENCE`).                                                                                                                        |
| `DEMO_COGNITO_REGION`    | Defaults to `AWS_REGION`, then `us-east-1`.                                                                                                                                                           |
| `DEMO_USER_<ACTOR>`      | The Cognito username per actor: `TEACHER`, `ANA`, `BEN`, `CAL`, `DANA`.                                                                                                                               |
| `DEMO_PASSWORD`          | Their password. `DEMO_PASSWORD_<ACTOR>` overrides it for one actor.                                                                                                                                   |
| `DEMO_INTERNAL_KEY`      | Optional. The deployment's `INTERNAL_API_KEY`, which lets the demo run the sweep itself instead of waiting for the platform's cron — minutes faster. Read from the environment only; never commit it. |
| `DEMO_SWEEP_WAIT_MS`     | How long an incident waits for a sweep-produced event. Defaults to 150s (a per-minute cron plus margin).                                                                                              |

Credentials are read from the environment and never logged — a failed sign-in reports
Cognito's own error type, not the password.

**AWS-side prerequisites** (once per environment, and the demo tells you which one is
missing rather than failing obscurely):

1. Five test users in the dev pool, each with a permanent password (a temporary one
   leaves the account in `NEW_PASSWORD_REQUIRED` and no token is issued).
2. `ALLOW_USER_PASSWORD_AUTH` enabled on the app client — the flow the demo signs in
   with.
3. The teacher's **role flip and a school**. Every first sign-in provisions a
   _student_ with no school (`GET /v1/me`), and nothing ever assigns one — but
   `classes.school_id` is `NOT NULL`, so the role by itself is not enough:

   Easiest path: run the demo and paste the two statements it prints — it mints
   the id for you. `schools.id` has **no database default** (ids are minted in
   TypeScript, data-model decision 2), so the insert has to supply one; to write
   them by hand, mint a UUIDv7 with
   `node --input-type=module -e "import {v7} from 'uuid'; console.log(v7())"`
   (run from a checkout after `npm ci`, or use any UUIDv7 generator).

   ```sql
   -- Creates a school only if you have no live one, then attaches the teacher to
   -- the oldest — correct whether or not the table was empty, and it ignores
   -- soft-removed schools (nothing is really deleted, decision 3).
   -- Run both: with no live school the UPDATE attaches nothing and reports "UPDATE 0".
   INSERT INTO schools (id, name)
   SELECT '<uuidv7>', 'Demo School' WHERE NOT EXISTS (SELECT 1 FROM schools WHERE removed_at IS NULL);
   UPDATE users SET role = 'teacher', school_id = (SELECT id FROM schools WHERE removed_at IS NULL ORDER BY created_at LIMIT 1)
   WHERE id = '<their id>' AND EXISTS (SELECT 1 FROM schools WHERE removed_at IS NULL);
   ```

   The demo prints whichever half is missing, with the id filled in, rather than
   failing obscurely.

The run creates a fresh class, block, and session each time and ends the session it
started, so it never needs anything wiped between runs. If a previous run crashed and
left a session live, the tap asserts say so — wait for the sweep to expire it, or end
it from the portal, and re-run.

If you run this from a network that requires an HTTPS proxy, Node's built-in `fetch`
ignores `HTTPS_PROXY` unless you set `NODE_USE_ENV_PROXY=1`.

## Web portal

The teacher portal lives in `apps/web` (Next.js). It runs locally against the dev
API and signs in through Cognito with a public PKCE client:

```bash
npm run dev -w @bali/web    # http://localhost:3000
```

It needs a Cognito **web** app client and a few `NEXT_PUBLIC_*` variables; the full
setup — app-client provisioning, callback URLs, and the teacher role flip
(`UPDATE users SET role = 'teacher' WHERE cognito_id = '<sub>'`, since every first
sign-in provisions a student) — is in [docs/WEB.md](docs/WEB.md). The API serves the
portal cross-origin only when `CORS_ORIGINS` is set; unset means no CORS, today's
behavior for the native apps.

## Deploying

`npm run migrate` applies migrations to `DATABASE_URL`; `npm start` serves the API. The
container builds from the root `Dockerfile` and runs both. Full deploy steps (Railway,
Cognito, the session-expiry cron, required env vars) are in [docs/DEPLOY.md](docs/DEPLOY.md).

## Database

The schema lives in `packages/db/src/schema.ts`; `packages/db/migrations/` holds the
generated SQL and is never hand-edited (custom migrations, like the events append-only
trigger, are added with `drizzle-kit generate --custom`). After a schema change, run
`npm run db:generate -w @bali/db` and commit the new migration with it. Tests apply the
committed migrations to an in-process Postgres (PGlite), so `npm test` needs no database
server — locally or in CI. `npm run migrate` applies them to a real `DATABASE_URL`.
