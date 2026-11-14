/*
 * What a teacher sees of a student in their class, and never sees: the student app's own two lists
 * (`ConsentCard.sees` and `ConsentCard.neverSees`, ios/Bali/UI/JoinView.swift), word for word, the
 * answers lines last (L8a), a clock set ahead after the phone lines and how many answered after the
 * answers line (the owner, 2026-10-28). One copy on the web, for the help page (P4) and the privacy
 * policy's section 2 (C2-text, #130), so the three never say different things; support.test.ts
 * holds these to the app's. The one line where the two pages differ is the focus status: the help
 * page names Android's lock beside Screen Time (`TEACHER_SEES_BOTH_APPS`), and the privacy policy
 * keeps the iPhone's until the owner and the lawyer word it (AP4).
 */

/** The focus status as the iPhone says it, Screen Time being its lock. */
const FOCUS_STATUS = 'Your focus status: focused, unlocked, or Screen Time off';

export const TEACHER_SEES = [
  FOCUS_STATUS,
  'If Bali stops hearing from your phone during class, and when it last did',
  "If your phone's clock is set ahead",
  'When you tap in, and when class ends for you',
  'When you unlock, and the reason if you share one',
  'If you leave this class',
  "Your answers to questions, counted only in the class's totals",
  'How many answered, which can show whether you did',
];

/**
 * What a teacher sees, in both apps' words, for the help page (AP2b, the owner's call of
 * 2026-11-12): `TEACHER_SEES`, its focus status naming Android's lock beside Screen Time as
 * Android's own list words it ("Bali's lock off", `ConsentList`,
 * android/outbox/src/main/kotlin/com/bali/outbox/Consent.kt). support.test.ts holds it to both.
 */
export const TEACHER_SEES_BOTH_APPS = TEACHER_SEES.map((line) =>
  line === FOCUS_STATUS ? `${line} (or Bali's lock off)` : line,
);

export const TEACHER_NEVER_SEES = [
  "Your screen, your apps, or what's in them",
  'Your messages or where you are',
  'Which answer is yours',
];
