# Bali — Full-Focus-Only Simplification: Concrete Implementation Plan

*Written 2026-06-15 (session 7). This is the "concrete plan before touching the iOS shield
code" that `ZERO_SETUP_ANALYSIS.md` §5/§6 and the SESSION 6 handoff asked for. It enumerates
**every** file/symbol that references per-app policy today (full repo grep, not a sample) and
sequences the change so the app keeps compiling + running at each step. **No code in this plan
has been applied** — it is the owner's go/no-go gate.*

---

## 0. What this implements (the decision being executed)

From `ZERO_SETUP_ANALYSIS.md`: ship **full-focus as the only mode** — every session shields
**everything** except the OS-unblockable essentials (calls/Messages are free on iOS regardless),
deleting the per-app `FamilyActivityPicker` selection that is the *only* thing forcing extra
student setup. Two non-negotiables carry forward:

- **A safety/essentials floor** (§6.2) — must be designed, not hand-waved. Options in §6 below.
- **A class-wide opt-in allow-list** stays on the roadmap (§6.3) — *not* built here, but the data
  model below is left able to express it so we don't repaint ourselves into a corner.

**Recommended approach: deprecate, don't delete the data.** Keep `policy_snapshot` and the
`policies` columns in the DB (nullable / ignored) so historical recaps still render and a future
allow-list has a home. Collapse only the *behavior* (the shield) and the *editors* (the UI). This
is lower-risk than a destructive drop and fully reversible.

---

## 1. The blast radius (complete reference map)

`allowedAppLabels` / `messagesAllowed` / `PolicyBuckets` / `PolicySetupView` appear in **5 layers**:

| Layer | Files (count) | Role |
|---|---|---|
| **iOS enforcement** | `ScreenTime.swift`, `FocusEngine.swift` (4 call sites) | the actual shield — the only place behavior changes |
| **iOS student UI** | `PolicySetupView.swift`, `TapInView.swift`, `JoinView.swift`, `FocusActiveView.swift`, `HomeView.swift`, `SettingsView.swift`, `BaliCore/Models.swift` | picker flow + "allowed apps" display |
| **iOS teacher UI** | `T8Policies.swift`, `T9StartSession.swift`, `T6ClassDetail.swift`, `T12CreateClass.swift`, `TeacherModels.swift` | W6-equivalent policy editor + "allowed" strings |
| **Web** | `policies/page.tsx`, `classes/page.tsx`, `classes/[id]/live/page.tsx`, `app/page.tsx`, `lib/types.ts` | W6 policy editor + "— X allowed" strings |
| **Backend/shared/db** | `dto.ts`, `schema.ts`, `seed.ts`, `domain.ts`, `serialize.ts`, `routes/{manage,teacher,student}.ts` | DTOs, snapshot, persistence |

Behavior lives in exactly **two** files (`ScreenTime.swift`, `FocusEngine.swift`); everything
else is data shape and display copy.

---

## 2. Sequencing (each phase leaves the tree green)

The phases are ordered so the **backend stays wire-compatible** with the *current* iOS/web until
their phases land — you can deploy Phase 1, then ship the iOS build, then clean UI, without a
flag-day. Reason: the iOS app reads `session.allowedAppLabels`/`messagesAllowed` from the snapshot;
if Phase 1 keeps emitting those fields (now always `[]` / `true`), the un-updated app still decodes.

```
Phase 1  backend + shared + db + seed   (sandbox-verifiable here; deploy-safe, additive)
Phase 2  iOS enforcement collapse        (Mac/Xcode + device — the real shield change)
Phase 3  UI cleanup: editors + copy      (web here; iOS on Mac)
Phase 4  safety floor + carve-out        (gated on the §6 decision)
```

---

## 3. Phase 1 — backend / shared / db / seed  *(doable in this sandbox)*

**Goal:** every session is full-focus; policy fields become vestigial (always `[]`/`true`) but the
columns + snapshot survive for history and the future allow-list.

1. **`packages/shared/src/dto.ts`**
   - `createPolicyBodySchema` / `updatePolicyBodySchema` (lines ~69–70): make `messagesAllowed`
     and `allowedAppLabels` **optional with full-focus defaults** (`messagesAllowed` default `true`
     is already harmless; `allowedAppLabels` default `[]`). Keep accepting them so old clients POST
     without 400s; ignore the values on the write path (step 4).
   - `PolicyDTO` / `SessionDTO` (lines ~183–184): **leave the fields in the type** (now always
     `[]`/`true`) so the un-migrated iOS app still decodes. Add a `// deprecated: full-focus`
     comment. (Removing them is a later, breaking cleanup once every client is updated.)

2. **`packages/db/src/schema.ts`** — **do not drop columns.** Add a migration `0004` only if you
   want to relax `allowed_app_labels`/`messages_allowed` to nullable; otherwise leave the
   `.notNull().default()` as-is and simply stop writing meaningful values. `policy_snapshot`
   (lines 198–200) **stays** — it is what makes `reports.ts` history render. Recommendation: **no
   schema migration at all in Phase 1** (purely behavioral), which is the safest.

3. **`apps/api/src/routes/manage.ts`** (policy create/patch, lines 32–33, 115–116, 137–138) — keep
   the endpoints (a "policy" becomes just a `{name}`), but **stop persisting** picker values: write
   `allowedAppLabels: []`, `messagesAllowed: true` regardless of body. Serializer keeps returning
   them for client compat.

4. **`apps/api/src/domain.ts`** (snapshot build lines 180–181; resolution 607–608, 824–825,
   876–877) — set the snapshot to `{ name, messagesAllowed: true, allowedAppLabels: [] }`. This is
   the single source the iOS shield reads, so after this deploy **every new session is full-focus
   even on the old app** — a nice property (the behavior flips server-side first).

5. **`apps/api/src/serialize.ts`** (28–29) and **`routes/{teacher,student}.ts`** — no change needed;
   they pass the snapshot through (now always `[]`/`true`).

6. **`packages/db/src/seed.ts`** (116–126, 255–256, 328–329) — simplify the demo policies to
   names only (`Focus`, `Quiz`, `Lab` with empty allow-lists) so the seeded world matches the new
   model. Keep the three policies so the start-session picker still has options to pick a *name*.

**Verify (here):** `npm run typecheck -ws`, the api integration suite (12/12), and a manual
`startSession` → confirm the snapshot is `allowedAppLabels: []`. The shield-relevant contract is
now full-focus regardless of client.

---

## 4. Phase 2 — iOS enforcement collapse  *(Mac + Xcode + device only)*

This is the actual shield change and the heart of the pivot. **Cannot be built or device-verified
in the Linux sandbox** — needs Xcode 26.5 + the iPhone (see the build gotcha in HANDOFF SESSION 5/6:
always a concrete single-arch `-destination`).

1. **`ios/Bali/Bali/Core/ScreenTime.swift`**
   - Protocol (lines 10–19): replace `func applyShields(allowedLabels: [String])` →
     `func applyFullFocus()`; **delete** `func hasSelection(forLabels:) -> Bool`.
   - `RealScreenTimeService.applyShields` (85–93): collapse the `if PolicyBuckets…` branch to the
     else branch only — `store.shield.applicationCategories = .all()` /
     `store.shield.webDomainCategories = .all()`. Rename to `applyFullFocus()`.
   - `StubScreenTimeService` (26–28): mirror the new signature.
   - **Delete the `PolicyBuckets` enum** (line 36 onward) entirely.

2. **`ios/Bali/Bali/Core/FocusEngine.swift`** (4 call sites: 44, 59, 100, 164) — replace each
   `screenTime.applyShields(allowedLabels: session.allowedAppLabels)` with
   `screenTime.applyFullFocus()`. (start / resume / refocus / heartbeat re-apply.)

3. **Delete `ios/Bali/Bali/Features/PolicySetupView.swift`** (the on-phone `FamilyActivityPicker`
   selection screen — the S5 flow). It is the only thing that ever required a per-student picker tap.

4. **`ios/Bali/Bali/Features/TapInView.swift`** (101–102, 112–113, 151) — remove the
   `needsSetup`/`hasSelection` gate and the `PolicySetupView` sheet route; tap-in goes straight to
   focus (this is the "one tap, then instant" win). The `AllowedAppsRow` at 151 → see Phase 3.

**Verify (Mac):** clean build all four targets single-arch; on-device, start a session and confirm
a non-allowed app **will not launch** (full shield), Messages/phone still work, emergency unlock +
re-focus still re-shield, and the `BaliMonitor` watchdog re-applies at the bell.

---

## 5. Phase 3 — UI cleanup (editors + "allowed apps" copy)

Pure display/editor removal — no behavior. Web is sandbox-doable; iOS on the Mac.

**Web** (`apps/web`):
- `app/policies/page.tsx` — gut the allow-list editor (lines 18–28, 89–94, 104–105, 202–221): a
  "policy" becomes a name (or remove the page entirely if you also drop named policies — see §6.4).
- Strip `— {…allowedAppLabels.join(', ')} allowed` strings: `classes/[id]/live/page.tsx` (168, 219,
  369), `classes/page.tsx` (207), `app/page.tsx` (58).
- `lib/types.ts` (14, 21–22) — drop the fields once the API stops sending them (after the breaking
  cleanup; until then leave for decode).

**iOS teacher** (`BaliTeacher`):
- `T8Policies.swift` — remove the Messages toggle + label editor (127, 141–142, 166, 209+, 251–253);
  policy editor collapses to a name, or the screen is removed (§6.4).
- `T9StartSession.swift` (146), `T6ClassDetail.swift` (250, 298–301), `T12CreateClass.swift` (128) —
  drop the "— X allowed" subtitles.
- `TeacherModels.swift` (23, 38–39, 64–65, 149–150, 155–156) — keep the optional fields for decode
  until the API cleanup; then remove.

**iOS student** (`Bali`):
- `JoinView.swift` (109–168), `FocusActiveView.swift` (36–37), `HomeView.swift` (252–253, 351–352),
  `SettingsView.swift` (243) — remove the `AllowedAppsRow` and "Messages stays available" chips;
  replace with a single honest "Full focus — everything but calls & Messages is paused" line.
- `BaliCore/Models.swift` (30–31, 48–49, 70–71, 88–89) — keep optional for decode, then remove.

---

## 6. Open decisions still needed from the owner (these gate the work)

1. **The safety/essentials floor (§6.2 — blocking for K-12).** `.all()` blacks out *everything*
   except what iOS never lets a third party block (phone, FaceTime, Messages, Emergency SOS). It
   does **not** spare assistive/AAC/medical (CGM) apps — an ADA/IEP problem. Concrete choices:
   - **(a) Ship `.all()` now, document the gap**, deliver the assistive floor via the **supervised
     (Tier 2)** path where MDM can whitelist by bundle id. *Fastest; honest only if marketed as
     "calls & Messages always work" and the medical carve-out is a managed-device feature.*
   - **(b) Keep a *minimal* one-time `FamilyActivityPicker`** for the student to mark *their own*
     assistive/medical apps once (not per-class) → `store.shield.applicationCategories =
     .all(except: assistiveTokens)`. Re-introduces one optional tap, but only for students who need
     it, and it's their accessibility set, not teacher policy. **Recommended for BYOD K-12.**
   - **(c) Defer** — full `.all()`, no carve-out, pilot with 13+ gen-ed only. *Not safe for any
     IEP/504 population.*
   → **Recommendation: (b).** It preserves "zero per-class setup" for everyone while honoring ADA;
   the picker becomes a once-ever accessibility step, surfaced only if the student opts in.

2. **Class-wide opt-in allow-list (§6.3).** Build now, or roadmap? Recommendation: **roadmap**, but
   keep `policy_snapshot.allowedAppLabels` alive (Phase 1) so it's a data-model no-op to add later.

3. **Tier-2 managed enforcement** — the `ScreenTimeService` second conformer. Out of scope for this
   plan; it's where (a)'s medical floor would live. Separate effort.

4. **Do named policies survive at all?** If every session is identical full-focus, "policies"
   collapse to labels with no behavior. Options: **keep them as names** (minimal change, lets the
   start-session sheet stay familiar) vs **remove the concept** (delete W6 + T8 + the start-session
   policy menu). Recommendation: **keep as names for v1** (smaller diff, no migration), revisit when
   the allow-list ships.

---

## 7. Effort & risk

- **Phase 1** (here): ~half a day, low risk, additive, reversible. Flips behavior server-side.
- **Phase 2** (Mac): ~half a day of edits + a careful device pass. **This is the only risky part**
  — it touches the live shield; verify the watchdog + emergency re-shield on-device.
- **Phase 3**: mechanical copy/editor removal, ~half a day split web/iOS.
- **Phase 4**: scoped by the §6.1 decision (option b ≈ 1 day for the minimal assistive picker).
- **App Store**: the FamilyControls entitlement justification (§7 of the analysis) should be
  re-checked — full `.all()` shielding reads as more aggressive; keep the wellbeing/consent framing.

**Net:** Phase 1 is safe to do now and makes the *behavior* full-focus immediately (server-authored
snapshot). Phases 2–4 need the Mac and the §6.1 safety decision. I recommend doing **Phase 1 in the
sandbox next** once you green-light, and holding Phases 2–4 for a device session with the carve-out
decided.
