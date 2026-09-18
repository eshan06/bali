# Bali

Tap a block, the phone locks into focus. This is the v3 rebuild; the design doc is
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Layout

| Workspace         | What it is                                                        |
| ----------------- | ----------------------------------------------------------------- |
| `apps/api`        | The Fastify HTTP API                                              |
| `apps/web`        | The teacher web portal (Next.js) — see [docs/WEB.md](docs/WEB.md) |
| `packages/db`     | Drizzle schema, migrations, and the Postgres client               |
| `packages/shared` | Types and constants shared by server and clients                  |

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

See the whole Phase-1 flow end-to-end, with no external services, via an in-memory
Postgres:

```bash
npm run demo
```

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
