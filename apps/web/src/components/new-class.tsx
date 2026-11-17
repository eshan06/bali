'use client';

import type { ClassDetail } from '@bali/shared';
import { Check, Copy } from 'lucide-react';
import Link from 'next/link';
import { type Ref, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';

import { CLASS_NAME_MAX, type CreateAnswer, createClass } from '@/lib/classes';
import { CANT_COPY } from '@/lib/errors';
import { newEventId } from '@/lib/event-id';
import { useApi } from '@/lib/use-api';

import { LockButton, lockButton } from './button';
import { CODE_WELL, DIALOG_LOCK } from './card';
import { useCount } from './count';
import { Field } from './field';
import { useCopy } from './join-code';
import { TryAgain } from './try-again';

/** How the page opens the dialog. */
export interface NewClassHandle {
  open: () => void;
}

/** The id a class's row in Your classes takes, so focus can go to a class just made. */
export const cardId = (classId: string) => `class-${classId}`;

/**
 * New class (ClassFlows), the lock-only look's dialog: the class's name and Create class, held until
 * a name is typed; Creating… holds the name, Cancel and Escape until Bali answers; a failure is said
 * right under the help, and Try again sends the name again, but after a final refusal, which no
 * resend can change (HomeMoments, drawn first): one button throughout (`TryAgain`'s `send`), so focus
 * stays on it whatever it comes to say. One create, one `eventId` (2026-10-23): minted at its first
 * press and sent again by every press while no answer has come, Try again's and one after the name
 * was changed alike, so a create that landed unanswered is answered with its class, never a second;
 * a class made, a refusal or the dialog closed lets it go. Every answer has the page read the list
 * again (`onAnswer`), so a class made shows there whatever the dialog came to say. A class made
 * turns the dialog into ClassFlows' "A class just made", focus on its title, the class's name: its
 * join code in its well, Copy code (Copied, or how to copy it by hand) and Open the class. Closed by
 * Escape, focus goes to the class's row once the list holds it, else back to what opened the dialog.
 */
export function NewClass({ ref, onAnswer }: { ref?: Ref<NewClassHandle>; onAnswer: () => void }) {
  const api = useApi();
  const count = useCount();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  // A create under way: a second press before the page redraws sends nothing.
  const sending = useRef(false);
  // This create's eventId, while no answer to it has come: what the next press sends again.
  const unanswered = useRef<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Exclude<CreateAnswer, { kind: 'created' }> | null>(null);
  const [made, setMade] = useState<ClassDetail | null>(null);
  const { copy, copyCode, forget } = useCopy();

  useImperativeHandle(
    ref,
    () => ({
      open() {
        dialog.current?.showModal();
        field.current?.focus();
      },
    }),
    [],
  );

  // A class made: its title takes focus, so a screen reader says it, then its code.
  useEffect(() => {
    if (made) title.current?.focus();
  }, [made]);

  // Create class's press, and Try again's; Enter in the field presses it, the form's submit
  // sending nothing.
  async function create() {
    const trimmed = name.trim();
    if (sending.current || !trimmed) return;
    sending.current = true;
    setBusy(true);
    setFailed(null);
    unanswered.current ??= newEventId();
    const answer = await createClass(api, { name: trimmed, eventId: unanswered.current });
    // Kept while the create may have landed with no answer to say so: Try again resends it.
    if (answer.kind !== 'failed') unanswered.current = null;
    sending.current = false;
    setBusy(false);
    onAnswer();
    // Said in the dialog, opened again if the browser closed it meanwhile (a second Escape).
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    if (answer.kind === 'created') {
      count?.('portal_class_created');
      setMade(answer.klass);
    } else setFailed(answer);
  }

  /** Closed: by Cancel or Escape. The next New class starts afresh, under a new eventId. */
  function closed() {
    if (sending.current) return;
    if (made) document.getElementById(cardId(made.id))?.focus();
    setName('');
    setFailed(null);
    setMade(null);
    unanswered.current = null;
    forget();
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      aria-describedby={made ? `${id}-line` : undefined}
      onCancel={(e) => {
        // Escape holds while a class is being made, as Cancel does.
        if (sending.current) e.preventDefault();
      }}
      onClose={closed}
      className={DIALOG_LOCK}
    >
      {made ? (
        <>
          <h2
            ref={title}
            id={`${id}-title`}
            tabIndex={-1}
            className="text-panel-title wrap-anywhere"
          >
            {made.name}
          </h2>
          <p id={`${id}-line`} className="text-text-secondary">
            Put this join code on the board. Students join with it in the Bali app.
          </p>
          <span translate="no" className={`${CODE_WELL} self-start`}>
            {made.joinCode}
          </span>
          {copy === 'failed' ? <p role="alert">{CANT_COPY}</p> : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <LockButton variant="secondary" onClick={() => void copyCode(made.joinCode)}>
              {copy === 'copied' ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <Copy size={16} aria-hidden="true" />
              )}
              {copy === 'copied' ? 'Copied' : 'Copy code'}
            </LockButton>
            {/* The button's own word changes too quietly for a screen reader: said here as well. */}
            <span role="status" className="sr-only">
              {copy === 'copied' ? 'Copied' : null}
            </span>
            <Link href={`/classes/${made.id}`} className={lockButton('primary')}>
              Open the class
            </Link>
          </div>
        </>
      ) : (
        <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-4">
          <h2 id={`${id}-title`} className="text-panel-title">
            New class
          </h2>
          <div>
            <Field
              ref={field}
              id={`${id}-name`}
              label="Class name"
              help="Your students see this name in the Bali app."
              name="class-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setFailed(null);
              }}
              readOnly={busy}
              maxLength={CLASS_NAME_MAX}
              autoComplete="off"
              aria-describedby={failed ? `${id}-said` : undefined}
            />
            {failed ? (
              <p id={`${id}-said`} role="alert" className="mt-2 text-pretty break-words">
                {failed.message}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <LockButton
              variant="secondary"
              aria-disabled={busy}
              onClick={() => {
                if (!sending.current) dialog.current?.close();
              }}
            >
              Cancel
            </LockButton>
            {/* One button throughout, so focus stays on it whatever it comes to say. */}
            <TryAgain
              type="submit"
              variant="primary"
              size="md"
              onRetry={create}
              held={busy}
              blocked={!name.trim()}
              then={[`${id}-title`]}
              send={{
                words: 'Create class',
                sending: 'Creating…',
                failed: failed?.kind === 'failed',
              }}
            />
          </div>
        </form>
      )}
    </dialog>
  );
}
