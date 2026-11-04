# Bali for Android — phases and open steps

Android's phases (8–11) and open steps, kept beside `docs/PLAN.md` and under its rules (the owner,
2026-11-02; `docs/DECISIONS.md`, 2026-11-02). PLAN.md stays the file every session reads first: it
carries Android's phase rows, one line in Now and a pointer here, and a session whose task is
Android's reads this file too (CLAUDE.md, Read first). The design is ARCHITECTURE's "Android app
structure", decided at AN1b (2026-11-04).

- **The current state only.** A finished step is one line (its id, its title, ✅, its PR, its
  DECISIONS date); its full notes move word for word to `docs/PLAN-ARCHIVE.md`, and the why goes in
  `docs/DECISIONS.md`.
- **Everything but the steps is shared.** ARCHITECTURE.md, DECISIONS.md, PLAN-ARCHIVE.md,
  ISSUES.md, CLAUDE.md and `contracts/` serve iOS and the server too, and win where this file
  disagrees.
- **Under 6,000 words,** held by the plan check (`plan-words.sh`), as it holds PLAN.md under 8,000.

_Last updated: 2026-11-04 (Central) — AN5c, the sync engine's read loop (#NNN; `docs/DECISIONS.md`,
2026-11-04): BaliOutbox's `SyncEngine` in Kotlin, its reads, with their tests: a check-in every 30 s
while the screen is on, the truth read as it comes on and one check-in as it goes off, rule 3's check
before each; each read applied only as the reconcile says; the unlock guard on every read and answer,
a failed read of it shown after the step it guards; a 401's refresh, once per rejection, shared by
both loops; a refused change shown; protection off reported again; and `me`, its failure and its
reads. Bali's own screen going behind sends a held unlock at once. Before it, AN5b, the drain. Next:
AN5d, the wait for the Start; Android 17's SDK platform for the owner to OK before the first step
with today's AndroidX, and OkHttp 5.5 with it (Open owner items, 6); AN1's part 2 once the owner has
the phones. Not on the pilot's critical path._

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
`android.yml` green (the build, Android 10's API check, Android Lint and the JVM tests), its twin's
tests ported and passing, and `/santa-loop`. **A screen step's** adds Compose UI tests that drive
each state its boards draw, and screenshots from the emulator at the default and the largest font
scale, beside its boards (👀). **A phone test** (📱) opens every part with its starting state (CLAUDE.md, the
owner's standing orders): the phone and its Android version, the class, focused or unlocked, the
screen, Airplane mode, the sticker.

## Phase 8, Android: the lock (iOS's Phase 0)

Android has no Screen Time for an ordinary app, so the lock is Bali's own: **(a)**, an
Accessibility service that sees which app comes to the front and covers it with Bali's block screen
(the owner's pick, AN1b; ARCHITECTURE, "Android app structure", decision 2; ISSUES #6). The spike
measured it on the emulators beside (b), usage access polled with an overlay, now dropped, and (c),
a VPN, left out; on real phones it confirms (a) before launch, as Phase 0 proved the shields first.

- **AN0** The plan (docs): this file, ARCHITECTURE's "Android app structure" (proposed), PLAN.md's
  rows, the decision, ISSUES #6 and #7, and CLAUDE.md's pointer — ✅ (#480; DECISIONS 2026-11-02)
- **AN1** 📱 The lock spike: (a), (b) and (c) on the emulators, then (a), the owner's pick (AN1b),
  on a Pixel and a Samsung (Open owner items, 1), still before launch, to confirm that it holds.
  Throwaway code on a branch of its own, never merged; the step writes a checklist for the owner:
  - every app covered, and how fast: how long a blocked app shows before the cover lands;
  - Bali swiped away from recents, force-stopped, and the phone rebooted mid-session, into Safe
    Mode too;
  - the Samsung's battery saver, and Doze over a 50-minute class;
  - split screen, picture-in-picture, and an app opened from a notification;
  - apps in a work profile or Private Space, and a guest user;
  - Advanced Protection: Android 16's, and Android 17's, which limits Accessibility to verified
    accessibility tools (ISSUES #6);
  - Emergency Unlock: the lock off at once, and the phone, messages and emergency calls never
    covered;
  - a real block's Text and URI records read (`BlockTag`), with Bali open and closed;
  - the battery a lesson costs: part 2's battery test, below.

  A build that doesn't come from Play may meet Android's "restricted settings" (13 and later)
  before its Accessibility service can be turned on: the checklist says how each build was
  installed — validation: every line answered on both phones

  **Part 1, on the emulators** ✅ (Android 15, 16 and 17; the code on `spike/android-lock`, never
  merged; DECISIONS 2026-11-03): neither lock holds up alone. (a) covers split screen window by
  window, picture-in-picture, the work profile and Private Space, but a force-stop or Safe Mode
  switches it off until the student switches it on again; (b) comes back by itself after both, but
  misses picture-in-picture and every profile, covers the allowed half of a split screen, and gets
  a Stop button in quick settings. **Part 2, on the phones, waits for them** (Open owner items, 1):
  a real block over NFC with Bali open and closed, the Samsung's battery saver and its in-call
  screen (`com.samsung.android.incallui`), the battery a lesson costs, and every other line again,
  Doze above all (an emulator's CPU never sleeps), for (a) alone.

  **Part 1c, lock (c), a VPN on the phone alone** ✅ (the owner, 2026-11-03: "Yes, test it";
  Android 15, 16 and 17; the code on `spike/android-lock`, never merged; DECISIONS 2026-11-03): no
  server, only the blocked apps routed in, their packets dropped unread. It takes a blocked app's
  internet within 1.6 s of the session's start (0.2 s on 17) and gives it back within 0.6 s of
  Emergency Unlock, but covers nothing: a blocked app opens and shows what it holds offline. Added
  to (a), it leaves what (a) misses unable to load anything new, and it comes back by itself after
  a force-stop or Safe Mode, where (a) doesn't. Against it: Android's VPN dialog; one VPN at a time,
  another app's taking over at once and an always-on one keeping Bali's from starting; the profiles
  and the guest user out of reach; and a second Play declaration (ISSUES #7). Left out at AN1b, so
  part 2 doesn't measure it.

  **Part 2's battery test** (the battery research; DECISIONS 2026-11-04; in full in
  `docs/ANDROID-PHONE-TESTS.md`): the battery plan built into the spike first (check-ins by the
  screen, the service narrowed outside a lesson, the covered app sent to the background), each with
  a switch. Then three runs on each phone, each against a run with no session: a desk lesson (50
  minutes, the screen off), a busy one (the screen on for 35 of 50) and a school day (four lessons),
  read from batterystats and the charge counter. Their pass marks: no wake lock, alarm or foreground
  service, and nothing sent while the screen is off but its one check-in. The makers' checks, each
  mid-session with Bali closed: the Samsung's Optimize now, Clean now, Power saving, Sleeping, Deep
  sleeping and Restricted; the Pixel's Battery Saver, Restricted and hibernation. And the questions
  only phones answer, the two conflicts first: deep Doze's timing, and whether the service keeps its
  network in Doze.
- **AN1b** The lock decided (docs): (a), the Accessibility service; no VPN for now; the battery
  plan's two calls; Android's gaps logged for launch — ✅ (#487; DECISIONS 2026-11-04)

## Phase 9, Android: the engine (BaliCore's and BaliOutbox's twin, no screens)

After AN1b, at the owner's go. Every rule in plain Kotlin where the JVM tests reach it, never in a
screen, as BaliOutbox's rules run on Linux; `contracts/` holds both apps to the same server.

- **AN2** The project and CI — ✅ (#488; DECISIONS 2026-11-04)
- **AN3a** The core's vocabulary and JSON coding, and Android 10's API check — ✅ (#489; DECISIONS
  2026-11-04)
- **AN3b** The core's wire types — ✅ (#490; DECISIONS 2026-11-04)
- **AN3c** The core's event ids, NFC tag reading and app config — ✅ (#491; DECISIONS 2026-11-04)
- **AN3d** The core's client — ✅ (#492; DECISIONS 2026-11-04)
- **AN4a** The unlock contract — ✅ (#493; DECISIONS 2026-11-04)
- **AN4b** The records — ✅ (#494; DECISIONS 2026-11-04)
- **AN4c** The outbox store — ✅ (#495; DECISIONS 2026-11-04)
- **AN4d** The outbox's recording — ✅ (#496; DECISIONS 2026-11-04)
- **AN4e** The outbox's sending — ✅ (#497; DECISIONS 2026-11-04)
- **AN5a** The sync engine's frame — ✅ (#499; DECISIONS 2026-11-04)
- **AN5b** The engine's drain — ✅ (#501; DECISIONS 2026-11-04)
- **AN5c** The engine's read loop — ✅ (#NNN; DECISIONS 2026-11-04)
- **AN5d** The engine's wait for the Start (#166; twin: `SyncEngine`'s `armed` and
  `SyncState.waitEnds`): an arming's wait, kept for a relaunch, and its end at the end of the day by
  the phone's clock, a `ZoneId`'s; and the reads while waiting. Tests: AnswerTests' `armed`;
  ReadTests' `waitingStays`; ClassesTests' `waitingReads`, `armedPastTheBell` and `overIsNoStart`;
  StandingKeptTests' `kept`, `unreadArmed`, `unreadArmedOut` and `unreadArmedFileBack`; and the
  engine's half of DroppedWaitTests' seven and WaitingHomeTests' `startFromHome` (their screens'
  checks are AN10's)
- **AN5e** Emergency Unlock in the engine (twin: `SyncEngine`'s `emergencyUnlock`, `pressUnlock`,
  `explain` and `backToFocus`): where it is filed (under a tap not answered, in its session, or not
  yet: B6b), its reason, held 15 s for it (`reasonHold`), and the late unlock (`Superseded`,
  `RecordedUnlock`); `record`'s lock back on and what each change clears; from `Enforcement`, the
  tap's cap and `shieldedUntil`, from `Unlocked`, `unlock(in:)`, and from `Join`, the renewal on a
  401, the engine's own until AN9; outcomes as types, the words AN10's; and `unanswered`. Tests:
  ShieldedUntilTests' three; UnderTapEngineTests' seven; RefiledTests' `refiled`, `joined`, `guards`
  and `afterThePress`; StaleReadTests' `lateUnlockLands`, `lateAnswerWithNoReturn`,
  `lateUnlockOverStuckUnlock`, `lateUnlockAfterReturn` and `protectionOffOverStuckUnlock`; the
  engine's half of BackOnTests' `once`, `lateUnlocked`, `unlockedSince` and `notKnown`;
  `keptWithItsStanding`'s lock check, which AN5a left; and the tests that reach the outbox's
  recording through the engine: UnreadUnlockTests' but `filing`, ReasonTests' but `refiledReason`,
  and UnlockRouteTests' `route` and `endsTheTapsShield`
- **AN6** Sign-in (twin: `SignIn`, `TokenStore`): Cognito's hosted UI in a Custom Tab, the code
  grant with PKCE; tokens sealed by a Keystore key; the refresh, Sign out, `Tokens.checked` (no
  token to Bali's API before the 13+ check, but the check's own read and a deletion's) and the
  deletion token; only a real `401` signs anyone out; the engine's `make` over the sign-in, its tokens
  and refresh, a token that arrives sending everything again, with SignInEngineTests'
  `signInSendsAtOnce`, `reauthRenews`, `refusedWaitsForSignIn` and `ownRenewalSendsAtOnce` (AN5's
  split); and `AppConfig`'s app side, which AN3c left
  here: Android's build setting its values, with a test pinning its keys to both sides, as iOS's
  pins Info.plist to `project.yml`. 🔧 The owner makes Android's Cognito app clients on dev and
  prod (no secret; the scopes iOS's client has, `aws.cognito.signin.user.admin` among them for
  Delete account) and adds their ids to `AUTH_AUDIENCE` on dev's and prod's API, or the API
  refuses Android's tokens with a `401`, which signs the student out
- **AN7** 📱 The lock (twin: BaliOutbox's `Enforcement`, `Bell` and `PhoneBell`): the
  Accessibility service, (a), as ARCHITECTURE's battery plan has it (listening only in a lesson,
  and then to window events, the covered app sent to the background); the system allow-list
  (decision 2); rule 3 at every check-in; protection off and on, with iOS's events; the bell, from
  the session's window; and a Debug readout like iOS's for the phone checks. From SyncEngine.swift,
  `setTapCap`, and the enforcer's suites: EnforcerTests, RevokedWhileRunningTests, LaunchGraceTests,
  the rest of ProtectionOffTests and BackOnTests, and StandingKeptTests' `unreadCapped` and
  `unreadCappedOverHeld` (AN5's split). Its first question is
  answered (the owner, 2026-11-04): the service checks in every 30 s while the screen is on, once
  as it goes off and once as it comes on, so an awake phone gone quiet means Bali stopped or lost
  its network. Still for the owner: whether Bali, opened again, reports how long it was stopped;
  that is new information about a student, so it needs a board and the owner's approval first
  (ARCHITECTURE, "Android app structure", the rules) — validation: the rules' JVM tests, then the
  device check on both phones
- **AN8** 📱 The tap over NFC (twin: `BlockReader`, B6): reader mode, started from the Debug readout
  until AS4 builds Bali's "hold your phone to the block" screen; the offline tap in under a second;
  the tap's dispositions (`tapDisposition`); and, if AN1 found it works, the block's link opening
  Bali when it's closed — validation: the JVM tests, then a real block on both phones, offline
- **AN9** The account's flows (twin: `Join`, `Me`, `History`, `Age`, `Deletion`): Join with the
  consent list, Me, History, the 13+ check (C7, C7-server), Your name, and Delete account (what the
  phone queued first, every Emergency Unlock first, then `DELETE /v1/me`, then Cognito's DeleteUser);
  with SyncEngine.swift's calls for them (`lookUp`, `history`, `ageCheck`, `join`, `rename`, `leave`,
  `unlockUnsent`, `forgetMe`, `deleteAccount`, the 13+ yes at each wake) and their suites:
  JoinEngineTests, LeaveEngineTests, MeEngineTests, HistoryEngineTests, AgeFallbackTests,
  DeleteAccountTests and DeletionOrderTests (AN5's split)
- **AN10** The router and the screens' rules (twin: `Screen.swift`, `FocusWords`, `UnlockedWords`,
  `ProtectionOffWords` and `ShieldWords`): which screen shows when, and what Focus, Unlocked,
  Protection off and the block screen say (rule 3: no countdown over nothing locked), their rules
  and tests ported; from SyncEngine.swift, Home's Tap in (`tapIn`) and every word the engine says,
  with TapInTests, BellRedrawTests and UnlockedTests (AN5's split); the words from AS0's approved
  boards, so AN10 follows AS0
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
  random wait of up to 10 s before the first read after a fresh alert; from SyncEngine.swift,
  `PushWait`, `holdRead`, `endWait` and the token's register and remove (an FCM token sent as it
  comes, never as hex), with PushTests but its words (AN5's split) — validation: the JVM tests,
  then an end-to-end check like N6's on an Android phone (📱)
- **AN13** The live lesson's engine (twin: `LiveLesson`, L5, and M7's deck download and cache): the
  poll and the answer, the deck downloaded, checked against its `sha256` and cached, and a page
  drawn with `PdfRenderer`; answers never enter the outbox

## Phase 10, Android: the screens (from the approved boards)

After AS0. Every screen built from boards the owner approved, every state drawn (CLAUDE.md, Working
rules); `docs/DESIGN.md` read first, its Android section from AS0; every user-facing string through
`no-ai-slop`; font scale and TalkBack in every step.

- **AS0** 👀 The Android canvas,
  [Bali Android app screens](https://claude.ai/artifact/SZPLe9WcymZJ1Bvrgj5KoE) — ✅ approved as it
  stands (#484, #486; DECISIONS 2026-11-03, 2026-11-04)
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
  its in-app disclosure (lock (a), AN1b; ISSUES #7), how Play's reviewer tries Bali without a
  block, and the testing tracks
- **AP2** 🔧 The Play Console: the account (Open owner items, 2), the app record and Play App
  Signing; and a workflow that uploads to the internal track (twin: `testflight.yml`)
- **AP3** 📱 The device test gate (twin: B5 and B6): a Pixel and a Samsung through the whole loop on
  dev, and every gap in ISSUES #6 checked again on both, as its line says, before launch (the owner,
  2026-11-04; `docs/ANDROID-PHONE-TESTS.md`)
- **AP4** 🔧 ⚖️ The pilot's track: closed testing (on a personal account, at least 12 testers opted
  in for 14 days in a row before production); the privacy policy names Android's processors,
  Google's push (FCM) and Play, before the first Android build reaches a student
- **AP5** 📱 The exit check: a real class on prod with iPhones and Android phones at once, every
  chip agreeing with the teacher's grid

## Open owner items

1. **The phones:** which Pixel and which Samsung. AN1 needs both, one of them on Android 17 for
   Advanced Protection's check (ISSUES #6), and so do AN7, AN8, AP3 and AP5.
2. **The Play account:** an organization (not under the 12-tester rule; it needs a D-U-N-S number)
   or personal (a closed test of at least 12 testers, opted in 14 days in a row, before production
   access).
3. **Timing:** in the Vanderbilt pilot, or after it. Until the owner says, Android has no Go-live
   row and nothing here is on the pilot's critical path.
4. ✅ **After AN1:** which lock: (a), the Accessibility service (the owner, 2026-11-04; AN1b).
5. ✅ **AS0's canvas:** approved as it stands, its Words board's calls as drawn, and the approved
   iPhone boards stand for the rest of Android's screens (the owner, 2026-11-04; DECISIONS
   2026-11-04).
6. **The SDK, for what comes next:** Android 17's platform (`platforms;android-37.0`, 64 MB, from
   Google's SDK repository) on the PC before the first step with today's AndroidX, which needs
   compileSdk 37 (androidx.core 1.19, Compose 1.12; DECISIONS 2026-11-04), as OkHttp 5.5 does, so
   `core` stays on 5.4.0 until then (AN3d); and Android 10 and 12 or 13 to test on, as emulator
   images (each a download) or phones, for ISSUES #6's gap 10.
7. ✅ **CodeQL and Android's Kotlin:** scanned, through CodeQL's advanced setup
   (`.github/workflows/codeql.yml`), beside GitHub Actions and JavaScript/TypeScript; default setup
   switched off by the owner (the owner, 2026-11-04: "Yes, prep it"; DECISIONS 2026-11-04).

## How to update this file

PLAN.md's own rules ("How to update this file"), for Android's steps:

- A step done: its line becomes one line (id, title, ✅, PR, DECISIONS date), its full line moved
  word for word to `docs/PLAN-ARCHIVE.md`, under an "Android" section the first move makes. Before
  building a step, search the archive for its id.
- Re-date the status line with the newest change and what's next; the line it replaces goes word for
  word to the same archive section.
- An Android PR updates this file, and Android's lines in PLAN.md: its Now line at least when the PR
  changes source, since CLAUDE.md's working rule asks every source change for `docs/PLAN.md`; its
  phase rows and its owner-items line when they change. The plan check holds an `android/` change
  to PLAN.md (AN2); this file it holds to its cap alone, so keep its lines by hand.
- A real decision goes at the top of `docs/DECISIONS.md`; a changed design, into ARCHITECTURE's
  "Android app structure".
- Past 6,000 words: finished detail moves word for word to the archive, the why to DECISIONS.
