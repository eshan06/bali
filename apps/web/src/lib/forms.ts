/** Shared plumbing for the two public marketing forms (the landing page's
 *  "Book a demo" and /contact). Both compose a prefilled email rather than
 *  POSTing — see the note in app/contact/ContactForm.tsx. */

/** Where every public form delivers. One place to change; override per
 *  environment with NEXT_PUBLIC_FORM_EMAIL. */
export const FORM_EMAIL = process.env.NEXT_PUBLIC_FORM_EMAIL ?? 'eshan.shah@vanderbilt.edu';

/** How many times one browser may submit a given form.
 *
 *  This is a courtesy stop, not a security control: it lives in localStorage,
 *  so clearing site data, a private window or another browser resets it. That
 *  is acceptable here precisely because there is no server endpoint to abuse —
 *  the worst a determined person can do is open their own mail client again.
 *  What it does prevent is the common case: someone double-submitting, or
 *  refilling the form five times because the mail client did not surface. */
export const MAX_SUBMISSIONS = 3;

/** Storage is wrapped because it throws outright in some contexts (Safari
 *  private mode, embedded webviews, browsers set to block site data). A form
 *  that cannot count must still be usable, so every failure reads as zero. */
export function submissionCount(key: string): number {
  try {
    const n = Number(window.localStorage.getItem(`bali.form.${key}`));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Returns the new count. Best-effort: if storage throws, the cap simply
 *  never engages rather than blocking a legitimate sender. */
export function recordSubmission(key: string): number {
  const next = submissionCount(key) + 1;
  try {
    window.localStorage.setItem(`bali.form.${key}`, String(next));
  } catch {
    /* storage unavailable — leave the sender unblocked */
  }
  return next;
}
