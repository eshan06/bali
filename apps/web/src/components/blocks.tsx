'use client';

import type { BlockDetail, BlockListResponse } from '@bali/shared';
import { Nfc } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { CARD_ALONE } from '@/components/card';
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
 * The teacher's blocks (P3; v2's card since PV16, as Classes and HomeStates draw it): its label
 * with the tag's icon, the ones registered to them as rows between hairlines, each ID in the code
 * face, and a field to register one by the ID written on it. The ID is checked as the phone reads a
 * tag before a try is spent on it; each refusal is said right under the field's help, with the way
 * on; an answer that never came is sent again as it was by Try again, which is safe: one's own tag
 * registers once. The list that didn't load is read again by its own Try again, its line said until
 * the answer, focus then on the card's label (HomeRetryStates, drawn first).
 */
export function Blocks() {
  const api = useApi();
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  // A send under way: a second Enter before the page redraws sends nothing.
  const sending = useRef(false);
  const [blocks, setBlocks] = useState<BlockDetail[] | null>(null);
  // Set when the list didn't load: what to add to the line that says so, or '' for nothing.
  const [loadError, setLoadError] = useState<string | null>(null);
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
    const { block, already } = answer;
    if (!already) setBlocks([...blocks, block]);
    setTyped('');
    setSaid({
      kind: 'done',
      message: already
        ? `${block.tagId} was already registered to you.`
        : `${block.tagId} is registered to you.`,
    });
  }

  return (
    <section aria-labelledby={`${id}-title`} className={CARD_ALONE}>
      <h2
        id={`${id}-title`}
        className="flex items-center gap-2 text-section-label text-text-tertiary uppercase"
      >
        <Nfc size={14} aria-hidden="true" className="shrink-0" />
        {blocks && blocks.length > 1 ? 'Your blocks' : 'Your block'}
      </h2>
      {/* 14 px under the label, as the boards render it: its margin outranks the line's. */}
      <p className="mt-3.5 text-body text-text-secondary">
        Students tap your block with their phone to join your session.
      </p>

      {blocks === null ? (
        loadError !== null ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
            <TryAgain onRetry={load} then={[`${id}-title`]}>
              <p role="alert" className="text-body">
                Couldn&apos;t load your blocks.{loadError ? ` ${loadError}` : null}
              </p>
            </TryAgain>
          </div>
        ) : (
          <p role="status" className="mt-4 text-body text-text-secondary">
            Loading…
          </p>
        )
      ) : (
        <>
          {blocks.length === 0 ? (
            <p className="mt-4 border-y border-border-default py-2.75 text-body text-text-secondary">
              No block registered yet.
            </p>
          ) : (
            <ul className="mt-4 border-b border-border-default">
              {blocks.map((b) => (
                <li
                  key={b.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border-default py-2.75"
                >
                  <span translate="no" className="font-mono font-medium text-body break-all">
                    {b.tagId}
                  </span>
                  <span className="text-caption text-text-tertiary">
                    Registered {registeredOn(b.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={(e) => e.preventDefault()} className="mt-4.5">
            <Field
              ref={field}
              id={`${id}-id`}
              label="Block ID"
              help="10 letters and digits, written on your block."
              mono
              name="block-id"
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
            />
            {said ? (
              <p
                id={`${id}-said`}
                role={said.kind === 'done' ? 'status' : 'alert'}
                className="text-body break-words"
              >
                {said.message}
              </p>
            ) : null}

            {/* One button throughout, so focus stays on it whatever it comes to say. */}
            <TryAgain
              type="submit"
              size="md"
              onRetry={register}
              held={busy}
              then={[]}
              send={{
                words: 'Register block',
                sending: 'Registering…',
                failed: said?.kind === 'failed',
              }}
              className="mt-3.5"
            />
          </form>
        </>
      )}
    </section>
  );
}
