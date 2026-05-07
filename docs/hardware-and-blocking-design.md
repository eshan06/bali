# Hardware / iOS contract & session-blocking snapshot

Owner: Eshan
Status: Shipped 2026-05-06 (commits `e1bfe1f`, `42f227d`, `30a69d1`, `633d7d7`)

## What this document covers

The end-to-end design of the prototype's classroom session loop:

1. A teacher registers a Bali tap device and assigns it to a student.
2. The teacher starts a class session — Bali captures an immutable snapshot of the blocking policy.
3. A student taps the device. Backend maps device → student → active session, marks attendance, and replies with the policy.
4. The student's iOS app fetches the same policy and reports back whether it was applied.
5. The teacher's active session page shows live attendance + per-student blocking status.

The goal is to make this flow demoable and reliable **before** the real hardware firmware and the native iOS app are ready, by mocking both through a teacher-facing simulator and keeping the contracts production-shaped.

## Goals

- Ship a contract the firmware and iOS teams can build to without further design churn.
- Make every step demoable from a single teacher login (no curl, no shell, no separate iOS test build).
- Guarantee that an in-flight class session sees a *stable* blocking policy — even if a teacher edits the class config mid-session, the live session keeps the policy it started with.
- Surface clear, typed error codes for every failure mode of the tap flow so the device firmware can render the right LED / message.

## Non-goals

- No real iOS Screen Time / app-blocking integration.
- No LMS sync (Canvas / Google Classroom / Blackboard).
- No analytics, push notifications, or device telemetry beyond a "blocking applied/failed" report.
- No multi-device-per-student support; assignment is currently 1:1.

## Architecture overview

```
              ┌─────────────────────────┐
              │  Bali tap device (HW)   │  POST /api/checkin
              │  or simulator UI        │  x-api-key
              └────────────┬────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │  /api/checkin handler   │
              │  - resolve device       │
              │  - find active session  │
              │  - upsert attendance    │
              │  - read snapshot        │
              └────────────┬────────────┘
                           │  blockingPolicy (from snapshot)
                           ▼
              ┌─────────────────────────┐
              │   Student iOS app       │  GET /api/blocking/policy/:studentId
              │   or simulator UI       │  POST /api/.../device-status/.../report
              └────────────┬────────────┘
                           │
                           ▼
              ┌─────────────────────────┐
              │  Teacher dashboard      │
              │  - active session page  │
              │  - devices page         │
              └─────────────────────────┘
```

The single load-bearing idea is the **session snapshot**: the moment a session starts, we resolve the class's blocking policy into a flat JSON document and store it on the session row. Every subsequent read — by iOS, by the simulator, by the teacher's UI — goes through that snapshot, never back to the class config.

## Data model

### `class_sessions.blocking_config_snapshot` (JSONB, added in migration `011_session_blocking_snapshot.sql`)

```json
{
  "preset": "no_social_media",
  "mode": "block_specific",
  "blockingActive": true,
  "blockedApps": [
    { "bundleId": "com.burbn.instagram", "appName": "Instagram" },
    { "bundleId": "com.zhiliaoapp.musically", "appName": "TikTok" }
  ],
  "allowedApps": []
}
```

Resolution logic lives in `packages/shared/src/blocking-snapshot.ts` (`resolveBlockingSnapshot(preset, customApps)`) and is shared between the API and the web UI. Each preset maps to a hardcoded bundle-id list in `packages/shared/src/constants.ts`:

| preset            | mode               | resolves from                                                  |
|-------------------|--------------------|----------------------------------------------------------------|
| `none`            | `block_specific`   | nothing — `blockingActive: false`                              |
| `full_focus`      | `block_all_except` | `FULL_FOCUS_ALLOWED_BUNDLE_IDS`                                |
| `no_social_media` | `block_specific`   | `SOCIAL_MEDIA_BUNDLE_IDS` minus system-protected               |
| `no_games`        | `block_specific`   | `GAME_BUNDLE_IDS` minus system-protected                       |
| `custom`          | `block_specific`   | the teacher's `class_blocked_apps` rows joined to `teacher_apps` |

App names come from `APP_NAME_BY_BUNDLE_ID` (also in `constants.ts`) so iOS can render a friendly label without a separate catalog round-trip.

### Other relevant tables (pre-existing)

- `devices` — `(school_id, device_id UNIQUE, friendly_name, student_id, registered_at)`. `student_id` is the assignment.
- `check_ins` — immutable log of every tap, deduped on `(session_id, device_id, tap_timestamp)`.
- `attendance_records` — one row per `(session_id, student_id)`, mutable so teachers can override status.
- `device_blocking_status` — per-session/student status report from the iOS side, including `reported_by` (`'manual' | 'device' | 'student_override'`).

### Lateness thresholds

- `ATTENDANCE_LATE_AFTER_MINUTES = 5` (constant in `@bali/shared`)
- `ATTENDANCE_ABSENT_AFTER_MINUTES = 15`
- `class_sessions.attendance_threshold_minutes` per-session column overrides the constant; default in the table is now 5 (was 10, changed in migration 011).

A tap within 5 min of session start → `present`. Anything later → `late`. Students with no tap stay `absent` (never auto-promoted).

## API contracts

### `POST /api/checkin`

Auth: `x-api-key` header (used by hardware firmware in production; the simulator uses the JWT-proxied alias below).

Request:

```json
{
  "deviceId": "device_demo_001",
  "timestamp": "2026-05-06T12:00:00Z"
}
```

Success (HTTP 200):

```json
{
  "success": true,
  "deviceId": "device_demo_001",
  "studentId": "...",
  "studentName": "Eshan Shah",
  "sessionId": "...",
  "classId": "...",
  "attendanceStatus": "present",
  "checkInTime": "2026-05-06T12:00:00Z",
  "blockingPolicy": { /* BlockingSnapshot from the session row */ }
}
```

Error (status varies):

```json
{
  "success": false,
  "error": "NO_ACTIVE_SESSION",
  "message": "No active class session found for this device."
}
```

| code                  | http | meaning                                                                  |
|-----------------------|------|--------------------------------------------------------------------------|
| `INVALID_REQUEST`     | 400  | body fails zod validation                                                |
| `UNKNOWN_DEVICE`      | 404  | `device_id` not registered                                               |
| `UNASSIGNED_DEVICE`   | 409  | device exists but `student_id IS NULL`                                   |
| `NO_ACTIVE_SESSION`   | 404  | the assigned student isn't enrolled in any class with a live session     |
| `AMBIGUOUS_SESSION`   | 409  | the student is enrolled in **multiple** simultaneously-running sessions  |
| `MISSING_BLOCKING_CONFIG` | 500 | reserved for future use; not currently emitted                       |
| `ALREADY_CHECKED_IN`  | 409  | reserved for future use; the dedup index quietly absorbs duplicate taps  |

### `GET /api/blocking/policy/:studentId`

Auth: `x-api-key`. Used by the iOS app to fetch the current focus-mode policy.

Active session response:

```json
{
  "blockingActive": true,
  "mode": "no_social_media",
  "classId": "...",
  "sessionId": "...",
  "blockedApps": [{ "bundleId": "com.burbn.instagram", "appName": "Instagram" }],
  "allowedApps": []
}
```

No active session:

```json
{
  "blockingActive": false,
  "mode": "none",
  "classId": null,
  "sessionId": null,
  "blockedApps": [],
  "allowedApps": [],
  "message": "No active session."
}
```

Reads `blocking_config_snapshot` directly. Falls back to the legacy resolver only for sessions started before migration 011.

### `POST /api/sessions/:sessionId/device-status/:studentId/report`

Auth: `x-api-key`. iOS app reports whether it managed to apply the policy.

Request body (current minimal shape):

```json
{ "isBlocked": true }
```

The brief includes a richer payload (`appliedMode`, `appliedAt`, `status`, `deviceId`); the database schema stores `(is_blocked, reported_at, reported_by)`. Extending the wire format to the brief's full shape is straightforward and tracked as future work.

### Simulator aliases (JWT auth)

Same handlers, mounted under `/api/dev/simulator/*`, gated by the teacher's Cognito JWT. This lets the in-browser simulator drive the production handlers without ever exposing `API_KEY` to the client bundle:

- `POST /api/dev/simulator/check-in`
- `GET /api/dev/simulator/policy/:studentId`
- `POST /api/dev/simulator/blocking-status/:sessionId/:studentId`

## Lifecycle

### Session start

`POST /api/sessions/start` (handler `packages/api/src/handlers/sessions/start.ts`):

1. Verify teacher owns the class.
2. Reject if the teacher already has a live session.
3. Pull the class's blocking config (`classBlockingConfigQueries.getConfig`).
4. Call `resolveBlockingSnapshot(preset, customApps)` to produce the JSON snapshot.
5. Insert the session row with the snapshot's `mode`.
6. Persist the snapshot via `sessionQueries.setSnapshot`.
7. If `snapshot.blockingActive`, flip `blocking_enabled = true` and dispatch the legacy push-notification path (kept in sync only for any read paths that haven't been ported yet).

### Tap → check-in

Handler `packages/api/src/handlers/checkin/tap.ts`:

1. Validate body. Reject `INVALID_REQUEST` on zod failure.
2. Look up `devices.device_id`. `UNKNOWN_DEVICE` if missing.
3. `UNASSIGNED_DEVICE` if `student_id IS NULL`.
4. Find sessions where the student is enrolled and `ended_at IS NULL`. Reject `NO_ACTIVE_SESSION` (zero) or `AMBIGUOUS_SESSION` (>1).
5. Insert into `check_ins` (deduped on `(session_id, device_id, tap_timestamp)`).
6. Compute attendance status from `tap_time - session.started_at` vs. `lateAfter`.
7. `attendanceQueries.upsertFromCheckIn` writes `attendance_records`.
8. Return success with `blockingPolicy = session.blocking_config_snapshot`.

### Mid-session edits — locked by design

`PUT /api/sessions/:sessionId/blocking-config` returns 409 unconditionally. The error message points the teacher at the class detail page. This is enforced at the API layer, not the UI: any client that tries to mutate a live session's policy gets bounced.

`PUT /api/sessions/:sessionId/blocking` (the on/off toggle) is still legal, but it ignores any `appIds` / `blockingMode` overrides in the body and dispatches the push notification straight from the snapshot. It can only enable or disable enforcement — not change the policy.

## Auth model

Two auth paths reach the same handlers:

- **`x-api-key`** — for hardware and the iOS app. The key is stored in the `API_KEY` env var, never reaches the browser.
- **`jwt`** — for the teacher's web app. Used by the dashboard UI and the simulator.

For three endpoints (check-in, policy fetch, status report) the simulator hits a JWT-aliased route and the firmware/iOS hit the apikey route, but both call the same handler functions. This avoids two parallel implementations.

## Simulator

`/dashboard/dev/simulator/` (sidebar-linked, teacher-auth gated). Three panels:

1. **Hardware tap** — picks a device from the registered list, sends `POST /api/dev/simulator/check-in` with `now()`. Renders the success / error response inline.
2. **iOS policy** — fetches `GET /api/dev/simulator/policy/:studentId` (auto-fills from the last successful tap). Renders the snapshot as blocked/allowed app chips.
3. **Status report** — emits `applied=true` or `applied=false` to `POST /api/dev/simulator/blocking-status/:sessionId/:studentId` for the most recent tap.

The active session page polls `/sessions/:id/device-status` every 5s and reflects the simulator's status reports as `Blocking applied / Blocking failed / Awaiting device` pills on each student card.

## Error handling principles

- Every check-in failure mode has a typed code. Never return raw stack traces to the client.
- Validation errors are `INVALID_REQUEST` (HTTP 400) regardless of which field failed; the message text spells out the reason.
- `404` vs. `409` is meaningful: 404 for "thing doesn't exist," 409 for "thing exists but is in a state that conflicts with the request."
- The web UI maps every code to a user-readable string (no raw codes in the dashboard).

## Alternatives considered

- **Reference instead of snapshot.** Storing only a pointer to the class config and re-resolving on each read would have meant mid-session policy edits silently leak into running sessions. Rejected; the brief explicitly called this out.
- **Open `/api/checkin`.** Simplest for demo, but anyone who learns a `device_id` could fake taps. The shared API key is one line of plumbing and matches what real firmware will do.
- **Per-device secret.** Would mint a secret on registration and require it on every tap. Closest to production hardware, but more wiring than this milestone needed. Tracked as future work.
- **Bundle-id catalog table.** A `app_catalog` table would have been more flexible than hardcoded preset → bundle-id lists, but would have added a migration, an admin UI, and a dependency for very little near-term value. Hardcoded constants in `@bali/shared` are easy to extend and ship.

## Future work

- Extend `device-status/.../report` to accept the brief's richer payload (`appliedMode`, `appliedAt`, `status: applied|failed|disabled|unknown`, `deviceId`). Schema-level: add `applied_mode`, `status` columns to `device_blocking_status`.
- Per-device authentication (mint a secret on registration, sign tap requests with it). Replaces `x-api-key` with a per-device HMAC or token.
- Demo seed: a one-shot script that creates `device_demo_001`, a sample class with `no_social_media`, a sample student, and the assignment. Currently this is manual.
- Wire a proper `MISSING_BLOCKING_CONFIG` failure so `none`-preset sessions reject taps with a clear message instead of returning an inactive snapshot.
- Move the legacy `getPolicyForStudent` resolver behind a single guard ("snapshot must exist for sessions started after 2026-05-06") and remove the JS code path once all such sessions have ended.

## Files

| concern              | path                                                              |
|----------------------|-------------------------------------------------------------------|
| migration            | `packages/db/migrations/011_session_blocking_snapshot.sql`        |
| snapshot resolver    | `packages/shared/src/blocking-snapshot.ts`                        |
| presets / app names  | `packages/shared/src/constants.ts`                                |
| session DB queries   | `packages/db/src/queries/sessions.ts`                             |
| device DB queries    | `packages/db/src/queries/devices.ts`                              |
| session start        | `packages/api/src/handlers/sessions/start.ts`                     |
| hardware check-in    | `packages/api/src/handlers/checkin/tap.ts`                        |
| iOS policy           | `packages/api/src/handlers/blocking/policy.ts`                    |
| status report        | `packages/api/src/handlers/blocking/deviceStatus.ts`              |
| session config lock  | `packages/api/src/handlers/blocking/sessionConfig.ts`             |
| toggle (on/off only) | `packages/api/src/handlers/blocking/toggle.ts`                    |
| router               | `packages/api/src/router.ts`                                      |
| active session UI    | `packages/web/src/app/dashboard/session/page.tsx`                 |
| devices UI           | `packages/web/src/app/dashboard/devices/page.tsx`                 |
| simulator UI         | `packages/web/src/app/dashboard/dev/simulator/page.tsx`           |
