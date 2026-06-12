# Bali v2 — Wiring Plan

> Phase 1 deliverable. Inputs: `DISCOVERY.md` (Phase 0), `design_handoff_bali_2/`
> (the target — docs 01–07 are normative), `legacy/` (the working wiring reference).
> This plan is executed immediately in Phase 2; deviations get noted back into this file.

---

## 1. Target architecture

```
bali/
├── apps/
│   ├── api/          Fastify 5 + TS — REST /v1 + SSE, zod-validated, port 3001
│   └── web/          Next.js 15 (App Router) — landing, /login, /t/[code], /app/**
├── packages/
│   ├── shared/       domain types · zod DTOs · the ONE state-derivation function · constants
│   └── db/           Drizzle schema · drizzle-kit migrations · seed (canonical demo data)
├── ios/              SwiftUI (iOS 16+) — Bali (student) + BaliTeacher targets over BaliCore
├── legacy/           old app, untouched (fallback + reference)
└── design_handoff_bali_2/   the spec
```

One Postgres database **`bali_v2`** on the existing RDS instance (`bali-db`,
us-east-1) — same instance, same credentials, separate database so legacy stays
fully runnable. Same Cognito user pool/client/domain as legacy for all humans.

**Runtime model:** the API is a long-lived Node process (local dev now; a container/
small VM later). It owns an in-process event bus that fans live updates out over SSE,
plus a 15s sweeper that ends overdue sessions and expires passes. Web talks REST+SSE;
iOS talks REST with a 30s heartbeat while focused (and instant POSTs for tap-in/unlock).

### Deliberate improvements over legacy (each: what → why)

| # | Legacy reality | v2 decision | Why |
|---|---|---|---|
| 1 | Hand-rolled regex router | **Fastify + fastify-type-provider-zod** | Validation at the edge, typed handlers, route table that can't drift, pino logging for free |
| 2 | Raw `pg`, serial `.sql`, **no transactions** | **Drizzle ORM + drizzle-kit**, explicit `db.transaction()` on multi-step writes | Schema-as-code, generated migrations, atomic session-start/unlock/pass flows |
| 3 | Shared `x-api-key` for all device/iOS calls | **Per-user Cognito JWT on every call; API key eliminated** | Attribution, revocability, no broadcast secret; students are authenticated people, not anonymous devices |
| 4 | Mutable `device_blocking_status` overwrites; sparse audit | **Append-only `events` table + dedicated `unlocks` table** | One source for every timeline UI (W9, portal, T3, S8, W4 panel); audit-grade; no lost updates |
| 5 | Dual-path blocking resolver (snapshot + legacy fallback) | **Snapshot-only**: sessions freeze `policy_snapshot` at start | Immutable session semantics; zero fallback complexity |
| 6 | Polling everywhere (web 5–10s) | **SSE push** (`/v1/sessions/:id/stream`) with automatic 5s-poll fallback + ReconnectingPill | Design requires near-instant emergency toasts and honest staleness UX; fallback keeps any deployment working |
| 7 | Role lives in Cognito `custom:role`, set by console | **DB-authoritative roles** (`teachers`/`students` rows keyed by `cognito_sub`; bootstrap endpoint provisions) | No invisible console state; the claim becomes a hint, not the truth |
| 8 | Hard deletes | Soft archive where history matters (`classes.archived_at`, `tags.deactivated_at`); events carry denormalized names | W8/W9 history survives roster churn |
| 9 | State logic scattered across clients | **One `deriveParticipantState()` in `packages/shared`**, used by API (and mirrored in Swift with the same fixture tests) | The 7-state system is law; one implementation of the law |
| 10 | No idempotency on student writes | Tap-in/unlock carry a client UUID; replays are no-ops | Emergency unlock must queue offline and replay safely |
| 11 | Permission revocation invisible until manual report | Heartbeat carries `permissionOk` + `shieldsApplied`; server flips `revoked` ↔ `focused` | The design's honesty promise ("Permission off" chip) stays live |
| 12 | No versioning | All routes under `/v1` | Future client skew safety |

Anti-goals (per design "out of scope"): no admin portal, no Android, no parent
surfaces, no leaderboards, no APNs settings UI, no per-student minute rankings —
the reports API will not even expose the query.

## 2. Data model (packages/db, Drizzle → Postgres `bali_v2`)

```
schools(id, name)
teachers(id, school_id→schools, cognito_sub UQ, email, name, display_name,
         notify_emergency bool, notify_revoked bool, notify_weekly bool, timestamps)
students(id, school_id→schools NULL, cognito_sub UQ, first_name, last_name, timestamps)
policies(id, teacher_id→teachers, name, messages_allowed bool, allowed_app_labels text[],
         timestamps)                      -- Phone always allowed; labels are words, never bundle IDs
classes(id, school_id, teacher_id, name, days_label, start_time, end_time,  -- end_time = "the bell"
        policy_id→policies, join_code char(8) UQ, require_approval bool, archived_at NULL)
tags(id, class_id→classes, label, code UQ, active bool, created_at, deactivated_at NULL)
memberships(id, class_id, student_id, status pending|active, joined_at, approved_at NULL,
            UQ(class_id, student_id))
sessions(id, class_id, teacher_id, policy_id, policy_snapshot jsonb,
         started_at, ends_at, ended_at NULL, end_reason bell|teacher NULL)
participations(id, session_id, student_id, state not_joined|focused|pass|emergency_unlocked|
               revoked|ended, no_device bool, tapped_in_at NULL, last_seen_at NULL,
               UQ(session_id, student_id))      -- rows created on tap-in or teacher action;
                                                -- roster minus rows ⇒ displayed "Not in"
passes(id, session_id, student_id, minutes, reason NULL, granted_at, ends_at, ended_at NULL)
unlocks(id, session_id, student_id, at, reason family|medical|safety|other|skipped NULL,
        reason_shared_at NULL, client_event_id UQ NULL)   -- reason NULL = "pending"
events(id bigserial, school_id, class_id NULL, session_id NULL, student_id NULL,
       teacher_id NULL, type, payload jsonb, at)
  -- type ∈ session_started|session_extended|session_ended|tapped_in|pass_granted|pass_ended|
  --        emergency_unlock|reason_shared|refocused|permission_revoked|permission_restored|
  --        member_requested|member_joined|member_approved|member_declined|member_removed|
  --        no_device_set|no_device_cleared|tag_created|tag_deactivated
```

Privacy invariants enforced in the API layer: no table stores screens/app lists/
location; `unlocks.reason` only ever set by the student; `GET /v1/student/history`
is the only reader of a student's own cross-session log; report endpoints return
aggregates only. Staleness is **derived** (`now - last_seen_at`), never stored.

Chip-state precedence (encoded once in `deriveParticipantState`):
`ended` > `revoked` > `emergency_unlocked` > active `pass` > `focused` > `not_joined`;
`no_device` replaces display when flagged; staleness ≥2min decorates any state.

## 3. API surface (apps/api, all JSON, Bearer ID-token unless marked)

```
            ── shared ──
POST /v1/auth/bootstrap        {role: teacher|student, firstName?, lastName?} → provision row
GET  /v1/me                    role + profile (+ teacher settings / student classes)
            ── teacher ──
GET/POST   /v1/classes                         list (with live + next-session info) / create
GET/PATCH  /v1/classes/:id                     detail / rename, schedule, policy, approval, archive
GET        /v1/classes/:id/roster              members + pending + per-member current state
POST       /v1/memberships/:id/approve|decline      DELETE /v1/memberships/:id
GET/POST   /v1/policies        PATCH/DELETE /v1/policies/:id   (delete guarded if in use)
GET/POST   /v1/classes/:id/tags        PATCH /v1/tags/:id      (label / active)
POST /v1/classes/:id/sessions  {endsAt, policyId?} → start (snapshot frozen, events)
GET  /v1/sessions/:id          header + participations (derived states) + active passes
GET  /v1/sessions/:id/stream   SSE: init snapshot · participant · session · event · ping(15s)
POST /v1/sessions/:id/end | /v1/sessions/:id/extend {minutes}
POST /v1/sessions/:id/passes   {studentId, minutes, reason?}
POST /v1/sessions/:id/no-device {studentId, on}   ← keyed by session+student (creates the
                               participation row when a never-tapped student is flagged)
GET  /v1/portal/home           greeting block, live-now card, today rows, approvals, recent events
GET  /v1/reports/unlocks?range=&classId=        rows + 6-week sparkline buckets (+CSV via Accept)
GET  /v1/reports/focus-minutes?range=&classId=  per-class averages only
GET  /v1/events?type=&classId=&cursor=          W9 log, cursor-paginated
GET/PATCH /v1/me/settings      display_name, school name, notify toggles
            ── student (iOS) ──
POST /v1/join                  {code} → membership (pending|active) + class preview
GET  /v1/student/home          classes + live-session banner states + permission echo
POST /v1/tags/resolve          {code} → class/session context → drives S4's 4 variants
POST /v1/sessions/:id/tap-in   {clientEventId, tappedAt?} idempotent → participation focused
POST /v1/sessions/:id/heartbeat {permissionOk, shieldsApplied} → last_seen_at; returns
                               {session{endsAt,endedAt}, participation{state}, pass{endsAt}?}
POST /v1/sessions/:id/unlock   {clientEventId, at?} idempotent, offline-replayable
POST /v1/unlocks/:id/reason    {reason: family|medical|safety|other|skipped}
POST /v1/sessions/:id/refocus
GET  /v1/student/history       weeks bars, streak, sessions w/ personal timelines (S8)
POST /v1/memberships/:id/leave
            ── public (no auth) ──
GET  /v1/public/tags/:code     {className} only — powers W2 fallback page
```

SSE wire shape: `event: participant` `data: {participation, state, staleSeconds}` etc.
The web client opens SSE; on `error` it shows ReconnectingPill and polls
`GET /v1/sessions/:id` every 5s until the stream re-establishes.

## 4. Surface-by-surface map (design → route → data → auth)

**Web (apps/web)** — shell: 216px sidenav (Home/Classes/Policies/Tags/Reports/Logs/
Settings + avatar/sign-out), tokens.css global, Instrument Sans + JetBrains Mono via
`next/font`, lucide-react @ strokeWidth 1.75.

| Surface | Route | Reads | Writes | Notes |
|---|---|---|---|---|
| Landing | `/` (public) | — | — | full §05 marketing page incl. live hold-to-unlock demos, tilt, rings; reduced-motion variants |
| W1 Login | `/login` | — | Cognito SRP `signIn`; Google → `signInWithRedirect` | Amplify v6; then `POST bootstrap` + route to `/app` |
| — Callback | `/auth/callback` | Amplify code exchange | — | mirrors legacy |
| W2 Fallback | `/t/[code]` (public) | `GET public/tags/:code` | — | deep link `bali://t/<code>` + store badge placeholder |
| Portal home | `/app` | `GET portal/home` (+SSE on live session for countdown/summary) | approve/decline | greeting, live-now card, today rows, rail |
| W3 Classes | `/app/classes` | `GET classes` | `POST classes` | create dialog + created/join-code state |
| **W4 Live** | `/app/classes/[id]/live` | `GET sessions/:id` + **SSE** | start/end/extend session, grant pass, no-device | all six states (a–f); toasts; StudentPanel; projector mode = fullscreen route param |
| W5 Roster | `/app/classes/[id]/roster` | `GET classes/:id/roster` | approve/decline/remove | join-code card + "Project this" |
| W6 Policies | `/app/policies` | `GET policies` | create/edit/delete (guarded) | PolicyEditor w/ honesty explainer |
| W7 Tags | `/app/tags` | `GET classes` + per-class tags | create/rename/deactivate | real SVG QR (encodes `https://<web>/t/<code>`), print sheet; NFC writing happens on iPhone (T4) |
| W8 Reports | `/app/reports` | `GET reports/unlocks`, `reports/focus-minutes` | — | framing line verbatim; CSV embeds it; sparklines |
| W9 Logs | `/app/logs` | `GET events` (cursor) | — | filter chips; EventTimeline rows |
| W10 Settings | `/app/settings` | `GET me/settings` | `PATCH me/settings` | "Shown to students as" feeds every student screen |

**iOS student (target `Bali`, dark-first)** — S0 sign-in (design gap, see §7) →
S1 onboarding (privacy contract verbatim; `AuthorizationCenter.requestAuthorization`)
→ S2 join (`POST join`) → S3 home (`GET student/home`) → tap tag → resolve → S4
(4 variants from resolve response) → S5 policy setup (FamilyActivityPicker; local
buckets per legacy technique) → `POST tap-in` → **S6 Focus Active** (arc 600ms once;
ManagedSettings shields on; 30s heartbeat) → hold 1.0s → local unshield **first**,
`POST unlock` (queued if offline) → S7 reason sheet → S8 history (`GET student/history`)
→ S9 settings/privacy → S10 ShieldConfiguration extension (six primitives only).

**iOS teacher (target `BaliTeacher`, light)** — T1 home (`GET classes`) + start sheet
(`POST sessions`) → T2 phone grid (`GET sessions/:id` + 5s poll or SSE via URLSession)
→ T3 student sheet (pass/no-device) → T4 tag list + **NFC write** (`NFCNDEFReaderSession`
writes the tag code; `POST classes/:id/tags`) → T5 active passes + notify prefs.

## 5. End-to-end flows (the wiring, traced)

**F1 — The slice: portal → start session → student taps in → live status back.**
1. Teacher: `/login` → Amplify SRP → ID token (Cognito pool `us-east-1_MwuzsGGtT`) →
   `POST /v1/auth/bootstrap` (teacher row, school `DEFAULT_SCHOOL_ID`) → `/app`.
2. `/app` renders `GET portal/home`. Teacher clicks **Start at 12:05** (or W4 state-c
   inline card) → `POST /v1/classes/:id/sessions {endsAt}` → tx: session row +
   `policy_snapshot` + `session_started` event → bus → portal/W4 flip live.
3. Student (iPhone, signed in via SRP, member of class): taps NFC tag → app reads code
   → `POST tags/resolve` → S4 "Ready" → Start Focus → `POST tap-in {clientEventId}` →
   tx: participation `focused` + `tapped_in` event → **SSE pushes `participant`** →
   W4 chip crossfades gray→green within ~150ms of receipt. iOS applies shields, starts
   30s heartbeats (`last_seen_at` → staleness stays <2min).
4. Bell: sweeper sees `now ≥ ends_at` → tx: session `ended` (reason `bell`) + participations
   `ended` + event → SSE `session` → W4 shows ended; iOS heartbeat response says ended →
   shields clear, S6 dismisses.

**F2 — Emergency unlock (offline-safe).** Hold completes → iOS clears shields
*immediately, locally* → enqueue `{clientEventId, at}` → `POST unlock` (replay until
2xx) → tx: unlock row (reason NULL=pending) + participation `emergency_unlocked` +
event → SSE → W4: sticky orange toast ("Reason pending · 10:31 AM"), chip pulses twice.
S7 sheet → `POST unlocks/:id/reason {family|…|skipped}` → `reason_shared` event → SSE →
toast sub updates in place. Re-focus → `POST refocus` → `focused` + shields reapplied.

**F3 — Pass.** W4 panel → `POST passes {studentId, minutes, reason}` → tx: pass row +
event; participation → `pass` → SSE → chip "Pass · 4:32" ticking client-side from
`pass.endsAt`. iOS heartbeat learns `pass` → S6 arc adopts blue, counts pass, shields
lift. Sweeper at `ends_at` → pass `ended` + event → both sides return to `focused`
(shields reapply) — "Shields return automatically."

**F4 — Permission honesty.** iOS heartbeat `permissionOk:false` (student revoked Screen
Time in Settings) → participation `revoked` + `permission_revoked` event → SSE → red
chip "Permission off" + sticky red toast (the only red). Restore → `focused` +
`permission_restored`.

**F5 — Join & approval.** S2 code entry → `POST join {code}` → `require_approval ?
pending : active` (+event) → pending shows in W5 card + portal rail (via portal/home
and SSE-less refresh) → Approve → membership `active` + event → student notified on
next `student/home` read (S2.4 "Request sent" → S3 class appears).

**F6 — No-device & staleness.** Teacher toggles in StudentPanel/T3 →
`POST participations/:id/no-device` (creates row if needed) → dashed chip. Staleness:
SSE `participant` payloads carry `staleSeconds`; chips ≥2min dim + badge; transport
loss ⇒ ReconnectingPill + poll fallback (the pill's "data may be 20s stale" copy is
honest because the poll keeps timestamps).

**F7 — Tags.** T4 writes NDEF code on iPhone → `POST classes/:id/tags`. W7 renders the
QR for the same code (URL `https://<web>/t/<code>`); phone-without-app hitting that URL
gets W2; phone-with-app deep-links straight into the S4 flow via `POST tags/resolve`.

## 6. Reuse vs rebuild

**Carried over as-is (the proven connections):**
- Cognito pool/client/domain + SRP flows (web: aws-amplify v6; iOS: Amplify Swift),
  Google IdP via hosted UI, `/auth/callback` + `balistudent://callback/` redirects.
- RDS instance + credentials (new database `bali_v2` beside legacy `bali`).
- `DEFAULT_SCHOOL_ID` single-school MVP convention.
- iOS Screen Time technique end-to-end: `AuthorizationCenter` → FamilyActivityPicker →
  locally-stored `FamilyActivitySelection` buckets → `ManagedSettingsStore` shields →
  `DeviceActivity` window; ShieldConfiguration extension; policy stays **semantic
  labels** server-side (server never sees app lists — now a design feature, not a hack).
- Core NFC NDEF read pattern; `BALI_DEV_API_HOST` LAN-dev convention; dev-only ATS
  local-networking; bundle id `com.bali.Bali` + team `H535678UF8` (drop-in replacement
  install; legacy reinstallable from `legacy/` any time).
- Port conventions: API :3001, web :3000 (env values copy across unchanged).

**Rebuilt (see §1 table for reasons):** API framework/routing/validation, DB schema +
access layer + migrations, role provisioning, liveness transport, event/audit model,
every pixel of UI on both platforms (new design), session/pass/unlock domain logic,
reports (aggregates-only), tag/QR system, seed data.

**Explicitly dropped:** shared `API_KEY` + anonymous device endpoints, hardware
check-in device registry (`devices` table — student phones are the devices now),
attendance present/late/absent/excused machinery (v2 models *focus participation*,
not attendance grading), CSV student import (roster forms via join codes; revisit if
asked), Android app, web student pages.

## 7. Env strategy

No secrets in committed files, ever. Names + placeholders in `.env.example`s; real
values copied locally out of `legacy/.env` / `legacy/packages/web/.env.local` (same
AWS resources, so values transfer verbatim unless noted).

| New file (untracked) | Vars | Source |
|---|---|---|
| **`.env` (repo root)** — shared by apps/api + packages/db scripts (deviation from the original `apps/api/.env` idea: db migrate/seed need the same values, and root-.env mirrors the legacy convention) | `DATABASE_URL` → same RDS host/user/pass, **db `bali_v2`** · `COGNITO_USER_POOL_ID` · `COGNITO_CLIENT_ID` · `CORS_ORIGIN=http://localhost:3000` · `DEFAULT_SCHOOL_ID` · `PORT=3001` · `SEED_TEACHER_EMAIL` · dev-only `ALLOW_DEV_TOKENS=1` | legacy `.env` (modified db name) |
| `apps/web/.env.local` | `NEXT_PUBLIC_API_URL=http://localhost:3001/v1` · `NEXT_PUBLIC_COGNITO_USER_POOL_ID` · `NEXT_PUBLIC_COGNITO_CLIENT_ID` · `NEXT_PUBLIC_COGNITO_DOMAIN` · `NEXT_PUBLIC_REDIRECT_URI=http://localhost:3000/auth/callback` | legacy web `.env.local` (new API path) |
| `ios/**/amplifyconfiguration.json` | same shape as legacy (pool, client, `balistudent://callback/`) | legacy ios config (untracked; `.example` committed) |

Dropped vars: `API_KEY` (auth model change), `DATABASE_SSL` (encoded in the URL's
`sslmode` instead), `COGNITO_DOMAIN` server-side (API only verifies JWTs).

## 8. Open questions → calls made (not blocking)

1. **Design shows no student sign-in UI.** Backend identity is required (states,
   history, passes are per-student). → Added minimal token-styled S0 sign-in/sign-up
   (email+password SRP, same pool) ahead of S1. The landing's "No student accounts"
   fine print stays verbatim (it's procurement copy: no school-provisioned accounts);
   tension noted here once.
2. **SSE vs Lambda.** API GW v2 + Lambda buffers responses — SSE won't stream there.
   → v2 API targets a long-lived Node process; if it's ever Lambda-deployed the web
   client's automatic poll-fallback keeps W4 fully functional (pill shows, 5s cadence).
3. **`bali_v2` database creation** needs CREATEDB on the RDS master user (likely held).
   → Attempt `CREATE DATABASE bali_v2`; fallback: Postgres **schema** `bali_v2` inside
   db `bali` (Drizzle `pgSchema`), equally isolated from legacy tables.
4. **Bells.** No school bell-schedule entity in the design. → Class `end_time` *is* the
   bell; "next bell HH:MM" copy derives from the class being started. Future: school
   bell table.
5. **Quiet hour gap: who flips `revoked` if the app is killed?** Heartbeats stop →
   staleness badge grows; state stays last-known (honest per design: staleness ≠ state).
   Revocation while app alive is caught by heartbeat; while dead, by next launch.
6. **W10 email toggles.** Stored as prefs; actual email delivery is out of scope (no
   templates in the design). Stub notifier logs intent. UI ships per spec.
7. **Teacher iOS Google sign-in** would need a new redirect URI on the pool client →
   teacher iOS uses email/password SRP only; zero Cognito changes. Web keeps Google.
8. **QR codes** render as real SVG (design: "render real ones") encoding the W2 URL.
9. **Demo data** (`Ms. Rivera / Period 3 / 28 students / KM3W7Q2A / T7XK2M9QPF`) ships
   as `npm run db:seed` for dev/demo only — never auto-applied.
10. **Rate limiting / abuse**: light `@fastify/rate-limit` defaults on student write
    routes; full hardening is post-MVP. *(Done in 2b: per-route opt-in, keyed by bearer
    token — never by IP, a classroom shares one school IP.)*

### Session-2 (2b/2c) deviations — each: what → why

11. **W8 focus-minutes denominator** is the school's real longest scheduled period
    (45 min with the demo seed), not the mock's literal 50 — the caption renders
    "Out of a {N}-minute period" with the true N. Honesty beats mock fidelity.
12. **Pending unlock reasons in W8** render "pending" in tertiary (same quiet weight
    as "skipped") — the design mocked no pending row; "reason pending" is the
    established W4 vocabulary.
13. **Tag reactivation** emits a `tag_created` event (renders "Tag … is live" — literally
    true) instead of adding a `tag_reactivated` enum value + migration.
14. **Policy delete** also nulls `sessions.policyId` / archived classes' `policyId`
    inside the tx — FK provenance pointers only; `policy_snapshot` stays the truth.
15. **S8 entry point** (design gap: no History link drawn anywhere): a History row in
    S9 Settings; the S3 gear navigates to S9.
16. **`notify_pass_endings` column added** (migration 0001) so T5's third toggle stores
    real intent instead of mislabeling an existing field. W10 still shows the
    designed three (emergency/permission/weekly).
17. **Teacher iOS navigation** is a 3-tab TabView (Classes/Tags/Passes) — the mocks'
    pill nav is a reviewer aid, not product chrome; tabs are the honest iOS idiom.
18. **DeviceActivity watchdog** (shields clear at the bell even if the app is killed)
    pads sub-15-minute sessions to iOS's 15-minute schedule minimum — the live engine
    still ends exactly at the bell; the watchdog is only the dead-app backstop.
19. **`bali://` URL scheme** registered on the student app only; the teacher app needs
    no deep links (and no new Cognito callback URIs).
20. **S5 count check** counts apps+categories+sites in the student's picker selection
    against the policy's label count, per the mock's copy ("The policy lists 3 — …");
    Messages, when allowed, rides the student's selection like any other pick.

## 9. Phase 2 build order (each step leaves the repo runnable)

1. **Foundations**: root workspaces, `packages/shared` (types, zod, state fn, tests),
   `packages/db` (schema, migrate, seed), `bali_v2` created on RDS.
2. **API core**: Fastify scaffold, auth middleware (aws-jwt-verify), bootstrap/me,
   classes/sessions/tap-in/heartbeat/unlock/passes/no-device, SSE bus, sweeper.
3. **Web slice**: tokens + fonts + shell; `/login` + callback; `/app` portal; W3
   minimal; **W4 complete (six states)**; Bali component kit (StatusChip, Arc,
   UnlockControl, Toaster, Timeline, JoinCodeBadge, ReconnectingPill).
4. **iOS slice**: project + BaliCore (tokens, API client, Amplify auth); S0–S4 minimal
   path (join, resolve, tap-in via typed code in Simulator), S6 + hold-to-unlock +
   heartbeat; Screen Time service behind protocol (real on device, stub on Simulator).
5. **Demo the slice end-to-end** (Simulator + local web + RDS) — then fan out:
6. **Web 2b**: landing, W2, W5–W10, polish, reduced-motion + a11y passes.
7. **iOS 2c**: S1 onboarding/permission, S5 picker, S7–S10 (shield extension),
   teacher T1–T5 (incl. NFC tag writing), device run.
8. Continuous: seed-driven screenshots vs design files; copy audit vs banned-word list.
