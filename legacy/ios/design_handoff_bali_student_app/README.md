# Handoff: Bali — Student iOS App

## Overview
Bali is a classroom productivity system. Students tap a real **NFC block** on their desk to automatically check in to class and activate a teacher-defined **Focus Mode** that pauses distracting apps for the duration of the session. When the teacher ends the session, apps unlock automatically.

This package contains the **student-facing iOS app** design, end to end: sign-in, device registration, joining classes, the NFC check-in moment, Focus Mode, emergency unlock, and session-end auto-unlock, plus profile/settings/notifications.

The companion **teacher dashboard** is a separate web app (not in scope here). The student app must never expose teacher controls (create class, start/end session, edit policy, roster, attendance override, or any "simulate check-in" affordance).

---

## About the Design Files
The files in this bundle are **design references created in HTML/CSS/React-via-Babel** — interactive prototypes that demonstrate the intended look, layout, copy, and behavior. **They are not production code to ship directly.**

The task is to **recreate these designs in the target environment**. Bali's student client is a native iOS app, so the natural target is **SwiftUI** (iOS 16+). If you are instead building a cross-platform client, recreate the same screens using that stack's idioms (React Native, Flutter, etc.). Either way:
- Match the visual spec (tokens, layout, type) precisely — this is **high-fidelity**.
- Use the platform's native primitives and your codebase's established patterns (navigation, networking, state) rather than porting the HTML structure literally.
- Replace mocked data/flows with real backend + real NFC (Core NFC) + real blocking (Screen Time / `FamilyControls` + `ManagedSettings` + `DeviceActivity`).

### How to run the reference
Open `Bali Student App.html` in a browser. A left-hand **"Screens"** rail (a reviewer-only tool — **not part of the app**) jumps to every screen and state. The center NFC button in the tab bar triggers check-in. "↺ Reset demo" restores the initial state. The rail must **not** be reproduced in the real app.

---

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, shadows, and interactions are final. Recreate the UI to match. The only deliberate placeholders are the **blocked/allowed app tiles** (generic names like "Chatter", "Glimpse" with colored squares) — these stand in for the real app catalog and avoid copying real brand logos. Replace them with the system's real app/category data.

> Note on the reference captures: the HTML uses entrance animations and bottom-sheet slide-ups. These are correct in a live browser; static screenshots may show them mid-animation.

---

## Platform Targets (native iOS specifics)
These map the prototype's concepts to real iOS capabilities:

| Concern | Prototype (mock) | Real implementation |
|---|---|---|
| NFC tap | Timed sheet animation | **Core NFC** (`NFCTagReaderSession`) reading the Bali block's tag/NDEF; send check-in to backend |
| App blocking | Greyed tiles + lock badges | **FamilyControls** authorization + **ManagedSettings** shields + **DeviceActivity** monitor, applying the session's server-sent policy |
| Permissions | "Allow access" button | `AuthorizationCenter.requestAuthorization(for: .individual)` (Screen Time / Family Controls) |
| Device ID | Static string `BALI-7F3A-22C9` | Stable per-install identifier (e.g. `identifierForVendor` + keychain-persisted ID); register with backend |
| Session policy | Local `POLICIES` object | Fetched from backend per active session; **never** editable on the student device |
| Notifications | Static list | Push (APNs) + local notifications for the four event types listed below |
| Auth | Instant | Email/password + Google Sign-In; **enforce student role** server-side, reject non-students |

---

## Design Tokens
All values are taken from `bali.css` (`:root`). Reproduce these as your design-system constants.

### Color — Brand
| Token | Hex | Use |
|---|---|---|
| `--blue` | `#2E5CFF` | Primary actions, accents, links |
| `--blue-700` | `#1E3FCC` | Primary pressed / gradient end |
| `--blue-300` | `#8AA4FF` | Light accent |
| `--blue-tint` | `#EAF0FF` | Secondary button bg, icon tile bg |
| `--blue-tint-2` | `#DDE6FF` | Unread card ring |

### Color — Ink / Neutral (cool-toned)
| Token | Hex | Use |
|---|---|---|
| `--ink` | `#0D1526` | Primary text |
| `--ink-2` | `#404B5E` | Strong secondary text |
| `--ink-3` | `#6B7585` | Body / secondary text |
| `--ink-4` | `#9AA3B2` | Tertiary text, placeholders, inactive icons |
| `--line` | `#E7EAF0` | Borders, input outlines |
| `--line-2` | `#EEF0F5` | Hairline row dividers |
| `--bg` | `#F4F5F8` | App background |
| `--surface` | `#FFFFFF` | Cards |

### Color — Status
| Token | Hex | Tint | Use |
|---|---|---|---|
| `--green` | `#15A974` | `#E2F6EE` | Present / checked-in / success |
| `--amber` | `#E08A12` | `#FBEFD8` | Late / pending / warning |
| `--coral` | `#F1564A` | `#FCE6E4` | Absent / emergency / destructive |
| `--violet` | `#7C5CFF` | — | Secondary class accent |

### Color — Focus Mode (dark)
| Token | Hex / value | Use |
|---|---|---|
| `--focus-bg` | `#070C1A` | Darkest background base |
| `--focus-bg-2` | `#0C1430` | Background mid |
| `--focus-card` | `rgba(255,255,255,0.06)` | Cards on dark |
| `--focus-line` | `rgba(255,255,255,0.10)` | Borders on dark |
| `--focus-text` | `#EAF0FF` | Primary text on dark |
| `--focus-text-2` | `rgba(234,240,255,0.62)` | Secondary text on dark |
| Focus hero gradient | `linear-gradient(150deg,#335CFF,#1E3FCC)` | Shield tile |
| Focus screen bg | `radial-gradient(120% 90% at 50% -10%, #142152 0%, #0C1430 42%, #070C1A 100%)` | Full screen |

### Radius
| Token | px |
|---|---|
| `--r-sm` | 12 |
| `--r` | 18 |
| `--r-lg` | 24 (default card) |
| `--r-xl` | 30 |
| Buttons | 9999 (full pill) |
| Icon tiles | 13 |
| Bottom sheet | 28 (top corners only) |

### Shadow
| Token | Value |
|---|---|
| `--sh-1` (card) | `0 1px 2px rgba(15,28,56,.04), 0 4px 14px rgba(15,28,56,.05)` |
| `--sh-2` (elevated) | `0 2px 6px rgba(15,28,56,.06), 0 14px 34px rgba(15,28,56,.09)` |
| `--sh-blue` (primary btn) | `0 8px 24px rgba(46,92,255,.30)` |

### Typography
Font: **system / SF** — `-apple-system, "SF Pro Text", "SF Pro Display", system-ui`. In SwiftUI this is the default `Font` (San Francisco). Scale:

| Style | Size | Weight | Letter-spacing | Notes |
|---|---|---|---|---|
| Display | 33 | 800 | -0.02em | Greeting "Maya.", screen titles |
| H1 | 27 | 800 | -0.02em | Hero headlines |
| H2 | 21 | 750 | -0.015em | Card titles |
| H3 | 17 | 700 | -0.01em | Row/section headings |
| Body | 15.5 | 400 | — | line-height 1.45, color `--ink-3` |
| Body-strong | 15.5 | 600 | — | color `--ink` |
| Footnote | 13 | 400 | — | color `--ink-3` |
| Eyebrow | 11.5 | 700 | 0.13em, UPPERCASE | color `--blue` (or `--ink-4` muted) |
| Tab label | 10.5 | 600 | — | — |

Numeric values that update (countdowns, IDs, times) use **tabular figures** (`font-variant-numeric: tabular-nums` → SwiftUI `.monospacedDigit()`).

### Spacing
Base 4px grid. Common gaps: 4, 6, 8, 10, 12, 14, 16, 20, 24, 32. Screen horizontal padding **20px**. Card padding **18px**. Safe-area top inset for content ≈ 56px; bottom inset for tab bar ≈ 92–112px.

---

## Layout Primitives

### Device / frame
Design canvas is **402 × 874** (iPhone logical points, ~iPhone 15). The HTML frame (status bar, dynamic island, home indicator) is `ios-frame.jsx` — **do not reproduce it**; it's only a preview bezel. The real app draws into the native safe area.

### Tab bar (persistent, light screens only)
- Height ~92px, translucent (`rgba(248,249,252,0.82)` + 22px blur). SwiftUI: `TabView` with `.ultraThinMaterial`-style bar.
- **5 slots:** Home · Classes · **[center NFC button]** · Focus · Profile.
- Center button: 62×62, radius 22, `--blue` fill, `--sh-blue` shadow, 4px background-colored border, NFC glyph, raised ~22px above the bar. Tapping it starts the NFC check-in for the current/likely-live class.
- Active tab: `--blue` icon+label and slightly heavier icon stroke; inactive: `--ink-4`.
- **Hidden** on: pushed detail screens, and the dark Focus Mode screen (which is a full takeover).

### Buttons (`.btn`)
Pill (radius 9999), height 52 (lg 56, sm 42), weight 650, gap 8 between icon and label, active scale 0.97.
- **primary**: `--blue` bg, white text, `--sh-blue`.
- **secondary**: `--blue-tint` bg, `--blue` text.
- **ghost**: white bg, `--ink` text, 1.5px `--line` inset border.
- **dark**: `--ink` bg, white text.
- **danger**: `--coral` bg, white text. **danger-soft**: `--coral-tint` bg, `--coral` text.
- **glass** (on dark): `rgba(255,255,255,.10)` bg, white text, subtle inset border. **glass-strong**: white bg, dark text.
- Disabled: opacity .45, no shadow.

### Cards (`.card`)
White, radius 24, shadow `--sh-1`, default padding 18.

### Badges (`.badge`)
Pill, height 26, 12.5px/650. Tones: blue, green, amber, coral, gray (each a tint bg + darker text). Optional leading 7px status dot. A `.live-dot` variant has an expanding pulse ring (use for "LIVE"/"BLOCKING APPLIED").

### Icon tiles (`.tile`)
Rounded square 44×44 (radius 13), tinted bg + matching icon color. Tones: blue, green, amber, coral, ink, violet.

### Attendance ring
Circular progress (conic/stroked). Track `#E7EAF0`, progress = class color, rounded cap, animates from 0 on appear. Centered % label, weight 750.

### Inputs (`.field`)
Height 54, radius 15, white, 1.5px `--line` inset border; focus → 2px `--blue` border. Leading icon tints `--blue` on focus. Read-only fields use `#EFF1F5` bg, no border, and a trailing lock icon.

### Segmented control (`.seg`)
`#E9ECF2` track, 3px padding; selected segment = white pill + `--sh-1`. Used for join method (Code/Link/QR) and grade picker.

### Bottom sheet (`.sheet` + `.scrim`)
Scrim `rgba(8,14,28,0.42)` + slight blur, fades in. Sheet anchored bottom, radius 28 top corners, slides up `translateY(100%)→0` over 420ms `cubic-bezier(.16,1,.3,1)`. Top grabber 38×5 pill. A `.sheet.dark` variant (`#14182B`) is used for the emergency confirmation.

---

## Screens / Views

> Navigation model: a **tab root** (Home/Classes/Focus/Profile) with **pushed detail screens** (slide-in from right, `push-enter`) and **modal bottom sheets** (NFC, emergency). Onboarding is a separate linear flow shown before the tabbed app.

### 1. Login  (`screens-auth.jsx → LoginScreen`)
- **Purpose:** student authentication.
- **Layout:** top hero band (height 312) with blue gradient `linear-gradient(160deg,#2E5CFF,#1E3FCC 60%,#16308f)` + soft radial highlight; "bali" wordmark 40/800 white, tagline "Focus, made effortless." + subcopy. Below, a white sheet (radius 26 top, overlapping the band by 26px) containing the form.
- **Components:** eyebrow "STUDENT SIGN IN"; School email field (mail icon, prefilled `maya.chen@lincoln.edu`); Password field (lock icon, dots, eye toggle); row with "Keep me signed in" checkbox (blue 18×18 with check) + "Forgot?" link; primary **Sign in** button (full width, lg, trailing arrow); "or" divider; **Continue with Google** ghost button with multi-color G logo; footer "Bali is for **students**. Teachers manage classes on the web dashboard."
- **Behavior:** any sign-in path → onboarding (register device). Real app: validate, enforce student role, handle errors inline.

### 2. Register Device  (`RegisterDeviceScreen`)
- **Purpose:** register this iPhone as a Bali device; generate a stable device ID.
- **Three phases:**
  1. *intro* — large device tile, eyebrow "Step 1 of 2 · Device", H1 "Make this your Bali phone", explanatory body, a card showing the device model + "Ready" green badge, primary "Register this iPhone".
  2. *generating* — device tile with animated **radar** rings, "Generating secure device ID" / "Pairing your phone…" (~1.9s).
  3. *done* — green check circle (pop animation), "You're paired", card showing the device ID (`BALI-7F3A-22C9`) + "Stable" badge, primary "Continue" → Permissions.
- **Real app:** generate/persist a real stable ID, POST to backend, then show assignment status. If the teacher hasn't assigned the seat yet, surface a "Waiting for your teacher to assign your phone" state (see Check-in state "Device not assigned").

### 3. Permissions  (`PermissionsScreen`, `onboarding` variant)
- **Purpose:** request Screen Time / Focus-blocking permission with a clear rationale.
- **Layout:** centered shield icon tile (blue, → green when granted); eyebrow "Step 2 of 2 · Permissions"; H1 "Allow Focus blocking"; explanatory body; a card listing three rows (Pause distracting apps / Use your teacher's policy / Auto-unlock when class ends), each with a blue icon tile + title + subtitle.
- **Behavior:** "Allow access" → ~1.2s "Requesting…" → granted state (green check card "Screen Time access granted"), then "Enter Bali" finishes onboarding. "Maybe later" skips. Also reachable (non-onboarding variant, with a back button) from Settings; reports failure if missing.
- **Real app:** `AuthorizationCenter.requestAuthorization(for:)`. If denied/missing, show the failure state and a path back into Settings.

### 4. Home / Class Home  (`screens-home.jsx → HomeScreen`)
- **Purpose:** the daily hub.
- **Layout (scroll):** header row — "Good morning," + Display "Maya." + bell button (with unread coral dot). Then the **hero**, which is one of three states:
  - *Live, not checked in* — blue gradient card, "CLASS IS LIVE" pulse badge, "{Class} started", "Tap your Bali block at {seat} to check in.", a white "Tap to check in" pill, large faint NFC watermark. Tapping → NFC sheet.
  - *Checked in (focus active)* — dark navy card (`linear-gradient(155deg,#0C1430,#070C1A)`) with blue radial glow, "FOCUS ACTIVE" badge, class name, "Apps unlock when the session ends · {time}", "{n} apps paused" + "Checked in/late". Tapping → Focus Mode.
  - *All clear* — white card, green check tile, "You're all set" + next session hint.
- Then a 2-up **stat row**: Attendance ring (avg across classes) + "{n}-day streak" (flame icon, amber tile). Then **Your classes** section header + "See all" → Classes tab; list of `ClassCard`s. Then **Pending invite** section if any (amber mail tile + "Review" → Join confirm).

### 5. Classes  (`ClassesScreen`)
- **Purpose:** roster of joined classes.
- **Layout:** header eyebrow "YOUR ROSTER" + Display "Classes" + round blue "+" button (→ Join). Body subcopy. List of `ClassCard`s. A dashed "Join a class" tile at the bottom.

#### ClassCard (`ClassCard`) — used on Home + Classes
White card, padding 18, with a **4px vertical color bar** (class color) on the left. Top row: eyebrow `PERIOD n` (class color) + optional "LIVE" pulse badge; H2 class name; footnote teacher; right-aligned **attendance ring** (class color). Divider, then bottom row: lock icon + policy name (left); status dot + status text (right). Status text logic:
- session active + checked in → green "Checked in"
- session active + late → amber "Checked in late"
- session active + not checked in → blue "Live now · tap in"
- else → gray "Next {time}" or "No session".

### 6. Join Class  (`JoinClassScreen`)
- **Purpose:** join via code / link / QR, with a confirm step.
- **Layout:** back button; eyebrow "ADD A CLASS"; Display "Join class"; segmented control **Code / Link / QR**.
  - *Code:* labeled field "Class code from your teacher" (e.g. `7K2-Q9F`); when ≥6 chars, the confirm card appears.
  - *Link:* card "Invite link detected" with `bali.app/join/{id}`.
  - *QR:* dark 200×200 panel with QR glyph + animated horizontal **scan line**.
- **Confirm before joining:** H3 "Confirm before joining" + card (class color square w/ school icon, class name, teacher · period, school row). Primary "Join {class}" + "Cancel".
- **Behavior:** join adds the class and returns to Classes; removes a matching pending invite.

### 7. Class Detail  (`ClassDetailScreen`)
- **Purpose:** everything about one class.
- **Layout (pushed):** back button + info button. **Header card**: class-color gradient (`linear-gradient(155deg,{color},color-mix(in oklab,{color} 70%, #0A1430))`), eyebrow period, H1 class name, teacher + school rows.
- **Current session block:**
  - *active, not checked in* — blue-outlined card, "SESSION LIVE" pulse badge + time range, "Check in at {seat}", body, primary "Tap to check in".
  - *active, checked in* — green/amber tile + "Checked in"/"late" + "Focus Mode is active · {policy}", dark "View Focus Mode" button.
  - *inactive* — gray clock tile + "No active session" + next time.
- **Stats:** 2-up — attendance ring + "{present} of {total} sessions present".
- **Assigned device + policy** card: device row (model + "Linked"/"Pending" badge) and a tappable "Focus policy" row (→ Focus policy preview).
- **Recent sessions** list: per row a status dot, date, time, and Present/Late/Absent badge.

### 8. Focus Policy Preview  (`screens-focus.jsx → FocusPreviewScreen`)
- **Purpose:** show what a class's policy blocks/allows (read-only).
- **Layout:** back; eyebrow "{Class} · Focus policy"; Display policy name; description + "Your teacher controls this — you can't change it during class." Then two cards: **Paused during class · {n}** (grid of locked app tiles) and **Always available · {n}** (grid of normal app tiles). 4-column grid, row-gap 18.

### 9. NFC Check-in Sheet  (`NfcSheet`) — **the signature interaction**
- **Presentation:** bottom sheet over the current screen (Apple-Pay style).
- **Header:** "bali" wordmark + divider + "Check in" + close (×). Below, a context card: class-color square (school icon) + class name + "{seat} · {teacher}".
- **Phases (auto-advancing, mimicking holding the phone to the block):**
  1. *waiting* (~2.1s) — expanding **radar** rings around the blue **NFC block mark** (rounded-square gradient tile with NFC glyph + glow); "Hold near your Bali block" + "Rest the top of your iPhone on the block at {seat}."
  2. *reading* (~1.5s) — NFC mark + "Reading Bali block…" + a determinate progress bar.
  3. *result* — one of:
     - **present** — green check circle (pop), "Checked in", class + time, "Starting Focus Mode…"; auto-advances (~1.7s) into Focus Mode.
     - **late** — amber check circle, "Checked in late".
     - **failed** — coral × in tint circle, "Check-in failed", "Couldn't reach the Bali server…", **Try again** (→ waiting).
     - **notAssigned** — amber device icon, "Device not assigned", "{teacher} hasn't linked this iPhone to your seat yet…", "Got it".
     - **noSession** — gray clock, "No active session", "There's no class running on this block right now…", "Close".
- **Critical rule:** there is **no manual "simulate check-in"** control. In the real app this whole sheet is driven by an actual Core NFC read of the physical block; the backend decides present/late/failed; the device must not let the student fake a check-in.

### 10. Focus Mode — Active  (`FocusActiveScreen`) — dark takeover
- **Purpose:** show that blocking is live and when it ends; the app's "in class" state.
- **Appearance:** **dark** screen (radial navy gradient). Status bar switches to light content. No tab bar. A chevron-down (top-left) returns Home; top-right "BLOCKING APPLIED" green pulse badge.
- **Hero:** glowing blue rounded-square **shield** tile (128, radius 40, blue gradient, blue radial glow behind); "FOCUS MODE ACTIVE" badge; Display class name; "Checked in · {time}" (or "Checked in late") with check/clock icon.
- **Countdown card** (glass on dark): "Apps unlock in" + large **mono countdown** (ticks down) | "Session ends" + end time; footnote "Set by {teacher}'s session — not editable here."
- **Paused right now** — section header + policy name; 4-col grid of **locked app tiles** (greyscaled + lock badge).
- **Still available** — 4-col grid of allowed app tiles (full color).
- **Emergency:** full-width glass "Request emergency unlock" button (→ emergency sheet); footnote "Phone & Messages stay available for emergencies."
- **Real app:** the countdown, policy, blocked/allowed sets, and "blocking applied/failed/disabled/unknown" status all come from the live session and the ManagedSettings state; report status back so the teacher dashboard reflects it live.

### 11. Focus Mode — Resting  (`FocusIdleScreen`)
- Shown on the Focus tab when no session is active / not checked in. Centered moon icon, "Focus is resting", contextual copy (if a class is live but not checked in, show a "Tap to check in" button). Below, a "How it works" 3-row explainer (Tap → Apps pause → Everything unlocks). If checked in to a live class, this tab instead renders **Focus Mode — Active**.

### 12. Emergency Unlock Sheet  (`EmergencySheet`)
- **Purpose:** request a temporary unlock from the teacher — never a silent bypass.
- **Layout:** coral hand tile + "Emergency unlock" + "Sends a request to your teacher to review." An amber warning card "This won't silently bypass blocking. Your teacher sees the request and decides." A **Reason** list (single-select pills: Family/urgent call, Medical, Need a specific app for class, Other) + an optional note textarea. Danger "Send request to teacher" (disabled until a reason is picked) + Cancel.
- **Sent state:** dark sheet, blue check, "Request sent", "Your teacher has been notified. Apps stay paused until they approve — nothing was bypassed.", "Back to Focus".
- **Emergency allow-list (always available, even in Full Focus):** Phone always; Messages and Camera typically; Maps optional per school policy.

### 13. Session Ended Overlay  (`SessionEndedOverlay`)
- Triggered when the teacher ends the session. Bottom sheet: green unlock icon (pop), "Focus Mode ended", "Your teacher ended the session. All your apps are available again.", a card "{n} apps unlocked · {class} · {time}", "Done". Dismiss returns to Home with blocking cleared.
- Corresponds to the "Session ended: Apps are available again" notification.

### 14. Profile  (`screens-misc.jsx → ProfileScreen`)
- Header eyebrow "ACCOUNT" + Display "Profile" + gear button (→ Settings). Avatar (blue gradient circle w/ initials), name, "Grade {n} · {school}", badges ("Device linked", "{n}-day streak"). Editable: First name, Last name (side-by-side fields), Grade (segmented 9–12), and **read-only** School email (locked). "Save changes" (enabled when dirty; shows "Saved" confirmation).

### 15. Settings  (`SettingsScreen`)
- Pushed. Display "Settings". Grouped inset rows:
  - **Account:** Profile (→), Email (value).
  - **Device & focus:** Registered device (→ Device info), Focus permissions (Granted/Off badge → Permissions), Class assignment (Linked).
  - **Notifications:** Class & focus alerts (On).
  - **About:** Help & support, Privacy, App version (`2.4.0 (118)`).
  - Destructive **Sign out** (danger-soft) + footer "Bali for Students · {school}".

### 16. Device Info  (`DeviceInfoScreen`)
- Pushed. Big device tile + "Registered & linked" badge. Rows: Model, Device ID, Registration (Active), Assigned seat. Footnote about the stable ID persisting across sign-ins.

### 17. Notifications  (`NotificationsScreen`)
- Pushed. "Mark read" action. List of cards (icon tile + title + time + body + unread blue dot + blue ring when unread). Four notification types to support:
  1. **Class started** — "Tap your Bali block to check in"
  2. **Checked in** — "Focus Mode is active"
  3. **Blocking failed** warning
  4. **Session ended** — "Apps are available again"

---

## Interactions & Behavior
- **Entrance transitions:** tab roots fade/slide up (`scrIn`, ~340ms, `cubic-bezier(.16,1,.3,1)`); pushed screens slide in from the right (`pushIn`); bottom sheets slide up from off-screen (`sheetUp`, ~420ms); scrims fade in.
- **Press feedback:** buttons scale to 0.97 on active.
- **Pulse:** "LIVE" / "BLOCKING APPLIED" dots emit an expanding ring (`pulse`, 1.8s loop).
- **Radar:** NFC waiting state emits concentric expanding rings (`radar`, 2.4s, staggered).
- **Countdown:** Focus Mode unlock timer ticks every second (monospaced digits).
- **NFC flow is automatic** once initiated — no manual confirm; mimics a hardware read.
- **Hit targets** ≥ 44px.

## State Management
Mocked in `app.jsx` (a single state object). Real-app equivalents:
- `phase`: auth → onboarding → app (gate on auth + student role + device registered).
- Active **tab** + a **navigation stack** for pushed detail screens.
- **sheet**: which modal is open (`nfc` | `emergency`) + an active session-ended overlay.
- **checkIn**: `{ classId, forcedResult }` while the NFC sheet runs.
- **checkedIn**: map of `classId → 'present' | 'late'`.
- **Focus active** is derived: a class has an active session AND the student is checked in.
- Per class: session (`active`, `startedAt`, `endsAt`, `blockName`/seat, `nextAt`), `policy`, attendance, recent sessions, assigned-device status.

### Data fetching (real app)
- Auth + role check; profile (first/last/grade/email-readonly).
- Classes list with live session state + policy (poll or push/websocket for "session started/ended").
- NFC read → check-in POST → server returns present/late + the session's Focus policy.
- Blocking status reporting back to backend: applied / failed / disabled / unknown (so the teacher dashboard updates live).
- Notifications via push.

## Blocking Policies (`data.jsx → POLICIES`)
- **Full Focus** — blocks all social/video/games; allows essentials (Phone, Messages, Camera, Calculator, Notes, Clock).
- **No Social Media** — blocks social only.
- **No Games** — blocks games only.
- **Custom blocklist** — supported; server-defined set.
- Policy is **always the session's server policy**, never local student settings.

## Assets
- **Icons:** custom SF-Symbols-style stroke set in `ui.jsx` (`Icon` component) — in SwiftUI use **SF Symbols** directly (home, square.grid.2x2, shield, person, bell, wave/`dot.radiowaves.left.and.right` for NFC, lock/lock.open, checkmark, etc.).
- **Logo:** "bali" lowercase wordmark, weight 800, letter-spacing -0.04em.
- **NFC block mark & focus shield:** simple gradient rounded-square tiles drawn in CSS (`NfcMark` in `ui.jsx`); recreate natively.
- **App catalog tiles:** generic placeholders in `data.jsx` (`APP_CATALOG`) — **replace with the real app/category catalog**; do not ship the placeholder names. Do not recreate real third-party brand logos.
- No external image assets; everything is code-drawn.

## Files (in this bundle)
- `screenshots/` — **reference images of every screen** (frozen, no animation). Map:
  `01-login` · `02-register-device` · `03-permissions` · `04-home` · `05-classes` · `06-class-detail` · `07-join-class` · `08-nfc-check-in` · `09-check-in-device-not-assigned` · `10-focus-mode-active` · `11-focus-mode-resting` · `12-emergency-unlock` · `13-session-ended` · `14-focus-policy-preview` · `15-profile` · `16-settings` · `17-device-info` · `18-notifications`.
- `Bali Student App.html` — entry point; loads everything in order.
- `bali.css` — **all design tokens + component styles** (the source of truth for the spec above).
- `ui.jsx` — icon set + primitives (`Icon`, `Eyebrow`, `Btn`, `Badge`, `Tile`, `Logo`, `NfcMark`).
- `data.jsx` — mock data: `BALI_DATA`, `APP_CATALOG`, `POLICIES`.
- `screens-auth.jsx` — Login, Register Device, Permissions.
- `screens-home.jsx` — Home, Classes, Class Detail, Join, `ClassCard`, `AttendanceRing`.
- `screens-focus.jsx` — NFC sheet, Focus Mode (active/resting), Emergency, Session Ended, Policy Preview, `AppTile`.
- `screens-misc.jsx` — Profile, Settings, Device Info, Notifications.
- `app.jsx` — navigation/state orchestrator + tab bar + (reviewer-only) jump rail. **The jump rail is not part of the app.**
- `ios-frame.jsx` — preview-only device bezel. **Not part of the app.**

## Explicitly OUT of scope (teacher dashboard — do NOT build into the student app)
Create class · Start/end session · Edit blocking policy · Roster management · Attendance override · Any "simulate check-in".
