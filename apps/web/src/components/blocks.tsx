'use client';

import type { BlockDetail, BlockListResponse } from '@bali/shared';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { LockButton } from '@/components/button';
import { DIALOG_LOCK } from '@/components/card';
import { OOPS, WAIT_LINE } from '@/components/classes';
import { useCount } from '@/components/count';
import { Field } from '@/components/field';
import { land, TryAgain } from '@/components/try-again';
import {
  blockIdOf,
  blocksNow,
  loadProblem,
  type RegisterAnswer,
  registerBlock,
  type RemoveAnswer,
  type RemoveAttempt,
  removeAttemptFor,
  removeBlock,
} from '@/lib/blocks';
import { NOT_A_BLOCK_ID } from '@/lib/errors';
import { useApi } from '@/lib/use-api';

/** What the section last said under the field: a block registered names its code. */
type Said =
  | Exclude<RegisterAnswer, { kind: 'registered' }>
  | { kind: 'done'; message: string; tagId: string };

/** What the confirm last said: why a removal didn't go through. */
type Unremoved = Exclude<RemoveAnswer, { kind: 'removed' }>;

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
 *
 * Each block's row ends on Remove (LO11; ClassFlows' "Remove a lost block", its in-between states
 * on RemoveBlockStates, drawn first), under the code where the row is full, as in Home's column.
 * It asks first, in a dialog naming the block, Cancel focused. Remove block sends the removal,
 * held as Removing… with Cancel, Escape and every row's Remove until Bali answers; the block then
 * leaves the list, said under it, focus on the next block's Remove, else the one before, else the
 * title. A failure is said in the dialog: an answer that never came makes the button Try again, which sends the same
 * removal again under its id, and a refusal keeps Remove block, which sends it anew. Closed on a
 * removal whose answer never came, the blocks are read again, since it may have landed.
 */
export function Blocks() {
  const api = useApi();
  const count = useCount();
  const id = useId();
  const titleId = `${id}-title`;
  const removeId = (blockId: string) => `${id}-remove-${blockId}`;
  const field = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  // A send under way: a second Enter before the page redraws sends nothing.
  const sending = useRef(false);
  // Register another block pressed open: focus goes into the field once it shows.
  const opened = useRef(false);
  // A removal under way: a second press before the page redraws sends nothing.
  const removalSent = useRef(false);
  // The removal whose answer never came: sent again, it goes under its own id.
  const unanswered = useRef<RemoveAttempt | null>(null);
  // Remove pressed: the confirm opens once its words name the block.
  const asked = useRef(false);
  // Once a removed block's row has gone, focus lands on the first of these the page has.
  const refocus = useRef<string[] | null>(null);
  const [blocks, setBlocks] = useState<BlockDetail[] | null>(null);
  // Set when the list didn't load: what to add to the line that says so, or '' for nothing.
  const [loadError, setLoadError] = useState<string | null>(null);
  // The field open under a list, by Register another block, or after a register from none.
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  // The block the confirm asks about, while it is open or its removal is on its way.
  const [asking, setAsking] = useState<BlockDetail | null>(null);
  const [removing, setRemoving] = useState(false);
  const [unremoved, setUnremoved] = useState<Unremoved | null>(null);
  // A block removed, said under the list until the section's next action.
  const [gone, setGone] = useState<string | null>(null);
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

  useEffect(() => {
    if (!asked.current || asking === null) return;
    asked.current = false;
    dialog.current?.showModal();
    // Cancel first: nothing is lost until Remove block is pressed.
    cancel.current?.focus();
  }, [asking]);

  useEffect(() => {
    const to = refocus.current;
    if (to === null) return;
    refocus.current = null;
    land(document, to);
  }, [blocks]);

  /** Focus with nowhere to be: on the page itself, or left in the confirm once it has closed. */
  function astray(): boolean {
    const now = document.activeElement;
    if (now === null || now === document.body) return true;
    return dialog.current !== null && !dialog.current.open && dialog.current.contains(now);
  }

  /** Register another block: the field opens, focus in it, or closes, starting afresh next time. */
  function toggle() {
    if (busy) return;
    opened.current = !open;
    setOpen(!open);
    setTyped('');
    setSaid(null);
    setGone(null);
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
    setGone(null);
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
    // A new block joins the list as it is now, which a removal may have changed meanwhile; one
    // listed when this was sent and gone since was removed after Bali took this, so stays gone.
    if (!already) {
      setBlocks((now) =>
        now === null || now.some((b) => b.id === block.id) ? now : [...now, block],
      );
    }
    // The field stays where it was said, under the list it joined.
    setOpen(true);
    setTyped('');
    setSaid({
      kind: 'done',
      tagId: block.tagId,
      message: already
        ? `${block.tagId} was already registered to you.`
        : `${block.tagId} is registered to you.`,
    });
  }

  /** Remove, on a block's row: its confirm opens once it names the block. */
  function ask(block: BlockDetail) {
    if (removalSent.current) return;
    setGone(null);
    setUnremoved(null);
    asked.current = true;
    setAsking(block);
  }

  /** Remove block, in the confirm: the removal sent, held as Removing… until Bali answers. */
  async function remove() {
    const block = asking;
    if (removalSent.current || block === null) return;
    const attempt = removeAttemptFor(unanswered.current, block.id);
    unanswered.current = attempt;
    removalSent.current = true;
    setRemoving(true);
    setUnremoved(null);
    const answer = await removeBlock(api, attempt);
    removalSent.current = false;
    setRemoving(false);
    if (answer.kind !== 'failed') unanswered.current = null;
    if (answer.kind !== 'removed') {
      setUnremoved(answer);
      // Said in the dialog, opened again if the browser closed it meanwhile (a second Escape).
      if (dialog.current && !dialog.current.open) dialog.current.showModal();
      return;
    }
    setAsking(null);
    dialog.current?.close();
    dropped(block);
  }

  /**
   * `block` is gone, removed here, from another tab, or found gone once its lost answer was read
   * again: its row leaves the list, said under it. Focus on its row, or with nowhere to be, moves
   * on to the next block's Remove, else the one before, else the title; never from where the
   * teacher has gone since.
   */
  function dropped(block: BlockDetail) {
    const row = document.getElementById(removeId(block.id))?.closest('li');
    const near = [row?.nextElementSibling, row?.previousElementSibling].flatMap((li) => {
      const button = li?.querySelector('button');
      return button?.id ? [button.id] : [];
    });
    const now = document.activeElement;
    if (astray() || (now !== null && row?.contains(now))) refocus.current = [...near, titleId];
    setBlocks((list) => list && list.filter((b) => b.id !== block.id));
    setGone(`${block.tagId} is no longer registered to you.`);
    // A line saying it is registered is no longer true.
    setSaid((cur) => (cur?.kind === 'done' && cur.tagId === block.tagId ? null : cur));
  }

  /**
   * The confirm closed: Cancel, Escape or a block removed, or the browser's second Escape while a
   * removal is on its way, whose answer opens it again with a failure to say. Focus goes back to
   * the block's Remove. Closed on a removal whose answer never came, the blocks are read again: it
   * may have landed, and a block gone leaves the list, said.
   */
  function closed() {
    const block = asking;
    const back = block === null ? null : document.getElementById(removeId(block.id));
    if (back) back.focus();
    else if (astray()) land(document, [titleId]);
    if (removalSent.current || block === null) return;
    const lost = unanswered.current?.blockId === block.id;
    setAsking(null);
    setUnremoved(null);
    if (!lost) return;
    void blocksNow(api).then((now) => {
      if (now !== null && !now.some((b) => b.id === block.id)) dropped(block);
    });
  }

  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-4">
      <h2 id={titleId} className="text-section-title">
        {blocks && blocks.length > 1 ? 'Your blocks' : 'Your block'}
      </h2>
      <p className="text-text-secondary">
        Students tap your block with their phone to join your session.
      </p>

      {blocks === null ? (
        loadError !== null ? (
          <div className={OOPS}>
            <TryAgain look="lock" onRetry={load} then={[titleId]}>
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
          <div>
            {blocks.length === 0 ? (
              <p className={WAIT_LINE}>No block registered yet.</p>
            ) : (
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
                    {/* Remove at the row's end while it fits there, under the code where not. */}
                    <span className="grow" />
                    <LockButton
                      id={removeId(b.id)}
                      variant="secondary"
                      size="sm"
                      aria-label={`Remove block ${b.tagId}`}
                      aria-haspopup="dialog"
                      aria-disabled={removing}
                      onClick={() => ask(b)}
                    >
                      Remove
                    </LockButton>
                  </li>
                ))}
              </ul>
            )}
            {/* Mounted while empty, so a screen reader hears a removal said when it lands. */}
            <p role="status" className="mt-3 break-words empty:mt-0">
              {gone}
            </p>
          </div>
          {blocks.length > 0 ? (
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
          ) : null}

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
                    look="lock"
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

      <dialog
        ref={dialog}
        aria-labelledby={`${id}-ask`}
        aria-describedby={`${id}-line`}
        onCancel={(e) => {
          // Escape holds while a removal is on its way, as Cancel does.
          if (removalSent.current) e.preventDefault();
        }}
        onClose={closed}
        className={DIALOG_LOCK}
      >
        <h2 id={`${id}-ask`} className="text-panel-title">
          Remove block <span translate="no">{asking?.tagId}</span>?
        </h2>
        <p id={`${id}-line`} className="text-body text-text-secondary">
          Students can&apos;t tap in with it after this.
        </p>
        {unremoved ? (
          <p role="alert" className="text-body">
            {unremoved.message}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <LockButton
            ref={cancel}
            variant="secondary"
            aria-disabled={removing}
            onClick={() => {
              if (!removalSent.current) dialog.current?.close();
            }}
          >
            Cancel
          </LockButton>
          <TryAgain
            look="lock"
            variant="primary"
            size="md"
            onRetry={remove}
            held={removing}
            then={[]}
            send={{
              words: 'Remove block',
              sending: 'Removing…',
              failed: unremoved?.kind === 'failed',
            }}
          />
        </div>
      </dialog>
    </section>
  );
}
