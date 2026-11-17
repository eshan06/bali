'use client';

import type { BlockDetail, BlockListResponse } from '@bali/shared';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { LockButton } from '@/components/button';
import { OOPS, WAIT_LINE } from '@/components/classes';
import { useCount } from '@/components/count';
import { Field } from '@/components/field';
import { TryAgain } from '@/components/try-again';
import { blockIdOf, loadProblem, type RegisterAnswer, registerBlock } from '@/lib/blocks';
import { NOT_A_BLOCK_ID } from '@/lib/errors';
import { useApi } from '@/lib/use-api';

/** What the section last said under the field. */
type Said = Exclude<RegisterAnswer, { kind: 'registered' }> | { kind: 'done'; message: string };

const registeredOn = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Your block (Main, HomeIdle, ClassFlows' "Your block, none yet"; its other moments on HomeMoments,
 * drawn first): its title, Your blocks once there are two, its line, then the blocks registered to
 * the teacher between hairlines, each code in the code face with the day it was registered, and
 * Register another block, which opens the field under them, focus in it, and closes it again; with
 * none, "No block registered yet." and the field open. The field takes the code written on a block,
 * checked as the phone reads a tag before a try is spent on it, Register block beside it; each
 * refusal is said under the help, with the way on, and so is a block registered, which joins the
 * list. An answer that never came is sent again as it was by Try again, which is safe: one's own
 * tag registers once. The list that didn't load is read again by its own Try again, its line said
 * until the answer, focus then on the title (HomeRetryStates, drawn first).
 */
export function Blocks() {
  const api = useApi();
  const count = useCount();
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  // A send under way: a second Enter before the page redraws sends nothing.
  const sending = useRef(false);
  // Register another block pressed open: focus goes into the field once it shows.
  const opened = useRef(false);
  const [blocks, setBlocks] = useState<BlockDetail[] | null>(null);
  // Set when the list didn't load: what to add to the line that says so, or '' for nothing.
  const [loadError, setLoadError] = useState<string | null>(null);
  // The field open under a list, by Register another block, or after a register from none.
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  const refused = said?.kind === 'refused';

  const load = useCallback(async () => {
    try {
      setBlocks((await api.get<BlockListResponse>('/v1/blocks')).blocks);
    } catch (e) {
      setLoadError(loadProblem(e) ?? '');
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open || !opened.current) return;
    opened.current = false;
    field.current?.focus();
  }, [open]);

  /** Register another block: the field opens, focus in it, or closes, starting afresh next time. */
  function toggle() {
    if (busy) return;
    opened.current = !open;
    setOpen(!open);
    setTyped('');
    setSaid(null);
  }

  // Register block's own press; Enter in the field presses it too, the form's submit sending nothing.
  async function register() {
    if (sending.current || blocks === null) return;
    const tagId = blockIdOf(typed);
    if (!tagId) {
      setSaid({ kind: 'refused', message: NOT_A_BLOCK_ID });
      field.current?.focus();
      return;
    }
    sending.current = true;
    setBusy(true);
    setSaid(null);
    const answer = await registerBlock(api, tagId, blocks);
    sending.current = false;
    setBusy(false);
    if (answer.kind !== 'registered') {
      setSaid(answer);
      if (answer.kind === 'refused') field.current?.focus();
      return;
    }
    count?.('portal_block_registered');
    const { block, already } = answer;
    if (!already) setBlocks([...blocks, block]);
    // The field stays where it was said, under the list it joined.
    setOpen(true);
    setTyped('');
    setSaid({
      kind: 'done',
      message: already
        ? `${block.tagId} was already registered to you.`
        : `${block.tagId} is registered to you.`,
    });
  }

  return (
    <section aria-labelledby={`${id}-title`} className="flex min-w-0 flex-col gap-4">
      <h2 id={`${id}-title`} className="text-section-title">
        {blocks && blocks.length > 1 ? 'Your blocks' : 'Your block'}
      </h2>
      <p className="text-text-secondary">
        Students tap your block with their phone to join your session.
      </p>

      {blocks === null ? (
        loadError !== null ? (
          <div className={OOPS}>
            <TryAgain onRetry={load} then={[`${id}-title`]}>
              <p role="alert">
                Couldn&apos;t load your blocks.{loadError ? ` ${loadError}` : null}
              </p>
            </TryAgain>
          </div>
        ) : (
          <p role="status" className={WAIT_LINE}>
            Loading…
          </p>
        )
      ) : (
        <>
          {blocks.length === 0 ? (
            <p className={WAIT_LINE}>No block registered yet.</p>
          ) : (
            <>
              <ul className="flex flex-col border-t border-border-default">
                {blocks.map((b) => (
                  <li
                    key={b.id}
                    className="flex flex-wrap items-baseline gap-x-5 gap-y-2 border-b border-border-default py-3"
                  >
                    <span translate="no" className="font-mono font-medium break-all">
                      {b.tagId}
                    </span>
                    <span className="text-countdown-sub text-text-tertiary">
                      Registered {registeredOn(b.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
              <div>
                <LockButton
                  variant="secondary"
                  size="sm"
                  aria-expanded={open}
                  aria-controls={`${id}-form`}
                  aria-disabled={busy}
                  onClick={toggle}
                >
                  Register another block
                </LockButton>
              </div>
            </>
          )}

          {blocks.length === 0 || open ? (
            <form id={`${id}-form`} onSubmit={(e) => e.preventDefault()}>
              <Field
                ref={field}
                id={`${id}-code`}
                label="Block code"
                help="10 letters and digits, written on your block."
                mono
                name="block-code"
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value);
                  setSaid(null);
                }}
                readOnly={busy}
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                translate="no"
                aria-invalid={refused}
                aria-describedby={said ? `${id}-said` : undefined}
                trailing={
                  // One button throughout, so focus stays on it whatever it comes to say.
                  <TryAgain
                    type="submit"
                    variant="primary"
                    size="md"
                    onRetry={register}
                    held={busy}
                    then={[]}
                    send={{
                      words: 'Register block',
                      sending: 'Registering…',
                      failed: said?.kind === 'failed',
                    }}
                  />
                }
              />
              {said ? (
                <p
                  id={`${id}-said`}
                  role={said.kind === 'done' ? 'status' : 'alert'}
                  className="mt-2 break-words"
                >
                  {said.message}
                </p>
              ) : null}
            </form>
          ) : null}
        </>
      )}
    </section>
  );
}
