'use client';

import type { BlockDetail, BlockListResponse } from '@bali/shared';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/button';
import { CARD } from '@/components/card';
import { Field } from '@/components/field';
import { blockIdOf, loadProblem, type RegisterAnswer, registerBlock } from '@/lib/blocks';
import { NOT_A_BLOCK_ID } from '@/lib/errors';
import { useApi } from '@/lib/use-api';

/** What the section last said under the field. */
type Said = Exclude<RegisterAnswer, { kind: 'registered' }> | { kind: 'done'; message: string };

const registeredOn = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The teacher's blocks on the classes home (P3; in Soft premium, D2e): the ones registered to
 * them as cards, each ID in the code style, and a field to register one by the ID
 * written on it. The ID is checked as the phone reads a tag before a try is spent on it; each
 * refusal is said under the field, with the way on; an answer that never came is sent again as it
 * was by Try again, which is safe: one's own tag registers once.
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

  const load = useCallback(() => {
    setLoadError(null);
    api.get<BlockListResponse>('/v1/blocks').then(
      (res) => setBlocks(res.blocks),
      (e: unknown) => setLoadError(loadProblem(e) ?? ''),
    );
  }, [api]);

  useEffect(load, [load]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
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
    <section aria-labelledby={`${id}-title`} className="mt-12 border-t border-border-default pt-10">
      <h2 id={`${id}-title`} className="text-h2">
        {blocks && blocks.length > 1 ? 'Your blocks' : 'Your block'}
      </h2>
      <p className="mt-2 text-body text-text-secondary">
        Students tap your block with their phone to join your session.
      </p>

      {blocks === null ? (
        loadError !== null ? (
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
            <p role="alert" className="text-body">
              Couldn&apos;t load your blocks.{' '}
              <span className="text-text-secondary">{loadError}</span>
            </p>
            <Button variant="secondary" onClick={load}>
              Try again
            </Button>
          </div>
        ) : (
          <p role="status" className="mt-6 text-body text-text-secondary">
            Loading…
          </p>
        )
      ) : (
        <>
          {blocks.length === 0 ? (
            <p className="mt-6 text-body text-text-secondary">No block registered yet.</p>
          ) : (
            <ul className="mt-6 grid gap-2">
              {blocks.map((b) => (
                <li
                  key={b.id}
                  className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 ${CARD}`}
                >
                  <span translate="no" className="font-mono text-code break-all">
                    {b.tagId}
                  </span>
                  <span className="text-caption text-text-tertiary">
                    Registered {registeredOn(b.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={(e) => void onSubmit(e)} className="mt-8 max-w-md">
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
                className="mt-4 text-body"
              >
                {said.message}
              </p>
            ) : null}

            {/* One button throughout, so focus stays on it whatever it comes to say. */}
            <Button type="submit" aria-disabled={busy} aria-busy={busy} className="mt-6">
              {busy ? 'Registering…' : said?.kind === 'failed' ? 'Try again' : 'Register block'}
            </Button>
          </form>
        </>
      )}
    </section>
  );
}
