'use client';

import type { MeResponse } from '@bali/shared';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Blocks } from '@/components/blocks';
import { Button } from '@/components/button';
import { CARD, CARD_ALONE } from '@/components/card';
import { EntryPage } from '@/components/entry-page';
import { Field } from '@/components/field';
import { InviteCode } from '@/components/invite-code';
import { getAccessToken } from '@/lib/auth';
import { CLASS_NAME_MAX, createClass } from '@/lib/classes';
import { errText } from '@/lib/errors';
import { useApi } from '@/lib/use-api';

/** The page under the bar (the Classes home canvas): 1400 px at most, its gutters the bar's (§5). */
const PAGE = 'mx-auto max-w-[1400px] px-4 pt-10 pb-16 sm:px-10';

/**
 * The classes home (the approved Classes home design): the teacher's classes as cards, each
 * opening its class page, and the create row under them on a card of its own; beside them on a
 * desktop, under them on anything narrower, the teacher's block. A create's failure is said under
 * its field with Try again; a made class is said by the list, read again. An account that doesn't
 * teach yet gets the invite code in place of all of it.
 */
export default function HomePage() {
  const api = useApi();
  const router = useRouter();
  const id = useId();
  // A create under way: a second Enter before the page redraws sends nothing.
  const sending = useRef(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  // The last create's failure, said under the field; Try again sends the name again.
  const [failed, setFailed] = useState<string | null>(null);
  // Set by a redeem (T2): the classes heading takes focus once the account is read as a teacher.
  const redeemed = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const load = useCallback(() => {
    setError(null);
    api.get<MeResponse>('/v1/me').then(setMe, (e: unknown) => setError(errText(e)));
  }, [api]);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }
    load();
  }, [load, router]);

  // The account teaches now (T2): who it is, read again, so the classes view shows; no reload.
  const onTeacher = useCallback(() => {
    redeemed.current = true;
    setMe(null);
    load();
  }, [load]);

  useEffect(() => {
    if (!redeemed.current || me?.user.role !== 'teacher') return;
    redeemed.current = false;
    heading.current?.focus();
  }, [me]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    // An empty name leaves Create disabled (Phase 2's behaviour): nothing to send, nothing to say.
    if (sending.current || !trimmed) return;
    sending.current = true;
    setBusy(true);
    setFailed(null);
    const answer = await createClass(api, trimmed);
    sending.current = false;
    setBusy(false);
    // The list as the server has it, whatever the answer: a class made before its answer was lost
    // shows before Try again, and beside a second one after it (DECISIONS, 2026-09-20: visible).
    load();
    if (answer.kind === 'failed') return setFailed(answer.message);
    setName('');
  }

  if (me === null || me.user.role !== 'teacher') {
    // Not a teacher yet, as `/v1/me` says: the invite code, in place of the classes or a 403.
    if (me) {
      return (
        <EntryPage signedIn>
          <InviteCode onTeacher={onTeacher} />
        </EntryPage>
      );
    }
    return (
      <main className={PAGE}>
        {error ? (
          <div className={`mx-auto max-w-md ${CARD_ALONE}`}>
            <p role="alert">
              <span className="block text-h3">Couldn&apos;t load your account.</span>
              <span className="mt-2 block text-body text-text-secondary">{error}</span>
            </p>
            <Button variant="secondary" onClick={load} className="mt-6">
              Try again
            </Button>
          </div>
        ) : (
          <p role="status" className="mx-auto max-w-md text-center text-body text-text-secondary">
            Loading…
          </p>
        )}
      </main>
    );
  }

  return (
    <main className={PAGE}>
      <h1 ref={heading} tabIndex={-1} className="text-h1 text-balance">
        Your classes
      </h1>

      {/* Two columns from the desktop width, the block's beside the classes'; narrower, one. */}
      <div className="mt-6 flex flex-wrap items-start gap-10">
        <div className="min-w-0 grow-999 basis-140">
          {/* The list read again after a create, and that read failed: said, unless the create's
              own failure under its field already says why. */}
          {error && !failed ? (
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
              <p role="alert" className="text-body">
                Couldn&apos;t load your classes.{' '}
                <span className="text-text-secondary">{error}</span>
              </p>
              <Button variant="secondary" onClick={load}>
                Try again
              </Button>
            </div>
          ) : null}

          <div className="flex flex-col gap-4">
            {me.classes.length === 0 ? (
              <p className="text-body text-text-secondary">
                No classes yet. Create your first one below.
              </p>
            ) : (
              <ul className="grid gap-2">
                {me.classes.map((c) => (
                  <li key={c.id}>
                    {/* The whole card opens the class; its edge firms and the chevron moves on hover. */}
                    <Link
                      href={`/classes/${c.id}`}
                      className={`group flex items-center justify-between gap-4 transition-colors hover:border-border-strong ${CARD}`}
                    >
                      <span className="min-w-0 text-h3 break-words">{c.name}</span>
                      <ChevronRight
                        size={20}
                        aria-hidden="true"
                        className="shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={(e) => void onCreate(e)} className={CARD}>
              <Field
                id={`${id}-name`}
                label="New class name"
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
                trailing={
                  // One button throughout, so focus stays on it whatever it comes to say: an
                  // empty name disables it by `aria-disabled`, which keeps it focusable when a
                  // made class empties the field under it.
                  <Button type="submit" aria-disabled={busy || !name.trim()} aria-busy={busy}>
                    {busy ? 'Creating…' : failed ? 'Try again' : 'Create class'}
                  </Button>
                }
              />
              {failed ? (
                <p id={`${id}-said`} role="alert" className="mt-4 text-body break-words">
                  {failed}
                </p>
              ) : null}
            </form>
          </div>
        </div>

        <div className="min-w-0 basis-100">
          <Blocks />
        </div>
      </div>
    </main>
  );
}
