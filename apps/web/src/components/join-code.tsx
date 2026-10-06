'use client';

import type { ClassDetail } from '@bali/shared';
import { useId, useRef, useState } from 'react';

import { Button } from '@/components/button';
import { CARD } from '@/components/card';
import { NEW_CODE_MADE } from '@/lib/errors';
import { codeMoved, regenerateCode } from '@/lib/session-controls';
import { useApi } from '@/lib/use-api';

/** What the control last said: a failure in the confirm, or the new code beside the code. */
type Said = { kind: 'failed' | 'made'; message: string };

/**
 * The class's join code with its New code control (P11; in Soft premium, D2f): the code in the
 * code style, and New code opening a confirm under it, since the old code stops working the moment
 * the new one is made; then the new code in its place, said beside it. Each failure is said in the
 * confirm, and Try again sends it again. `onClass` gets the class as the answer gives it, its new
 * code included. Focus goes back to New code whenever the confirm closes.
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
  const toggle = useRef<HTMLButtonElement>(null);
  const group = useRef<HTMLDivElement>(null);
  // A send under way: a second press before the page redraws sends nothing.
  const sending = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);

  function close() {
    // Focus inside the confirm would fall to the page as it goes (#247's review): back to New code.
    if (group.current?.contains(document.activeElement)) toggle.current?.focus();
    setConfirming(false);
  }

  async function make() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setSaid(null);
    const answer = await regenerateCode(api, classId, code);
    sending.current = false;
    setBusy(false);
    if (answer.kind === 'failed') {
      setSaid(answer);
      return;
    }
    close();
    setSaid({ kind: 'made', message: NEW_CODE_MADE });
    onClass(answer.klass);
  }

  /**
   * Close the confirm unmade. After a failed mint the class is read once more (santa's round 1): a
   * mint can commit after the read that followed its lost answer, and its code shows then, said.
   */
  function dismiss() {
    if (said?.kind === 'failed') {
      void codeMoved(api, classId, code).then((klass) => {
        if (!klass) return;
        setSaid({ kind: 'made', message: NEW_CODE_MADE });
        onClass(klass);
      });
    }
    setSaid(null);
    close();
  }

  return (
    // Beside the class's name, the code stays put as the confirm opens under it.
    <div className="flex max-w-md flex-col items-start sm:items-end">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="flex items-baseline gap-2">
          <span className="text-caption text-text-tertiary">Join code</span>
          <span translate="no" className="font-mono text-code">
            {code}
          </span>
        </p>
        {/* A disclosure: it stays where it is while the confirm under it is open. */}
        <Button
          ref={toggle}
          variant="secondary"
          aria-expanded={confirming}
          onClick={() => {
            if (sending.current) return;
            if (confirming) return dismiss();
            setConfirming(true);
            setSaid(null);
          }}
        >
          New code
        </Button>
      </div>
      {confirming ? (
        <div ref={group} role="group" aria-labelledby={`${id}-ask`} className={`mt-3 ${CARD}`}>
          <p id={`${id}-ask`} className="text-body">
            Make a new code?{' '}
            <span translate="no" className="font-mono text-code">
              {code}
            </span>{' '}
            stops working right away.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => void make()} aria-disabled={busy} aria-busy={busy}>
              {busy ? 'Making…' : said?.kind === 'failed' ? 'Try again' : 'Make new code'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (!sending.current) dismiss();
              }}
              aria-disabled={busy}
            >
              Cancel
            </Button>
          </div>
          {said?.kind === 'failed' ? (
            <p role="alert" className="mt-4 text-body">
              {said.message}
            </p>
          ) : null}
        </div>
      ) : null}
      {/* Mounted while empty, so a screen reader hears the new code said when it lands. */}
      <p role="status" className="mt-2 text-body empty:mt-0 sm:text-right">
        {said?.kind === 'made' ? said.message : null}
      </p>
    </div>
  );
}
