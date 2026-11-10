# Bali v3 — Known issues and how we plan to handle them

A running list of the problems that could genuinely hurt Bali, and the plan for each.
New issues get added as we find them. Plain language on purpose.

---

## 1. The whole school shares one internet address

**The problem.** On school Wi-Fi, all ~600 phones reach the internet through **one shared
address** — like an apartment building where every letter shows the same street address.
Servers normally protect themselves with a rule like "too many requests from one address =
block it, it's probably an attack." At the bell, 600 honest taps arrive from one address in
one minute. A naive rule blocks the entire school at the exact moment everyone needs us.

**The plan.**
- Count request budgets **per signed-in student account**, not per address. 600 students
  tapping once each = everyone comfortably within their own budget. One bad actor flooding
  us hits *their* limit and gets stopped without anyone else noticing.
- Only trust the account after the sign-in is **verified**. (v2 counted requests by a label
  the phone wrote on itself, without checking it — an attacker could change the label every
  request and get a fresh budget each time, making the limit useless.)
- Requests where nobody is signed in yet (signing in): budget by address, but sized
  generously for "a whole school at once," and slow requests down before ever blocking
  them.
- Phones retry with a small random delay, so even a server hiccup doesn't cause everyone
  to retry in lockstep and pile the crowd back up.

**Done when:** a simulated school — hundreds of accounts behind one address — can all tap
in the same minute with zero blocks, while a single flooding account still gets stopped.

**Status: done (Phase 4, L1 and L2b — 2026-10-04): the limits are built, and the simulated school
proved them.**
- Every signed-in request spends its own account's budget, counted only once the sign-in is
  verified (Cognito's `sub`), never its address's: 120 at once, then 120 a minute — 2.4 times
  the busiest honest client, a teacher with five portal tabs open.
- A request with no sign-in, or one Cognito refused, spends its address's budget: 1,200 at
  once, then 600 a minute — a whole school's phones, twice over.
- Guessing a class code: each account gets 20 tries, then 2 a minute; each address gets 100
  wrong codes, then 6 a minute, whichever accounts guess — so free accounts don't add guesses.
- Over a budget, the answer is "too many requests" (`429`) with how many seconds to wait. Phones
  retry on their own; nothing waiting on a phone, an Emergency Unlock included, is ever dropped.
- The address is the one Railway's edge reports (`X-Real-IP`), which a phone can't fake: on dev,
  the edge replaced every one a client sent (checked 2026-10-04).
- **Proven (L2b):** 600 accounts behind one address tapped in within the same minute, their
  teachers' Starts joined them, and each phone then checked in every 30 s, as phones do: 3,366
  requests in three minutes, not one refused, 95% of them answered within 8.5 ms (the gate
  allows 500 ms). At the same address and time, one account asking 50 times a second was
  stopped 2,762 times, each refusal saying when to come back. CI's load gate runs it again on
  every change to the API.
- Numbers and why: `docs/DECISIONS.md`, 2026-10-04 (L1, L2b).

## 2. An emergency unlock record must never be lost

**The problem.** Emergency Unlock means shields drop immediately, no permission needed.
The deal that makes that freedom okay: it's always allowed, but it's **always recorded**.
If a record can silently vanish, the button becomes a secret off-switch and every report
we show a teacher is untrustworthy. v2 really did this: a student removed from class
mid-session hit Emergency Unlock; the server answered "you're not in this class," and the
app threw the record away. Unshielded phone, zero trace, nobody ever knew.

**The plan.**
- The phone **saves the record to its own storage first**, before telling anyone — like
  writing it in a notebook before mailing the letter.
- The phone retries sending — minutes, hours, days if needed — until the server confirms
  "saved for real." Only then does it cross the record out of its notebook.
- The server **never throws an unlock record away**, even in weird situations. Removed
  from the class? Session already over? It gets recorded with a note attached. No server
  reply may ever mean "delete this."
- Every record carries a unique ID, so retries and double-sends count once, never twice.

**Done when:** killing the Wi-Fi mid-unlock, force-quitting the app, and the
"removed from class" case all still end with the record visible to the teacher.

**Status: done on hardware (2026-10-01).** On the owner's iPhone against dev (Phase 3's
E1), all three cases ended with the record visible to the teacher:
- **Wi-Fi off mid-unlock** (Airplane Mode): the unlock made at 3:40:07 PM was delivered at
  3:41:41 PM, once the phone was back online.
- **The app force-quit right after an unlock:** made offline at 3:56:43 PM; the relaunched
  app delivered it at 3:57:05 PM.
- **Removed from class mid-session:** an unlock made offline at 4:12:54 PM reached the
  server after the removal (4:13:09 PM) and was recorded with the note
  `no_live_participation`; the teacher saw the student as "left · unlocked".

The phone half — save first, retry until the server confirms — is the iOS app's outbox
(Phase 3).

**Status (Phase 2 — server half done):** the transition engine's `unlock` now
always commits the event. A live participation flips to `unlocked` as before —
unless its protection is off, which an unlock never softens: the unlock is then
recorded with the note `protection_off` and the state left alone (Phase 3, A2) — or
unless the student's own refocus or tap there came after it: a late unlock, stuck on the
phone while that return went ahead of it, is recorded with the note `superseded` and
the state left alone too (Phase 3, A10), whether or not the student is still in the
session. An unlock made while the phone's own tap was unanswered is sent under that tap
and filed in whatever session it landed in — or kept with no session, noted `tap_armed`
or `unknown_tap`, and filed by the tap if the tap arrives after it (Phase 3, A11).
With no live participation to flip, the event is still written with a
`payload.recorded_as` note —
`no_live_participation` (removed from the class mid-session), `after_session_end`
(the session is already over), `unknown_session` (an unrecognized session id,
recorded as an orphan event), or `not_enrolled` (a caller with no participation
row here and no active enrollment in the class — recorded as an orphan too, so a
stranger who merely knows a session id cannot write into someone else's history
or live grid) — and the call returns `recorded`, never a refusal that could let
the phone discard the record. The retry side of the contract —
which responses let the phone delete the record versus keep retrying — is the
typed table in `@bali/shared` (`unlockDisposition`), so the Phase 3 iOS outbox
implements against an explicit rule. The phone-side "save first, retry until
confirmed" half lands with iOS (Phase 3). One residual: an `unknown_session`
unlock is durable but, lacking a session/class, shows only in the student's own
history rather than a teacher report — an ops surface for these orphan records is
an API-layer follow-up, bounded meanwhile by the per-account rate limits of #1.

## 3. Apple's terms for Screen Time apps may not fit a classroom

**The problem.** Since 2026-03-30, Apple's developer agreement limits apps that use the
Family Controls framework, the one Bali's shields run on (§3.3.3(P); the text of
2026-08-18). The app's primary purpose must be parental controls through Family Sharing,
or "offering individuals the ability to manage their devices to enable focus and
productivity". The framework "may not be used for other purposes, such as ad blocking, in
organizational settings, or for managing the device of another adult individual", and
device or usage data "received through the Family Controls Framework or otherwise" may not
be shared "beyond … the individual and their device". Bali's sessions are started by a
teacher at school, and the teacher's grid shows each student's state, "Screen Time off"
included. A reviewer could read that as both. Apple granted the distribution entitlement on
2026-09-24, after the clause existed: a good sign, not a ruling. External TestFlight builds
are reviewed too, so this can stop the pilot, not only the App Store. And that "or
otherwise" may reach what Bali records itself, not only what the framework hands it.

**What others do (researched 2026-10-04).** Doorman (doorman.school), the closest
competitor, mostly avoids the framework. Its Focus Mode "installs a secure and private VPN
profile, specific to your school" and blocks traffic at the network level: App Review
guideline 5.4's rules, not §3.3.3(P)'s, but a weaker lock (SMS gets through; a student can
switch the VPN off, which its dashboard shows as "Disconnected"). Its 2026 Lockdown Mode
"uses Apple's built-in on-device frameworks", unnamed. Its teachers still see live
per-student status and every bypass. Screen Time apps with per-student school dashboards
are live after the clause (Opal for Schools, Lockup, LockedIn, Yondr's tap-to-lock app), and
none has been reported removed or rejected under it; but Apple has pulled a category
before (parental-control apps, 2018–19), and it answers such questions only in App Review
consultations.

**The plan.**
- The owner asks App Review before the first external build (an App Review consultation),
  describing Bali as it is: the student installs it, grants Screen Time access to
  themselves, taps in, and holds the exit; the teacher sees what the app records.
- Fallback designs, settled with the owner before the answer comes, best fit first:
  school-owned devices under MDM (sanctioned, but never a student's own phone); a network
  filter like Doorman's, which is the local VPN filter ARCHITECTURE already parks as a second
  enforcement layer (iOS app structure, "Decided later, on purpose"), here made the only one:
  outside the framework, weaker, and an ARCHITECTURE change; Family Controls as a purely
  personal tool, no lock state leaving the phone. A grid showing only what Bali itself
  records may not be enough alone, because of "or otherwise".
- Phase 6 gates on it.

**Asked 2026-10-13** by the owner, App Store Connect → Contact Us, **case 102994872143**: the
question as sent is in `docs/APP-STORE.md`, section 5.6.

**Answered** (the owner, 2026-11-03): Apple said to submit the app for review; App Review can't say
before it sees the build. So App Review of the first App Store submission is the answer, with no
external beta for now (the owner, 2026-11-04), and the fallbacks above stay ready if it refuses.

**Submitted** 2026-11-09 (the owner): Bali 1.0, build 13, "Waiting for Review" (`docs/APP-STORE.md`).

**Refused by an automated scan** 2026-11-10 (guideline 2.5.1), before any reviewer read it: "the app
uses one or more Screen Time APIs but the app has not been submitted with the Family Controls
entitlement". Not a §3.3.3(P) verdict. Each App ID (`com.bali.Bali`, `.BaliMonitor`, `.BaliShield`)
had held Family Controls (Distribution), "Assigned" and enabled, since 2026-09-20. The owner then
filed the account-level form (developer.apple.com/contact/request/family-controls-distribution,
request YUN9YN3547), and Apple's email the same minute said the entitlement "has been assigned to
your account": most likely the piece the scan reads. TestFlight run 42904088436 (build 15) read the
App-Store-signed copy, and all three bundles carry `com.apple.developer.family-controls = true`;
`testflight.yml` now checks that on every build.

**Resubmitted** 2026-11-10 (the owner): build 14, signed after the account-level grant, the same app
as 13, with a reply to App Review naming the entitlement on all three bundle IDs. "Waiting for
Review". Record App Review's verdict here, with its date, when it comes.

**Done when:** Apple's answer is on record, and the design matches it.

## 4. Phone bans at school

**The problem.** By March 2026, 33 states restricted students' phones at school. Texas
(HB 1481) has districts forbid personal devices for the whole school day; Oklahoma and
Arkansas ban them bell to bell; Kansas requires them stored away; Illinois starts in
2027–28. Tapping in is using the phone.

**Where the pilots are (owner, 2026-10-04).** The first pilot is preliminary and
unofficial: one professor's class at Vanderbilt University in Nashville (US Central, so
the deploy's `TZ` stays America/Chicago), with adult students on their own phones. There
is no school or district phone policy and no data agreement yet, and the states' K-12
phone laws don't apply to a university class of adults. The likely later K-12 pilot is in
Los Angeles or New Jersey; phones are still assumed to be the students' own.

**The plan.** Before the K-12 pilot, the owner confirms its state and the school's phone
policy, and the school's lawyer clears Bali against that state's law. For the lawyer then:
- **California:** SOPIPA (student online privacy), AB 1584's terms for a district's
  contract with a vendor holding pupil records, and the Phone-Free Schools Act (each
  district limits phones on campus by July 2026).
- **New Jersey:** its student-privacy rules (the state's student records regulations and
  any data agreement the district requires), and its 2025 law requiring districts to
  adopt a policy restricting phones during the school day.

**Done when:** the K-12 school confirms in writing that its policy allows Bali.

## 5. Deleting data, and "an unlock record is never lost"

**The problem.** The App Store requires that an account made in the app can be deleted in
the app (guideline 5.1.1(v)); a school's data agreement requires its data disposed of on
request; FERPA lets parents inspect a student's record; COPPA, once under-13 comes,
requires a written retention policy. Bali's architecture says nothing is ever truly
deleted (data-model decision 3), and ISSUES #2 says an unlock record is never lost.

**The plan.**
- "Never lost" keeps its meaning on the way from the phone to the server, which is what
  the unlock contract promises: no response ever means "discard".
- Records leave only through three doors: the student deleting their account, the
  school's written request, and a published retention schedule. Each deletion is logged
  without personal data, and none happens while a parent's inspection request is open.
- The owner ruled (2026-10-04, `docs/DECISIONS.md`): named records are kept through the
  school year, then de-identified, and aggregates stay (C6b); a student's in-app account
  deletion de-identifies their events and deletes the account, name and sign-in (C3).
  ARCHITECTURE's data-model decision 3 is amended (C3 landed 2026-10-04: the deletion
  is recorded as an `account_deleted` event naming no one); Phase 6 C4–C6 build the rest.

- A parent's inspection request (FERPA) is answered with the student's whole record by the
  owner's `npm run school -- export-student` (C5, landed 2026-10-04); while one is open the
  owner holds every disposal of that student's data (`docs/RUNBOOKS.md`, runbook 1, step 10).

- A school's written request is answered by the owner's `npm run school -- dispose` (C6a,
  landed 2026-10-05): its people de-identified as C3 leaves an account, its classes, blocks,
  open invites and pre-bell taps removed, logged as a `school_disposed` event of counts
  (`docs/RUNBOOKS.md`, runbook 1, step 11).

- The retention schedule (C6b, landed 2026-10-05): the owner records each school's year
  end (`npm run school -- year-end`); after it, `npm run school -- retention` de-identifies
  everyone whose records all lie in that year, kept counts and all, logged as a
  `retention_applied` event of counts naming no one (`docs/RUNBOOKS.md`, runbook 1, step 12).

**Done when:** the owner's policy is written, and C3–C6 have landed (C3, C5 and C6 have;
C4a, the phone's Delete account engine, has too; its Me screen button, C4b, is next).

## 6. Android's lock is Bali's own, so it is softer than iOS's

**The problem.** On an iPhone the shields are the system's: Screen Time keeps them on with Bali
force-quit and takes them off at the bell from its own monitor. Android gives an ordinary app
nothing like it, so Bali's lock is its own: an Accessibility service that sees which app comes to
the front, covers it with Bali's block screen and sends it to the background (the owner's pick,
2026-11-04: "we will use a)"; ARCHITECTURE, "Android app structure", decision 2). It runs in Bali's
own process, so whatever stops Bali stops the lock. Android's full lock, device-owner mode, needs a
factory-reset phone the school manages: never a student's own.

**What others do (researched 2026-11-02).** Android's app blockers live with the same limits.
AppBlock, a common one, asks for usage access to see which app is in use, Display over other apps
to show its block screen, and Accessibility for its website blocking and some of its app blocking,
and asks to be left out of battery optimization and, on some phones, to start itself after a
reboot. Its help pages warn that some makers' phones (Xiaomi, Huawei, Oppo) turn Accessibility
services off to save battery, that Samsung's power monitor can interfere, that Safe Mode turns it
off, and that Android 17's Advanced Protection may restrict it
([AppBlock's permissions help](https://appblock.app/help/android/troubleshooting-and-permissions/)).
Google's own Family Link can block a supervised child's apps at the system's level, but it is
Google's own, not something another app can use.

**The gaps, each checked before Android launches** (the owner, 2026-11-04: "log the gaps with
android for something we will check before launch"). AN1's part 1 found most of them on the
emulators (`docs/DECISIONS.md`, 2026-11-03) and the battery research the rest (2026-11-04). AN1's
part 2 measures them on a Pixel and a Samsung, and the device gate (AP3) checks every one again on
both phones, on the build students will install, before Android launches
(`docs/ANDROID-PHONE-TESTS.md`).

1. **A force-stop or Safe Mode switches the lock off** until the student switches it on again;
   Bali can say so, not undo it. The grid shows it, the phone gone quiet and then protection off
   once Bali is opened, but the phone is free meanwhile. Opened only after the bell, Bali reports
   nothing, where an iPhone reports it late from its monitor's note: the grid's quiet tile is all
   the class keeps of it (`docs/DECISIONS.md`, 2026-11-05, Q7). Switched on again before Bali is
   opened, it reports nothing either: switching it on starts Bali, whose first check finds it on, and
   Bali keeps no note of the stop, where an iPhone's marker stays gone until Bali writes it again
   (santa's review of AN7b, for the owner). Whether Bali, opened again, says how long it was stopped
   is the owner's open question, a board first. What the emulators showed with Bali's own service
   (Android 15, 16 and 17; `docs/DECISIONS.md`, 2026-11-05, AN7c): a force-stop takes it off Android's
   list of switched-on services at once, unbound, Bali's process gone; a reboot leaves it on the list,
   and Android starts Bali and binds it again by itself, but only once the phone is unlocked (11 to 32
   s after the screen came on there), so on a phone with a screen lock nothing of Bali's runs before
   the student unlocks it; and Bali's process killed, as Android's memory killer kills one, is started
   and bound again by itself within seconds, the switch reading starting meanwhile, inside the grace.
   *Checked:* Bali force-stopped, and the phone booted into Safe Mode and back, each mid-session, the
   switch then turned on before Bali is opened and after: the grid's tile at each step, and the lock
   back only once the student switches it on; and a plain reboot mid-session, unlocked late.
2. **Phone makers' battery savers** (Samsung, Xiaomi, OnePlus, Oppo, Motorola) can switch the lock
   off or freeze it, by users' and developers' reports. Samsung's sleeping-app lists are untested.
   *Checked:* the battery test's makers' checks on the Samsung and the Pixel, each mid-session with
   Bali closed: the blocked app still covered, the switch on and the service bound, and protection
   off reported whenever the lock is off. The other makers' phones aren't among the two, so their
   reports stay reports.
3. **A blocked app shows for a moment before the cover lands:** on the emulators a median of half
   to three quarters of a second from launch, always after the app's first frame, and longer on a
   slow first launch. And one already on screen as a lock comes on, beside Bali in split screen or in
   picture-in-picture, shows until it changes or the student touches it: Bali names a window only from
   that window's own events, never reading its contents (the battery plan; `docs/DECISIONS.md`,
   2026-11-05, AN7e). *Checked:* launch to cover, timed on both phones as part 1 timed it; and a video
   playing in split screen beside Bali, and in picture-in-picture, as a tap locks the phone: how long
   each shows.
4. **A blocked app's sound can play on.** Most apps stop once they are sent to the background;
   music apps, a picture-in-picture window and a split-screen half don't. *Checked:* a video app, a
   music app, a picture-in-picture window and a split-screen half, each playing as a lesson starts:
   which go quiet.
5. **A guest user on the phone is out of reach:** nothing is covered there, though a work profile
   and Private Space are. *Checked:* a guest user switched to mid-session: what it shows, what the
   grid says meanwhile, and how soon the lock is back in the student's own user (30–66 s on the
   emulators).
6. **A permission prompt can show the blocked app behind it,** dimmed and uncovered, until the
   prompt is answered. *Checked:* blocked apps opened for the first time, whose prompts show
   (Contacts' and YouTube's did on the emulators): what shows behind the prompt, and the cover once
   it is answered.
7. **Advanced Protection on Android 17 limits Accessibility to verified accessibility tools,** so
   Bali's lock may not switch on there
   ([Google, 2026-10-01](https://blog.google/security/android-advanced-protection-updates/)). Part 1
   turned it on only by `cmd`, which left (a) alone, and couldn't test Google's own switch.
   *Checked:* Advanced Protection turned on through Settings, on the phone with Android 17 and a
   screen lock, with Bali's service on: whether the service stays on, and whether it can be switched
   on again.
8. **A device or profile owner,** such as a school's, an employer's or a parent's management app,
   can keep Bali's service from being switched on
   ([`setPermittedAccessibilityServices`](https://developer.android.com/reference/android/app/admin/DevicePolicyManager)).
   *Checked:* a test management app, such as Google's Test DPC, keeping Bali off its permitted list:
   what Bali's permission step and the grid show.
9. **Play may not approve the Accessibility use** (#7). The Accessibility step's disclosure lost
   "Bali keeps and sends none of it." in the owner's canvas cuts of 2026-11-04, with the matching
   sentence of the service's description in Settings; if Play's review asks for it, it goes back.
   *Checked:* by Play's review of the build students install (AP4); on both phones, the disclosure
   shown in Bali's normal use, and No thanks leaving the service off.
10. **Android 10 to 14 are untested.** Bali runs on Android 10 and later (minSdk 29, AN2), but the
    PC has only Android 15, 16 and 17 emulators, so nothing older has run it. A Java API an older
    phone lacks would fail only there, since Android Lint doesn't check `core`'s and `outbox`'s
    calls against Android 10 (`docs/DECISIONS.md`, 2026-11-04, AN2). Android 10 also measures no
    insets outside a window, so there the cover's safe area is worked out from the display's own sizes
    (2026-11-05, AN7e). *Checked:* the build students install, through a whole lesson, on Android 10
    and on Android 12 or 13, as emulator images the owner adds (each a download the owner OKs) or as
    phones; on Android 10, a screen with a cutout, upright and turned both ways: a full-screen app sent
    home, a split half covered to its edges.
11. **What the allow-list lets through.** The parts the student chooses are allowed whoever holds
    them, each app whole: the phone and messaging apps chosen, the home screen chosen and every keyboard
    switched on, so an app that is one of these and more besides (a home screen with a feed, a keyboard
    with games) is never covered. Another app's accessibility overlay is never covered, nor the system's
    share sheet, which a blocked app can open over itself and show behind it, dimmed, as a permission
    prompt can (6). A blocked app's floating window, covered, stays where it is until the student closes
    it from its notification or Settings (`docs/DECISIONS.md`, 2026-11-05, AN7e). *Checked:* on both
    phones, the keyboards and home screens they ship with, and a share sheet opened over a blocked app:
    what each lets the student reach under the lock.

**The plan.**
- Honest, not fought (the mirror rule): what the lock can't stop is never shown as focus. The
  service switched off is protection off, with iOS's events; a stopped Bali goes quiet on the grid
  within about a minute. The lock's service checks in every 30 s while the screen is on (the
  battery plan, the owner's call of 2026-11-04), so an awake phone gone quiet means Bali stopped or
  the phone lost its network, while one asleep reads silent after 90 s, as an iPhone does; no
  screen claims a lock the last check didn't verify (rule 3).
- What the school is told about Android's lock, before any Android phone joins a class, is the
  owner's call (`docs/PLAN-ANDROID.md`, Open owner items, 3).
- The full lock later: device-owner mode on school-owned phones, the K-12 path (ARCHITECTURE,
  "Android app structure", Decided later).

**Done when:** AN1's part 2 has confirmed (a) on a Pixel and a Samsung, and the device gate (AP3)
has checked every gap above on both, the grid telling the truth about each.

## 7. Google Play's Accessibility rules may not fit a classroom lock

The twin of #3, Apple's terms, for Android.

**The problem.** Lock (a), the owner's pick (2026-11-04, AN1b), uses an API that Play guards
([Use of the AccessibilityService API](https://support.google.com/googleplay/android-developer/answer/10964491)).
Only an app whose primary purpose is supporting people with disabilities may declare itself an
accessibility tool (`isAccessibilityTool`), which Bali isn't. Every other app needs a prominent
disclosure inside the app, shown in its normal use, never only in a menu, the listing or a privacy
policy, saying what the API reads and how it is used; the user's affirmative consent (a tap to
accept, a box ticked); a declaration in the Play Console, with a video of the disclosure and of what
happens when the user says no; and the listing saying so. The API may never stop a user from
disabling or uninstalling an app or service unless a parent authorizes it through a parental-control
app or an administrator through enterprise management software
([Permissions and APIs that Access Sensitive Information](https://support.google.com/googleplay/android-developer/answer/16558241)),
and a teacher's tool on a student's own phone is neither. Play's newer rule against apps that act
on their own through the API spares a fixed rule a person set, such as "a blocked app comes to the
front: cover it". The declaration is made again whenever the app's use of the API changes, and a
deceptive or undeclared use can suspend the app. Separately, a personal developer account made after
2023-11-13 reaches production only after a closed test of at least 12 testers, opted in for 14 days
in a row
([App testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465)).

**No VPN declaration.** Lock (c), a VPN on the phone alone, stays out (the owner, 2026-11-04), so
Bali needs no second declaration for Play's `VpnService`
([VpnService](https://support.google.com/googleplay/android-developer/answer/12564964)). What it
would ask, should (c) ever come back, is in `docs/DECISIONS.md` (2026-11-03, AN1 part 1c).

**What others do (researched 2026-11-02).** A screen-time app's developer reports four refusals
from Play over its Accessibility disclosure, until they took the service out and saw the app in
front by polling usage access instead, about 800 ms behind: lock (b), which needs no Accessibility
declaration
([their account](https://dev.to/lui61140/why-i-removed-accessibilityservice-from-my-android-app-and-finally-got-into-play-store-4i52)).
AppBlock asks for both (#6).

**The plan.**
- The disclosure and the consent are drawn on AS0's canvas, with the permission steps, and built
  from it; the declaration, its video and the listing's words are in AP1's drafts
  (`docs/PLAY-STORE.md`). The service reads only which app is in front, to cover it, and keeps and
  sends none of it, which the declaration says. The disclosure itself lost "Bali keeps and sends
  none of it." in the owner's canvas cuts of 2026-11-04 (AS0 approved, `docs/DECISIONS.md`): if
  Play's review asks for it, it goes back (#6).
- If Play refuses (a), what Android does is the owner's call. (b) was dropped on 2026-11-04, so no
  second lock is ready behind (a); AN1's part 1 measured it, so its holes are known
  (`docs/DECISIONS.md`, 2026-11-03).
- The kind of Play account decides the 12-tester wait (`docs/PLAN-ANDROID.md`, Open owner items, 2).
- No Android build reaches a student before Play has reviewed the one they install (AP4).

**Done when:** Play has accepted the build students install, with its Accessibility declaration
(AP4).

---

## Considered and set aside (so we don't re-argue them)

- **Copying the NFC tag.** Not an issue in our setup: the block belongs to the *teacher* —
  it is not stuck on desks — so students never get quiet access to clone it. Revisit only
  if a tap ever needs to prove physical presence (attendance-style claims).
- **Bell-minute load testing.** Real, but it's a testing task, not a design issue — it will
  be part of pre-launch testing.
