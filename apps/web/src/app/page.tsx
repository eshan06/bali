'use client';

import type { MeResponse } from '@bali/shared';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Blocks } from '@/components/blocks';
import { Button } from '@/components/button';
import { Field } from '@/components/field';
import { InviteCode } from '@/components/invite-code';
import { TextLink } from '@/components/text-link';
import { CARD, EMPTY_TRAY, TRAY } from '@/components/tray';
import { getAccessToken } from '@/lib/auth';
import { CLASS_NAME_MAX, createClass } from '@/lib/classes';
import { errText, NO_CLASS_NAME } from '@/lib/errors';
import { useApi } from '@/lib/use-api';

/** What the create form last said under its field. */
type Said =
  /** Nothing sent: the name is the thing to put right. */
  | { kind: 'refused'; message: string }
  /** No class to show: Try again sends it again. */
  | { kind: 'failed'; message: string }
  | { kind: 'created'; id: string; name: string };

/** The page's column, under the bar: its gutters the bar's, 40 px from the desktop width (§5). */
const PAGE = 'mx-auto max-w-2xl px-4 pt-10 pb-16 sm:px-10';

/**
 * The classes home (D2e, in Soft premium): the teacher's classes as cards in a tray, each opening
 * its class page; the create form under them, its name's refusals and failures said under the
 * field with the way on; then the teacher's block. An account that doesn't teach yet gets the
 * invite code in place of all of it.
 */
export default function HomePage() {
  const api = useApi();
  const router = useRouter();
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  // A create under way: a second Enter before the page redraws sends nothing.
  const sending = useRef(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
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
    if (sending.current) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setSaid({ kind: 'refused', message: NO_CLASS_NAME });
      field.current?.focus();
      return;
    }
    sending.current = true;
    setBusy(true);
    setSaid(null);
    const answer = await createClass(api, trimmed);
    sending.current = false;
    setBusy(false);
    // The list as the server has it, whatever the answer: a class made before its answer was lost
    // shows before Try again, and beside a second one after it (DECISIONS, 2026-09-20: visible).
    load();
    if (answer.kind === 'failed') return setSaid(answer);
    setName('');
    setSaid({ kind: 'created', id: answer.klass.id, name: answer.klass.name });
  }

  if (me === null || me.user.role !== 'teacher') {
    return (
      <main className={PAGE}>
        {me ? (
          // Not a teacher yet, as `/v1/me` says: the invite code, in place of the classes or a 403.
          <InviteCode onTeacher={onTeacher} />
        ) : error ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <p role="alert" className="text-body">
              Couldn&apos;t load your account. <span className="text-text-secondary">{error}</span>
            </p>
            <Button variant="secondary" onClick={load}>
              Try again
            </Button>
          </div>
        ) : (
          <p role="status" className="text-body text-text-secondary">
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

      {/* The list read again after a create, and that read failed: said, unless the create's own
          failure under its field already says why. */}
      {error && said?.kind !== 'failed' ? (
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
          <p role="alert" className="text-body">
            Couldn&apos;t load your classes. <span className="text-text-secondary">{error}</span>
          </p>
          <Button variant="secondary" onClick={load}>
            Try again
          </Button>
        </div>
      ) : null}

      {me.classes.length === 0 ? (
        <p className={`mt-6 text-body ${EMPTY_TRAY}`}>
          No classes yet. Create your first one below.
        </p>
      ) : (
        <ul className={`mt-6 ${TRAY}`}>
          {me.classes.map((c) => (
            <li key={c.id}>
              {/* The whole card opens the class; its edge firms and the chevron moves on hover. */}
              <Link
                href={`/classes/${c.id}`}
                className={`group flex items-center justify-between gap-4 transition-colors hover:border-border-strong dark:hover:border-border-strong ${CARD}`}
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

      <form onSubmit={(e) => void onCreate(e)} className="mt-8 max-w-md">
        <Field
          ref={field}
          id={`${id}-name`}
          label="New class name"
          help="Your students see this name in the Bali app."
          name="class-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaid(null);
          }}
          readOnly={busy}
          maxLength={CLASS_NAME_MAX}
          autoComplete="off"
          aria-invalid={said?.kind === 'refused'}
          aria-describedby={said ? `${id}-said` : undefined}
        />
        {said ? (
          <p
            id={`${id}-said`}
            role={said.kind === 'created' ? 'status' : 'alert'}
            className="mt-4 text-body break-words"
          >
            {said.kind === 'created' ? (
              <>
                {said.name} is ready. <TextLink href={`/classes/${said.id}`}>Open it</TextLink> to
                see its join code.
              </>
            ) : (
              said.message
            )}
          </p>
        ) : null}

        {/* One button throughout, so focus stays on it whatever it comes to say. */}
        <Button type="submit" aria-disabled={busy} aria-busy={busy} className="mt-6">
          {busy ? 'Creating…' : said?.kind === 'failed' ? 'Try again' : 'Create class'}
        </Button>
      </form>

      <Blocks />
    </main>
  );
}
