# Bali — "Doorman-style" Zero-Setup Model: Analysis & Recommendation

*Written 2026-06-14 (session 6). Source: a 5-agent analysis (Doorman/market research + iOS
technical feasibility reading our codebase + teacher/student/administrator personas). This is a
decision document — the product owner still needs to make the calls in §6.*

The prompt: the owner wants Bali to work like **Doorman**, marketed as *"parental control apps
require every family to install and configure settings… Doorman works instantly at school, with
zero parent setup, and schools stay in full control while parents have full visibility."* Target:
**zero parent/student setup, instant at school, school in full control, parents full visibility** —
and the owner will accept **full-focus as the only mode** (drop per-app policies).

---

## 1. The headline finding — Doorman's lock is *weaker* than Bali's

Doorman is **not** MDM and **not** Apple FamilyControls. It's a regular App Store app that installs
a **Personal VPN (NetworkExtension)** and routes web traffic through a filtering server to block
high-dopamine sites; the NFC "DoorTag" tap activates it and logs attendance.

**The lock is soft.** An independent technical review (White Hatter) confirms: a student who turns
on *their own* VPN walks right through it. Doorman **cannot prevent** this — it can only **detect**
the disconnect and raise a red "Disconnected" alert on the dashboard for staff follow-up. So
Doorman's "full control" is really *filter + visibility + accountability*, enforced only as far as
the student cooperates.

**Bali already has the stronger lock.** Our FamilyControls/`ManagedSettings` shield is **OS-enforced**
— a non-allowed app simply will not launch, and a personal VPN can't defeat it; the `DeviceActivity`
watchdog re-applies at the bell even if the app is killed. The teacher persona put it bluntly:
*"Doorman alerts you when a kid cheats; Bali makes cheating not work."*

> **Strategic implication: copy Doorman's adoption model, not its technology.** The thing Doorman
> nailed is *go-to-market* — configuration moved entirely off parents (school roster/SSO + a
> per-classroom NFC tap), so the only end-user action is a one-time install + login + one OS
> permission. Bali should replicate that **experience** while keeping its superior enforcement.

---

## 2. The hard iOS constraint — "zero setup" is impossible on BYOD (be honest)

Everything that actually prevents an app from launching on iOS — `ManagedSettings` shielding,
`DeviceActivity`, the `FamilyActivityPicker` token model — sits behind the **FamilyControls
entitlement *and* a runtime grant**: `AuthorizationCenter.shared.requestAuthorization(for:)`. There
is **no** way to shield from a third-party app without that grant first being approved **on that
device**. Bali requests `.individual` (`ScreenTime.swift:73`) — the BYOD path.

- **`.individual`** (13–17, self-managed): the device owner approves one system dialog, once. This
  is the **irreducible one-time student tap**. Revocable anytime in Settings → Screen Time (Bali
  honestly surfaces this as "permission off").
- **`.child`** (under-13): requires a **parent** to approve from *their* Apple ID via Family
  Sharing — that's **more** parent setup, the opposite of the pitch, and it spikes COPPA exposure.
  It is also **mutually exclusive with MDM** (`.child` throws `FamilyControlsError.restricted` on
  MDM-enrolled devices).
- **Literal zero-setup** only exists on **school-managed / supervised** devices (Apple School
  Manager + MDM / Automated Device Enrollment), where restrictions, Web Content Filter, and Single
  App Mode push silently. That means the **school owns the hardware** — not a student's personal phone.

**Net:** the closest BYOD can get is **one student tap**, after which sessions are instant. The only
truthful framing is **"zero *parent* setup, one ~10-second student tap, then instant at every class."**
Do **not** market literal "zero setup" or "unbypassable" on BYOD — the admin persona said this must
be contractual: no such claims in anything reaching a parent/board.

---

## 3. Recommended direction — a two-tier hybrid (all three personas + feasibility converged here)

**Tier 1 — BYOD, one-tap, full-focus (ship now; it's mostly what Bali already has).**
Keep the FamilyControls one-tap model; embrace full-focus-only so the student's *single* action is
the authorization tap; sessions start instantly via NFC/join-code. This wins fast, IT-free,
bottoms-up adoption on the phones students already carry — Bali's real edge. Add the honest framing
from §2.

**Tier 2 — Managed/supervised devices via ASM + MDM (the upsell).**
For schools that own the hardware, the *same app* delivers literal zero-end-user-setup, hard,
non-revocable, schedule-driven focus. This is the only configuration that truthfully delivers "zero
setup + school in FULL (enforced) control," and it's how Bali lands districts without winning one
student at a time. Implement behind the **existing `ScreenTimeService` protocol seam** (a second
conformer + backend hooks for an MDM partner: Jamf School / Mosyle / Meraki).

**Parents get full visibility (both tiers, cheapest part to match honestly):**
a read-only parent surface (web route + lightweight invite/link) fed by Bali's **existing
append-only event stream** + W8 reports (focus minutes, tap-ins, emergency unlocks with optional
reasons). **No new iOS permission, no new on-device data** — preserves the lock-status-only contract.

**Reject:** DNS/network-only (doesn't stop offline native apps; profile is user-removable), and
betting the company on pure managed-device (slow procurement sale that contradicts Bali's
fast-adoption advantage).

---

## 4. Full-focus-only — YES as default, but keep a safety floor (unanimous persona caveat)

Dropping per-app policy is the right call: the `FamilyActivityPicker` trip is the **only** thing
forcing extra student work, so removing it collapses setup to one tap. It also deletes a lot of
surface area (see §5). **All three personas independently demanded a carve-out, though:**

- **Admin (compliance floor — mandatory):** an unconditional, district-controlled **always-allowed
  safety/assistive set** that survives *every* session — accessibility/AAC, communication, medical
  (e.g. CGM) apps, plus **calls and 911**. This is ADA/IEP/medical, not instructional policy. "Ship
  full-focus only, but never 'literally everything blacked out.'"
- **Student:** same — a small essentials carve-out (phone, messages, health/accessibility, maybe
  Notes/Calculator) so it feels like *focus*, not "my phone is bricked." Without any carve-out they'd
  narrowly vote to keep per-app policies.
- **Teacher:** drop per-app *policies*, but keep an **optional, class-level allow-list mode** (one
  toggle, whole class — Notes/Calculator/Canva/Classroom) for the ~20% of lessons where the phone is
  the work surface. "If you must ship one mode for v1, ship full-focus-only — but commit on the
  record to the class-wide allow-list next, or you'll lose teachers on their most tech-forward lessons."

**Synthesis:** ship **full-focus as the only/default mode**, delete the per-student picker churn, but
(a) keep a hard **safety/essentials floor** always-allowed (note: iOS makes calls/Messages
unblockable anyway; the assistive/medical floor likely needs the supervised tier or a minimal
one-time picker for those specific apps), and (b) put a **class-wide opt-in allow-list** on the
roadmap as the immediate next thing.

---

## 5. Concrete Bali changes (if we commit to this)

From the iOS-feasibility agent (grounded in the actual code):

**Drop per-app (full-focus-only):**
- Delete `ios/Bali/Bali/Features/PolicySetupView.swift`, the `PolicyBuckets` enum, and the
  `.all(except:)` branch in `ScreenTime.swift` → `applyShields` collapses to
  `store.shield.applicationCategories = .all()` / `webDomainCategories = .all()`. Remove the
  `FamilyActivityPicker` usage and the count-honesty/mismatch UI (the whole S5 flow).
- Simplify the `ScreenTimeService` protocol: `applyShields(allowedLabels:)` → `applyFullFocus()`;
  drop `hasSelection(forLabels:)`. Update `FocusEngine` start/resume/refocus/heartbeat to the no-arg
  shield.
- **Backend/shared:** remove `allowedAppLabels` / `messagesAllowed` from policy/session DTOs +
  snapshot — `packages/shared/src/dto.ts`, `packages/db/src/schema.ts` (`allowed_app_labels`,
  `policySnapshot` `$type`), `seed.ts`. Use a **nullable/deprecate migration** (not a destructive
  drop) to preserve history. Policies collapse to ~`{name}` or one implicit full-focus policy.
- **Web/teacher-iOS:** gut W6 policy editor + `T8Policies.swift` + the `T9StartSession` policy menu
  (every session is full focus). Keep classes/tags/sessions/recaps.

**Add:**
- A pluggable **managed-enforcement conformer** behind `ScreenTimeService` for Tier 2 (no-op local
  shields, report "enforced by MDM"; backend hooks for the MDM partner at session start/bell).
- A **read-only parent-visibility** web surface (reuse `reports.ts` focus-minute walker + unlocks +
  `EventTimeline`).
- Tighten BYOD onboarding to the single authorization tap (copy: "one-time *student* step, not
  parental setup").

**Keep unchanged:** NFC/join-code session start, the `BaliMonitor` watchdog (still needed so
full-focus shields never outlive a session), `BaliShield` (drop "allowed apps" wording, keep teacher
name + emergency path), the emergency-unlock local-first queue.

---

## 6. Open decisions for the owner (pick these next session)

1. **Commit to full-focus-only for v1?** (Strong yes from feasibility + admin; teacher/student say
   yes *with* a carve-out.) → if yes, the §5 deletions are a sizable but clean simplification.
2. **The safety/essentials carve-out** — how far? (calls/Messages are free; assistive/medical needs
   either a minimal one-time picker or the supervised tier.) **Treat as non-negotiable for K-12.**
3. **Class-wide opt-in allow-list** — roadmap commitment now, or genuinely defer? (Teacher's adoption
   risk lives here.)
4. **Two-tier scope** — build Tier 2 (ASM+MDM) now, or ship Tier 1 BYOD + parent-visibility first and
   treat managed as a fast-follow? (Recommendation: Tier 1 + parent visibility first.)
5. **Under-13 / K-8** — the `.child` parent-approval wall + COPPA make BYOD untenable for elementary;
   decide if K-8 is in scope (likely managed-only) or out for v1.
6. **Marketing language, contractually** — adopt "zero *parent* setup; one 10-second student
   permission; instant after; on personal phones it's focus + visibility, on school-managed devices
   it's fully enforced." Ban "zero setup"/"unbypassable" for BYOD.

## 7. Risks (legal/platform — confirm before shipping the pivot)

- **FamilyControls App Store review**: the entitlement needs separate Apple justification; keep the
  wellbeing/consent/emergency/revocability framing prominent (don't present as covert school control).
- **MDM isn't App-Store-distributed enforcement**: Tier 2 needs an MDM partner integration /
  per-partner certification — a different distribution + BD surface.
- **COPPA** (under-13 data → verifiable parental consent; school-consent exception needs a DPA),
  **FERPA** (focus/unlock recaps are education records; parent view must be access-controlled to that
  student), **CIPA** (don't market app-shielding as a CIPA web filter).
- **Supervision ceiling**: every "zero user setup / unbypassable" guarantee requires supervised
  devices. Set buyer expectations per device class.
- **BYOD revocability**: students can disable the authorization anytime, and `.individual` is hard to
  detect when backgrounded — so "school in full control" is *cooperative* on BYOD. Overstating it is
  a product-integrity and marketing-claims risk.

---

*Full raw agent output (this session): the workflow result is in the run transcript under
`…/subagents/workflows/wf_7b3e2c26-adc/`. This document is the synthesis.*
