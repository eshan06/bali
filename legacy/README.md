# Bali — legacy app (reference baseline)

This folder is the **original, working Bali app**, relocated unchanged from the repo root
on 2026-06-11 so the root could host the v2 rebuild (see `../docs/WIRING_PLAN.md`). It is the
known-good baseline and fallback: **do not modify it** — run it from inside `legacy/`.

Classroom productivity platform: teachers manage classes/sessions/attendance, students
check in by NFC/simulator, and class sessions drive Screen-Time app blocking on iOS
(AccessibilityService overlay on Android).

## What's here

| Path | Description |
|---|---|
| `packages/web` | Next.js 14 teacher console + student web pages (`/dashboard`, `/student`) |
| `packages/api` | REST API — manual router, runs locally via ts-node or as AWS Lambda |
| `packages/db` | PostgreSQL schema, serial `.sql` migrations, query layer |
| `packages/shared` | Shared TS types, zod validators, blocking-snapshot resolver |
| `ios/` | SwiftUI student app (Amplify auth, Core NFC, FamilyControls shielding) + `ios/PLAN.md` |
| `android/` | Kotlin/Compose student app (parity endpoints, AccessibilityService blocking) |
| `docs/` | `aws-setup.md` (how the AWS resources were provisioned), `hardware-and-blocking-design.md` |
| `.env` | **Real secrets (untracked).** DB URL, Cognito IDs, device API key |
| `packages/web/.env.local` | **Untracked.** `NEXT_PUBLIC_*` Cognito/API config for the web client |

## Prerequisites

- Node.js 20+
- Network access to the shared AWS resources (all in `us-east-1`):
  - **RDS PostgreSQL 15** `bali-db` (public endpoint; connection string in `.env` → `DATABASE_URL`)
  - **Cognito** user pool + app client (real ids live in the untracked `.env` /
    `amplifyconfiguration.json`), hosted UI (email/password SRP + Google)
- For iOS on a real iPhone: macOS + Xcode (built with 26.x; set
  `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` if `xcode-select` points at CLT),
  a paid Apple developer team (was `H535678UF8`), and the Family Controls + NFC entitlements.

## Environment

Both env files already exist here with real values — nothing to create:

- `legacy/.env` — `DATABASE_URL` (secret), `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`,
  `COGNITO_DOMAIN`, `API_KEY` (secret; shared device key), `CORS_ORIGIN`,
  `DEFAULT_SCHOOL_ID`, `PORT`. Template: `legacy/.env.example`.
- `legacy/packages/web/.env.local` — `NEXT_PUBLIC_API_URL` (`http://localhost:3001/api`),
  `NEXT_PUBLIC_COGNITO_USER_POOL_ID`, `NEXT_PUBLIC_COGNITO_CLIENT_ID`,
  `NEXT_PUBLIC_COGNITO_DOMAIN`, `NEXT_PUBLIC_REDIRECT_URI` (`http://localhost:3000/auth/callback`).

The API loads `.env` from the **legacy folder root** (its cwd when run via the workspace
scripts below), so always run commands from inside `legacy/`.

## Run the web stack (teacher console + API)

```bash
cd legacy
npm install                  # node_modules was moved along, so usually a no-op

# 1. Database — schema already applied to the shared RDS; re-running is idempotent
npm run db:migrate

# 2. Build shared packages once (api/web import them)
npm run build:shared && npm run build:db

# 3. API on http://localhost:3001  (terminal 1)
npm run dev:api

# 4. Web on http://localhost:3000  (terminal 2)
npm run dev:web
```

Sign in at `http://localhost:3000/login` with a Cognito teacher account (email/password
or Google). Teachers are auto-provisioned into the DB on first `/api/auth/me` call using
`DEFAULT_SCHOOL_ID`. The role lives in the Cognito custom attribute `custom:role`
(`teacher` | `student`) — set it in the Cognito console for new users.

Useful dev surfaces: `/dashboard/dev/simulator/` (fake a device check-in without
hardware), `/student/` (student web view).

## Run the iOS app

Simulator (no NFC, no real shielding — both are stubbed):

```bash
cd legacy
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcodebuild -project ios/Bali/Bali.xcodeproj -scheme Bali \
  -destination 'platform=iOS Simulator,name=iPhone 17' -configuration Debug build
```

Real iPhone (NFC + Screen Time shielding work here; see `ios/PLAN.md` §device bring-up
for the full history):

```bash
# Mac and iPhone on the same Wi-Fi; API running on the Mac (port 3001)
export BALI_DEV_API_HOST=<your-mac-LAN-IP>

DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcodebuild -project ios/Bali/Bali.xcodeproj -scheme Bali \
  -destination 'id=<device-udid>' -configuration Debug -allowProvisioningUpdates build

xcrun devicectl device install app --device <udid> <path-to-built>/Bali.app
xcrun devicectl device process launch \
  --environment-variables '{"BALI_DEV_API_HOST":"<your-mac-LAN-IP>"}' \
  --device <udid> com.bali.Bali
```

Notes:
- The app reads `BALI_DEV_API_HOST` (env or UserDefaults) in DEBUG and calls
  `http://<host>:3001/api`; ATS allows local networking in dev builds only.
- Amplify config with the real Cognito IDs lives in the **untracked**
  `amplifyconfiguration.json` (see `.gitignore`); the `.example` next to it shows the shape.
  OAuth redirect scheme: `balistudent://callback/`.
- Family Controls requires a paid team and a real device; Authorization will fail on
  the Simulator by design.

## Android (incomplete)

`android/` builds with Gradle (`cd legacy/android && ./gradlew assembleDebug`); Compose
app with the same student endpoints, AccessibilityService-based blocking. It got through
login/join/check-in/blocking-overlay on emulator; never taken to hardware parity.

## How the pieces talk (one paragraph)

Web and both mobile apps authenticate against Cognito (Amplify SRP; Google via the hosted
UI) and call the API with `Authorization: Bearer <idToken>`. The API verifies JWTs with
`aws-jwt-verify` (pool/client from env, `custom:role` claim) and talks to RDS Postgres
via parameterized `pg` queries. Hardware/device endpoints (`/api/checkin`,
`/api/blocking/policy/:studentId`, status reports) instead use the shared `x-api-key`
header (value: `API_KEY` in `.env`). Live updates everywhere are **polling**: web 5–10s,
iOS/Android 30s while a focus session is active. Sessions snapshot their blocking config
at start (`class_sessions.blocking_config_snapshot` JSONB); iOS maps the snapshot's
semantic preset onto locally-picked FamilyActivitySelection buckets and applies
ManagedSettings shields; students can Emergency-Stop (logged to `emergency_stop_log`,
reported via `POST .../emergency-stop`).
