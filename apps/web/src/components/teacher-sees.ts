/*
 * What a teacher sees of a student in their class, and never sees: the student app's own two lists
 * (`ConsentCard.sees` and `ConsentCard.neverSees`, ios/Bali/UI/JoinView.swift), word for word, the
 * answers lines last (L8a). One copy on the web, for the help page (P4) and the privacy policy's
 * section 2 (C2-text, #130), so the three never say different things; support.test.ts holds these
 * to the app's.
 */

export const TEACHER_SEES = [
  'Your focus status: focused, unlocked, or Screen Time off',
  'If Bali stops hearing from your phone during class, and when it last did',
  'When you tap in, and when class ends for you',
  'When you unlock, and the reason if you share one',
  'If you leave this class',
  "Your answers to questions, counted only in the class's totals",
];

export const TEACHER_NEVER_SEES = [
  "Your screen, your apps, or what's in them",
  'Your messages or where you are',
  'Which answer is yours, or whether you answered',
];
