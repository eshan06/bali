'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Blocks } from '@/components/blocks';
import { Button } from '@/components/button';
import { CARD } from '@/components/card';
import { Field } from '@/components/field';
import { InviteEntry } from '@/components/invite-code';
import { useMe } from '@/components/shell';
import { StudentHome } from '@/components/student-home';
import { getAccessToken } from '@/lib/auth';
import { CLASS_NAME_MAX, type CreateAnswer, createClass } from '@/lib/classes';
import { useApi } from '@/lib/use-api';

/**
 * The home (decision 13), where the account belongs. A teacher's is the classes home (the approved
 * Classes home design): their classes as cards, each opening its class page, and the create row
 * under them on a card of its own; beside them on a desktop, under them on anything narrower, the
 * teacher's block. A create's failure is said under its field with Try again; a made class is said
 * by the list, read again. A student who said 13+ in the app gets their own home (W3;
 * StudentHome); an account the 13+ check never passed, the invite page with its line for students
 * (Invite, PV15). The account is the shell's one read (`useMe`: the 13+ check, then `/v1/me`),
 * which the side menu names too, read again as the page opens; until it answers, the shell says
 * Loading… or its failure in the page's place (PV5b); the page sits in the shell's frame beside
 * the menu (PV5).
 */
export default function HomePage() {
  const api = useApi();
  const router = useRouter();
  const id = useId();
  // A create under way: a second Enter before the page redraws sends nothing.
  const sending = useRef(false);
  const { home, error, load, refresh } = useMe();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  // The last create's failure, said under the field; Try again sends the name again, but after a
  // final refusal (a deleted account), which no resend can change.
  const [failed, setFailed] = useState<Exclude<CreateAnswer, { kind: 'created' }> | null>(null);
  // Set by a redeem (T2): the classes heading takes focus once the account is read as a teacher.
  const redeemed = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }
    load();
  }, [load, router]);

  // The account teaches now (T2): who it is, read again, so the classes view shows, the side
  // menu with it; no reload.
  const onTeacher = useCallback(() => {
    redeemed.current = true;
    load(true);
  }, [load]);

  useEffect(() => {
    if (!redeemed.current || home?.kind !== 'teacher') return;
    redeemed.current = false;
    heading.current?.focus();
  }, [home]);

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
    if (answer.kind !== 'created') return setFailed(answer);
    setName('');
  }

  // The account not read yet, or its read failed: the shell says so in this page's place
  // (`AccountUnread`), as it does on every page.
  if (home === null) return null;
  if (home.kind === 'student') {
    return <StudentHome me={home.me} failed={error !== null} onRead={load} onRefresh={refresh} />;
  }
  // Never through the 13+ check: the invite code, in place of the classes or a 403.
  if (home.kind === 'invite') return <InviteEntry forStudents onTeacher={onTeacher} />;
  const { me } = home;

  return (
    <main>
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
              <Button variant="secondary" onClick={() => load()}>
                Try again
              </Button>
            </div>
          ) : null}

          <div className="flex flex-col gap-4">
            {/* A made class is said by the list: a screen reader hears its name as it appears. */}
            <div aria-live="polite">
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
            </div>

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
                    {busy ? 'Creating…' : failed?.kind === 'failed' ? 'Try again' : 'Create class'}
                  </Button>
                }
              />
              {failed ? (
                <p id={`${id}-said`} role="alert" className="mt-4 text-body break-words">
                  {failed.message}
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
