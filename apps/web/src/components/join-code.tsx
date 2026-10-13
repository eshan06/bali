'use client';

import type { ClassDetail } from '@bali/shared';
import { Check, Copy } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/button';
import { CANT_COPY, NEW_CODE_MADE } from '@/lib/errors';
import { codeMoved, copyText, regenerateCode } from '@/lib/session-controls';
import { useApi } from '@/lib/use-api';

/** What New code last said: a failure in its dialog, or the new code under the code. */
type Said = { kind: 'failed' | 'made'; message: string };

/** How long Copy reads Copied before it reads Copy again (CopyStates: "for a few seconds"). */
const COPIED_FOR = 2000;

/** The code on its card (ClassBefore): 40/48 on its grey chip, centred for its tracking. */
const CODE =
  'inline-block rounded-md border border-border-default bg-surface-sunken py-4 pr-6.5 pl-[calc(26px+0.16em)] font-mono text-code-card text-text-primary select-all';

/**
 * New code's dialog (ClassNewCode): 460 px, 120 px from the top, over the page's warm backdrop. A
 * native modal, so the page behind it is inert and Escape closes it; shown only while open.
 */
const DIALOG =
  'm-auto mt-30 w-115 max-w-[calc(100%-48px)] flex-col gap-4.5 rounded-md bg-surface-card p-6 text-text-primary shadow-3 backdrop:bg-scrim open:flex';

/**
 * The class's join code. Before a session, on its own card (`card`; ClassBefore, CopyStates): the
 * code on its chip, what students do with it, then Copy and New code; Copy says Copied for a few
 * seconds, or, where the browser refuses it, says so under the buttons, the code still there to
 * select. While a session runs, two items of the page's header, as before v2's look until PV7 draws
 * it: the code with New code, `large` setting it in `code-lg` for Present. New code opens a dialog
 * in both (ClassNewCode), since the old code stops working the moment the new one is made; then
 * the new code takes its place and is said under it. Each failure is said in the dialog, and Try
 * again sends it again. `onClass` gets the class as the answer gives it, its new code included.
 * Focus goes back to New code whenever the dialog closes.
 */
export function JoinCode({
  classId,
  code,
  onClass,
  card = false,
  large = false,
}: {
  classId: string;
  code: string;
  onClass: (klass: ClassDetail) => void;
  card?: boolean;
  large?: boolean;
}) {
  const api = useApi();
  const id = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  // A send under way: a second press before the page redraws sends nothing.
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  // Copy's answer: Copied for a few seconds, or the browser refused it.
  const [copy, setCopy] = useState<'copied' | 'failed' | null>(null);
  const copied = useRef<number | undefined>(undefined);

  // A Copied still showing when the page goes is forgotten with it.
  useEffect(() => () => window.clearTimeout(copied.current), []);

  function open() {
    if (sending.current) return;
    setSaid(null);
    dialog.current?.showModal();
    // Cancel first: nothing is lost until Make new code is pressed.
    cancel.current?.focus();
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
      // Said in the dialog, opened again if the browser closed it meanwhile (a second Escape).
      if (dialog.current && !dialog.current.open) dialog.current.showModal();
      return;
    }
    dialog.current?.close();
    // Copy's answer was about the old code.
    window.clearTimeout(copied.current);
    setCopy(null);
    setSaid({ kind: 'made', message: NEW_CODE_MADE });
    onClass(answer.klass);
  }

  /**
   * The dialog closed: Cancel, Escape, or a code made. After a failed mint the class is read once
   * more (santa's round 1): a mint can commit after the read that followed its lost answer, and its
   * code shows then, said. A made code stays said; focus goes back to New code.
   */
  function closed() {
    if (said?.kind === 'failed') {
      void codeMoved(api, classId, code).then((klass) => {
        if (!klass) return;
        setSaid({ kind: 'made', message: NEW_CODE_MADE });
        onClass(klass);
      });
    }
    setSaid((cur) => (cur?.kind === 'made' ? cur : null));
    toggle.current?.focus();
  }

  async function copyCode() {
    window.clearTimeout(copied.current);
    if (await copyText(code)) {
      setCopy('copied');
      copied.current = window.setTimeout(() => setCopy(null), COPIED_FOR);
    } else setCopy('failed');
  }

  const newCode = (
    <Button
      ref={toggle}
      variant="secondary"
      size={card ? 'sm' : 'md'}
      aria-haspopup="dialog"
      onClick={open}
    >
      New code
    </Button>
  );
  // Mounted while empty, so a screen reader hears the new code said when it lands.
  const made = said?.kind === 'made' ? said.message : null;
  const ask = (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-ask`}
      aria-describedby={`${id}-line`}
      onCancel={(e) => {
        // Escape holds while a code is being made, as Cancel does.
        if (sending.current) e.preventDefault();
      }}
      onClose={closed}
      className={DIALOG}
    >
      <h2 id={`${id}-ask`} className="text-dialog-title">
        Make a new code?
      </h2>
      <p id={`${id}-line`} className="-mt-2 text-body text-text-secondary">
        <span translate="no" className="font-mono font-medium">
          {code}
        </span>{' '}
        stops working right away.
      </p>
      {said?.kind === 'failed' ? (
        <p role="alert" className="-mt-2 text-body">
          {said.message}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2.5">
        <Button
          ref={cancel}
          variant="secondary"
          onClick={() => {
            if (!sending.current) dialog.current?.close();
          }}
          aria-disabled={busy}
        >
          Cancel
        </Button>
        <Button onClick={() => void make()} aria-disabled={busy} aria-busy={busy}>
          {busy ? 'Making…' : said?.kind === 'failed' ? 'Try again' : 'Make new code'}
        </Button>
      </div>
    </dialog>
  );

  if (card) {
    return (
      <>
        <span translate="no" className={CODE}>
          {code}
        </span>
        <p role="status" className="mt-3 text-body empty:mt-0">
          {made}
        </p>
        <p className="text-caption text-text-tertiary">
          Students type it in the Bali app to join this class.
        </p>
        <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
          <Button variant="secondary" size="sm" onClick={() => void copyCode()}>
            {copy === 'copied' ? (
              <Check size={16} aria-hidden="true" />
            ) : (
              <Copy size={16} aria-hidden="true" />
            )}
            {copy === 'copied' ? 'Copied' : 'Copy'}
          </Button>
          {newCode}
          {/* The button's own word changes too quietly for a screen reader: said here as well. */}
          <span role="status" className="sr-only">
            {copy === 'copied' ? 'Copied' : null}
          </span>
        </div>
        {copy === 'failed' ? (
          <p role="alert" className="mt-3 text-body">
            {CANT_COPY}
          </p>
        ) : null}
        {ask}
      </>
    );
  }

  return (
    // Two of the header's items while a session runs (PV7 redraws it): the code with New code, a
    // made code said under it; and the dialog, which takes no place in the row.
    <>
      {/* At the header's end, the code keeps its place when a made code's line grows the column. */}
      <div className="flex flex-col items-start sm:items-end">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="flex items-baseline gap-2">
            <span className="text-caption text-text-tertiary">Join code</span>
            <span translate="no" className={`font-mono ${large ? 'text-code-lg' : 'text-code'}`}>
              {code}
            </span>
          </p>
          {newCode}
        </div>
        <p role="status" className="mt-2 text-body empty:mt-0 sm:text-right">
          {made}
        </p>
      </div>
      {ask}
    </>
  );
}
