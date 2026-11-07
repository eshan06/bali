# Bali privacy policy: notes for the lawyer

> **The live text is the page, not this file.** The privacy policy's words, the owner's draft of
> 2026-10-24 (adapted from General Legal's "Privacy Policy (U.S. Only)" template, CC0,
> https://github.com/General-Legal/legal-templates, and filled in from what Bali does), live only
> in `apps/web/src/app/privacy/page.tsx`, served at `/privacy`
> (https://app.getbali.app/privacy). The lawyer reviews that live page, and their words
> replace it there (C2). This file keeps only the questions for the lawyer, which no page shows.
> Not legal advice.

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
   promise multi-factor sign-in on every console: Railway's 2FA is still deferred. PostHog's
   1 year (section 1, since 2026-11-05) is its free plan's (its docs' "Events retention" and
   its pricing page, read 2026-11-05; a paid plan keeps events up to 7 years unless the project
   is set shorter), and PostHog deletes expired events in batches, not on the day. Its
   encryption at rest is a control its Trust Center lists (trust.posthog.com), not a line of
   its public docs.
6. **The 45-day breach notice** follows Tennessee's law (Tenn. Code § 47-18-2107). Check the
   K-12 state's.
7. **State privacy laws** (California, Colorado, Connecticut, Virginia and others) mostly
   apply above size thresholds a pilot doesn't reach, and FERPA may govern education records
   instead. Section 10 offers the rights anyway.
8. **The operators** are two individuals. An LLC changes "Who we are" and the liability
   picture.
9. **These must match word for word**: the app's "What your teacher sees" lists, Apple's privacy
   label (`docs/APP-STORE.md` §3), and the policy (#130). The live page's section 2 shows the
   app's own two lists, the help page's too (`apps/web/src/components/teacher-sees.ts`, held word
   for word to `ios/Bali/UI/JoinView.swift` by `apps/web/src/app/support/support.test.ts`), so
   those three can't say different things. Apple's privacy label is still checked by hand.
10. **PostHog's usage counts** (section 1, since 2026-11-05) hold a class's totals for each
    session and a teacher's actions in the portal, every count filed under a teacher's Bali ID.
    A session's totals add up the students who tapped in and are sent however few that is, so
    when a class has only one or two students, or only one or two tap in, its counts are those
    students' own numbers (the owner's pick, over
    holding them back under 3 or 5 students), and the counts stay at PostHog after an account
    is deleted or a school's data is disposed of (the owner's pick). Are such a session's
    totals still de-identified under FERPA, and is counting how Bali is used a use the
    school-official terms allow? Section 5 now names the counts as the one use
    outside the school's purposes. Does keeping a deleted teacher's actions under their ID meet
    a state law's right to delete, where one applies (note 7)? And does section 3's "no
    profiling" still hold with each teacher's actions filed under their ID?
