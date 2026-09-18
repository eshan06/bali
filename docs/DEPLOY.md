# Deploying the Bali API

The API deploys as a single container from the repo's `Dockerfile`. It runs
under `tsx` (the workspace packages export TypeScript source directly, so there
is no compile-to-dist step), applies migrations on start, then serves. Target
platform is Railway (hosting decision 1); the Dockerfile is platform-neutral and
also works on Render or plain Docker.

## What runs

- **Build:** `docker build` → `npm ci` for the whole workspace, then the source.
- **Release/start:** `npm run migrate && npm start`. `migrate` applies the
  committed `packages/db/migrations` to `DATABASE_URL` using drizzle-orm's
  migrator (no drizzle-kit in production); it records and skips already-applied
  migrations, so it is safe to re-run.
- **Health check:** `GET /healthz`.
- **Sweep:** a scheduled `POST /internal/sweep` with the `x-internal-key` header
  (see below) — one minute-tick that expires ended sessions and opens silence
  episodes for phones gone quiet. Idempotent, so a double-fire is harmless.

## Environment variables

All are validated at boot (`apps/api/src/env.ts`); a missing or malformed one
fails the boot with a readable message. See `.env.example` for the full list
with notes. The ones a deploy must set:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Managed Postgres connection string. |
| `AUTH_ISSUER` / `AUTH_JWKS_URI` / `AUTH_AUDIENCE` | The Cognito pool's issuer, its JWKS endpoint, and the app client id. |
| `INTERNAL_API_KEY` | Long random secret (`openssl rand -hex 32`) for the sweep cron. |
| `TZ` | The school's zone (e.g. `America/Chicago`). Bell times and armed-tap end-of-day expiry use server-local time; Railway defaults to UTC. |
| `LOG_LEVEL` | `info` in production. |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | Set above `SHUTDOWN_DEADLINE_MS` (8s) so graceful shutdown finishes before SIGKILL. |

`PORT`/`HOST` are provided by the platform; `NODE_ENV` defaults to `production`.

## First-time setup checklist (needs the Railway dashboard + AWS)

These steps need credentials this repo doesn't hold — do them once per
environment (start with **dev**, then **production**; hosting decision 2 keeps
them fully separate):

1. **Cognito** — create (or reuse the v2) user pool and an app client. Note the
   issuer URL, JWKS URI, and app client id for the `AUTH_*` variables.
2. **Railway project** — create a project with two environments (dev, prod). Add
   the **Postgres** plugin to each; it supplies `DATABASE_URL`. Enable daily
   backups + point-in-time recovery, same region as the service (decision 4).
3. **Deploy the service** — connect this repo; Railway reads `railway.json` and
   builds from the `Dockerfile`. Set all environment variables above.
4. **Sweep cron** — add a Railway cron that runs **every minute** (the silence
   threshold is 90s, so a per-minute tick opens episodes promptly) and POSTs to
   `/internal/sweep` with `x-internal-key: $INTERNAL_API_KEY`.
5. **Verify** — `GET /healthz` returns `{"status":"ok"}`; a signed request to
   `GET /v1/me` returns the caller; the cron shows `{"expired":N,"wentSilent":M}`.

## Local run

```bash
npm ci
cp .env.example .env   # fill in DATABASE_URL etc.
npm run migrate        # apply migrations to your local Postgres
npm start              # serve on PORT (default 3001)
```

No external services are needed to see the core flow end-to-end:

```bash
npm run demo           # walks arm → start → join → unlock → refocus → end (in-memory)
```
