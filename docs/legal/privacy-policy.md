# Bali privacy policy — DRAFT for the lawyer

> **Not live. Not legal advice.** A first draft, adapted from General Legal's
> "Privacy Policy (U.S. Only)" template (CC0,
> https://github.com/General-Legal/legal-templates), filled in from what Bali's code
> and `docs/ARCHITECTURE.md` actually do as of 2026-10-24. Every fact is filled in; the
> questions for the lawyer are listed at the end. Its sections follow the outline the
> portal's `/privacy` page already shows (what Bali collects, what your teacher sees, how
> long records are kept, deleting your account), plus the sections the template requires.

**Effective date:** October 24, 2026
**Who we are:** Bali is run by Eshan Shah and Jonathan Bani ("Bali", "we", "us").

This policy covers the Bali iPhone app and the Bali portal at
`https://bali-portal.vercel.app` (together, "Bali").

## The short version

- Bali quiets a student's iPhone during class and shows the teacher who is focused.
- Bali never sees your screen, your messages, where you are, or which apps you have.
- We don't sell your information, show ads, or use tracking or advertising tools.
- Your school decides to use Bali. We hold class records for the school and use them
  only to run Bali for that school.
- You can delete your account from the app at any time.

## 1. What Bali collects

### If you are a student

| What | Why |
|---|---|
| The email you sign in with | To sign you in. It's held by our sign-in provider (Amazon Cognito), not in Bali's own database |
| Your name, as you set it in the app | So your teacher knows who's who on the class grid and in reports |
| The classes you join, and when you leave one | To put you in the right class |
| What happens to your phone during class: when you tap in, when you're focused, when you use Emergency Unlock, when you go back to focus, when Screen Time is turned off, when Bali stops hearing from your phone and when it hears from it again, and when class ends for you | This is what Bali does. Your teacher sees it (section 2) |
| A check-in from your phone about every 30 seconds during class, and when it last arrived | So Bali can tell your teacher honestly whether your phone is still focused |
| The reason for an Emergency Unlock, only if you pick one: bathroom, nurse or other | So your teacher knows why. You can always skip it |
| Your answers to class questions: the option you picked and when we got it | To count them in the class's totals. Your teacher never sees which answer is yours |
| That you confirmed you're 13 or older | To meet the age rule (section 8). We never store your birth date or your age |
| A random ID for your copy of the app | To keep your phone's records in the right order. It isn't your phone's serial number or an advertising ID, and it changes if you reinstall |
| A push token from Apple, when class-start notifications are on and you allow them | To tell you when class starts. Only Apple's notification service receives it |
| What you write when you email us | To answer you |

### If you are a teacher

Your sign-in email and name, your school, your classes and their join codes, the ID of the
Bali block you registered, the invite code you redeemed (we keep only a scrambled version
of it), the questions you write, and the slide decks (PDFs) you upload.

### What Bali never collects

Your screen or anything on it, your messages, calls or contacts, your location, your photos,
your browsing or search history, your health records, or any advertising ID. **Bali doesn't
know which apps you have.** It quiets every app it can, and Apple's Screen Time doesn't give
Bali a list of your apps to read.

### Automatically, from the portal and our servers

- **No cookies for tracking, no analytics, no ads.** The portal keeps your sign-in in your
  browser tab's own storage, which is cleared when the tab closes. It also remembers, on
  that computer, the session length a teacher last picked. Amazon Cognito's sign-in page
  sets its own cookies, only to keep you signed in.
- **Error reports.** When something breaks on our servers or in the portal, an error report
  goes to Sentry, our error-reporting provider. We strip names, emails, unlock reasons,
  sign-in tokens and codes out of these reports before they leave. The iPhone app sends
  none. Sentry keeps error reports for up to 90 days.
- **Server logs.** Our hosting providers record basic request information, such as IP
  addresses and the page or address requested, to run and secure the service. Railway
  (our servers) keeps these logs for up to 90 days. Vercel (the portal) keeps them for
  1 hour.

## 2. What your teacher sees

Before you join a class, the app shows you this list. Your teacher sees:

- Your focus status: focused, unlocked, or Screen Time off
- If Bali stops hearing from your phone during class, and when it last did
- When you tap in, and when class ends for you
- When you unlock, and the reason if you share one
- If you leave the class

Your teacher **never** sees your screen, your apps or what's in them, your messages, or where
you are.

When your teacher asks the class a question, your teacher sees the class's answer totals,
never which answer is yours.

Reports show the class as a whole and never rank students. A session's recap lists who
joined, every Emergency Unlock with its reason, and every time protection went off.

Unlock reasons are seen by your teacher. Bali's team sees them only to run and support
Bali, never to share or sell. Your school can ask us for its records (section 5).

You can see your own record in the app: the History screen shows everything recorded about
you that your teacher can see, in every class you've been in.

## 3. How we use it

Only to run Bali: sign you in, run class sessions, show teachers their class, write
reports, keep the service working and secure, answer support emails, and meet our legal
duties. We don't use your information for ads, for profiling, or to train AI models, and we
don't sell or rent it.

## 4. Who we share it with

- **Your teacher and your school**, as section 2 says.
- **Service providers** that run Bali for us, only for that, and under their own security
  and data-protection terms:
  - Amazon Web Services: sign-in (Amazon Cognito) and slide-deck storage (Amazon S3)
  - Railway: our servers, database and backups
  - Vercel: the portal's hosting
  - Sentry: error reports, with personal details removed (section 1)
  - Apple: TestFlight and App Store delivery, Screen Time on your phone, and class-start
    notifications when they're on
- **The law.** Only when the law requires it, or to protect someone's safety. If we get a
  legal demand for a school's records, we tell the school first, unless the law forbids it.
- **If Bali is sold or merged**, the records go only with this policy's promises, and only as
  each school's agreement allows.

## 5. Schools and student records (FERPA)

Bali is used by schools. When a school uses Bali, the class records we hold about its
students are education records the school controls. We hold them as a "school official"
under the Family Educational Rights and Privacy Act (FERPA), under our agreement with the
school, and use them only for the school's purposes. If that agreement and this policy
disagree, the agreement wins. To see, correct or remove a record, you can ask your school
or email us. We'll give the school a copy of everything we hold about one student. For a
school in a state with its own student-privacy law, we follow that law too.

## 6. How long records are kept

- Each school picks the last day of its school year with us. For the Vanderbilt pilot it's
  December 18, 2026.
- After that day, we remove the names and sign-ins of everyone whose records all fall on
  or before it. What's left is counts that name no one, such as "3 unlocks in that session".
- A school can ask us in writing to dispose of all its data. We remove names from everyone
  at the school and delete its classes, blocks and pending invite codes.
- **Backups.** We back up the database every day and every week. Daily backups are kept for
  6 days and weekly backups for 27 days, then deleted. So something deleted from Bali can
  remain in a backup for up to 27 days, where nobody uses it except to recover from a
  failure.
- Error reports and server logs are kept as section 1 says.

## 7. Deleting your account

Students can delete their account in the app (Me → Delete account). When you do:

- Your name and sign-in are removed, from Bali and from Amazon Cognito.
- You leave every class.
- The class's records keep their counts but no longer name you. Your answers stay in the
  class's totals, attached to no one.
- Backups age out as section 6 says.

A teacher with a class or a registered block deletes their account through their school, so
a class isn't left without its teacher. Email us to start.

## 8. Age

Bali is for people 13 and older. The app asks before you sign up. If you're under 13, it
stops and Bali records nothing. If we learn we have an account for someone under 13, we
delete it. The Vanderbilt pilot is for adult students only.

## 9. Security

- **On the way:** everything between your device and Bali travels encrypted (HTTPS). Inside
  our hosting, our servers reach the database over Railway's private network, which is also
  encrypted and isn't reachable from the internet.
- **Stored:** Railway, Amazon Web Services and Sentry encrypt the data they store for us.
  Invite codes are stored only in scrambled form.
- **Access:** only Bali's team can reach the production systems.

No system is perfectly secure. If a breach exposes your information, we'll tell your school
and you without unreasonable delay, and within 45 days at the latest, or sooner if a school
agreement or the law requires it.

## 10. Your choices and rights

- **See your record:** the app's History screen, or email us for all of it.
- **Fix your name:** in the app, any time.
- **Leave a class:** in the app, any time a session isn't running.
- **Delete your account:** section 7.
- **Turn Bali off:** you can turn off Screen Time for Bali in Settings at any time. If you do
  during class, your teacher sees "Screen Time off".
- **State privacy rights:** depending on where you live, you may have the right to know,
  correct, delete or get a copy of what we hold. Email us and we'll answer within 45 days.
  We don't sell or share personal information for advertising, so there's nothing to opt out
  of.

## 11. Changes to this policy

If we change this policy, we'll update the date at the top. If a change matters, such as
collecting something new, we'll say so in the app and on the portal before it applies.

## 12. Contact us

Email [eshan.shah@vanderbilt.edu](mailto:eshan.shah@vanderbilt.edu).

---

## Notes for the lawyer

1. **"Nurse" as an unlock reason** hints at a health visit. Is it health information (Apple's
   label, state law, FERPA/HIPAA)? Option: rename it to "office".
2. **Who sees unlock reasons** is still an open owner decision. Section 2 describes today's
   behavior: the teacher sees them.
3. **Answers to class questions** are education records kept, without a name, after a
   deletion. Is "kept in counts that name no one" the right way to say it?
4. **The 13+ yes** is stored without a birth date. Is a self-declared age enough, and does it
   count as sensitive information? For K-12: COPPA, and the state's app-store age law.
5. **Retention figures** come from the providers' published settings as of 2026-10-24:
   Railway backups (daily 6 days, weekly 27 days; turned on before the first class, PLAN's
   L0b), Railway logs (shown 7–30 days by plan, stored up to 90 days per Railway's staff),
   Vercel's Hobby plan (1 hour), and Sentry (up to 90 days by plan). Railway's encryption at
   rest is stated by its staff and Trust Center, not its public docs. Section 9 doesn't
   promise multi-factor sign-in on every console: Railway's 2FA is still deferred.
6. **The 45-day breach notice** follows Tennessee's law (Tenn. Code § 47-18-2107). Check the
   K-12 state's.
7. **State privacy laws** (California, Colorado, Connecticut, Virginia and others) mostly
   apply above size thresholds a pilot doesn't reach, and FERPA may govern education records
   instead. Section 10 offers the rights anyway.
8. **The operators** are two individuals. An LLC changes "Who we are" and the liability
   picture.
9. **These must match word for word**: the app's "What your teacher sees" list (the answers
    line joins it with L8), Apple's privacy label (`docs/APP-STORE.md` §3), and this policy
    (#130).
