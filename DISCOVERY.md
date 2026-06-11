# Phase 0 — Discovery summary

Two inputs were inventoried before any code: the design handoff (`design_handoff_bali_2/`,
the target) and the old app (`legacy/`, the wiring reference). Full reasoning and the
build plan live in `WIRING_PLAN.md`; this is the condensed stock-take.

## A. The design handoff (what we are building)

A complete, high-fidelity product design — **Bali: classroom focus sessions**. Teacher
starts a session; students tap an NFC desk tag; Apple Screen Time shields all but an
allowed app set until the bell; teacher watches a live status grid; students always have
a 1-second hold-to-unlock Emergency exit (orange, shame-free, offline-capable).

**Surfaces** (docs `04`/`05`, HTML refs in `design-files/`):

- **Web** — marketing landing `/`; W1 `/login`; W2 `/t/[code]` phone fallback;
  portal home `/app`; W3 classes `/app/classes` (+create); **W4 live dashboard
  `/app/classes/[id]/live` (THE page, 6 required states)**; W5 roster; W6 policies;
  W7 tags; W8 reports; W9 logs; W10 settings. Stack: Next.js + Tailwind + shadcn-style
  primitives, Instrument Sans / JetBrains Mono, Lucide @1.75.
- **iOS student (dark-first)** — S1 onboarding + privacy contract + permission;
  S2 join by code/QR; S3 home (StatusBanner); S4 tap-in confirm (4 variants);
  S5 policy setup via FamilyActivityPicker; **S6 Focus Active (flagship: hero arc,
  EmergencyUnlockControl)**; S7 post-unlock reason sheet (Skip first-class);
  S8 personal history; S9 settings/privacy; S10 ShieldConfiguration screen.
- **iOS teacher (light)** — T1 home/start-session; T2 phone live grid; T3 student
  detail sheet (pass form); T4 NFC tag writer; T5 passes & alerts.

**Non-negotiables**: the 7-state system (`not_joined / focused / pass /
emergency_unlocked / revoked / no_device / ended`) always icon+label+color;
red only for `revoked`+destructive; emergency always orange; exact emergency copy;
honesty/privacy copy verbatim; tokens in `tokens/tokens.css` are the source of truth;
motion budget ≤300ms except the one 600ms arc draw-in; banned vocabulary list;
staleness is an overlay badge, not a state. Canonical demo content (Ms. Rivera /
Period 3 — Algebra II / 28 students / `KM3W7Q2A` / `T7XK2M9QPF`) everywhere.

**Data the screens need** (doc `07` sketch, adopted): School, Teacher, Class, Policy,
Tag, Membership (pending|active), Session, Participation (state + last_seen heartbeat),
Pass, append-only Event log. Server-side privacy invariants: no screen/app/location data
exists; reasons nullable + student-supplied; student history visible to the student only;
reports expose averages, never per-student rankings.

## B. The legacy app (how the working wiring actually works)

Monorepo (`legacy/packages/{web,api,db,shared}` + `ios/` + `android/`).

- **API**: hand-rolled regex router (no framework), Node 20; local dev `:3001`,
  deployable as Lambda behind API Gateway (`ANY /api/{proxy+}`). Zod validation,
  parameterized `pg` queries, **no transactions**, no rate limits.
- **Auth**: Cognito pool `us-east-1_MwuzsGGtT`, client `3hsgud7pr2k0emhsodctqg4okd`,
  hosted-UI domain `bali-auth.auth.us-east-1.amazoncognito.com`; SRP + refresh flows;
  Google IdP configured. ID-token verified with `aws-jwt-verify`; role from
  `custom:role` claim; teacher auto-provisioned on first `/auth/me` using
  `DEFAULT_SCHOOL_ID`. Device/iOS policy endpoints use a **single shared `x-api-key`**.
- **DB**: RDS PostgreSQL 15 `bali-db` (us-east-1, public, db.t3.micro), database `bali`,
  19 tables (classes, class_sessions w/ JSONB blocking snapshot, check_ins,
  attendance_records, device_blocking_status, emergency_stop_log, …), serial `.sql`
  migrations via a custom idempotent runner.
- **Web**: Next.js 14 + Amplify v6 (SRP `signIn`, Google `signInWithRedirect`,
  `/auth/callback`); `api-client.ts` Bearer wrapper + `usePolling` (5–10s) for live data.
- **iOS**: SwiftUI, Amplify Swift (SRP + `balistudent://callback/`), `BALI_DEV_API_HOST`
  override → `http://<host>:3001/api`; **proven** FamilyControls/ManagedSettings
  shielding (preset → locally-picked FamilyActivitySelection buckets), Core NFC NDEF
  reading, 30s polling during focus, Emergency-Stop endpoint. Bundle `com.bali.Bali`,
  paid team `H535678UF8`. Entitlements: family-controls + NFC formats.
- **Env**: `legacy/.env` (`DATABASE_URL`†, `COGNITO_*`, `API_KEY`†, `CORS_ORIGIN`,
  `DEFAULT_SCHOOL_ID`, `PORT`) and `legacy/packages/web/.env.local`
  (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_COGNITO_*`, `NEXT_PUBLIC_REDIRECT_URI`).
  † = secret (never printed/committed).

**Carried forward**: the AWS resources + env values, Amplify SRP patterns (web + iOS),
JWT verification approach, the Screen-Time preset→local-buckets technique, NFC reading,
LAN-dev host convention, ATS dev posture.

**Deliberately not carried** (top of the list; full table in `WIRING_PLAN.md`):
shared API key (→ per-user JWT everywhere), framework-less router (→ Fastify),
no transactions (→ Drizzle + explicit tx), mutable status overwrites (→ append-only
events), legacy dual-path blocking resolver (→ snapshot-only), polling-only liveness
(→ SSE with polling fallback), hard deletes, presets-in-code.
