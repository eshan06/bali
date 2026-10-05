'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';

import {
  type Attempt,
  attemptFor,
  CODE_REFUSALS,
  codeProblem,
  type RedeemAnswer,
  redeemInvite,
  typedCode,
} from '@/lib/invite';
import { useApi } from '@/lib/use-api';

/**
 * The invite-code screen (T2): what a signed-in account that isn't a teacher yet sees in place of
 * the classes view. The code is typed or pasted in any form and shown in fives, as the owner's
 * command printed it, and checked as the redeem checks it before a try is spent on it. Each
 * refusal is said where it happened, with the way on; an answer that never came is sent again
 * under the same `eventId`. `onTeacher` once the account teaches: the page reads it again.
 */
export function InviteCode({ onTeacher }: { onTeacher: () => void }) {
  const api = useApi();
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  // The last attempt whose answer never came: sent again, unchanged, by Try again.
  const unanswered = useRef<Attempt | null>(null);
  // A send under way: a second Enter before the page redraws sends nothing.
  const sending = useRef(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Exclude<RedeemAnswer, { kind: 'teacher' }> | null>(null);
  const codeRefused = said?.kind === 'refused' && CODE_REFUSALS.has(said.reason);
  const teaches = said?.kind === 'refused' && said.reason === 'already_teacher';

  // The caret back after the symbols it followed, once the grouped code is in the field.
  useLayoutEffect(() => {
    if (caret.current === null) return;
    field.current?.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { value, selectionStart } = e.target;
    const { inputType } = e.nativeEvent as InputEvent;
    const next = typedCode(code, value, selectionStart ?? value.length, inputType);
    setSaid(null);
    if (next.value !== code) {
      caret.current = next.caret;
      setCode(next.value);
    } else {
      // A space or dash typed changes nothing, so no render puts the caret back: React's own
      // restore of the field moves it to the end, and this puts it back after that.
      queueMicrotask(() => e.target.setSelectionRange(next.caret, next.caret));
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (sending.current) return;
    if (teaches) return onTeacher();
    const problem = codeProblem(code);
    if (problem) {
      setSaid({ kind: 'refused', message: problem, reason: 'invite_code_invalid' });
      field.current?.focus();
      return;
    }
    const attempt = attemptFor(unanswered.current, code);
    sending.current = true;
    setBusy(true);
    setSaid(null);
    const answer = await redeemInvite(api, attempt);
    unanswered.current = answer.kind === 'failed' ? attempt : null;
    if (answer.kind === 'teacher') return onTeacher();
    sending.current = false;
    setBusy(false);
    setSaid(answer);
    if (answer.kind === 'refused' && CODE_REFUSALS.has(answer.reason)) field.current?.focus();
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Enter your invite code</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        You need it once, to set up this account for teaching.
      </p>

      <form onSubmit={(e) => void onSubmit(e)} className="mt-8 max-w-md">
        <label htmlFor={`${id}-code`} className="block text-sm font-medium">
          Invite code
        </label>
        <input
          ref={field}
          id={`${id}-code`}
          name="invite-code"
          value={code}
          onChange={onChange}
          readOnly={busy}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          translate="no"
          aria-invalid={codeRefused}
          aria-describedby={`${id}-help${said ? ` ${id}-said` : ''}`}
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-mono text-base tracking-wide aria-[invalid=true]:border-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:aria-[invalid=true]:border-slate-100"
        />
        <p id={`${id}-help`} className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          25 letters and digits. Paste it, or type it with or without dashes.
        </p>
        {said ? (
          <p id={`${id}-said`} role="alert" className="mt-4 text-sm font-medium">
            {said.message}
          </p>
        ) : null}

        {/* One button throughout, so focus stays on it whatever it comes to say; the brand green. */}
        <button
          type={teaches ? 'button' : 'submit'}
          onClick={teaches ? onTeacher : undefined}
          aria-disabled={busy}
          className="mt-6 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-800 aria-disabled:opacity-60 motion-reduce:transition-none"
        >
          {busy
            ? 'Redeeming…'
            : teaches
              ? 'Go to your classes'
              : said?.kind === 'failed'
                ? 'Try again'
                : 'Redeem code'}
        </button>
      </form>
    </>
  );
}
