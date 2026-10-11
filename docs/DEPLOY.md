# Deploying the Bali API

The API deploys as a single container from the repo's `Dockerfile`. It runs
under `tsx` (the workspace packages export TypeScript source directly, so there
is no compile-to-dist step), applies migrations on start, then serves. Target
platform is Railway (hosting decision 1); the Dockerfile is platform-neutral and
also works on Render or plain Docker.

## What runs

- **Build:** `docker build` → `npm ci` for the whole workspace, then the source.
- **Release/start:** the image's `CMD`,
  `sh -c "npm run migrate && cd apps/api && exec node --import tsx src/server.ts"`
  (`Dockerfile`). The shell runs the `&&`; `exec` replaces it with the server's node process
  (what `npm start` runs, in one process), so the API is PID 1 and Railway's SIGTERM reaches
  its graceful shutdown. **Set no custom start command** in Railway: one applied through IaC
  on this Dockerfile service ran without a shell, so only the migration ran and the API never
  started (production, 2026-10-06; `railway.json`'s identical start command had worked). `migrate` applies the
  committed `packages/db/migrations` to `DATABASE_URL` using drizzle-orm's
  migrator (no drizzle-kit in production); it records and skips already-applied
  migrations, so it is safe to re-run.
- **Health check:** `GET /healthz`.
- **Where Railway gets these:** `.railway/railway.ts` (Infrastructure as Code, P8; applied to
  both environments 2026-10-06): the source (`main`, Wait for CI on), the Dockerfile build,
  `/healthz`, and the restart policy (on failure, 3 retries). It manages only the API's
  services, dev's `bali` and production's `bali prod`, scoped by the named partial
  `bali-api`, and lists every variable as `preserve()` (values stay in Railway). Railway
  never reads it on a deploy: the owner plans and applies it by hand (`docs/RUNBOOKS.md`,
  runbook 8). An apply resets any setting the file leaves out, so a setting changed in the
  dashboard goes into the file too, or the next apply undoes it.
- **Sweep:** the API runs it itself every minute — the tick that expires ended
  sessions and opens silence episodes for phones gone quiet (hosting decision 3).
  A scheduled `POST /internal/sweep` with the `x-internal-key` header (step 4
  below) is its backup. Idempotent, so any overlap is harmless.
- **Rate limits** (ISSUES #1, `apps/api/src/limits.ts`): kept in each process's
  memory, so N instances are N times each budget, and a restart empties them —
  the way to clear a school's address locked out of joining by a guesser. The
  caller's address is the `X-Real-IP` Railway's edge sets, overwriting any a
  client sends, so the API must be reached only through that edge. On another
  host (Render, plain Docker), a proxy in front must set `X-Real-IP` the same
  way, or a client picks its own address's budget.

## Environment variables

All are validated at boot (`apps/api/src/env.ts`); a missing or malformed one
fails the boot with a readable message. See `.env.example` for the full list
with notes. The ones a deploy must set:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | Managed Postgres connection string. |
| `AUTH_ISSUER` / `AUTH_JWKS_URI` / `AUTH_AUDIENCE` | The Cognito pool's issuer, its JWKS endpoint, and the app client ids whose tokens the API accepts, comma-separated: the web portal's and the phone's (below), both in the pool `AUTH_ISSUER` names. One id alone accepts just that client. |
| `INTERNAL_API_KEY` | Long random secret (`openssl rand -hex 32`) for the backup sweep cron; under 32 characters, the API refuses to boot. |
| `TZ` | The school's zone (e.g. `America/Chicago`). Bell times and armed-tap end-of-day expiry use server-local time; Railway defaults to UTC. |
| `LOG_LEVEL` | `info` in production. |
| `SENTRY_DSN` | Optional. The Sentry project's DSN; unset, error monitoring is off. When set, a 500 or a crash is reported with the route, never the request, the user or query values, and each minute's sweep checks in to the cron monitor `api-sweep` (`apps/api/src/monitoring.ts`; alerts: `docs/RUNBOOKS.md`, runbook 6). |
| `SENTRY_ENVIRONMENT` | Optional. The environment Sentry files events under (`dev`, `production`); unset, `NODE_ENV`, which reads `production` on every deploy. Railway's `RAILWAY_GIT_COMMIT_SHA` is the release, nothing to set. |
| `APNS_KEY_P8` / `APNS_KEY_ID` / `APNS_TEAM_ID` | Optional, all three or none (the API refuses to boot on one or two). The APNs auth key's `.p8` contents (line breaks as they are or written `\n`), its 10-character key id, and the team id (`H535678UF8`). Unset, the "class started" push is off (`apps/api/src/push/apns.ts`; wired to the Start in N5b; the console steps: N6). |
| `APNS_TOPIC` | Optional. The app's bundle id, sent as `apns-topic`; unset, `com.bali.Bali`. |
| `COGNITO_DELETER_ACCESS_KEY_ID` / `COGNITO_DELETER_SECRET_ACCESS_KEY` | Optional, both or none, and only beside a Cognito pool's `AUTH_ISSUER` (else the API refuses to boot). An IAM user's access key, that environment's own, allowed only `cognito-idp:AdminGetUser` and `cognito-idp:AdminDeleteUser` on the pool `AUTH_ISSUER` names, which also gives the region. Unset, a deleted account's Cognito sign-in waits in the API's queue and the boot log says `Cognito sign-in deletion is off` (`apps/api/src/cognito/`; the console steps: `docs/RUNBOOKS.md`, runbook 9). |
| `DECK_BUCKET` / `DECK_BUCKET_REGION` / `DECK_BUCKET_ACCESS_KEY_ID` / `DECK_BUCKET_SECRET_ACCESS_KEY` | Optional, all four or none (the API refuses to boot on one to three). The private S3 bucket that environment keeps decks' PDFs in (Phase 7), its name without dots (the API reaches it at `<bucket>.s3.<region>.amazonaws.com`), its region, and an IAM user's access key, that environment's own, allowed only `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject` in that bucket. Unset, deck storage is off and the boot log says `deck storage is off` (`apps/api/src/deck-storage.ts`; the console steps and the check: `docs/RUNBOOKS.md`, runbook 10). |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | Set above `SHUTDOWN_DEADLINE_MS` (8s) so graceful shutdown finishes before SIGKILL. |

`PORT`/`HOST` are provided by the platform; `NODE_ENV` defaults to `production`.

## First-time setup checklist (needs the Railway dashboard + AWS)

These steps need credentials this repo doesn't hold — do them once per
environment (start with **dev**, then **production**; hosting decision 2 keeps
them fully separate):

For **production**, follow `docs/RUNBOOKS.md` instead: the same steps, numbered,
with prod's hardening (private-network database, Cognito per Phase 6) and a
check after each.

1. **Cognito** — create (or reuse the v2) user pool and its app clients: the
   portal's (`docs/WEB.md`) and the phone's (below). Note the issuer URL, JWKS
   URI, and app client ids for the `AUTH_*` variables.
2. **Railway project** — create a project with two environments (dev, prod). Add
   the **Postgres** plugin to each; it supplies `DATABASE_URL`. Enable daily
   backups + point-in-time recovery, same region as the service (decision 4).
   Railway's backups need its **Pro** plan: on Hobby there are none, and prod runs
   without them for the Vanderbilt pilot (the owner's ruling, 2026-10-05;
   `docs/RUNBOOKS.md`, runbook 1, step 4).
3. **Deploy the service** — connect this repo. Its settings come from
   `.railway/railway.ts`: add the environment and service name to `SERVICE_BY_ENVIRONMENT`
   there (a PR), then plan and apply (runbook 8); it builds from the `Dockerfile`. Set all
   environment variables above.
4. **Sweep cron, the backup** — the API sweeps every minute by itself; add a
   Railway cron that runs **every 5 minutes** (`*/5 * * * *`) and POSTs to
   `/internal/sweep` with `x-internal-key: $INTERNAL_API_KEY`, so sessions still
   end if the API's own ticks ever stop. Not more often: Railway's runs "must be
   at least 5 minutes apart", and not to the minute — why the API sweeps itself
   (hosting decision 3). The cron's service must exit once the POST returns:
   Railway skips a run while the last one is still running.
5. **Verify** — `GET /healthz` returns `{"status":"ok"}`; a signed request to
   `GET /v1/me` returns the caller; the API's log says `sweeping every minute`
   at boot; the cron shows `{"expired":N,"wentSilent":M}`.

## The phone's sign-in — owner action (needs the AWS console)

The student app signs in through Cognito's hosted UI with the authorization-code
grant and PKCE (Phase 3, B4), over its **own** app client in the same pool as
the portal's — never the portal's web client (`docs/WEB.md`), since the callback
URLs and grant settings differ. Each environment gives two values, the
hosted-UI domain and the phone's client id; neither is secret.

**Dev — done** (owner, 2026-09-24), in the pool `us-east-1_YTloqilwT`, and
checked with a public authorize request (`bali://auth/callback`, scope
`openid email profile`, PKCE S256 → the hosted sign-in page):

- **Hosted-UI domain:** `https://bali-dev.auth.us-east-1.amazoncognito.com`
- **The phone's app client:** `bali-ios-dev-public`, id `7u6trs6gv805oi35ima29em6oe` — a public client, no secret. The first one, `bali-ios-dev` (`33qr62dl4ee4inigneidmfe2s9`), was made with a client secret, which Cognito's token endpoint then demands (`invalid_client`) and a phone must never hold; a secret cannot be removed, so it was replaced (2026-09-26, the device check). It allows `aws.cognito.signin.user.admin` too (the owner, 2026-10-05, for C4's `DeleteUser`; an authorize request asking for it reaches the login page)
- **The portal's app client:** `bali-web-dev`, id `2f0vj9o545imu4qth5phanki1v` (created 2026-10-04): a public SPA client with PKCE and no secret (`docs/WEB.md`). Dev's `AUTH_AUDIENCE` is the phone's id plus this one: `7u6trs6gv805oi35ima29em6oe,2f0vj9o545imu4qth5phanki1v`
- **Dev's API:** `https://bali-production-09a2.up.railway.app` — dev's, despite
  the name: Railway named the service before the environment was renamed dev.
  Production's is below.
- **In place** (2026-09-26, for the replacement client; the first was in place
  2026-09-25): all three are in `ios/project.yml` (B4c), and the client id is on
  dev's `AUTH_AUDIENCE`, appended after B4a deployed.
- **Refresh-token expiration — done** (owner, 2026-09-25 on the first client; the
  replacement was made with 365 days, read back the same day): raised above
  Cognito's 30-day default (step 3 below; 365 days was asked for), which no
  request from outside can show.

**Production — done** (owner, 2026-10-04, `docs/RUNBOOKS.md` runbooks 1–2), in its
own pool (hosting decision 2). None of these is secret:

- **Production's API:** `https://bali-prod-production.up.railway.app` — Railway
  environment `production`, services `bali prod`, `postgres prod` (no public TCP
  proxy) and the backup sweep cron `sweep-cron` (`*/5 * * * *`); `/healthz` answers ok.
  No backups, by the owner's ruling for the pilot (`docs/RUNBOOKS.md`, runbook 1, step 4).
- **The portal:** the Vercel project `bali-portal` (root `apps/web`, Node.js 22.x) at
  `https://bali-portal.vercel.app`, built with prod's values (2026-10-05); prod's
  `CORS_ORIGINS` is that origin.
- **The pool:** `bali-production`, id `us-east-1_C55e0fhX8`; `AUTH_ISSUER`
  `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_C55e0fhX8`. Deletion
  protection on; MFA optional (TOTP); self sign-up gated by the Pre sign-up Lambda
  `bali-pre-signup` with `ALLOWED_EMAIL_DOMAINS=vanderbilt.edu` (checked: a gmail
  sign-up is refused). The API's `TZ` is `America/Chicago`.
- **Hosted-UI domain:** `https://us-east-1c55e0fhx8.auth.us-east-1.amazoncognito.com`
  (Hosted UI classic). Password policy: minimum 12 characters.
- **The portal's app client:** `bali-web`, id `36meb9r9h0cdrt2a1schcv9abs` — a
  public SPA client, PKCE, SRP and refresh only; callback
  `https://bali-portal.vercel.app/auth/callback`, sign-out
  `https://bali-portal.vercel.app/login`, the Vercel project's own address.
- **The phone's app client:** `bali-ios`, id `5dr74i0iqnth9p4c4k594r27aj` — public,
  callback `bali://auth/callback`, scopes `openid email profile` and
  `aws.cognito.signin.user.admin` (for C4's `DeleteUser`), refresh token 365 days,
  SRP and refresh only.
- **`AUTH_AUDIENCE`:** `36meb9r9h0cdrt2a1schcv9abs,5dr74i0iqnth9p4c4k594r27aj`.
- **In the build:** the TestFlight workflow's `prod` choice (below) sets the API,
  the domain and the phone's client id; `ios/project.yml` keeps dev's for every
  other build. The app asks for `openid email profile aws.cognito.signin.user.admin`
  (`ios/BaliCore/Sources/BaliCore/SignIn.swift`, since C4a), which both
  environments' phone clients allow.

How a pool's phone client is made (as production's was; for a rebuild). In the AWS
console → Cognito → that user pool:

1. **Hosted-UI domain**, if the pool has none: **Branding → Domain → Create
   Cognito domain**, with a prefix such as `bali`, and choose **Hosted UI
   (classic)**, which needs no style. The domain is
   `https://<prefix>.auth.<region>.amazoncognito.com`, the pool's one — the
   portal's `NEXT_PUBLIC_COGNITO_DOMAIN` too.
2. **The phone's app client.** **Applications → App clients → Create app
   client**, type **Mobile app**: a public client, so no client secret (a phone
   cannot keep one, and the app sends none). Name it something like
   `bali-ios`. On its **Login pages**:
   - **Allowed callback URLs:** `bali://auth/callback`, exactly.
   - **Identity providers:** Cognito user pool.
   - **OAuth grant types:** **Authorization code grant** only.
   - **OpenID Connect scopes:** `openid`, `email`, `profile` and
     `aws.cognito.signin.user.admin`. Tick **Profile** by hand: a new Mobile-app
     client allows only `openid`, `email` and `phone`. The app asks for all four
     (C4a: Cognito's `DeleteUser` needs the last), so a client without one
     refuses every sign-in from the phone.
3. **Refresh-token expiration.** On the client's **App client information →
   Edit**, raise **Refresh token expiration** above Cognito's 30-day default —
   365 days, say. Cognito refusing the refresh token is the app's one
   sign-out, so at 30 days every student is signed out monthly, where auth
   decision 2 has a student sign in roughly once, ever.

**Where the values go** (each environment's own):

- **The domain and the client id:** the build settings `BALI_COGNITO_DOMAIN`
  and `BALI_COGNITO_CLIENT_ID`, beside the API in `BALI_API_URL` — dev's in
  `ios/project.yml` (B4c), production's as the TestFlight workflow's `prod`
  overrides, whose `BALI_API_URL` must never be dev's URL (its release guard
  checks). A build with any of them empty says sign-in is not set up.
- **The portal the app links (C2b):** `BALI_PORTAL_URL`, production's portal
  (`https://bali-portal.vercel.app`) for every build, since the privacy policy and
  terms live only there: set once in `ios/project.yml` (`AppConfigTests.agree` fails
  on a second there), and the TestFlight workflow overrides it for no environment. A
  build without it fails its start as one without the sign-in's settings does, in the
  same words.
- **The client id, again:** appended to that environment's `AUTH_AUDIENCE`,
  after the id already there (`<that id>,<the phone's>`) — **only once B4a is
  deployed there.** Before it, the API reads `AUTH_AUDIENCE` as a single id,
  so a list matches no token and locks every sign-in out. The same holds the
  other way: trim the list back to one id before rolling the API back past
  B4a. Dev's was appended on 2026-09-25, after #81 (B4a) had deployed, and
  the replacement client's on 2026-09-26.
- **Check the client is public before any phone signs in:** send the token
  endpoint a made-up code —
  `curl -sS -X POST <domain>/oauth2/token -H 'Content-Type: application/x-www-form-urlencoded' --data 'grant_type=authorization_code&client_id=<the id>&code=x&redirect_uri=bali%3A%2F%2Fauth%2Fcallback&code_verifier=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'`.
  A public client answers `invalid_grant`; one made with a secret answers
  `invalid_client`, and every sign-in from the phone will fail the same way
  (dev's first client did, found at the device check; the authorize request
  above passes either way, so it proves nothing about the secret).

## TestFlight — owner action (needs App Store Connect and GitHub settings)

The **TestFlight** workflow (`.github/workflows/testflight.yml`, Phase 5's P5) archives
the student app as Release, signs it through an App Store Connect API key, and uploads
it. It runs only by hand: Actions → TestFlight → Run workflow, choosing whose API and
sign-in the build talks to: `dev` (the default; `ios/project.yml`'s values) or `prod`
(production's, set in its "Archive" step). Without the key's secrets it builds nothing,
says which are missing, and passes. Once, before the first run:

1. **The app record.** App Store Connect → Apps → + → New App: iOS, the name, a
   language, bundle ID `com.bali.Bali` (registered on team `H535678UF8` by the first
   device build), any SKU. A build uploads only into an app that exists.
2. **The API key.** App Store Connect → Users and Access → Integrations → App Store
   Connect API → Team Keys → + (the Account Holder requests access the first time).
   Name it `Bali CI`, access **App Manager**, Generate. Download the `.p8` — Apple
   offers it once — and note its **Key ID** and the **Issuer ID** above the table.
3. **The secrets.** GitHub → the repo → Settings → Secrets and variables → Actions →
   New repository secret, three times:
   - `APP_STORE_CONNECT_KEY_ID` — the Key ID;
   - `APP_STORE_CONNECT_ISSUER_ID` — the Issuer ID;
   - `APP_STORE_CONNECT_KEY_P8` — the whole `.p8` file, its `BEGIN` and `END` lines
     included.

**A prod build:** GitHub → the repo → Actions → TestFlight → **Run workflow** → branch
`main`, environment **`prod`** → Run workflow (or `gh workflow run testflight.yml -f
environment=prod`). Dev and prod builds go to the same app in TestFlight, told apart only
by their build number: each run's name in the Actions list, `TestFlight (prod)`, and its
summary say which environment its number was built for, so note it before handing a build
to testers.

**Keep the pilot's testers on prod builds only.** A TestFlight group is offered every
build added to it, so once the pilot has a prod build, put its testers in an external
group that gets prod builds and nothing else. Dev builds go to an internal group (the
owner's own testers) and never to the pilot's group: a dev build there would point a
classroom's phones at dev.

What a run checks and needs:

- **The release guard** (#130, "Nothing from Debug in Release"; part of Phase 6's S10)
  fails the run before anything is uploaded if a Release target compiles with
  `DEBUG`, if the app or the monitor holds text only `#if DEBUG` code has (the
  readout's title, the lost-bell device check), if a sign-in setting is empty or the
  API isn't `https://`, if a `prod` build's API, domain or client id isn't production's, or if the app has
  **no icon** (App Store Connect refuses such a
  build). The icon is `ios/Bali/Assets.xcassets`'s `AppIcon`, named by
  `ASSETCATALOG_COMPILER_APPICON_NAME` in `ios/project.yml`.
- **Signing:** `-allowProvisioningUpdates` with the key, so Xcode makes or fetches
  the certificate and the App Store profiles for the app and both extensions itself.
  If it says the key may not create a certificate or use cloud-managed distribution
  certificates, the key's role is too narrow for that: generate one with **Admin**
  access and replace the three secrets. A GitHub runner keeps no keychain, so a run
  may leave a new Apple Development certificate on the team each time: revoke old
  ones in the developer account if they pile up toward Apple's limit. Each extension's Family Controls
  (Distribution) entitlement must be approved on its own bundle ID too.
- **The build number** is the run's number; the version stays `MARKETING_VERSION`.
  Apple refuses a number already uploaded, so re-running a run that got as far as the
  upload fails: dispatch a new run.
- Export compliance is answered in the app's `Info.plist`
  (`ITSAppUsesNonExemptEncryption` = `false`: Bali's only cryptography is exempt: the HTTPS
  that iOS provides, CryptoKit's SHA-256 for the sign-in's PKCE challenge, and the system
  Keychain for its tokens), so App Store Connect no longer asks on each build.

## Local run

```bash
npm ci
cp .env.example .env   # fill in DATABASE_URL etc.
npm run migrate        # apply migrations to your local Postgres
npm start              # serve on PORT (default 3001)
```

No external services are needed to see the core flow end-to-end:

```bash
npm run demo           # drives the real HTTP API over a local socket; see the README
```
