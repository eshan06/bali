# The teacher web portal (`apps/web`)

A Next.js (App Router) portal for teachers: sign in, see your classes, run a
session, and watch the live grid. It talks to the same Fastify API as the phone
apps — read-through-the-events-feed, no direct database access — and authenticates
with the same Cognito user pool over a **public PKCE** client (no client secret in
the browser).

This phase the portal runs **locally** against the Railway **dev** API; there is no
Vercel deploy yet.

## Run it locally

```bash
npm ci
npm run dev -w @bali/web     # Next dev server on http://localhost:3000
```

It needs the API reachable and a Cognito app client configured (below). Config is
read from `NEXT_PUBLIC_*` variables, baked in at build time — none are secret (the
PKCE flow uses a public client), so they are safe to expose in the bundle. Put them
in `apps/web/.env.local`:

| Variable | Example | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | The Fastify API base URL. Point at the Railway dev API to run against it. |
| `NEXT_PUBLIC_COGNITO_DOMAIN` | `https://bali-dev.auth.us-east-1.amazoncognito.com` | The hosted-UI domain (no trailing slash). |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | `abc123…` | The **web** app client id (distinct from the phone client). |
| `NEXT_PUBLIC_REDIRECT_URI` | `http://localhost:3000/auth/callback` | Must exactly match a callback URL registered on the app client. |
| `NEXT_PUBLIC_COGNITO_SCOPES` | `openid email profile` | Space-separated OAuth scopes. |
| `NEXT_PUBLIC_SENTRY_DSN` | `https://<key>@o<org>.ingest.sentry.io/<project>` | Optional. Unset (dev, tests), error monitoring is off. Set at build time, an uncaught error, an API 5xx or an API call that got no answer is reported with the path's template (`/v1/classes/:id`), never the URL, a token, a body, a form value or breadcrumbs (`src/lib/monitoring.ts`). A 4xx is never reported. |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | `dev` | Optional. The environment Sentry files the portal's events under; unset, `NODE_ENV` (`production` in every build). Vercel's `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` is the release, nothing to set. |

The defaults in `src/lib/config.ts` already point at a local setup
(`http://localhost:3001` API, `http://localhost:3000/auth/callback` redirect), so
only the Cognito domain and client id must be supplied to sign in.

## Cognito app client — author action (needs the AWS console)

The portal is a browser SPA, so it uses the **authorization-code + PKCE** grant with
a public client — there is no secret to hold. Create a dedicated **web** app client
in the *same* user pool the API validates against (`AUTH_ISSUER` / `AUTH_AUDIENCE`
in `docs/DEPLOY.md`); do **not** reuse the phone client, because the callback URLs
and grant settings differ.

In the AWS console → Cognito → the dev user pool → **App integration → App clients**:

1. **Create app client.**
   - Type: **Public client** (SPA). **Do not** generate a client secret — a browser
     cannot keep one, and the code sends none.
   - Name it something like `bali-web-dev`.
2. **Hosted UI / OAuth.**
   - **Allowed callback URLs:** `http://localhost:3000/auth/callback` (add the
     deployed portal origin later, when there is one).
   - **Allowed sign-out URLs:** `http://localhost:3000/login` (and the deployed
     portal's `/login` later). Sign out (S4a, below) sends the browser to the
     hosted UI's `/logout` with this URL as `logout_uri`: the callback URL's origin
     plus `/login`, so it needs no variable of its own. **An existing client made
     without it needs it added** (App client → Login pages → Edit → Allowed sign-out
     URLs); until then Cognito shows an error page at Sign out and its session stays.
   - **Identity providers:** Cognito user pool (plus any federated IdPs the pool
     already uses).
   - **OAuth grant types:** **Authorization code grant** only. Leave *Implicit* off.
   - **OpenID Connect scopes:** `openid`, `email`, `profile`.
3. **Hosted UI domain.** If the pool has no hosted-UI domain yet, create one under
   **App integration → Domain** (e.g. `bali-dev`). This is the
   `NEXT_PUBLIC_COGNITO_DOMAIN`.
4. **Copy the app client id** into `NEXT_PUBLIC_COGNITO_CLIENT_ID`. The API's
   `AUTH_AUDIENCE` lists it with the phone's, comma-separated (`docs/DEPLOY.md`):
   a token from a client it does not list is refused.

**Dev's client** (created 2026-10-04): `bali-web-dev`, id
`2f0vj9o545imu4qth5phanki1v`, a public SPA client with PKCE and no secret, in the same
pool as the phone's `bali-ios-dev-public` (`7u6trs6gv805oi35ima29em6oe`, `docs/DEPLOY.md`).
Dev's `AUTH_AUDIENCE` is the phone's id plus this one, comma-separated.

The portal builds the hosted-UI authorize URL itself (`src/lib/auth.ts`) with a
freshly generated PKCE `code_verifier`/`code_challenge` (S256) and a `state` nonce,
exchanges the code for tokens at `/oauth2/token` on the callback, and sends the
resulting access token as a bearer on every API call. No tokens ever appear in a
query string, and the SSE stream is read with `fetch` + `ReadableStream` (not
`EventSource`) so it can carry the `Authorization` header.

> Both `NEXT_PUBLIC_REDIRECT_URI` and the app client's **Allowed callback URL** must
> be byte-for-byte identical, or Cognito rejects the exchange. That mismatch is the
> most common first-run failure.

**Sign out (S4a).** Every signed-in page, the invite-code screen's included, has a
bar with Sign out (`PortalBar`, `src/components/portal-bar.tsx`, in the root layout;
hidden on `/login`, `/auth/*` and the public help page `/support`). It forgets the token, then sends the browser to
`<NEXT_PUBLIC_COGNITO_DOMAIN>/logout?client_id=…&logout_uri=<origin>/login`, which ends
the Cognito session and returns to `/login`, saying "You're signed out." So the next
Sign in on a shared classroom computer asks who it is, instead of opening the last
teacher's account. When there is no hosted UI to send it to (no domain or client id
configured), the token is still gone and `/login` says the sign-in page may still
remember the account, and to close the browser. Limits, as Cognito has them: the
access token itself stays valid until it expires (an hour), in any other tab that
still holds it; `/logout` ends the hosted UI's session, not tokens already issued.

## Making a teacher

Every first sign-in provisions the caller as a **student** (see
`findOrCreateStudent` in `packages/db/src/queries.ts`). A teacher is made with an
**invite code** the owner mints for their school: the owner mints it and hands it on,
and the teacher signs in once and redeems it, which makes the account a teacher at
the code's school in one step. Phase 4 built it in three steps: T1a, the codes and
the owner's command; T1b, the redeem (`POST /v1/teacher-invites/redeem`); T2, the
portal's screen for it.

**The owner's commands** run against `DATABASE_URL`, as `npm run migrate` does, from
a checkout after `npm ci`:

```bash
npm run school -- add "Lincoln High"                 # prints the school's id
npm run school -- agreement <school-id> 2026-10-01   # its data agreement, signed that day
npm run school -- invite <school-id>                 # one teacher's code, shown this once
npm run school -- list                               # every school, its agreement, open invites
npm run --silent school -- export-student <id> > record.json   # one student's whole record (C5)
```

- **The data agreement comes first.** No invite is minted for a school without one on
  record: FERPA's school-official terms and the state's student-privacy law call for it
  (`docs/ISSUES.md`, Phase 6). The day is the one the agreement was signed, never after
  today; recording it again replaces it and says what it said.
- **A code is for one teacher, once, for 14 days.** 25 letters and digits in five
  groups of five, with no `0`/`O` or `1`/`I`/`L` to mistake. Only its hash is stored,
  so the command's output is the one place a code is ever shown: lost, mint another.
- **Where they run:** with `DATABASE_URL` set to that environment's database. From
  your own machine that is the Railway Postgres service's `DATABASE_PUBLIC_URL`; or
  run the command inside the API's service with `railway ssh`, where `DATABASE_URL` is
  already set and the image carries the command.
- **A student's whole record, for a parent's inspection request (C5).** `export-student`
  takes the account's id or its Cognito subject (`sub`: find the user by email in the
  pool's Users list) and prints one JSON document, `bali.student-record/1`, and nothing
  else, so `--silent` and a redirect save it whole: the account row, every enrollment,
  participation, event (unlocks with their reasons, taps, protection off, renames…), armed
  tap and redeemed invite keyed to them, every column, plus the names of the classes,
  sessions and school those rows point at. Nothing keyed to another student. It reads in
  one read-only transaction and writes nothing. A deleted account (C3) is found by its id
  only, its record as the deletion left it. A teacher's account is refused: their classes
  and blocks are the school's, so it would print a record that only looks whole. `STUDENT_RECORD_COVERAGE`
  (`packages/db/src/student-record.ts`) says where each foreign key to `users` stands, and a
  test fails when a new one is neither exported nor argued out. Running it on prod and
  delivering it: `docs/RUNBOOKS.md`, runbook 1, step 10.

**Redeeming it, on the portal (T2).** The teacher signs in to the portal with the
account they will teach from. An account that isn't a teacher yet, as `GET /v1/me` says,
gets the invite-code screen in place of its classes (`InviteCode`,
`apps/web/src/components/invite-code.tsx`; its logic `apps/web/src/lib/invite.ts`):

- **The code goes in as it came:** typed or pasted, in any case, with or without its
  dashes or spaces, and shown in fives as the command printed it. The portal checks it
  by the redeem's own rule (`@bali/shared`'s `INVITE_CODE_PATTERN`) before it sends
  anything, so a code too short or long, or with a symbol no code has, spends none of
  the account's tries.
- **One redeem, applied once:** sent with an `eventId` the portal mints (a UUIDv7). An
  answer that never came (no connection, a server error, a `429`) leaves Try again,
  which resends the same code under the same `eventId`; a changed code, or one sent
  after a refusal, gets a new one.
- **Redeemed:** the page reads `GET /v1/me` again and shows the classes, with no reload.
- **Refused, nothing redeemed,** each said on the screen with what to do next: a code
  that can't be one (`400 invite_code_invalid`, also said before sending), a code no
  invite has (`404 invite_not_found`): check it; one used (`409 invite_used`) or expired
  (`409 invite_expired`): ask whoever sent it for a new one, which the owner mints; an
  account already a teacher (`409 already_teacher`): Go to your classes; an account that
  is a student in a live class (`409 student_in_class`): it teaches from a separate
  account (the owner's ruling, 2026-10-04), the code still good there; too many tries
  (`429`): wait a moment.

**The fallback, through the API**, for when the portal can't be used: the access token
of the account they will teach from (a portal sign-in keeps it in the tab's session
storage):

```bash
# From a checkout after npm ci: the eventId is a UUIDv7, as every write's is.
EVENT_ID=$(node --input-type=module -e "import {v7} from 'uuid'; console.log(v7())")
curl -X POST "$API/v1/teacher-invites/redeem" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"code\": \"<the code>\", \"eventId\": \"$EVENT_ID\"}"
```

- **The code is matched as printed,** its case, spaces and dashes set aside. The answer
  is the account as `/v1/me` gives it, now `teacher`; sent again with the same
  `eventId`, it answers `replay` with the account now, nothing redeemed twice. Refused,
  it answers with the reasons above.

**The dev fallback**, on dev only and never for a school's teacher: the role and the
school set by hand, with no invite on record. After the would-be teacher has signed in
**once** (so their row exists), against `DATABASE_URL`, with the id `add` printed:

```sql
UPDATE users SET role = 'teacher', school_id = '<school id>' WHERE cognito_id = '<their Cognito sub>';
```

The `cognito_id` is the user's `sub` claim (visible in the Cognito console under
**Users**, or in the JWT). The teacher-only endpoints (`requireTeacher` in
`apps/api/src/auth/teacher.ts`) return 403 until the role is set, and a class can't be
made until the school is (`409`, "teacher is not assigned to a school").

## The API side: CORS

A browser calling the API cross-origin needs CORS. The API adds it only when
`CORS_ORIGINS` is set (comma-separated origins, e.g. `http://localhost:3000`); unset
— the default — means no CORS headers at all, which is correct while only native
apps and server-to-server call it. Set `CORS_ORIGINS` on the dev API to the portal's
origin. The allowed request header is the `Authorization` bearer; there are no
cookies, so the API runs CORS without credentials mode.

## Security headers and the CSP

Every page carries a Content-Security-Policy with a fresh nonce
(`apps/web/src/middleware.ts`, built by `contentSecurityPolicy` in
`apps/web/src/lib/csp.ts`); HSTS, `nosniff`, the referrer policy and the
Permissions-Policy come from `next.config.ts`'s `headers()`. The page may
connect only to its own origin, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_COGNITO_DOMAIN`
and the ingest host of `NEXT_PUBLIC_SENTRY_DSN`, read at build time.

- **A production build needs `NEXT_PUBLIC_API_URL`** (no localhost default there),
  and fails on any of the three that is not an http(s) URL (`checkBuildEnv`).
- **Every route renders per request** (the root layout's `dynamic`): a route built
  ahead has no nonce, so it would be blank. A test and CI's build step guard it.
- **Any new origin the portal loads or calls** (an API, a font, an image host,
  an analytics or monitoring service) **must be added to the CSP** in
  `csp.ts`, with its test, or the browser refuses it.
- **No inline script, `eval` or `<style>` element of our own:** scripts run only
  with the nonce Next stamps on them; styles come from the stylesheet.
- **The CSP is the access token's defence** (it sits in sessionStorage): a
  refresh token, when one comes, never goes in web storage
  (`docs/DECISIONS.md`, S4).

## Known gap — token renewal

The portal stores only the Cognito **access token** (sessionStorage, per tab).
There is no refresh token and no silent renewal, so when the ~1h access token
expires the next API call or stream read returns 401 and the teacher is dropped
to `/login` — mid-class if it happens then. This is deliberate for the Phase 2
skeleton, not an oversight: the honesty rule still holds (only a definitive 401
ever signs anyone out), and renewal lands with the real portal UI. It is tracked
in `docs/PLAN.md`'s decision log.
