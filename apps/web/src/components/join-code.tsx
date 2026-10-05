'use client';

import type { ClassDetail } from '@bali/shared';
import { useId, useRef, useState } from 'react';

import { NEW_CODE_MADE } from '@/lib/errors';
import { regenerateCode } from '@/lib/session-controls';
import { useApi } from '@/lib/use-api';

/** What the control last said under the code. */
type Said = { kind: 'failed' | 'made'; message: string };

// The class page's own secondary button (its `SECONDARY`); the focus ring is globals.css's.
const SECONDARY =
  'rounded-lg border border-slate-300 px-3 py-1.5 text-sm transition-colors hover:bg-slate-100 disabled:opacity-50 motion-reduce:transition-none dark:border-slate-700 dark:hover:bg-slate-900';

/**
 * The class's join code with its New code control (P11): a confirm step first, since the old code
 * stops working the moment the new one is made; then the new code in its place, said beside it.
 * Each failure is said where it happened, and Try again sends it again. `onClass` gets the class
 * as the answer gives it, its new code included.
 */
export function JoinCode({
  classId,
  code,
  onClass,
}: {
  classId: string;
  code: string;
  onClass: (klass: ClassDetail) => void;
}) {
  const api = useApi();
  const id = useId();
  // A send under way: a second press before the page redraws sends nothing.
  const sending = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);

  async function make() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setSaid(null);
    const answer = await regenerateCode(api, classId);
    sending.current = false;
    setBusy(false);
    if (answer.kind === 'failed') {
      setSaid(answer);
      return;
    }
    setConfirming(false);
    setSaid({ kind: 'made', message: NEW_CODE_MADE });
    onClass(answer.klass);
  }

  return (
    <div className="text-sm">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500 dark:text-slate-400">
        <span>
          Join code:{' '}
          <span translate="no" className="font-mono font-medium text-slate-900 dark:text-slate-100">
            {code}
          </span>
        </span>
        {confirming ? null : (
          <button
            type="button"
            onClick={() => {
              setConfirming(true);
              setSaid(null);
            }}
            className={`${SECONDARY} px-2 py-1 text-xs text-slate-900 dark:text-slate-100`}
          >
            New code
          </button>
        )}
      </p>
      {confirming ? (
        <div
          role="group"
          aria-labelledby={`${id}-ask`}
          className="mt-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800"
        >
          <p id={`${id}-ask`}>
            Make a new code?{' '}
            <span translate="no" className="font-mono font-medium">
              {code}
            </span>{' '}
            stops working right away.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void make()}
              aria-disabled={busy}
              aria-busy={busy}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-emerald-800 aria-disabled:opacity-60 motion-reduce:transition-none"
            >
              {busy ? 'Making…' : said?.kind === 'failed' ? 'Try again' : 'Make new code'}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setSaid(null);
              }}
              disabled={busy}
              className={SECONDARY}
            >
              Cancel
            </button>
          </div>
          {said?.kind === 'failed' ? (
            <p role="alert" className="mt-3 font-medium">
              {said.message}
            </p>
          ) : null}
        </div>
      ) : said?.kind === 'made' ? (
        <p role="status" className="mt-1">
          {said.message}
        </p>
      ) : null}
    </div>
  );
}
