# Bali privacy policy: notes for the lawyer

> **The live text is the page, not this file.** The privacy policy's words, the owner's draft of
> 2026-10-24 (adapted from General Legal's "Privacy Policy (U.S. Only)" template, CC0,
> https://github.com/General-Legal/legal-templates, and filled in from what Bali does), live only
> in `apps/web/src/app/privacy/page.tsx`, served at `/privacy`
> (https://bali-portal.vercel.app/privacy). The lawyer reviews that live page, and their words
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
   promise multi-factor sign-in on every console: Railway's 2FA is still deferred.
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
