# Owner runbooks — production

Five runbooks for the consoles only the owner can reach: Railway, AWS (Cognito),
Vercel and GitHub. Phase 5's P6. Do them in this order the first time — each one
uses values the one before it produced:

1. [Cognito for production](#2-cognito-for-production) (the API needs its pool's values),
2. [Production on Railway](#1-production-on-railway),
3. [The Vercel flip](#3-the-vercel-flip),
4. [The backup-restore drill](#4-the-backup-restore-drill), once prod holds data,
5. [GitHub hardening](#5-github-hardening), any time.

**Where production stands** (the owner, 2026-10-05; its values are in `docs/DEPLOY.md`,
"The phone's sign-in", none secret):

- **Runbook 2, Cognito — done:** root MFA on the AWS account (step 1); the pool
  `bali-production` with deletion protection (3); sign-up gated to `vanderbilt.edu` by
  `bali-pre-signup` ([`infra/cognito/pre-signup.mjs`](../infra/cognito/pre-signup.mjs)),
  a gmail sign-up checked refused (4); the password policy, minimum 12 (5); MFA optional,
  TOTP (6); both app clients, SRP and refresh only, the phone's with the 365-day refresh
  token and the `aws.cognito.signin.user.admin` scope C4 needs (8); the hosted-UI domain,
  its branding set to Hosted UI (classic) (9); the values handed to Railway, Vercel and
  the iOS build (12). Not needed: Sign in with Apple (11; no Google sign-in).
- **Runbook 2 — skipped for the pilot, still to do:** threat protection (7; it needs
  the Plus plan, billed per user) and CloudTrail (2). Not recorded, so check them:
  "prevent user existence errors" on both clients (8), and the pool holding no client
  but those two (10).
- **Runbook 1, Railway — done:** the `production` environment (step 2), its database
  `postgres prod` with no public TCP proxy (3, checked 2026-10-05), the API service
  `bali prod` with its variables, `TZ` `America/Chicago` and `CORS_ORIGINS`
  `https://bali-portal.vercel.app` (5–6), the sweep cron `sweep-cron` (7; its first run
  logged `expired 0`, `wentSilent 0`), and `/healthz` answering ok (8).
- **Runbook 1 — not done, by the owner's ruling:** backups (4). Railway's backups need
  its **Pro** plan; the account is on **Hobby** (upgraded 2026-10-05). For the Vanderbilt
  pilot prod runs **without backups**, an accepted risk (step 4 says what that means);
  revisit before any K-12 school. Railway's 2FA (1) is deferred by the owner.
- **Runbook 3, the Vercel flip — done** (2026-10-05): the project `bali-portal`, rooted at
  `apps/web`, at `https://bali-portal.vercel.app`, Node.js 22.x, prod's values; the API's
  CORS preflight from it answers `204`. The old project `bali-web` (the v2 demo) isn't
  connected to the repo, so step 2 wasn't needed. Still open: step 6, deleting `vercel.json`.
- **Runbook 4, the restore drill — on hold** while prod has no backups. Its half A, a
  `pg_dump` into a scratch database, works without them (skip its step 1).
- **Runbook 5, GitHub:** the load gate is a required check (7); the rest is open.

**Prod's data so far:** the school "Vanderbilt" (id `01a10a81-4ac0-7698-a1d4-fc0487865082`),
its data agreement recorded 2026-10-05 and its year's end `2026-12-18`; the owner is a
teacher there with a block and a class. 🔧 That block's first code reached the repo's history (#228): before the first class, write and register a fresh one (`docs/PILOT.md`, setup step 6). The first prod TestFlight build was
dispatched 2026-10-05 (Actions run 37267876703).

How to read them:

- Each step says where to click, then **Check:** how to know it worked.
- `<like this>` is a value you fill in. **No real secret goes in this file, or in any
  commit, chat or issue.** Secrets live in Railway's variables, Vercel's environment
  variables and GitHub's secrets, and nowhere else.
- Consoles rename their menus often. Where these steps say *(wording unsure)*, the
  setting exists but its label may read differently today; look for the nearest match.
- Production never shares anything with dev (hosting decision 2): its own pool, its own
  database, its own keys. Never paste a dev value into prod or a prod value into dev.

Write down as you go, in a password manager, never in the repo: the pool id, the
hosted-UI domain, both app client ids, the API's URL, the portal's URL.

---

## 1. Production on Railway

What it makes: a `production` environment in the existing Railway project, with the API
service and its own Postgres, reachable only on Railway's private network.

**Before you start:** the Cognito pool from runbook 2 exists, and you have a Sentry
project for the API (its DSN).

1. **2FA on the Railway account.** Railway → your avatar → **Account Settings** →
   **Security** *(wording unsure)* → turn on two-factor authentication with an
   authenticator app; save the recovery codes in your password manager.
   **Check:** sign out and back in; it asks for the code.
2. **The environment.** Open the Bali project → the environment menu at the top (it
   reads `dev` today) → **New Environment** → name it `production`. Choose an empty
   environment, not a copy of dev, so no dev variable comes along *(if Railway only
   offers "duplicate", duplicate and then replace every variable in step 5)*.
   **Check:** the menu lists `dev` and `production`; switching between them shows
   different services.
3. **The database.** In `production`: **+ Create** → **Database** → **PostgreSQL**. Put
   it in the same region as the API (hosting decision 4): its **Settings** →
   **Region** *(wording unsure)* must match the API service's.
   - **No public TCP proxy.** Postgres service → **Settings** → **Networking** →
     **Public Networking**: if a TCP proxy is listed (Railway adds one by default),
     delete it. The API reaches the database over the private network only.
   - **Check:** the Postgres service's **Variables** show `DATABASE_URL` with a host
     ending `.railway.internal`; `DATABASE_PUBLIC_URL` is gone or empty, and
     **Networking** lists no public domain or proxy.
4. **Backups.** Postgres service → **Backups** tab → turn on a **daily** schedule (and
   weekly, if offered). Backups need Railway's **Pro** plan ($20 a month); Hobby has
   none.
   - **The Vanderbilt pilot runs without them** (the owner's ruling, 2026-10-05; the
     account is on Hobby). An accepted risk for an informal pilot of adults: if prod's
     volume is lost, its sessions, reports and unlock records are gone, and the school,
     its teachers and their classes are made again by hand. **Revisit before any K-12
     school:** Pro and this step, or a nightly `pg_dump` to an encrypted S3 bucket.
   - **Point-in-time recovery:** hosting decision 4 asks for it. Railway's backups, as
     far as this doc's author knows, are scheduled volume snapshots, not
     point-in-time recovery. If you find no PITR setting, write that down and raise
     it: it is an architecture decision (a managed Postgres elsewhere, or accepting
     daily snapshots for the pilot), not something to settle in the console alone.
   - **Check:** the next day, the Backups tab lists one backup with a time.
5. **The API service.** In `production`: **+ Create** → **GitHub Repo** →
   `eshan06/bali`. Railway reads `railway.json`: Dockerfile build, `npm run migrate &&
   npm start`, health check `/healthz`.
   - **Settings → Source** *(wording unsure)*: branch `main`. If Railway offers
     **Wait for CI**, turn it on, so a red `main` never deploys to prod.
   - **Settings → Networking → Generate Domain** for the public HTTPS URL (or add
     your own domain there and follow its DNS instructions). This is `<prod API URL>`.
     Your own domain: the API's HSTS carries `includeSubDomains`, so once a browser has
     seen it, every subdomain of that host must serve HTTPS too. Give the API a host
     of its own (`api.<domain>`), never the apex a plain-HTTP site sits under.
   - **Settings → Replicas:** leave at 1. The rate limits live in each process's
     memory (`docs/DEPLOY.md`), so 2 replicas double every budget.
6. **The variables.** API service → **Variables** → **Raw Editor**, then paste and fill
   in. Every one is checked at boot (`apps/api/src/env.ts`); one missing or malformed
   fails the deploy with a message naming it.

   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   AUTH_ISSUER=https://cognito-idp.<region>.amazonaws.com/<prod pool id>
   AUTH_JWKS_URI=https://cognito-idp.<region>.amazonaws.com/<prod pool id>/.well-known/jwks.json
   AUTH_AUDIENCE=<prod web client id>,<prod phone client id>
   INTERNAL_API_KEY=<64 hex characters, generated below>
   TZ=<the school's zone, e.g. America/Chicago>
   CORS_ORIGINS=<the portal's origin: https://<project>.vercel.app for now (runbook 2)>
   LOG_LEVEL=info
   SENTRY_DSN=<the API's Sentry project DSN>
   SENTRY_ENVIRONMENT=production
   RAILWAY_DEPLOYMENT_DRAINING_SECONDS=15
   ```

   - `DATABASE_URL`: the reference `${{Postgres.DATABASE_URL}}` as written, if the
     database service is named `Postgres`; Railway fills in the private URL. Never
     paste the URL itself.
   - `AUTH_*`: from runbook 2. `AUTH_AUDIENCE` is both client ids, comma, no spaces.
   - `INTERNAL_API_KEY`: generate it on your own computer with
     `openssl rand -hex 32` and paste the output. Never reuse dev's. Boot refuses
     under 16 characters; 64 is the target.
   - `TZ`: an IANA zone name for the school (`America/Chicago`,
     `America/New_York`, …). Unset, Railway runs UTC and every bell time is wrong.
   - `CORS_ORIGINS`: exactly the portal's origin — `https://`, the host, no path, no
     trailing slash, no `*`. Not dev's portal, not `localhost`. Until the portal has
     its domain (runbook 3), leave it unset: the API then sends no CORS headers and
     the portal can't call it, which is the safe failure.
   - `SENTRY_*`: from the API's Sentry project → **Settings → Client Keys (DSN)**.
     Unset, error monitoring is off (nothing breaks).
   - `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`: above the 8 s graceful shutdown.
   - `PORT`, `HOST` and `NODE_ENV`: leave unset; Railway provides `PORT`, and
     `NODE_ENV` defaults to `production`.

   **Check:** **Deploy** (or wait for the auto-deploy). The deploy log shows the
   migrations applied, then the server listening and `sweeping every minute`.
7. **The backup sweep cron.** The API sweeps every minute itself; this cron is its
   backup (hosting decision 3). Easiest: open **dev**'s cron service, note its
   image, start command and schedule, and make the same in `production`:
   **+ Create** → **Empty Service** (or **Docker Image**) → name it `sweep-cron`.
   - **Settings → Cron Schedule:** `*/5 * * * *`.
   - **Variables:** `INTERNAL_API_KEY=${{<api service name>.INTERNAL_API_KEY}}`
     (a reference, so the key lives in one place).
   - **Start command:** one request that exits when done, with the image
     `curlimages/curl:8.10.1`, wrapped in `sh -c` so a shell expands the key:
     `sh -c 'curl -fsS -X POST -H "x-internal-key: $INTERNAL_API_KEY" <prod API URL>/internal/sweep'`.
   - **As made** (2026-10-05): the service `sweep-cron`, that image, `*/5 * * * *`,
     `INTERNAL_API_KEY` a reference to `bali prod`'s, the URL
     `https://bali-prod-production.up.railway.app`.
   - **Check:** after the next run, the cron's log shows
     `{"expired":N,"wentSilent":M}`. A `401` means the key differs from the API's.
8. **Verify the whole thing.**
   - `curl -sS <prod API URL>/healthz` → `{"status":"ok","version":…}`.
   - `curl -sS -o /dev/null -w '%{http_code}\n' <prod API URL>/v1/me` → `401` (no
     token: refused, as it should be).
   - Once the portal is up (runbook 3), sign in there: the home page loads, which is
     a signed `GET /v1/me` with a prod token.
   - The API's log has no `error` line since boot.
9. **Owner commands on prod** (`npm run school`, `docs/WEB.md`). With no public proxy,
   your computer can't reach prod's database. Run them inside the API service:
   `railway link` (choose the project and `production`), then
   `railway ssh --service <api service name>`, and in that shell
   `npm run school -- list`. Never turn the TCP proxy back on for this.
10. **A parent's inspection request (FERPA; C5).** The request reaches you through the
    school; its data agreement gives you days, not weeks, to hand over the student's whole
    record. The day it arrives:
    - **Hold every disposal of the student's data until the school has the record:** no
      school disposal (C6a) or retention run (C6b) that would touch them. A student's own
      account deletion (C3) can't be held, but it keeps their records under the account's
      id: export first all the same.
    - **Find the account.** In the production pool's **Users**, search by the email the
      school gives you and copy the user's `sub`.
    - **Export it** from your machine, the output landing in a file there:
      `railway ssh --service <api service name> -- npm run --silent school -- export-student <sub> > record.json`
      `railway ssh` runs the command after `--` and, with its output going to a file, opens
      no terminal, so the file holds the record alone (an old CLI without that: `railway
      upgrade` first).
    - **Check:** `jq '.format, .account.id, (.events | length)' record.json` prints
      `"bali.student-record/1"`, the account's id and a count; `jq` failing means the file
      holds something besides the record. `no account on record` means no account has that
      `sub`: a deleted account is found by its id only.
    - **Deliver it to the school,** to the contact and by the channel the agreement names,
      never as a plain email attachment, inside the agreement's days. Once the school confirms
      it has the file, delete your copy and lift the hold.
11. **A school's written request to dispose of its data (C6a).** The request comes in
    writing from the contact the school's data agreement names, and the agreement says how
    many days you have. Before you start:
    - **Check no parent's inspection request is open** for a student of the school (step
      10): if one is, export that record and deliver it first.
    - **Open a shell in the API service** (step 9): `railway ssh --service <api service
      name>`, and run the next two commands in that shell, never from your machine with
      `railway ssh … --`: there the school's name in quotes would reach the remote shell
      unquoted. (Either way the command runs in the container, on the server's clock.)
    - **Preview it:** `npm run school -- dispose <school-id>` (`npm run school -- list`
      gives the id). It prints the school's name and what would go
      (teachers, students, classes, sessions, blocks, open invites, pre-bell taps) and writes
      nothing. "lesson(s) running" means a class is in session: run it again after the bell.
      "records at another school too" lists accounts by id: nothing was written, and this
      command can't split one; stop and raise it.
    - **Dispose of it**, with the name exactly as the preview printed it: paste the
      preview's last line, `npm run school -- dispose <school-id> --confirm '<name>'` (the
      name single-quoted, so an apostrophe or `$` in it reaches the command as typed).
      It prints one line, `disposed of school <id> on <time>: teachers …`, with no name: keep
      it with the school's request. Running it again says it was disposed of already.
    - **Delete the school's sign-ins in Cognito.** The disposal can't reach them (the API
      holds no AWS credential), and each still holds an email address. In the production
      pool's **Users**, delete every user whose email is at the school's domain. A sign-in
      left there only ever makes a new, empty account.
    - **Backups:** Railway's backups (step 4) still hold the school's data until they age
      out. Note the day the last backup from before the disposal expires (the Backups tab
      lists each backup's time; its retention is the schedule's). While prod has no backups
      (the pilot), there is none to wait for: say so in the reply.
    - **Write back to the school,** by the agreement's channel, inside its days: the date of
      the disposal; what was removed (every name, Cognito subject and sign-in, class name,
      block, open invite and pre-bell tap of the school); what stays (lessons,
      unlocks with their reason, taps and their times, under accounts that name no one, kept
      as counts); and the day the last backup holding its data expires. If the agreement
      requires that de-identified records go too, stop before disposing and raise it: this
      command keeps them.
12. **A school year's retention run (C6b).** The owner's ruling: named records are kept
    through the school year, then de-identified; the counts stay. It never runs by itself:
    you run it, so the hold of step 10 stays yours.
    - **Record the year's end when the school is added,** and again each year: ask the
      school for the last day of its year (for the Vanderbilt pilot, the semester's last
      day), then in the API service's shell (step 9):
      `npm run school -- year-end <school-id> YYYY-MM-DD`. `npm run school -- list` shows
      it under "year ends". Put the run in your calendar for the week after that day.
    - **On the calendar day, check no parent's inspection request is open** for a student
      of the school (step 10).
    - **Preview it** in the same shell: `npm run school -- retention <school-id>`. It prints
      how many students, teachers, enrollments and pre-bell taps would go, and the ids of
      the accounts it keeps named: anyone with a record after the year's last day, at
      another school, or a teacher with a live class or block. "no year end on record" or
      "isn't over until" means nothing was written: record the day, or wait.
    - **Run it,** pasting the preview's last line,
      `npm run school -- retention <school-id> --confirm '<name>'`. It prints one line of
      counts with no name: keep it with the school's records. A second run says it ran
      already, with the same counts.
    - **Next year:** record the new last day with `year-end`; whoever was kept named this
      time is judged again against it. The Cognito sign-ins stay (a de-identified student
      who signs in again starts a fresh, empty account); Railway's backups age out on their
      schedule (step 4).

---

## 2. Cognito for production

What it makes: a new user pool for production only, hardened per Phase 6's list, with
two app clients (the portal's and the phone's) and nothing else.

**Decided** (the owner, 2026-10-04, for the Vanderbilt pilot on production): self
sign-up **gated** to `@vanderbilt.edu` (step 4), MFA **Optional** with TOTP (step 6),
and the portal on its free Vercel address, `https://<project>.vercel.app` (e.g.
`bali-portal.vercel.app`), until a custom domain is chosen. Wherever these runbooks say
`<portal domain>`, that is `<project>.vercel.app` for now.

1. **MFA on the AWS root user.** Sign in as root → account menu (top right) →
   **Security credentials** → **Multi-factor authentication (MFA)** → **Assign MFA
   device** → authenticator app or a security key. Then do the console work below as
   an IAM user or IAM Identity Center user, not as root.
   **Check:** the root's Security credentials page lists the device; the next root
   sign-in asks for it.
2. **CloudTrail.** AWS console → **CloudTrail** → **Trails** → **Create trail**: a name
   like `bali-account-trail`, a new S3 bucket, **log file validation** on, all
   regions, **management events** read and write. (Event history already keeps 90
   days without a trail; the trail keeps them as long as the bucket does.)
   **Check:** **Trails** lists it as Logging: on; within ~15 minutes, files appear in
   the bucket.
3. **The pool.** **Cognito** → **User pools** → **Create user pool**, in the same
   region as dev's (`us-east-1`) unless there is a reason not to. Sign-in with
   **email**. Name it `bali-production`. Turn on **deletion protection**
   (pool **Settings**, *wording unsure*).
   **Check:** the pool's overview shows its **User pool ID** (`<region>_…`). Its
   issuer is `https://cognito-idp.<region>.amazonaws.com/<pool id>`;
   `curl -sS <issuer>/.well-known/jwks.json` returns a `keys` list. These are
   `AUTH_ISSUER` and `AUTH_JWKS_URI` (runbook 1).
4. **Self sign-up, gated to the school's domain.** Cognito has no domain allow-list
   setting, so a **Pre sign-up Lambda** refuses every other email:
   [`infra/cognito/pre-signup.mjs`](../infra/cognito/pre-signup.mjs). Attach it
   **before** turning sign-up on (open sign-up is what dev runs; never on prod).
   1. **Lambda** (same region as the pool) → **Create function** → **Author from
      scratch**: name `bali-pre-signup`, runtime **Node.js 22.x**, architecture
      arm64, default execution role → **Create function**.
   2. **Code** tab: open `index.mjs`, replace its contents with the whole of
      `infra/cognito/pre-signup.mjs` from `main` → **Deploy**. The handler stays
      `index.handler`.
   3. **Configuration → Environment variables → Edit → Add:**
      `ALLOWED_EMAIL_DOMAINS` = `vanderbilt.edu` → Save. Comma-separated for more
      than one; exact match only (`mc.vanderbilt.edu` must be listed itself). Unset
      or empty refuses every sign-up.
   4. Cognito → the pool → **Extensions** → **Add Lambda trigger** *(wording
      unsure)*: **Sign-up** → **Pre sign-up trigger** → `bali-pre-signup` → Add.
      The console adds the permission for Cognito to call it.
   5. Pool → **Sign-up**: **Self-service sign-up** on, and Cognito sends the email a
      verification code (**Cognito-assisted verification**, email), so nobody signs
      up with a school address they can't read.
   6. Leave **email** writable on both app clients (step 8). Cognito won't take
      write away from a required attribute, and hosted **Sign up** needs it to set
      the address at all. The guard is the check itself: it runs only at sign-up,
      so an account can only start from a school address, and Cognito sends a
      changed email a code before it counts as verified.
   Accounts you make yourself under **Users → Create user** skip the check (e.g.
   App Review's demo account). A first sign-in through Apple or Google is checked
   like a sign-up, so a hidden Apple email is refused.
   **Check:** on the hosted page (step 9) → **Sign up**: a `@gmail.com` address is
   refused with "PreSignUp failed with error Use your @vanderbilt.edu email address
   to sign up." (Cognito puts its own prefix before the Lambda's message and its own
   period after it, so the Lambda's message ends without one); a
   `@vanderbilt.edu` one is sent a code.
5. **Password policy.** Pool → **Authentication** → **Sign-in** → **Password policy**
   → **Custom**: minimum length 12 or more, temporary passwords valid 7 days or less.
   **Check:** the page shows the new minimum.
6. **MFA: Optional, TOTP** (ruled 2026-10-04). Pool → **Authentication** →
   **Sign-in** → **Multi-factor authentication** → **Optional**, **Authenticator
   apps** only, no SMS. Cognito sets MFA for the whole pool, not per group, so
   **Required** would make students use it too; Optional lets each user turn it on,
   and nothing forces a teacher to. Whether the hosted sign-in page itself walks an
   optional user through setting up TOTP is unsure; try it with a test account
   before telling teachers it works.
7. **Threat protection.** Pool → **Threat protection** *(formerly "advanced
   security")*. It needs the pool's **Plus** feature plan, which is billed per
   monthly active user; check the price first. Set it to **Full function**
   (enforcement), with compromised-credentials and adaptive authentication on.
   **Check:** the page shows Full function; **Users** → a user → shows a risk level
   after their next sign-in.
8. **The two app clients.** Pool → **App clients** → **Create app client**:
   - **The portal's:** type **Single-page application** (public, **no client
     secret**). Name `bali-web`.
     **Login pages** → **Allowed callback URLs:** `https://<portal domain>/auth/callback`
     only. **Allowed sign-out URLs:** `https://<portal domain>/login` only. No
     `localhost`, no preview URLs, no dev URLs.
   - **The phone's:** type **Mobile app** (public, no secret). Name `bali-ios`.
     Callback `bali://auth/callback` only; follow `docs/DEPLOY.md`, "The phone's
     sign-in", steps 2–3 (scopes with **Profile** ticked by hand, and the 365-day
     refresh token).
   - On **both**: **OAuth grant types:** **Authorization code grant** only (that is
     PKCE; Implicit off). **Scopes:** `openid`, `email`, `profile`. **Identity
     providers:** Cognito user pool (and Apple, if step 11 applies).
   - On **both**, **App client information → Edit:**
     - **Authentication flows:** turn **off** `ALLOW_USER_PASSWORD_AUTH` and
       `ALLOW_ADMIN_USER_PASSWORD_AUTH` (those send a password straight to the API).
       Keep `ALLOW_REFRESH_TOKEN_AUTH`. `ALLOW_USER_SRP_AUTH`: try it off; if the
       hosted page then fails to sign anyone in, turn it back on (SRP never sends
       the password).
     - **Prevent user existence errors:** **Enabled**, so a sign-in never says
       whether an email has an account.
   **Check**, with the AWS CLI signed in to the account:
   ```bash
   aws cognito-idp describe-user-pool-client --user-pool-id <pool id> --client-id <client id> \
     --query 'UserPoolClient.[ExplicitAuthFlows,PreventUserExistenceErrors,AllowedOAuthFlows,CallbackURLs,LogoutURLs]'
   aws cognito-idp initiate-auth --client-id <client id> --auth-flow USER_PASSWORD_AUTH \
     --auth-parameters USERNAME=nobody@example.com,PASSWORD=x
   ```
   The first shows no `*_PASSWORD_AUTH`, `ENABLED`, `["code"]`, and only the URLs
   above. The second must fail with *"USER_PASSWORD_AUTH flow not enabled for this
   client"*. Then the phone client's public-client check in `docs/DEPLOY.md`
   (`invalid_grant`, never `invalid_client`).
9. **The hosted-UI domain.** Pool → **Branding** → **Domain** → **Create Cognito
   domain**, prefix e.g. `bali`, **Hosted UI (classic)** (as dev). This is
   `https://<prefix>.auth.<region>.amazoncognito.com`: the portal's
   `NEXT_PUBLIC_COGNITO_DOMAIN` and the phone's `BALI_COGNITO_DOMAIN`.
   **Check:** open
   `<domain>/oauth2/authorize?response_type=code&client_id=<web client id>&redirect_uri=https%3A%2F%2F<portal domain>%2Fauth%2Fcallback&scope=openid+email+profile&code_challenge=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx&code_challenge_method=S256`
   in a browser: the sign-in page loads. A `redirect_mismatch` error means the
   callback URL isn't registered byte for byte.
10. **Delete unused clients.** Pool → **App clients**: delete every client that is
    not `bali-web` or `bali-ios`.
    **Check:** `aws cognito-idp list-user-pool-clients --user-pool-id <pool id>`
    lists exactly two, and both ids are in prod's `AUTH_AUDIENCE`.
11. **Sign in with Apple — only if Google sign-in is offered.** App Store guideline 4.8:
    an app that offers a third-party sign-in such as Google must offer Sign in with
    Apple too. Email-and-password through Cognito alone doesn't need it. If Google is
    on the pool:
    1. Apple Developer → **Certificates, Identifiers & Profiles** → **Identifiers** →
       the app ID `com.bali.Bali` → tick **Sign in with Apple** → Save.
    2. **Identifiers** → **+** → **Services IDs** → an identifier such as
       `com.bali.signin` → Continue → Register. Open it → tick **Sign in with
       Apple** → **Configure**: primary app ID `com.bali.Bali`; **Domains:**
       `<prefix>.auth.<region>.amazoncognito.com`; **Return URLs:**
       `https://<prefix>.auth.<region>.amazoncognito.com/oauth2/idpresponse` → Save.
    3. **Keys** → **+** → name it, tick **Sign in with Apple** → **Configure** →
       primary app ID `com.bali.Bali` → Register → **Download** the `.p8` (Apple
       offers it once; keep it in your password manager) and note the **Key ID**.
       Your **Team ID** is at the top right of the developer site.
    4. Cognito → the pool → **Social and external providers** → **Add identity
       provider** → **Sign in with Apple**: the Services ID, Team ID, Key ID, and the
       `.p8`'s contents; scopes `email` and `name`. Map Apple's `email` to `email`
       and `name` to `name`.
    5. Both app clients → **Login pages** → **Identity providers:** add Sign in with
       Apple.
    **Check:** the hosted sign-in page shows "Continue with Apple", and a test Apple
    ID signs in and lands back on the portal.
12. **Hand the values on:** `AUTH_ISSUER`, `AUTH_JWKS_URI` and `AUTH_AUDIENCE` to
    Railway (runbook 1); the domain and web client id to Vercel (runbook 3); the
    domain and phone client id to whoever adds prod's values to the iOS build
    (`docs/DEPLOY.md`, "Where the values go"; Phase 6's S10).

---

## 3. The Vercel flip

What it makes: a new Vercel project that builds the portal (`apps/web`) from `main`.

**Done 2026-10-05** (the status list at the top). The v2 demo site is the older Vercel
project `bali-web`, which turned out **not connected to the repo**: no push reaches it,
so steps 1–2 weren't needed. They stay below for a rebuild where a demo project is
connected. Left to do: step 6.

**What the repo says about `vercel.json`:** the file at the repo root only turns off
deploys of `main`. Vercel reads `vercel.json` from a project's **Root Directory**, so
it governs a project whose root is the repo root (the existing one, if that is its
setting), and not the new project rooted at `apps/web`. The doc's author can't see
your Vercel projects; step 1 tells you which case you're in.

1. **Look at the existing project, change nothing** *(only if a demo project is connected
   to the repo; not needed 2026-10-05)*. Vercel → the existing project →
   **Settings → General:** note its **Root Directory**. **Settings → Git:** note its
   **Production Branch** (expected `v2-archive`).
2. **Protect the demo before anything changes** *(only if a demo project is connected to
   the repo; not needed 2026-10-05)*. Still in the existing project →
   **Settings → Git → Ignored Build Step** → **Custom**:
   `[ "$VERCEL_GIT_COMMIT_REF" != "v2-archive" ]` (exit 0 means skip, so it builds
   only `v2-archive`). Never set its production branch to `main` unless you mean to
   retire the demo site: the next push to `main` would replace it with the portal.
   **Check:** **Deployments** still shows the demo's production deployment as
   current; its URL still shows the demo.
3. **The new project.** Vercel → **Add New… → Project** → import `eshan06/bali`:
   - **Root Directory:** `apps/web`. Leave **Include files outside the root
     directory** on *(wording unsure)*: the portal imports `packages/shared`.
   - **Framework:** Next.js (detected). **Build command:** default (`next build`).
     **Install command:** default; Vercel installs the npm workspace from the
     repo's lockfile. Name it `bali-portal`.
   - **Settings → Build and Deployment → Node.js Version: 22.x.** Vercel's default
     (24.x on 2026-10-05) fails the install with npm's `EBADENGINE`: the repo's
     `engines` asks for Node 22.
   - **Environment Variables**, scope **Production** only, before the first deploy:

     | Variable | Value |
     | --- | --- |
     | `NEXT_PUBLIC_API_URL` | `<prod API URL>` (runbook 1), no trailing slash |
     | `NEXT_PUBLIC_COGNITO_DOMAIN` | `https://<prefix>.auth.<region>.amazoncognito.com` |
     | `NEXT_PUBLIC_COGNITO_CLIENT_ID` | prod's `bali-web` client id |
     | `NEXT_PUBLIC_REDIRECT_URI` | `https://<portal domain>/auth/callback` |
     | `NEXT_PUBLIC_COGNITO_SCOPES` | `openid email profile` |
     | `NEXT_PUBLIC_SENTRY_DSN` | the portal's Sentry project DSN (optional) |
     | `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | `production` |

     None is secret (`docs/WEB.md`), but each is baked in at build time: change one,
     then **Redeploy**.
   - **Deploy.** **Check:** the deployment's build log finishes, and its
     `*.vercel.app` URL shows the portal's sign-in page.
4. **The domain.** For now (ruled 2026-10-04) it is the project's free address,
   `https://<project>.vercel.app` (e.g. `bali-portal.vercel.app`): no DNS. A custom
   domain later: **Settings → Domains** → add it and create the DNS record Vercel
   shows, then repeat this step's three URLs with it.
   **Check:** `https://<portal domain>` loads with a valid certificate. Then make
   these three agree, byte for byte: Vercel's `NEXT_PUBLIC_REDIRECT_URI`, the
   `bali-web` client's callback and sign-out URLs (runbook 2, step 8), and Railway's
   `CORS_ORIGINS` (runbook 1). Redeploy the portal after any change.
5. **Previews: protected, and never pointed at prod.**
   - **Settings → Deployment Protection → Vercel Authentication:** on, for
     **Standard Protection** (all deployments but the production domain).
     **Check:** a preview URL opened in a private window asks for a Vercel login.
   - **Settings → Environment Variables:** the **Preview** and **Development**
     scopes get dev's values (dev API, dev pool's domain and `bali-web-dev` client),
     or none at all. Never prod's: a preview is unreviewed code. **Check:** every
     `NEXT_PUBLIC_*` with a prod value is ticked **Production** only.
   - A preview can sign in only at a URL registered on dev's web client (Cognito
     takes no wildcards) and listed in dev's `CORS_ORIGINS`. Previews that can't sign
     in are fine; to sign in on one, register one fixed branch alias, never every URL.
6. **Remove `vercel.json`'s deploy block.** Ask a session for a PR that deletes
   `vercel.json` (the block is the whole file). It governs only a project rooted at the
   repo root, and none is connected (step 2's note), so the portal already deploys `main`
   without it; the file is dead weight that misleads.
   **Check:** after it merges, the next push to `main` deploys `bali-portal` as before,
   and the demo site is unchanged.
7. **End to end.** On `https://<portal domain>`: sign in (prod pool), the classes page
   loads, Sign out returns to `/login` saying you're signed out. In the browser's
   developer tools, the API calls go to `<prod API URL>` and none fails with a CORS
   error.

---

## 4. The backup-restore drill

What it proves: prod's data can be brought back, how long it takes, and that it comes
back whole. Run it after prod holds real sessions, then once a term.

**On hold for the Vanderbilt pilot:** prod has no backups (runbook 1, step 4), so step 1
below fails, and half B needs backups on dev, the same plan. Half A without step 1 proves a
`pg_dump` of prod restores whole; it is worth a run before the pilot's first week ends.

Railway's restore button, as far as this doc's author knows, restores a backup **over
the same volume**. Never do that on prod for a drill. So the drill has two halves:
prod's data restored into a scratch database inside prod's private network, and
Railway's own restore practised on dev, whose data is disposable. *(If the Backups tab
offers restoring into a new volume or service, use that on prod's latest backup instead
of the dump in A, and skip B.)*

Run it outside school hours, so prod isn't changing while you count.

**A. Prod's data into a scratch database (about 30 minutes).**

1. Postgres service (production) → **Backups:** note the latest backup's time.
   **Check:** it is from the last 24 hours. If not, stop: backups aren't running
   (runbook 1, step 4).
2. In `production`: **+ Create** → **Database** → **PostgreSQL**, named
   `restore-drill`. Delete its TCP proxy as in runbook 1, step 3. Add a variable to
   it: `PROD_DATABASE_URL=${{Postgres.DATABASE_URL}}`.
3. Shell into it: `railway link` (the project, `production`), then
   `railway ssh --service restore-drill`. Start a timer, or use `time` below.
4. Dump prod and restore it into the scratch database:
   ```bash
   time sh -c 'pg_dump "$PROD_DATABASE_URL" -Fc -f /tmp/prod.dump \
     && pg_restore --no-owner --no-privileges -d "$DATABASE_URL" /tmp/prod.dump'
   ```
   **Check:** no `error:` lines. If `pg_dump` refuses over a server version
   mismatch, the two Postgres services run different versions: give
   `restore-drill` the same version as prod's (its image tag) and start again.
5. **Row counts,** every table, prod against the copy:
   ```bash
   for t in schools users blocks classes enrollments sessions participations events armed_taps teacher_invites; do
     echo "$t $(psql "$PROD_DATABASE_URL" -Atc "select count(*) from $t") $(psql "$DATABASE_URL" -Atc "select count(*) from $t")"
   done
   ```
   **Check:** the two numbers match on every line.
6. **A known session's events,** in order. Pick a recent ended session:
   `psql "$PROD_DATABASE_URL" -Atc "select id from sessions where ended_at is not null order by started_at desc limit 1"`,
   then on both databases:
   ```bash
   Q="select count(*), md5(string_agg(event_id::text || type || occurred_at::text, ',' order by seq)) from events where session_id = '<session id>'"
   psql "$PROD_DATABASE_URL" -Atc "$Q"; psql "$DATABASE_URL" -Atc "$Q"
   ```
   **Check:** both lines are identical. Then open that session's recap on the
   portal and see it matches what you remember of the class.
7. **Destroy the copy.** It holds student data. `restore-drill` → **Settings** →
   **Delete service**, and delete its volume if Railway keeps it.
   **Check:** the `production` environment lists only the API, Postgres and the cron.

**B. Railway's own restore, on dev (about 15 minutes).**

8. Dev's Postgres → **Backups** → the latest → **Restore**. Railway stages the
   change; apply it *(wording unsure)*. Time it from the click until dev's API
   answers `/healthz` again.
9. **Check:** dev's portal signs in and lists its classes. Anything written to dev
   after that backup is gone; that is expected.

**Record it** — a line in `docs/PLAN.md` (ask a session for a PR, or add it to the
PR the session opens next) under Phase 5's P6, like:
`Restore drill 2026-MM-DD: prod backup of <time> restored into scratch in <A minutes>, counts and session <id>'s events match; dev's in-place restore took <B minutes>.`
A failed check goes there too, with what failed.

---

## 5. GitHub hardening

All on `github.com/eshan06/bali` → **Settings**, as the owner.

1. **2FA on the GitHub account.** Avatar → **Settings → Password and
   authentication → Two-factor authentication**. **Check:** the page says enabled.
2. **The owner on `.github/**`, `Dockerfile` and `railway.json`.** Two parts:
   - **CODEOWNERS.** Ask a session for a PR adding `.github/CODEOWNERS`:
     ```
     /.github/      @eshan06
     /Dockerfile    @eshan06
     /railway.json  @eshan06
     ```
   - **The ruleset.** **Settings → Rules → Rulesets → `protect-main`** → **Require a
     pull request before merging** → tick **Require review from Code Owners** → Save.
     *(Whether this needs "Required approvals" at 1 or works at 0 is unsure;
     try 0 first, then check below.)*
   - Know this before turning it on: GitHub never lets a PR's author approve it, and
     sessions open PRs under your account. So a session's PR touching those files
     won't auto-merge; you merge it yourself with the merge box's bypass, after
     reading it. That is the point: a PR can't change its own checks or deploy
     without you.
   **Check:** a PR that touches `.github/` shows "Review required — code owner" and
   doesn't merge on green; a PR touching only `docs/` merges as before.
3. **Secret scanning with push protection.** **Settings → Code security**
   *(formerly "Code security and analysis")* → **Secret Protection** (or **Secret
   scanning**) → **Enable**, then **Push protection** → **Enable**. On a public repo
   it's free; on a private one it needs GitHub's paid Secret Protection.
   **Check:** **Security → Secret scanning** opens with no alerts; pushing a commit
   with a test token pattern (on a throwaway branch) is blocked.
4. **Private vulnerability reporting.** Same page → **Private vulnerability
   reporting → Enable** (offered on public repos). **Check:** **Security →
   Advisories** shows a "Report a vulnerability" button to outsiders.
5. **CodeQL, default setup.** Same page → **Code scanning → CodeQL analysis → Set up →
   Default**. Languages: JavaScript/TypeScript and GitHub Actions. Swift builds on
   macOS runners and bills those minutes; leave it out unless you want it.
   **Check:** **Actions** shows a CodeQL run finishing; **Security → Code scanning**
   lists results (or none).
6. **Approval for outside contributors' workflows.** **Settings → Actions → General
   → Fork pull request workflows from outside collaborators** → **Require approval
   for all outside collaborators**. *(On a private repo this section reads
   differently: keep "Run workflows from fork pull requests" off.)* **Check:** the
   setting shows after Save.
7. **The load gate as a required check.** **Settings → Rules → Rulesets →
   `protect-main` → Require status checks to pass → Add checks** →
   `One-address load gate (k6)` → Save. Its workflow runs on every PR and skips the
   job when no API, database, shared code or manifest changed, and a skipped job
   counts as passed, so docs PRs never wait on it.
   **Check:** the next docs-only PR shows the check as skipped and still merges;
   the next API PR shows it running and required.
