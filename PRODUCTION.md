# Bali — Production Readiness

Status of getting Bali (API + web; iOS tracked separately in HANDOFF.md) to production, and
what's left. Written 2026-06-14. The architecture is sound — zod validation, parameterized
Drizzle queries, policy snapshots, SSE-with-poll-fallback, a lazy-bell sweeper. The gaps are
operational and were closed or triaged below.

## Go-live web hardening (2026-06-16) — driven by a multi-perspective audit

A multi-agent audit (4 principal-engineer lenses + teacher/parent/admin/product personas, each
finding adversarially verified against the code) produced a prioritized backlog; the web track is
now go-live ready. Shipped this session (all on `main`, web + a db seed fix):

**P0 blockers (fixed):**
- **docker-compose web build now passes the Cognito/redirect build args** (was: only
  `NEXT_PUBLIC_API_URL`, so the documented `docker compose up --build` baked empty Cognito → a
  portal where no teacher could sign in). Dockerfile declares them + optional site/lead args.
- **`/t/[code]` no longer dead-ends on a fake striped "app store badge."** Honest env-driven link
  (`NEXT_PUBLIC_APP_STORE_URL`); until the iOS app is published it says "coming to the App Store
  soon," not a broken graphic.
- **`seed.ts --reset` fixed** — it crashed on a FK violation (added `parent_links` delete before
  `memberships`); the documented reseed path now works. All 12 API + 12 shared tests green.

**P1 (fixed):**
- **Security headers + CSP on the web tier** (`next.config.ts`): `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy` (global `strict-origin-when-cross-origin`; `no-referrer` on the
  token-bearing `/p` & `/t`), a prod-only `Content-Security-Policy` (allows the API origin + SSE +
  Cognito) + HSTS, and `poweredByHeader: false`. Verified served.
- **Build-time env guard** (`apps/web/src/lib/env.ts`, called from `next.config.ts`): a production
  build now *fails* when the Cognito pair is empty or `NEXT_PUBLIC_ALLOW_DEV_TOKENS=1` — the
  dev-token auth-bypass can never be inlined into a prod bundle (also co-gated on `NODE_ENV`).
- **Central 401 handling** (`api.ts` + `auth.tsx`): an expired/revoked session now clears auth and
  bounces to `/login` (from the portal only) instead of every page hanging on "Loading…".
- **Web mutation + first-load error handling** across the whole teacher portal: failures surface a
  dismissible toast; failed loads show a "Couldn't load — Retry" instead of a permanent spinner
  (shared `ErrorToast`/`LoadError` in `bits.tsx`). Tag-deactivate failures no longer mislead.
- **SSE live grid escalates a sustained outage** to a loud "Live updates lost — reload" banner
  instead of a too-calm "Reconnecting" pill (a monitoring-surface safety gap).
- **Real `/privacy`, `/terms`, `/contact` routes** (K-12-appropriate, FERPA/COPPA framing, grounded
  in the actual status-only data practices; offline-unlock claim scoped honestly). Footer + privacy
  section link them; `/p` & `/t` are `noindex` + `robots.ts` disallows them.
- **Landing**: full-focus copy (was describing the pre-pivot class-policy model); the "Book a demo"
  form now captures a lead (composes an email) instead of being a dead `#demo` anchor; a clear
  "Sign in" path for self-serve teachers (Google auto-provisions).
- **a11y**: `--text-tertiary` darkened to meet WCAG AA; `Label` renders a real `<label>`;
  parent-link modal closes on Escape; live grid is responsive (`grid-cols-2 sm:3 md:4`).

**P2 (fixed):** favicon/`icon.svg`, `apple-icon`, OpenGraph image + Twitter/OG metadata +
`metadataBase`, web manifest, `sitemap.ts`, branded `not-found` + `global-error`, `apps/web/.env.example`,
CSV-export `res.ok` guard, auth-callback poll-retry (no more fixed 600ms hang).

### Still open / explicitly out of scope (owner decisions)
- **No App Store URL yet** — `/t/[code]` says "coming soon" until `NEXT_PUBLIC_APP_STORE_URL` is set
  (the iOS app isn't published; FamilyControls justification pending — see HANDOFF.md).
- **Lead capture is a `mailto:`** (no CRM/leads backend). Wire a real endpoint/Calendly when ready;
  set `NEXT_PUBLIC_DEMO_EMAIL` / `NEXT_PUBLIC_CONTACT_EMAIL` / `NEXT_PUBLIC_PRIVACY_EMAIL`.
- **Single-tenant + no admin role + no SSO (SAML/Clever/Workspace)** — the product spec lists
  "Admin portal" as out of scope and uses `DEFAULT_SCHOOL_ID` + open teacher bootstrap. Real
  multi-school + admin/SSO is a roadmap item (ROADMAP.md "retire DEFAULT_SCHOOL_ID"), not a v1 web
  gate. For a clean prod tenant, don't ship seed rows / disable seed-adoption.
- **Notifications** still stored-but-undelivered; **error tracking (Sentry)** not wired (the
  boundaries `console.error` — add a DSN-gated tracker). **Legal pages need counsel review** before
  a real signed contract (content is accurate to practice, not legal advice).

## Done this session (committed to `main`)

| Area | What | Verified |
|---|---|---|
| **Security (P0)** | Fixed **IDOR** on `GET /v1/sessions/:id`, `/stream`, `/end`, and the per-student timeline — they loaded/acted on a session by id with no ownership check. Added an `ownedSession()` guard (404 on mismatch). `extend`/`passes`/`no-device`/`recap` already enforced ownership. | Integration test: a 2nd teacher gets 404; owner 200 |
| Graceful shutdown | SIGTERM/SIGINT → stop sweeper, drain requests + SSE (`forceCloseConnections`), close DB pool, 10s hard-timeout; `uncaughtException` → clean exit | `docker stop` exits 0, "shutdown complete", node as PID 1 |
| Readiness | `GET /v1/ready` (DB ping, 503 when down) distinct from `/v1/health` liveness | container probe returns 200 |
| Config guards | Fail-fast env validation; **refuse to boot when `NODE_ENV=production` + `ALLOW_DEV_TOKENS=1`** | boot refused as expected |
| CORS / proxy | Multi-origin `CORS_ORIGIN` (comma list); `trustProxy` so IP-keyed limits use the real client IP | preflight 204 |
| Rate limits | `auth/bootstrap` 30/min per **token**; public tag lookup 120/min per IP (classroom-safe, blocks code enumeration) | tests pass |
| Security headers | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` on all JSON; HSTS in prod | asserted in tests |
| Tests + CI | `vitest` + `app.inject` integration suite (12 tests; **`TEST_DATABASE_URL`-only**, skips otherwise so a plain `npm test` never hits RDS). GitHub Actions: typecheck + shared tests + web build + API integration on a Postgres service | 12/12 green; all CI steps run locally |
| Packaging | Multi-stage **Dockerfile** (api + web), **docker-compose** (postgres + migrate + api + web), `.dockerignore` | api image built + run-verified |
| Web | Dashboard **error boundary** (a render crash no longer takes down `/app`) | builds |

## Recommended next — safe to implement (no product/infra decision)

These came out of an adversarial audit; all are low-risk and decision-free. Roughly priority order:

1. **Web mutation error handling.** `approve`/`decline` (dashboard + roster), `startSession`, and
   the policy/class edits call the API with no `try/catch` — a failure throws unhandled or leaves a
   button spinning. Wrap with a toast + reload. (`apps/web/src/app/app/page.tsx`,
   `…/classes/[id]/roster/page.tsx`.)
2. **Validate `NEXT_PUBLIC_COGNITO_DOMAIN` at startup** — today an unset domain silently degrades
   OAuth to password-only. Fail fast in `configureAmplify()` (`apps/web/src/lib/auth.tsx`).
3. **Empty states** for zero-student rosters; replace `window.confirm` (roster remove) with the
   Radix dialog used elsewhere for consistency + a11y.
4. **Request-id propagation** — Fastify already stamps a `reqId`; honor an inbound `x-request-id`
   (`genReqId`) so traces line up across the LB.
5. **SSE diagnostics** — `apps/web/src/lib/live.ts` swallows JSON-parse and reconnect errors
   silently; log in dev / count in prod to detect schema drift.

## Decisions for you (I did not change these)

- **Hosting + prod API domain.** There is no deployed API yet — iOS `APIConfig` has
  `https://api.bali.app` as a TODO and web reads `NEXT_PUBLIC_API_URL`. Pick a target (ECS/Fargate,
  Fly, Render, a VM…), wire TLS, and set the real host in both clients. The Dockerfile/compose are
  a starting point.
- **Single instance vs horizontal scale.** The SSE bus and the bell sweeper are in-process by
  design (the 5s poll fallback keeps correctness). To run >1 API instance you need Redis pub/sub for
  the bus **and** a leader-lock/scheduler for the sweeper — or commit to one (vertically-scaled)
  instance for v1. A school product goes far on one instance.
- **Notifications.** `notify*` flags are stored but nothing delivers. Emergency/approval emails
  (SES) or web/APNs push is a real feature needing AWS + product calls.
- **Compile the API?** Prod currently runs the TS sources via `tsx` (the Docker `CMD`). Fine and
  simple; a `tsc`/`tsup` build → `node dist` is the standard alternative if you want it.
- **Secrets.** `.env` (gitignored) is dev-only. In prod inject env from your orchestrator/secrets
  manager (SSM/Secrets Manager), never a file.
- **RDS TLS.** `packages/db/src/client.ts` uses `rejectUnauthorized: false` (AWS cert not in the
  local trust store). Bundle the RDS CA and verify for a hardened posture.
- **CSP on web** (`next.config.ts` has no headers) — add a Content-Security-Policy that allows
  Amplify + the SSE `connect-src`. Needs a careful allow-list, hence a decision.
- **Seed adoption in prod.** Bootstrap adopts a `seed-%` teacher row by email match (one-time, and
  Cognito email uniqueness gates it). Safe for the demo; for a clean prod tenant, don't ship seed
  rows / disable adoption.
- **Observability + DB.** Add an error tracker (Sentry DSN) and request metrics; tune the pg pool
  (`max: 10`) for your instance count; confirm RDS automated backups / PITR.

## Deploy runbook (today's shape)

1. **Migrate first**, before the new API code runs (it SELECTs new columns):
   `npm run db:migrate` (or `docker compose run --rm migrate`).
2. Build + run: `docker compose up --build` (postgres + migrate + api + web), or deploy the api
   image (`docker build -f apps/api/Dockerfile -t bali-api .`) to your target with env injected.
3. Optional demo data: `npx tsx packages/db/src/seed.ts --reset` (⚠️ wipes the world; re-adopts on
   next sign-in). The `--reset` flag does **not** forward through `npm run db:seed`.
4. Set in both clients: web `NEXT_PUBLIC_API_URL`, iOS `APIConfig` production host.

## Backend env reference (`apps/api/src/env.ts`)

| Var | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | — | `?sslmode=disable` for local pg; RDS uses TLS |
| `COGNITO_USER_POOL_ID` / `COGNITO_CLIENT_ID` | yes | — | public identifiers |
| `DEFAULT_SCHOOL_ID` | yes | — | UUID |
| `PORT` | no | 3001 | |
| `CORS_ORIGIN` | no | `localhost:3000` | comma-separated list |
| `NODE_ENV` | no | development | `production` hardens logging/HSTS + blocks dev tokens |
| `SWEEP_INTERVAL_MS` | no | 15000 | bell/pass sweeper |
| `ALLOW_DEV_TOKENS` | no | unset | `1` enables `Bearer dev:…`; forbidden in production |

Integration tests additionally read `TEST_DATABASE_URL` (throwaway Postgres only).
