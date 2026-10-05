'use client';

import type { BlockDetail, BlockListResponse } from '@bali/shared';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { blockIdOf, loadProblem, type RegisterAnswer, registerBlock } from '@/lib/blocks';
import { NOT_A_BLOCK_ID } from '@/lib/errors';
import { useApi } from '@/lib/use-api';

/** What the section last said under the field. */
type Said = Exclude<RegisterAnswer, { kind: 'registered' }> | { kind: 'done'; message: string };

const registeredOn = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The teacher's blocks on the classes page (P3): the ones registered to them, and a field to
 * register one by the ID written on it. The ID is checked as the phone reads a tag before a try is
 * spent on it; each refusal is said under the field, with the way on; an answer that never came is
 * sent again as it was by Try again, which is safe: one's own tag registers once.
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
    <section
      aria-labelledby={`${id}-title`}
      className="mt-12 border-t border-slate-200 pt-8 dark:border-slate-800"
    >
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        {blocks && blocks.length > 1 ? 'Your blocks' : 'Your block'}
      </h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        Students tap your block with their phone to join your session.
      </p>

      {blocks === null ? (
        loadError !== null ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <p role="alert" className="text-sm">
              Couldn't load your blocks.{' '}
              <span className="text-slate-600 dark:text-slate-300">{loadError}</span>
            </p>
            <button
              type="button"
              onClick={load}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm transition-colors hover:bg-slate-100 motion-reduce:transition-none dark:border-slate-700 dark:hover:bg-slate-900"
            >
              Try again
            </button>
          </div>
        ) : (
          <p role="status" className="mt-4 text-sm text-slate-500 dark:text-slate-400">
            Loading…
          </p>
        )
      ) : (
        <>
          {blocks.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
              No block registered yet.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-200 dark:divide-slate-800">
              {blocks.map((b) => (
                <li key={b.id} className="flex items-baseline justify-between gap-4 py-2">
                  <span translate="no" className="font-mono text-sm tracking-wide">
                    {b.tagId}
                  </span>
                  <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                    Registered {registeredOn(b.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={(e) => void onSubmit(e)} className="mt-6 max-w-md">
            <label htmlFor={`${id}-id`} className="block text-sm font-medium">
              Block ID
            </label>
            <input
              ref={field}
              id={`${id}-id`}
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
              aria-describedby={`${id}-help${said ? ` ${id}-said` : ''}`}
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-mono text-base tracking-wide aria-[invalid=true]:border-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:aria-[invalid=true]:border-slate-100"
            />
            <p id={`${id}-help`} className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              10 letters and digits, written on your block.
            </p>
            {said ? (
              <p
                id={`${id}-said`}
                role={said.kind === 'done' ? 'status' : 'alert'}
                className="mt-4 text-sm font-medium"
              >
                {said.message}
              </p>
            ) : null}

            {/* One button throughout, so focus stays on it whatever it comes to say. */}
            <button
              type="submit"
              aria-disabled={busy}
              aria-busy={busy}
              className="mt-6 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-800 aria-disabled:opacity-60 motion-reduce:transition-none"
            >
              {busy ? 'Registering…' : said?.kind === 'failed' ? 'Try again' : 'Register block'}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
