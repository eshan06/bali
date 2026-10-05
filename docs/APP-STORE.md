# App Store drafts

Drafts for App Store Connect that the owner edits and pastes in (Phase 5, P7; issue #130).
Nothing here is submitted by a session. Sources: ARCHITECTURE "What Bali is", ISSUES #3
and #5, DESIGN.md's voice, the student app's "what your teacher sees" list
(`ConsentCard` in `ios/Bali/UI/JoinView.swift`) and the data model
(`packages/db/src/schema.ts`). Read as of 2026-10-04: if the code changes what Bali
collects or what a teacher sees, this file changes in the same PR.

**The framing rule (ISSUES #3).** Apple's developer agreement §3.3.3(P) allows Family
Controls for "individuals the ability to manage their devices to enable focus and
productivity", and says the framework "may not be used … in organizational settings". So
every word here describes what Bali really is: the student installs it, approves Screen
Time for themselves, taps in, and holds the exit. Never "schools stay in control",
"classroom management", "enforce", "monitor students" or "device policy". The teacher
appears as who starts class and what they see, never as who controls the phone. This
wording is not a substitute for asking App Review (ISSUES #3's consultation), which still
comes first; if Apple's answer changes the design, these drafts change with it.

⚖️ marks what the lawyer confirms before submission. 🔧 marks what the owner fills in.

---

## 1. Store listing

Written in DESIGN.md's voice (short, warm, second person, never alarm, no exclamation
marks) and edited with `no-ai-slop`. No em dashes. Character limits are App Store
Connect's.

### Name (30)

`Bali: Focus for Class` 🔧 (or plain `Bali` if the name is free; the subtitle carries the
rest)

### Subtitle (30), pick one

- `Your phone, quiet for class` (27)
- `Focus for class, back at the bell` is 34, too long; `Tap in for class` (16) if the name carries "focus"
- `Focus in class, exit any time` (29)

Lean: the first. It says what happens and to whom, and nothing about control.

### Promotional text (170)

> Tap in when class starts and get your phone back at the bell. Emergency Unlock is always
> one hold away, and calls and Messages keep working.

### Description (4,000)

> Bali puts your phone away for class and gives it back at the bell.
>
> You set it up yourself. Install Bali, sign in, and let it use Screen Time on your
> iPhone. You approve that on your own phone. You can turn it off in Settings any time,
> and your teacher sees Screen Time off when you do.
> Then join your class with the code your teacher gives you.
>
> When class starts, hold your iPhone to your teacher's Bali block. Your apps go quiet
> until the bell. At the bell they come back on their own, even if Bali is closed.
>
> You can always leave. Hold Emergency Unlock and your phone opens right away, no one's
> permission needed. Pick a reason if you want to: bathroom, nurse, or something else.
> Your teacher sees that you unlocked, and the reason only if you pick one. Ready to
> focus again before the bell? Tap Lock my apps again.
>
> Calls, FaceTime, Messages and Emergency SOS keep working the whole time.
>
> What your teacher sees:
> • Your focus status: focused, unlocked, or Screen Time off
> • If Bali stops hearing from your phone during class, and when it last did
> • When you tap in, and when class ends for you
> • When you unlock, and the reason if you share one
> • If you leave the class
>
> What your teacher never sees:
> • Your screen, your apps, or what's in them
> • Your messages or where you are
>
> Bali never reads which apps you use. It quiets every app it can, so there is no list to
> look at.
>
> History shows you the same moments your teacher sees, and nothing more.
>
> Bali is for students 13 and older.

Notes for the owner:
- The two lists are the app's own `ConsentCard` words (the colons replace the app's em
  dash). Keep them identical to the app: #130 asks that the store, the privacy labels and
  the app say the same thing.
- "Bali is for students 13 and older" holds only once C7 (the 13+ screen) lands; drop the
  line if submission comes first, and never claim it before it's true.
- "Lock my apps again" and History's line are the shipped screens' words
  (`UnlockedView`, `HistoryView`). If those screens change, these lines follow them.
- No "Delete account" line until C3/C4 land. Once they do, add: "You can delete your
  account in the app, on the Me tab."

### Keywords (100)

`focus,study,class,school,distraction,phone,lock,students,concentrate,homework,bell`

No "Screen Time", "iPhone" or other Apple trademarks: keywords with them can be rejected
(guideline 2.3.7). ⚖️ none needed.

### Category

Primary **Education**, secondary **Productivity**. Not the Kids category: Bali is 13+, and
the Kids category brings its own rules (guideline 1.3) for under-13 apps.

### URLs 🔧

- Support URL: P4's support page.
- Privacy policy URL: C2's privacy policy page. Required before submission. ⚖️ its words.

---

## 2. Review notes (App Review Information → Notes)

Plain English for a reviewer, under App Store Connect's 4,000 characters. 🔧 fills in the
accounts and the video link once the review path (section 4) is chosen.

> Bali helps a student keep their own iPhone out of the way during class. The student
> installs Bali, approves Screen Time access for themselves, joins their class with a
> code, and taps their iPhone on their teacher's Bali block (an NFC tag) when class starts.
> Their apps are shielded until the class's end time. The teacher sees whether each
> student is focused, unlocked, or has turned Screen Time off.
>
> HOW BALI USES FAMILY CONTROLS
> - Authorization is `.individual`: the student requests and approves it on their own
>   device (`AuthorizationCenter.shared.requestAuthorization(for: .individual)`). There
>   is no parent or guardian authorization and no Family Sharing involvement.
> - The shield is `ManagedSettingsStore.shield.applicationCategories = .all()` and
>   `webDomainCategories = .all()`. Bali never asks the student to pick apps and never
>   uses a FamilyActivityPicker, so it never receives or reads which apps the student has
>   or uses. It reports only its own state: focused, unlocked, or Screen Time access
>   turned off.
> - A DeviceActivity monitor extension removes the shields at the class's end time, even
>   if the app is closed or force-quit.
> - A ShieldConfiguration extension draws the shield screen.
>
> THE STUDENT ALWAYS HAS A WAY OUT
> - Emergency Unlock is on the focus screen at all times: press and hold, and the shields
>   come off at once, on the phone, with or without a network. Nothing can turn it off.
>   Choosing a reason is optional.
> - iOS keeps calls, FaceTime, Messages and Emergency SOS available while shielded; Bali
>   does not change that.
> - The student can revoke Screen Time access in Settings at any time. The shields stop,
>   and the teacher sees "Screen Time off".
> - Deleting the app removes its shields.
>
> PRIVACY
> - No ads, no tracking, no third-party analytics or advertising SDKs in the app.
> - The teacher sees what the app shows the student before they join a class, word for
>   word, under "What your teacher sees": focus status, last contact during class, tap-in
>   and end times, unlocks and their reason if given, and leaving the class. Never the
>   screen, apps, messages or location.
>
> HOW TO TRY IT
> [🔧 From section 4, the chosen option: the accounts, the class code, the video link,
> and what the reviewer can do without a Bali block.]
>
> Student review account: [🔧 email] / [🔧 password]
> Teacher portal (optional, to watch the live grid): [🔧 URL], [🔧 email] / [🔧 password]
> Class code: [🔧]

Notes for the owner:
- "Nothing can turn it off" is true of the code today (the unlock is local-first, ISSUES
  #2). Keep it true: if anything ever gates Emergency Unlock, this line goes.
- If App Review's consultation (ISSUES #3) has answered by then, say so in one line at the
  top, with the date and the case number.
- The notes name APIs on purpose: a reviewer checking §3.3.3(P) looks for `.individual`
  and for whether app usage leaves the device.

---

## 3. Privacy answers

### App Privacy ("nutrition label")

Read from the code and the data model as of 2026-10-04; the push token added 2026-10-06 (N6). Purpose for every row: **App
Functionality**. Nothing is used for **Analytics**, **Product Personalization**,
**Developer's Advertising**, **Third-Party Advertising** or **Other Purposes**. Every row
is **linked to the user** (it sits in a row keyed by their account). **Tracking: No** for
every row.

| Apple's data type | What Bali collects | Where it lives | Notes |
|---|---|---|---|
| Contact Info → **Email Address** | The account's sign-in email | Cognito (AWS), not Bali's database; the Me screen shows it | |
| Contact Info → **Name** | Display name the student picks or the account carries (`users.display_name`) | Bali's database | Seen by the teacher on the grid and reports |
| Identifiers → **User ID** | Bali's user id and the Cognito user id (`users.id`, `users.cognito_id`) | Bali's database | |
| Identifiers → **Device ID** | The install id: a random UUID the app mints for its outbox (`events.order_install`, `armed_taps.order_install`), used to order a phone's own records. A student's APNs device token, with its environment (`device_tokens`, N3), used only to send the "class started" alert | Bali's database | ⚖️ Not a hardware or advertising id; it is per install and resets on reinstall. Apple's "Device ID" covers "other device-level ID"; declaring it is the safe reading. Confirm. The push token rides this row: App Functionality, linked (stored with the student's account, deleted with it, in C5's export), not tracking; never logged, never sent to anyone but Apple's push service |
| Usage Data → **Product Interaction** | Focus-state events: tap in, unlock, refocus, Screen Time off, going silent and coming back, leaving a class or session; the ~30 s check-in's last-seen time; device timestamps of each, clamped to the session by the server | Bali's database (`events`, `participations`, `armed_taps`) | The core of the product. Bali never collects which apps are used |
| User Content → **Other User Content** | The unlock reason, when given: one of bathroom, nurse, other (`UNLOCK_REASONS`) | Bali's database (event payload) | ⚖️ A fixed choice, not free text. "Nurse" hints at a health visit: confirm it isn't **Health & Fitness → Health** data, and who should see it (Phase 6's open decision: who sees unlock reasons) |
| Other Data → **Other Data Types** | Class membership: which classes the student joined, with which teacher, when they left | Bali's database (`enrollments`) | ⚖️ Could equally ride under Product Interaction; listing it separately is the more open answer |

**Not collected:** location, contacts, photos, browsing or search history, purchases,
health data (subject to the ⚖️ above), sensitive info, audio, the list of apps, any
advertising identifier. **Diagnostics:** none from the app. The app ships no crash or
analytics SDK. Sentry runs on the API and the portal only (P1, P2), scrubbed of personal
data; ⚖️ confirm a server-side error report triggered by an app request is not
"Diagnostics collected from the app" (lean: not, as nothing personal is sent).

**Checks before pasting:**
- The in-app "What your teacher sees" list, this table and the privacy policy (C2) must
  agree (#130). They do as of this draft.
- The app's privacy manifest (`ios/Bali/PrivacyInfo.xcprivacy`, C1) lists the same data
  types; CI fails when this table's types and the manifest's differ. The push token adds no type
  (it is a Device ID, already declared linked, App Functionality, not tracking), so the
  manifest needs no change for it.
- If accounts stop being self-created (Phase 6's open decision on how accounts are made),
  the email row still stands: the school or Cognito still holds it on Bali's behalf.
- Data kept after an account is deleted follows the owner's retention policy (ISSUES #5,
  C3): the label doesn't ask, but the privacy policy must say it.

### Age rating questionnaire

App Store Connect's 2025 questionnaire, answered for Bali as it is. 🔧 check the wording
against the form when filling it in: Apple revised it in 2025 and may again.

| Question | Answer |
|---|---|
| Violence, sexual content, nudity, profanity, horror, mature or suggestive themes | None |
| Alcohol, tobacco, drug use or references | None |
| Medical or treatment information; health or wellness topics | None ⚖️ (the "nurse" reason is a label, not medical content) |
| Gambling, simulated gambling, contests | None |
| Unrestricted web access | No. Sign-in opens the account page in a system sign-in sheet (`ASWebAuthenticationSession`), not a browser |
| User-generated content shared with other users | No. The only text a student gives is a display name and an optional fixed-choice reason, seen by their teacher; no student sees another student's |
| Messaging or chat | No |
| Advertising | No |
| Parental controls | No. Bali is not a parental-control app, and saying yes would contradict section 2's `.individual` framing |
| Age assurance | No, until C7. Once C7 ships its 13+ screen, ⚖️ ask the lawyer whether a self-declared age screen counts |
| Made for Kids | No |

The questionnaire alone likely rates Bali 4+. ⚖️ **Raise the rating to 13+**, if App Store
Connect offers a higher rating than the computed one (🔧 check the form), to match the 13+ promise (Phase 6, C7)
and keep the app outside COPPA's "directed to children": confirm with the lawyer, and
confirm the state's app-store age law (Phase 6's owner items) doesn't change the answer.

---

## 4. How App Review tries Bali without a block or a teacher

The core flow needs an NFC block, a class with a running session, and a teacher pressing
Start. A reviewer has none of these, and guideline 2.1 lets App Review reject an app it
can't exercise. Everything short of the tap works for a reviewer today: sign in, the
intro, approving Screen Time, joining a class by its code and seeing what the teacher
sees, Me and History. The open question is the tap, the shield and Emergency Unlock.

This is the owner's decision. Nothing below is built.

### Option A: a recorded tap, plus review accounts (recommended)

A 1 to 2 minute screen recording on a real iPhone (the owner's 15 Pro, against prod),
linked in the review notes, plus a student account already in a demo class and,
optionally, a teacher portal account on the same class:

1. Sign in, approve Screen Time, join the demo class.
2. Teacher presses Start on the portal (shown side by side, or cut in).
3. The tap: phone to the block, "You're in", the shield on an app.
4. A call and Messages working while shielded.
5. Emergency Unlock held, a reason picked, the grid showing it.
6. The bell: shields off with the app force-quit.
7. Deleting the app: shields gone.

- **For:** no code, no new attack surface, nothing in the Release build that differs from
  what students run. Apple's own guidance for hardware-dependent features is a demo video,
  and the reviewer can still exercise every screen around the tap live.
- **Against:** the reviewer can't shield their own device, and may ask for more. A round
  trip with App Review costs days. The video goes stale as screens change: re-record it
  when the tap's screens change.
- **Cost:** an afternoon. The demo class and accounts live on prod, so they show up in
  reports: name them so (a "Demo" school), and exclude them from any school's data.

### Option B: a demo class with a session already running, plus a block in the post

The demo class runs sessions on a schedule (a server job, or the owner's portal by hand
during the review window), and the owner offers to ship an NFC sticker that holds the demo
block's ID.

- **For:** the reviewer could do the real flow end to end.
- **Against:** Apple doesn't take hardware for review, as far as known, so the sticker
  helps only if asked. A scheduled session needs a server job that starts sessions
  without a teacher, which the architecture doesn't have (a session is a teacher's Start);
  on prod that's a new write path for a demo. Without the sticker it adds nothing over A.
- **Cost:** a server change on the transition engine's path, and its tests, for review
  only.

### Option C: typing the block's ID, for review accounts only

A "Type the block's ID" field in Release builds, shown only when `GET /v1/me` marks the
account as a review account, and accepted by the API only from such accounts. With a
running session (B's schedule, or the reviewer's own Start on the teacher account), the
reviewer types the ID, and the rest of the flow is real.

- **For:** the reviewer exercises the real shield, Emergency Unlock and the bell on their
  own device, which answers 2.1 most fully.
- **Against, the security cost:** the ID is printed on every block (P3), so the typed path
  is a way to tap in without being in the room. Gated server-side, a leaked or
  mis-flagged review account, or a bug in the gate, lets any account fake presence. The
  code ships to every student's phone, so it's one flag away from anyone. It goes against
  #130's "nothing from Debug in Release" and the release guard (P5, S10) would need an
  exception. It also adds an additive `/v1` field and a role or flag that can never be
  removed.
- **Cost:** an app change, an API change with authorization tests (S1's matrix), and the
  release guard's exception. The most code of the three, all of it there only for review.

### Recommendation

**Option A.** It costs no code and no attack surface, it's what Apple asks for when a
feature needs hardware, and every screen but the tap stays live for the reviewer. Go to C
only if App Review rejects under 2.1 after seeing the video, and then build it as its own
planned step with the security review it needs. Raise the question in ISSUES #3's App
Review consultation too: "how would you like to review a feature that needs our NFC
block?" costs nothing to ask.

---

## 5. TestFlight external beta (the Vanderbilt pilot)

The pilot's students install Bali through TestFlight's **external** testing, and Apple's
**Beta App Review** checks the first build offered to an external group (later builds of
the same version usually go straight through). It reads the same §3.3.3(P) rules as App
Review, so ISSUES #3's consultation comes first (5.6 below). 🔧 Everything here is pasted
by the owner in App Store Connect → the app → **TestFlight**. How builds are made:
`docs/DEPLOY.md`, "TestFlight"; the pilot itself: `docs/PILOT.md`.

### 5.1 The groups: prod builds to the pilot, dev builds stay internal

- **External group `Vanderbilt pilot`** (TestFlight → External Testing → +): **prod builds
  only**, each one dispatched with `environment: prod` (the run's name reads
  `TestFlight (prod)`; note its build number). Add the students by email, or turn on its
  **public link** with a tester limit near the class's size and send the link only to the
  class.
- **Internal group** (the owner and anyone on the team): dev builds, and a prod build
  before it goes external. Internal testing needs no Beta App Review.
- **Never add a dev build to the external group:** it would point a classroom's phones at
  dev. A build added to a group stays offered to it, so check the number twice.
- A build expires 90 days after upload: the pilot's term (to 2026-12-18) fits in one
  build uploaded on or after 2026-10-05, but any fix is a new prod dispatch and, for a
  new version, a new Beta App Review.

### 5.2 Test Information (TestFlight → Test Information)

- **Beta App Description:** the store listing's promotional text (section 1) is enough.
- **Feedback email:** `eshan.shah@vanderbilt.edu` (P4's support address). Testers' in-app
  feedback (a screenshot from TestFlight) reaches App Store Connect → TestFlight →
  Feedback.
- **Marketing URL / Privacy policy URL:** the support page
  `https://bali-portal.vercel.app/support`, and C2's policy page once it exists. ⚖️ Test
  Information asks for a privacy policy URL, and C2 is a Phase 6 gate item for the
  student-facing steps anyway: its page (the lawyer's words) comes before the first
  external build.
- **Beta App Review Information:** contact name, email and phone (🔧 the owner's); the
  sign-in the reviewer uses (5.4); **Review Notes:** section 2's review notes, with its
  "How to try it" filled from section 4's choice and 5.4's accounts. Add one line at the
  top for the beta: "This build is for one university class's pilot (adult students on
  their own iPhones)."
- **Export compliance:** nothing to answer per build. The app's `Info.plist` sets
  `ITSAppUsesNonExemptEncryption` to `false` (Bali's only cryptography is exempt: iOS's
  HTTPS, CryptoKit's SHA-256 for the sign-in's PKCE challenge, the system Keychain;
  `docs/DEPLOY.md`, "TestFlight"). If App Store Connect still asks, the answer is **None
  of the algorithms mentioned above** (no non-exempt encryption).

### 5.3 What to Test (each build's "What to Test", 4,000 characters)

Written in DESIGN.md's voice and edited with `no-ai-slop`; no em dashes. It tells testers
what to try and what to report, in the words a student uses; change it with a build only
when what to try changes.

> Thanks for trying Bali in class this term.
>
> What to try:
> - Sign up with your @vanderbilt.edu email, give Bali Screen Time access, and join your
>   class with the code your professor gives you.
> - When class starts, hold your iPhone to the Bali block. Your apps lock until the class
>   ends. Calls, FaceTime, Messages and Emergency SOS still work.
> - If you need your phone, hold Emergency Unlock. It works without a signal. Your
>   professor sees that you unlocked, and the reason if you give one.
> - When class ends, your apps unlock on their own, even if Bali is closed.
>
> Tell us if anything stays locked when it shouldn't, if a screen says something that
> isn't true, or if Bali gets in your way. Send feedback from TestFlight with a
> screenshot, or write to eshan.shah@vanderbilt.edu.

### 5.4 Review and demo accounts

Prod's pool only lets `@vanderbilt.edu` addresses sign up: the Pre sign-up Lambda
(`infra/cognito/pre-signup.mjs`) refuses any other on the hosted page. It lets an account
the owner makes in the console through (Cognito's `AdminCreateUser`, trigger source
`PreSignUp_AdminCreateUser`: only someone with AWS access to the pool can make one), so
review accounts are made there:

1. **A mailbox you control** for each account (a `+review` alias of your own address is
   enough; Apple never needs to receive mail there).
2. **Create the user:** AWS console → Cognito → `bali-production` → **Users** → **Create
   user**: the email as username and email, **Mark email address as verified**, **Set a
   password** (12+ characters, the pool's policy), and don't send an invitation.
3. **Make the password permanent,** so the reviewer isn't asked to change it on first
   sign-in:
   ```bash
   aws cognito-idp admin-set-user-password --user-pool-id us-east-1_C55e0fhX8 \
     --username <email> --password '<password>' --permanent
   ```
   **Check:** the user's **Confirmation status** reads Confirmed. The password goes into
   App Store Connect's review fields and your password manager, never the repo.
4. **The student review account** signs in once on the app (its first sign-in makes it a
   student, as anyone's does) and joins the demo class with its join code, so the
   reviewer lands where section 4's option A starts.
5. **The teacher review account** (optional, to watch the live grid): an invite redeemed
   on the portal, as `docs/PILOT.md`'s setup steps 3–4 do. 🔧 Decide where the demo class
   lives: under the Vanderbilt school its accounts and sessions are in that school's
   reports, export and retention run; a separate demo school keeps them apart, but
   `npm run school` mints its invite only once an agreement day is recorded for it, and
   that record should be true. Either way, name the class "Demo" so it's never mistaken for
   a real one.
6. **After review,** set a new password on both, or disable them (**Users** → the user →
   **Disable**), and re-enable them for the next review.

### 5.5 What the beta can't show the reviewer

The tap needs a block and a running session (section 4). For Beta App Review, section 4's
recommendation stands: the recorded tap in the review notes, the accounts above for
everything around it.

### 5.6 Ask Apple first: §3.3.3(P) (ISSUES #3)

ISSUES #3: Beta App Review applies §3.3.3(P), so the pilot's first external build can be
stopped by it. Ask before submitting the first external build, through App Store Connect →
**Contact Us** → App Review → *(wording unsure)* a question about a guideline or the
developer agreement, or through an App Review appointment at a Meet with Apple session.
The draft to paste (the owner edits it; the facts are true of the code today):

> Hello App Review,
>
> We'd like guidance before we submit our first build for external TestFlight testing.
>
> Bali (bundle ID com.bali.Bali, with its extensions com.bali.Bali.BaliMonitor and
> com.bali.Bali.BaliShield; Family Controls distribution entitlement granted 2026-09-24)
> helps a student keep their own iPhone out of the way during class. The student installs
> Bali, approves Screen Time access for themselves with `.individual` authorization, joins
> their class with a code, and taps their iPhone on their teacher's NFC tag when class
> starts. Bali then shields all app and web categories (`.all()`) until the class's end
> time. The student can hold Emergency Unlock at any time to remove the shields at once,
> with or without a network; calls, FaceTime, Messages and Emergency SOS keep working; and
> revoking Screen Time access or deleting the app ends it.
>
> Bali never uses a FamilyActivityPicker and never receives which apps the student has or
> uses. The teacher sees only what Bali records itself, which the student reads before
> joining: whether each student is focused, unlocked (with an optional reason), or has
> turned Screen Time access off; the last contact during class; tap-in and end times; and
> leaving the class.
>
> Our first users are adult students at Vanderbilt University, on their own iPhones, in
> one professor's class.
>
> Our questions about section 3.3.3(P) of the Apple Developer Program License Agreement:
>
> 1. Is this use, where each student approves Family Controls on their own device to
>    manage their own focus, within "offering individuals the ability to manage their
>    devices to enable focus and productivity", given that a teacher starts the class
>    session?
> 2. Does sharing with the teacher the state Bali records itself (focused, unlocked,
>    Screen Time access off), with the student's consent before joining, fall under the
>    restriction on sharing data "received through the Family Controls Framework or
>    otherwise"? If so, what may the teacher see?
> 3. How would you like to review a feature that needs our NFC tag? We plan to include a
>    screen recording of the tap and accounts for everything around it.
>
> Thank you,
> [🔧 name, team, contact]

Record the answer, its date and case number in ISSUES #3, and the review notes' top line
(section 2).
