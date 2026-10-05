# The Vanderbilt pilot — runbook

How the first pilot runs on production: one professor's class of adult students at
Vanderbilt, on their own iPhones, through the fall 2026 term (its last day,
`2026-12-18`, is recorded as the school's year end). The owner runs the setup and the
support; the professor runs the class.

This page says what each step **does**, not what each screen says: the screens are being
redesigned (D2), so their wording and layout will change under it. Production's values
(URLs, pool, client ids) are in `docs/DEPLOY.md`; the console steps are in
`docs/RUNBOOKS.md`.

**What runs where:** the API `https://bali-prod-production.up.railway.app`, the portal
`https://bali-portal.vercel.app`, the Cognito pool `bali-production` (sign-up only with a
`@vanderbilt.edu` address), the student app through TestFlight. Prod has **no database
backups** for this pilot (the owner's ruling, 2026-10-05; `docs/RUNBOOKS.md`, runbook 1,
step 4).

## 1. Setup, in order

Done once, by the owner, before the first class. Steps 1–3 are done for the owner's own
class (2026-10-05); for another professor, start at step 3.

1. **The school.** In a shell inside the API service (never through a public database
   proxy; `docs/RUNBOOKS.md`, runbook 1, step 9):
   ```bash
   railway link                          # the Bali project, environment production
   railway ssh --service "bali prod"
   npm run school -- add "Vanderbilt"    # prints the school's id
   ```
   Prod's school is `01a10a81-4ac0-7698-a1d4-fc0487865082`; `npm run school -- list`
   shows it.
2. **Its agreement and its year's end**, in the same shell:
   ```bash
   npm run school -- agreement <school-id> 2026-10-05   # the day the agreement was signed
   npm run school -- year-end <school-id> 2026-12-18    # the term's last day
   ```
   No invite is minted for a school without an agreement on record. The year's end is when
   the retention run (section 5) may run; put that run in the calendar for the week after.
3. **An invite for the professor**, in the same shell:
   `npm run school -- invite <school-id>`. The code prints once, here and nowhere else:
   lost, mint another. It is for one teacher, once, within 14 days. Send it to the
   professor directly (not in a shared channel).
4. **The professor redeems it.** They open the portal, sign up with their
   `@vanderbilt.edu` address (Cognito emails a code to confirm it), and enter the invite
   code when the portal asks for one. That makes the account a teacher at the school.
   **Check:** `npm run school -- list` no longer lists that invite as open, and the
   portal shows the professor's classes page.
5. **The class.** On the portal the professor creates the class. It gets a **join
   code**: short, without `0`/`O` or `1`/`I`/`L`, for the students. The portal can't
   change the code yet (the API can, `PATCH /v1/classes/{id}`, but no screen calls it), so
   share it with the class only. If it leaks, tell the owner; a new code means a session's
   PR for the portal, or a new class.
6. **The block.** A block is an NFC tag carrying a ten-letter-and-digit code,
   `<your block's 10-character code>`. Make it up (letters and digits only) and keep it
   off shared channels and the repo: anyone enrolled who knows it can send a tap with it.
   Write the code onto a blank NFC tag (NTAG213 or
   similar) as an NDEF **Text** record with any NFC-writing app; a link `https://<host>/t/<code>` or
   `bali://t/<code>` works too (never `http://`: the phone refuses it as not a block). The professor registers the code on the portal by typing it in;
   one block serves all of a teacher's classes, and a block registered to one teacher is
   refused to another. **Check:** a student's app, scanning the block before any session,
   waits for the teacher rather than saying it isn't a Bali block.
   🔧 **Before the first class, the owner's block needs a fresh code:** its first code
   was committed to this repo (#228) and stays in its history. Write a new code onto the
   tag and register it on the portal. The old code stays valid until its block row is
   retired (`blocks.removed_at` set), and no screen or command does that yet: ask a
   session for an owner command that retires a block, and run it on the old code.
7. **The students' app**, through TestFlight's **external** group for the pilot, which
   gets prod builds only (`docs/DEPLOY.md`, "TestFlight"; dev builds go to an internal
   group, never this one). The owner adds each student's email to that group (or shares
   the group's public link); each student installs TestFlight, accepts, and installs Bali.
   Apple's rules, not this repo's: a TestFlight build expires 90 days after upload (the
   one dispatched 2026-10-05 lasts to about 2027-01-03, past the term's end), and the first
   build offered to an external group waits for Apple's Beta App Review (what to send it:
   `docs/APP-STORE.md`, section 5). A fix is a new
   prod dispatch (`docs/DEPLOY.md`, "TestFlight").
8. **Each student, once:** opens Bali, reads the privacy pages, signs up with their
   `@vanderbilt.edu` address, gives Bali Screen Time permission, enters the class's join
   code, sees what the professor will and won't see, and joins. A student can do this
   before the first class; it takes a few minutes.

## 2. The day of class — the professor's checklist

Before class:

- The block is with you, and the portal is open and signed in on the laptop you teach
  from.
- New students have the app installed and have joined with the join code (step 8 above);
  a student can join on the spot, as long as they have a connection.

At the start:

- Press Start for the class on the portal. **A session is 25 minutes today:** the
  portal's one Start button has no length to choose. Students tap their phone to the
  block, before or after Start: a tap before Start waits and joins at Start, so nobody
  taps twice.
- Each phone locks into focus at the tap, even with no signal. Calls, FaceTime, Messages
  and Emergency SOS keep working; every other app is shielded.
- The live grid shows who is focused. A phone not heard from for 90 seconds shows as
  silent; it is not a sign that anyone did anything wrong (a phone off, out of battery or
  without signal looks the same).

During:

- **Emergency Unlock** is always allowed. A student holds it on the phone; the phone
  unlocks at once, with or without a connection, and the unlock is recorded, with an
  optional reason (bathroom, nurse, other). It shows on the grid. A student who unlocked
  can go back into focus from the app, or by tapping the block again.
- **For a class longer than 25 minutes:** when the session's bell comes, every phone
  lets go. Press Start again for a new 25-minute session, and the students tap the block
  again (a tap made before that Start waits for it). The portal has no "add time" yet
  (the API's extend isn't on any screen), and a session can't be extended after its bell
  anyway.

At the end:

- At the bell every phone lets go by its own clock, even with Bali closed, unless its tap
  never reached the server: then it holds until 50 minutes after the tap (Emergency Unlock
  still works). End early from the portal if the class ends early.
- The class page shows the session's recap: who joined, focus and silent minutes, every
  unlock. The reports page keeps every session. Totals, never rankings.

## 3. Support

- **Support email:** eshan.shah@vanderbilt.edu, for students and the professor. The
  public help page is `https://bali-portal.vercel.app/support`.
- **A student is stuck locked:** Emergency Unlock, always. It works offline and is never
  refused. If the app itself won't open, the shields still come off at the bell, and a
  tap that never reached the server comes off by itself after 50 minutes. Last resort:
  Settings → Screen Time → turn it off, or delete the app; both take the shields off.
- **A student can't sign up:** the address must end `@vanderbilt.edu` exactly (a
  subdomain such as `mc.vanderbilt.edu` is refused unless added to the Pre sign-up
  Lambda's list, `docs/RUNBOOKS.md`, runbook 2, step 4), and they must enter the code
  Cognito emails them.
- **A student can't join:** check the code they typed against the class page (it has no
  `0`, `O`, `1`, `I` or `L`), and that they're signed in with their `@vanderbilt.edu`
  account. A join needs a connection.
- **The scan says it isn't a Bali block:** the tag holds something else, or the code on
  it isn't the one registered; rewrite it (step 6).
- **The API is down:** taps still lock phones at once and are kept on the phone, sent when
  it's back; Emergency Unlock still works and is kept until it can be sent; at the bell, or
  after 50 minutes for a tap never answered, the shields come off by themselves. What
  stops: the portal (Start, the grid, reports) and joining a class. Nothing a phone
  recorded is lost. Check `/healthz` (below) and Railway's deploy log for `bali prod`.
- **A sign-in is stuck** (a forgotten password): the hosted sign-in page's reset flow
  emails a code to the `@vanderbilt.edu` address. The owner can also find the user in the
  production pool's **Users** list and check it is confirmed.

## 4. Where to look

- **Health:** `curl -sS https://bali-prod-production.up.railway.app/healthz` →
  `{"status":"ok","version":…}`. Anything else, or no answer: open Railway → production →
  `bali prod` → Deployments and its logs.
- **Errors:** Sentry, the API's project (environment `production`) and the portal's. It
  reports server errors and crashes, never a refusal, and never a student's name, reason
  or token (P1, P2).
- **The sweep:** the API sweeps every minute itself (its log says `sweeping every
  minute` at boot); `sweep-cron`'s runs every 5 minutes log `{"expired":N,"wentSilent":M}`.
  A run that logs `401` means its key differs from the API's.
- **What happened in a class:** the portal's reports page, as the professor sees it.

## 5. After the pilot

- **A student asks for their record** (or, at a K-12 school, a parent through the school):
  `npm run --silent school -- export-student <sub> > record.json`, as
  `docs/RUNBOOKS.md`, runbook 1, step 10 says.
- **A student asks to delete their account:** the API can do it (C3), but the button on
  the phone is C4's, not built yet, and there is no owner command for one account. Until
  C4 ships, write the request down, tell the student when it will happen, and raise it
  for a session to build; the retention run de-identifies them at the term's end anyway.
- **The retention run,** the week after `2026-12-18`: preview, then run
  `npm run school -- retention <school-id> [--confirm '<name>']` (runbook 1, step 12).
  Named records become de-identified; counts stay.
- **Disposing of the school's data,** only on Vanderbilt's written request:
  `npm run school -- dispose <school-id>`, then with `--confirm` (runbook 1, step 11), and
  delete the school's sign-ins in Cognito. With no backups, nothing waits to age out.
- **Write down what was learned** in `docs/PLAN.md` (a session's PR), with anything the
  next school (K-12) needs first: backups (runbook 1, step 4), the data agreements, the
  13+ screen.
