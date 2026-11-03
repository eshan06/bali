# Bali for Android — phases and open steps

Android's phases (8–11) and open steps, kept beside `docs/PLAN.md` and under its rules (the owner,
2026-11-02; `docs/DECISIONS.md`, 2026-11-02). PLAN.md stays the file every session reads first: it
carries Android's phase rows, one line in Now and a pointer here, and a session whose task is
Android's reads this file too (CLAUDE.md, Read first). The design is ARCHITECTURE's "Android app
structure", proposed until AN1b settles the lock.

- **The current state only.** A finished step is one line (its id, its title, ✅, its PR, its
  DECISIONS date); its full notes move word for word to `docs/PLAN-ARCHIVE.md`, and the why goes in
  `docs/DECISIONS.md`.
- **Everything but the steps is shared.** ARCHITECTURE.md, DECISIONS.md, PLAN-ARCHIVE.md,
  ISSUES.md, CLAUDE.md and `contracts/` serve iOS and the server too, and win where this file
  disagrees.
- **Under 6,000 words.** AN2 puts the cap in CI, as `plan-words.sh` holds PLAN.md under 8,000.

_Last updated: 2026-11-03 (Central) — AN1's setup (`docs/DECISIONS.md`, 2026-11-03): AN1 runs on
the emulator first and on the phones later (the owner), and the spike's code waits for the owner's
word; Android 15, 16 and 17 emulators are set up on the PC whose clone is `C:\dev\bali`; AN2's
contract tests run on every PR, as BaliCore's do. Next: AN1's spike, once the owner says its code
can start. Not on the pilot's critical path._

**The legend:** 👀 the owner looks at screenshots · 📱 needs the owner's Android phone · 🔧 the
owner in a console · ⚖️ the lawyer.

## Who builds what

- **The PC whose clone is `C:\dev\bali`:** every Android step, the screens included. It has the
  SDK, Google's command-line tools and three test emulators, each a Pixel 7 with 4 GB:
  `Bali_Spike_API35`, `Bali_Spike_API36` and `Bali_Spike_API37` (Android 15, 16 and 17; set up and
  cold-booted 2026-11-03). The owner's own `Pixel_7` is never used. Its traps are in
  `docs/GOTCHAS.md`'s "Android's SDK on Windows".
- **Cloud sessions:** the API's push (AN11) and docs. Also the steps that are Kotlin alone, tested
  on the JVM with no emulator, once the owner allows Gradle's hosts in the cloud environment
  (GOTCHAS, "Egress is allowlisted").
- **The owner:** the phones (📱), the consoles (🔧: Google Play, Firebase, Cognito's Android app
  clients, Railway's keys) and the lawyer (⚖️).
- **The Mac:** keeps iOS. No Android step needs it.

## How a step runs

Each step is one PR from a fresh worker, under ~400 changed lines not counting tests, and names its
iOS twin: the Swift it ports, whose rules come with their tests (ARCHITECTURE, "Android app
structure", the parity rule). A step that grows past that is split (AN4a, AN4b…). Two aren't PRs:
AN1's spike is a branch never merged, and AS0 is the canvas alone. **An engine step's validation:**
`android.yml` green (the build, Android Lint and the JVM tests), its twin's tests ported and
passing, and `/santa-loop`. **A screen step's** adds Compose UI tests that drive each state its
boards draw, and screenshots from the emulator at the default and the largest font scale, beside
its boards (👀). **A phone test** (📱) opens every part with its starting state (CLAUDE.md, the
owner's standing orders): the phone and its Android version, the class, focused or unlocked, the
screen, Airplane mode, the sticker.

## Phase 8, Android: the lock (iOS's Phase 0)

Android has no Screen Time for an ordinary app, so the lock is Bali's own (ARCHITECTURE, "Android
app structure", decision 2; ISSUES #6). Two candidates: **(a)** an Accessibility service that sees
which app comes to the front and covers it with Bali's block screen, and **(b)** usage access,
polled, with an overlay ("Display over other apps"). The spike measures both, on the emulators
first and then on real phones, before any of the app is built, as Phase 0 proved the shields first.

- **AN0** The plan (docs): this file, ARCHITECTURE's "Android app structure" (proposed), PLAN.md's
  rows, the decision, ISSUES #6 and #7, and CLAUDE.md's pointer — ✅ (#480; DECISIONS 2026-11-02)
- **AN1** 📱 The lock spike: (a) and (b), each on a Pixel and a Samsung (Open owner items, 1).
  Throwaway code on a branch of its own, never merged; the step writes a checklist for the owner,
  and the answers go to AN1b:
  - every app covered, and how fast: how long a blocked app shows before the cover lands;
  - Bali swiped away from recents, force-stopped, and the phone rebooted mid-session, into Safe
    Mode too;
  - the Samsung's battery saver, and Doze over a 50-minute class;
  - split screen, picture-in-picture, and an app opened from a notification;
  - apps in a work profile or Private Space, and a guest user;
  - Advanced Protection: Android 16's, and Android 17's, which is reported to turn off any
    Accessibility service that isn't a disability tool;
  - Emergency Unlock: the lock off at once, and the phone, messages and emergency calls never
    covered;
  - a real block's Text and URI records read (`BlockTag`), with Bali open and closed;
  - the battery a lesson costs.

  A build that doesn't come from Play may meet Android's "restricted settings" (13 and later)
  before its Accessibility service can be turned on: the checklist says how each build was
  installed — validation: every line answered on both phones

  **On the emulator first** (the owner, 2026-11-02: "we will do it on the simulator I have android
  simulator on this. I can get an android device later"): every line an emulator can answer, on
  Android 15, 16 and 17 (`Bali_Spike_API35`–`37`, Who builds what). A real block over NFC, the
  Samsung's battery saver and the battery a lesson costs wait for the phones, and AN1b waits for
  both. The emulators are set up (2026-11-03); the spike's code starts at the owner's word ("just
  setup. nothing with code yet", 2026-11-02). To check first (the spike worker's expectations, not
  findings):
  - whether a force-stop takes Bali off `enabled_accessibility_services` under (a);
  - the Stop button that Android 13 and later give (b)'s foreground service in quick settings'
    active apps;
  - that an emulator may not sleep as a phone does (log uptime beside elapsed time on every tick);
  - that ticks over `adb reverse` ride loopback, which Doze may let through (send them to
    `10.0.2.2`);
  - that usage events carry no window bounds, so (b) may cover an allowed app in split screen;
  - Samsung's in-call screen, its own package (`com.samsung.android.incallui`), on the allow-list;
  - that an overlay doesn't pause the app under it, whose sound may play on.
- **AN1b** The lock decided (docs): AN1's measurements into `docs/DECISIONS.md`; the owner's pick
  (Open owner items, 4) moves ARCHITECTURE's "Android app structure" from proposed to decided;
  ISSUES #6 and #7 updated. If neither lock holds up, the owner decides what becomes of Phases
  9–11 before any of them starts — validation: docs only

## Phase 9, Android: the engine (BaliCore's and BaliOutbox's twin, no screens)

After AN1b. Every rule in plain Kotlin where the JVM tests reach it, never in a screen, as
BaliOutbox's rules run on Linux; `contracts/` holds both apps to the same server.

- **AN2** The project and CI (twin: `ios/project.yml`, `ios.yml`, `ios/README.md`): Gradle under
  `android/` with the modules `core`, `outbox` and `app`; `android.yml`, the build, Android Lint and
  the JVM tests on Linux, run only when `android/` or the workflow changes, decided by a changes job
  as `ios.yml` decides (a workflow filtered by paths never reports, so a required check would wait
  on it); its contract tests (`core` decoding `contracts/fixtures/`, `outbox` running
  `contracts/outbox/`) instead on every PR but a docs-only one, never filtered by path, as
  `ci.yml`'s BaliCore Swift job runs, since the contract spans `apps/api`, `packages/shared` and
  `contracts/`: a server change that breaks the phone's reading of an answer goes red on its own PR
  (the conductor, 2026-11-03, from the owner's question: "will the same checks happen for android
  server work and all that?"); the plan check counting `android/` as source, and this file's 6,000-word cap
  (`plan-words.sh docs/PLAN-ANDROID.md 6000`). Letting an update to this file alone meet the check
  for an `android/` change, never for `apps/`, `packages/` or `ios/`, needs CLAUDE.md's working rule,
  which asks every source change for `docs/PLAN.md`, amended first in a PR of its own; `.gitignore`
  entries for Android Studio's local files (`local.properties`, `.gradle/`, `.kotlin/`, `.idea/`,
  `build/`); `android/README.md`; and the applicationId, minSdk and targetSdk decided (iOS's id is
  `com.bali.Bali`; the PC's untracked `android/` folder holds an old debug build as
  `com.bali.student`, never committed; targetSdk as Play's yearly rule requires) — validation:
  `android.yml` green on its own PR, the plan check's self-test with an `android/` case
- **AN3** The core (twin: BaliCore): the wire types and the vocabulary (`@bali/shared`'s lists, a
  value it doesn't know read as none), UUIDv7 event ids, the API client and its errors (keyed on
  `reason`, never the message), and `BlockTag` (an NDEF Text record, or a URI record,
  `bali://t/<code>` or `https://<host>/t/<code>`). Every `contracts/fixtures/` file is decoded in a
  test, as BaliCore's Linux job decodes them, so a new fixture fails until `core` reads it
- **AN4** The outbox store (twin: BaliOutbox's `Outbox` and `OutboxRecord`): Room in the app's own
  storage; the records; the unlock contract (`contracts/outbox/`; no response ever means delete);
  the outbox's counter and its install id, the phone's order (A12); and Bali's files left out of
  Android's backup (ARCHITECTURE, "Android app structure")
- **AN5** The sync engine (twin: `SyncEngine`): the drain with backoff and jitter, the 30-second
  check-in while Bali is open, and the reconcile (`readMayReconcile` and the typed dispositions),
  all on a fake clock
- **AN6** Sign-in (twin: `SignIn`, `TokenStore`): Cognito's hosted UI in a Custom Tab, the code
  grant with PKCE; tokens sealed by a Keystore key; the refresh, Sign out, `Tokens.checked` (no
  token to Bali's API before the 13+ check, but the check's own read and a deletion's) and the
  deletion token; only a real `401` signs anyone out. 🔧 The owner makes Android's Cognito app
  clients on dev and prod (no secret; the scopes iOS's client has, `aws.cognito.signin.user.admin`
  among them for Delete account) and adds their ids to `AUTH_AUDIENCE` on dev's and prod's API, or
  the API refuses Android's tokens with a `401`, which signs the student out
- **AN7** 📱 The lock (twin: BaliOutbox's `Enforcement`, `Bell` and `PhoneBell`): AN1b's method;
  the system allow-list (decision 2); rule 3 at every check-in; protection off and on, with iOS's
  events; the bell, from the session's window; and a Debug readout like iOS's for the phone checks.
  For the owner: whether the lock's service checks in while it runs, so that a quiet Android phone
  means a stopped Bali (ARCHITECTURE, "Android app structure", the rules) — validation: the rules'
  JVM tests, then the device check on both phones
- **AN8** 📱 The tap over NFC (twin: `BlockReader`, B6): reader mode, started from the Debug readout
  until AS4 builds Bali's "hold your phone to the block" screen; the offline tap in under a second;
  the tap's dispositions (`tapDisposition`); and, if AN1 found it works, the block's link opening
  Bali when it's closed — validation: the JVM tests, then a real block on both phones, offline
- **AN9** The account's flows (twin: `Join`, `Me`, `History`, `Age`, `Deletion`): Join with the
  consent list, Me, History, the 13+ check (C7, C7-server), Your name, and Delete account (what the
  phone queued first, every Emergency Unlock first, then `DELETE /v1/me`, then Cognito's DeleteUser)
- **AN10** The router and the screens' rules (twin: `Screen.swift`, `FocusWords`, `UnlockedWords`,
  `ProtectionOffWords` and `ShieldWords`): which screen shows when, and what Focus, Unlocked,
  Protection off and the block screen say (rule 3: no countdown over nothing locked), their rules
  and tests ported; the words from AS0's approved boards, so AN10 follows AS0
- **AN11** The API's push (cloud; twin: `apps/api/src/push/apns.ts`): an FCM sender beside APNs,
  under the same rules (after the Start commits, the same words, no personal data, a token reported
  gone deleted); an additive field on the push-token endpoint, `PUT` and `DELETE`, naming the
  token's service, absent meaning APNs, so every shipped iPhone calls it as today; under it, each
  service's own token format (an FCM token, mixed case with `:`, `-` and `_`, kept as sent, never
  lower-cased as an APNs token is), what `environment` means for an FCM token, and each sender
  sending to, and deleting, only its own service's tokens; the privacy paths (the deletion, the
  disposal, the retention run, the export) holding FCM's tokens as they hold APNs's; the fixtures
  and `openapi.json` regenerated; integration tests for the happy path, authz, validation and
  replay. 🔧 The owner makes the Firebase project and puts its key on Railway, dev then prod —
  validation: `npm run typecheck && npm run lint && npm test`, `npm run demo`
- **AN12** The app's push (twin: the push's app half, #456): the FCM token registered at each launch
  and removed at Sign out; Android's notification permission (Android 13 and later) asked once,
  right after onboarding's permission steps, as iOS asks after its Screen Time step; and #336's
  random wait of up to 10 s before the first read after a fresh alert — validation: the JVM tests,
  then an end-to-end check like N6's on an Android phone (📱)
- **AN13** The live lesson's engine (twin: `LiveLesson`, L5, and M7's deck download and cache): the
  poll and the answer, the deck downloaded, checked against its `sha256` and cached, and a page
  drawn with `PdfRenderer`; answers never enter the outbox

## Phase 10, Android: the screens (from the approved boards)

After AS0. Every screen built from boards the owner approved, every state drawn (CLAUDE.md, Working
rules); `docs/DESIGN.md` read first, its Android section from AS0; every user-facing string through
`no-ai-slop`; font scale and TalkBack in every step.

- **AS0** 👀 The Android canvas (Claude Design; no code): a board per screen group in Android's own
  controls, the approved iOS boards' words and states carried over; the Android-only screens: the
  permission steps in place of the Screen Time ask, "hold your phone to the block" (Android has no
  system NFC sheet) and the block screen (BaliShield's twin); and `docs/DESIGN.md`'s Android
  section. The owner approves it, and rules whether the approved iOS boards then stand for the rest
  (the owner, 2026-11-02: "now we have the screens and stuff settled") — validation: the canvas
  opened and every board checked before it's reported
- **AS1** 👀 The theme and shared pieces (twin: `Theme.swift`): `bali-tokens.json` in Compose, type
  that follows the font scale, and the hold-to-unlock control (one second, as on iOS)
- **AS2** 👀 Sign in and sign up: the 13+ check, the intro and Your name (twin: `SignInView`,
  `AgeView`, `IntroView`, `NameView`)
- **AS3** 👀 The permission steps and the push prompt (twin: `ScreenTimeView`, and the prompt iOS
  asks as Home shows)
- **AS4** 👀 Home, the tap's "hold your phone to the block" screen, Join with the consent preview,
  and Waiting (twin: `HomeView` and its tap, `JoinView`, `WaitingView`)
- **AS5** 👀 Focus, Emergency Unlock's hold, and the block screen (twin: `FocusView`, BaliShield)
- **AS6** 👀 Unlocked, Protection off and Session over (twin: `UnlockedView`, `ProtectionOffView`,
  `SessionOverView`)
- **AS7** 👀 History, Me, Delete account, the list-changed screen and the policy links (twin:
  `HistoryView`, `MeView`, `DeletingView`, `ListChangedView`, `PolicyLinks`)
- **AS8** 👀 The live lesson on screen, L8's, M8's and M8b's twins (twin: `AnswerCardView`,
  `SlideView`)

## Phase 11, Android: on Play (TestFlight's and the App Store's twin)

- **AP1** The Play drafts (docs): `docs/PLAY-STORE.md`, the twin of `docs/APP-STORE.md`: the
  listing, Data safety, the content rating, the target audience, the Accessibility declaration and
  its in-app disclosure (if AN1b picks (a); ISSUES #7), how Play's reviewer tries Bali without a
  block, and the testing tracks
- **AP2** 🔧 The Play Console: the account (Open owner items, 2), the app record and Play App
  Signing; and a workflow that uploads to the internal track (twin: `testflight.yml`)
- **AP3** 📱 The device test gate (twin: B5 and B6): a Pixel and a Samsung through the whole loop on
  dev
- **AP4** 🔧 ⚖️ The pilot's track: closed testing (on a personal account, at least 12 testers opted
  in for 14 days in a row before production); the privacy policy names Android's processors,
  Google's push (FCM) and Play, before the first Android build reaches a student
- **AP5** 📱 The exit check: a real class on prod with iPhones and Android phones at once, every
  chip agreeing with the teacher's grid

## Open owner items

1. **The phones:** which Pixel and which Samsung. AN1 needs both, and so do AN7, AN8, AP3 and AP5.
2. **The Play account:** an organization (not under the 12-tester rule; it needs a D-U-N-S number)
   or personal (a closed test of at least 12 testers, opted in 14 days in a row, before production
   access).
3. **Timing:** in the Vanderbilt pilot, or after it. Until the owner says, Android has no Go-live
   row and nothing here is on the pilot's critical path.
4. **After AN1:** which lock, (a) or (b) (AN1b).

## How to update this file

PLAN.md's own rules ("How to update this file"), for Android's steps:

- A step done: its line becomes one line (id, title, ✅, PR, DECISIONS date), its full line moved
  word for word to `docs/PLAN-ARCHIVE.md`, under an "Android" section the first move makes. Before
  building a step, search the archive for its id.
- Re-date the status line with the newest change and what's next; the line it replaces goes word for
  word to the same archive section.
- An Android PR updates this file, and Android's lines in PLAN.md: its Now line at least when the PR
  changes source, since CLAUDE.md's working rule asks every source change for `docs/PLAN.md`; its
  phase rows and its owner-items line when they change. Until AN2 teaches the plan check, an
  `android/` change isn't held to either, so hold to both by hand.
- A real decision goes at the top of `docs/DECISIONS.md`; a changed design, into ARCHITECTURE's
  "Android app structure".
- Past 6,000 words: finished detail moves word for word to the archive, the why to DECISIONS.
