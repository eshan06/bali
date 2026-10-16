'use client';

import type { ClassDetail } from '@bali/shared';
import { Check, CircleCheck, Copy } from 'lucide-react';
import { type Ref, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';

import { CLASS_NAME_MAX, type CreateAnswer, createClass } from '@/lib/classes';
import { CANT_COPY } from '@/lib/errors';
import { useApi } from '@/lib/use-api';

import { Button } from './button';
import { Field } from './field';
import { CODE, DIALOG, useCopy } from './join-code';

/** How the page opens the dialog. */
export interface NewClassHandle {
  open: () => void;
}

/** The id a class's card on the list takes, so focus can go to a class just made. */
export const cardId = (classId: string) => `class-${classId}`;

/**
 * New class (ClassesNew), v2's dialog: the class's name and Create class, held until a name is
 * typed; Creating… holds the name, Cancel and Escape until Bali answers; a failure is said right
 * under the help, and Try again sends the name again, but after a final refusal, which no resend can
 * change (ClassesStates, drawn first). Every answer has the page read the list again (`onAnswer`):
 * the route takes no `eventId`, so a class made before its answer was lost shows there. A class made
 * turns the dialog into ClassesCreated's, focus on its title: "<name> is ready", its join code, Copy
 * code (CopyStates) and Done. Closed after Done, focus goes to the class's card once the list holds
 * it, else back to what opened the dialog.
 */
export function NewClass({ ref, onAnswer }: { ref?: Ref<NewClassHandle>; onAnswer: () => void }) {
  const api = useApi();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  // A create under way: a second press before the page redraws sends nothing.
  const sending = useRef(false);
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

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (sending.current || !trimmed) return;
    sending.current = true;
    setBusy(true);
    setFailed(null);
    const answer = await createClass(api, trimmed);
    sending.current = false;
    setBusy(false);
    onAnswer();
    // Said in the dialog, opened again if the browser closed it meanwhile (a second Escape).
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    if (answer.kind === 'created') setMade(answer.klass);
    else setFailed(answer);
  }

  /** Closed: by Cancel, Escape or Done. The next New class starts afresh. */
  function closed() {
    if (sending.current) return;
    if (made) document.getElementById(cardId(made.id))?.focus();
    setName('');
    setFailed(null);
    setMade(null);
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
      className={made ? `${DIALOG} items-start` : DIALOG}
    >
      {made ? (
        <>
          {/* The board's own style: its 40 px check at a 1.5 stroke (PV4b). */}
          <CircleCheck size={40} aria-hidden="true" className="stroke-[1.5] text-ready" />
          <h2
            ref={title}
            id={`${id}-title`}
            tabIndex={-1}
            className="text-dialog-title wrap-anywhere"
          >
            {made.name} is ready
          </h2>
          <p id={`${id}-line`} className="-mt-2 text-body text-text-secondary">
            Put this join code on the board. Students join with it in the Bali app.
          </p>
          <span translate="no" className={CODE}>
            {made.joinCode}
          </span>
          <div className="flex flex-wrap items-center gap-2.5">
            <Button variant="secondary" onClick={() => void copyCode(made.joinCode)}>
              {copy === 'copied' ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <Copy size={16} aria-hidden="true" />
              )}
              {copy === 'copied' ? 'Copied' : 'Copy code'}
            </Button>
            {/* The button's own word changes too quietly for a screen reader: said here as well. */}
            <span role="status" className="sr-only">
              {copy === 'copied' ? 'Copied' : null}
            </span>
          </div>
          {copy === 'failed' ? (
            <p role="alert" className="text-body">
              {CANT_COPY}
            </p>
          ) : null}
          <Button onClick={() => dialog.current?.close()} className="w-full">
            Done
          </Button>
        </>
      ) : (
        <form onSubmit={(e) => void create(e)} className="flex flex-col gap-4.5">
          <h2 id={`${id}-title`} className="text-dialog-title">
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
              <p id={`${id}-said`} role="alert" className="text-body text-pretty break-words">
                {failed.message}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2.5">
            <Button
              variant="secondary"
              aria-disabled={busy}
              onClick={() => {
                if (!sending.current) dialog.current?.close();
              }}
            >
              Cancel
            </Button>
            {/* One button throughout, so focus stays on it whatever it comes to say. */}
            <Button type="submit" aria-disabled={busy || !name.trim()} aria-busy={busy}>
              {busy ? 'Creating…' : failed?.kind === 'failed' ? 'Try again' : 'Create class'}
            </Button>
          </div>
        </form>
      )}
    </dialog>
  );
}
