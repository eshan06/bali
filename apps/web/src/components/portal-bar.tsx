'use client';

import type { SessionSnapshot } from '@bali/shared';
import { LogOut, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from 'react';

import { Button, ICON_BUTTON, LockButton } from '@/components/button';
import { LOCKUP, Mark, TOP_BAR } from '@/components/mark';
import { AFTER_BELL_MS, liveNow, nextBell, type TaughtClass } from '@/lib/classes';
import { fromSnapshot, gridDisplay } from '@/lib/grid-state';
import { laterBell } from '@/lib/session-controls';
import { useApi } from '@/lib/use-api';

import { stateCounts } from './live-grid';
import { Ring, shareLeft, timeLeft, useClock } from './live-header';

/**
 * The bar over a signed-in page with no side menu (S4a; the Invite board's, PV15): Bali, a link
 * home in the brand's ink as every board renders it, and Sign out, small, with its icon. The shell
 * (`shell.tsx`) puts it over the invite page, over any page of an account the 13+ check never
 * passed, and over an account read that failed, and signs out; a teacher's pages have the top bar
 * (`TopBar`) instead, and a student's the side menu (W3).
 */
export function PortalBar({ leaving, onSignOut }: { leaving: boolean; onSignOut: () => void }) {
  return (
    <header className={TOP_BAR}>
      <Link href="/" translate="no" className={`${LOCKUP} rounded-item text-text-brand`}>
        <Mark size={20} />
        Bali
      </Link>
      <Button variant="secondary" size="sm" onClick={onSignOut} aria-disabled={leaving}>
        <LogOut size={16} aria-hidden="true" />
        {leaving ? 'Signing out…' : 'Sign out'}
      </Button>
    </header>
  );
}

/** A name's initials, as v2 drew them: the first letter of its first two words (Ms. Rivera, MR). */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => (/\p{L}/u.exec(word) ?? [...word])[0])
    .join('')
    .toLocaleUpperCase();
}

/** A class's page, or a page under it (`/classes/<id>/…`), and the class's id. */
const CLASS_PAGE = /^\/classes\/([^/]+)/;

/** A place in the bar, marked on its page and every page under `under`. */
interface Place {
  href: string;
  label: string;
  under: string;
}

/**
 * The bar's places (Main, Reports): Classes, which is Home, marked on a class's page too, as
 * ClassLive draws it, and on Classes' old address, which goes Home (LO3); and Reports, a session's
 * report under it. Never Questions or Slides, whichever way the lessons switch is set: no board
 * draws them.
 */
const PLACES: Place[] = [
  { href: '/', label: 'Classes', under: '/classes' },
  { href: '/reports', label: 'Reports', under: '/reports' },
];
const HELP: Place = { href: '/support', label: 'Help', under: '/support' };

/** Whether `path` is the place's own page or one under it, never one merely named alike. */
const isHere = (path: string, { href, under }: Place): boolean =>
  path === href || path === under || path.startsWith(`${under}/`);

/** A live class the bar carries: the class, and its session as the account last read it. */
interface Riding {
  c: TaughtClass;
  session: { id: string; endsAt: string };
}

/**
 * The live class the bar carries (Reports; BarStates, drawn first): the first in Your classes'
 * order live by this computer's clock to its bell, but never on Classes, which shows it itself, nor
 * on its own page, and none whose session the server has said is over (`gone`).
 */
function ridingFor(
  classes: readonly TaughtClass[],
  path: string,
  now: number,
  gone: ReadonlySet<string>,
): Riding | null {
  if (path === '/' || path === '/classes') return null;
  const own = CLASS_PAGE.exec(path)?.[1];
  for (const c of classes) {
    const session = liveNow(c, now);
    if (session !== null && c.id !== own && !gone.has(session.id)) return { c, session };
  }
  return null;
}

/** lock.css's `.livestrip`: a green pill 36 px tall, 8 px in at the ring and 16 at the end. */
const STRIP =
  'inline-flex min-h-9 max-w-full items-center gap-3 rounded-full border border-live-edge bg-live-fill pr-4 pl-2 text-meta whitespace-nowrap text-text-secondary transition-colors hover:border-live-hover';

/** How often the bar reads its live class's session again: the class page's own 15 s. */
const READ_EVERY_MS = 15_000;

/**
 * The live class in the bar (Reports; BarStates, drawn first), a link to its page: the ring, the
 * time left to the bell, its name, cut to fit with the whole of it on hover and in the link's
 * words, and how many of the class are focused, gone under 1024 px as on a phone. Its session is
 * read as it shows and every 15 s after, as the class page reads its own, with no live feed of its
 * own, which in every tab would count against a teacher's five. Nothing until a read says the
 * session runs, so a class ended a moment ago never shows as live; no count while the latest read
 * failed. Its bell is the later of the account's and the read's: a later one (time added, in this
 * tab or another) has the account read again (`onLater`, the shell's `refresh`), as Home's live
 * card does, so the bar keeps the class to it. The server's end is told to the bar (`onEnded`).
 */
function LiveStrip({
  riding: { c, session },
  onEnded,
  onLater,
}: {
  riding: Riding;
  onEnded: (sessionId: string) => void;
  onLater: () => Promise<void>;
}) {
  const api = useApi();
  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let gone = false;
    const read = () =>
      api.get<SessionSnapshot>(`/v1/sessions/${session.id}`).then(
        (answer) => {
          if (gone) return;
          if (answer.ended) onEnded(session.id);
          setSnap(answer);
          setFailed(false);
        },
        () => {
          if (!gone) setFailed(true);
        },
      );
    void read();
    const timer = window.setInterval(() => void read(), READ_EVERY_MS);
    return () => {
      gone = true;
      window.clearInterval(timer);
    };
  }, [api, session.id, onEnded]);
  const later = snap !== null && Date.parse(snap.session.endsAt) > Date.parse(session.endsAt);
  useEffect(() => {
    if (later) void onLater();
  }, [later, snap, onLater]);
  const bell = laterBell(snap?.session.endsAt ?? null, session.endsAt);
  const now = useClock(bell);
  if (snap === null || snap.ended || now >= Date.parse(bell)) return null;
  const counts = failed
    ? null
    : stateCounts(Object.values(fromSnapshot(snap)).map((s) => gridDisplay(s, new Date(now))));
  const left = `${timeLeft(Date.parse(bell) - now)} left`;
  const focused = counts === null ? null : `${counts.counts.focused} of ${counts.total} focused`;
  return (
    <div className="min-w-0 max-[760px]:col-span-2 max-[760px]:row-start-2 max-[760px]:pb-2.5">
      <Link
        href={`/classes/${c.id}`}
        aria-label={`${c.name} is live. ${left}${focused === null ? '' : `, ${focused}`}. Open the class.`}
        className={STRIP}
      >
        <span className="shrink-0 p-px">
          <Ring share={shareLeft(snap.session.startedAt, bell, now)} box={18} stroke={3} />
        </span>
        <span title={c.name} className="min-w-0 truncate font-semibold text-text-primary">
          {c.name}
        </span>
        <span>{left}</span>
        {focused === null ? null : (
          <span className="font-medium text-state-focused-fg max-lg:hidden">{focused}</span>
        )}
      </Link>
    </div>
  );
}

/**
 * lock.css's top bar (Main, Reports, PhonePages): on the page's colour with its hairline, staying in
 * view as the page scrolls, under the student panel and a pop-up (z 5 and up). Its row 1360 px wide
 * at most, 40 px in; under 760 px 16 px in, two columns, the live class on a row of its own
 * (BarStates, drawn first). Its height, 60 px and the hairline (56 on a phone), is where the unlock
 * pop-ups pin, 18 px under it (`unlock-popups.tsx`'s `STACK`, LO13): change the two together.
 */
const BAR = 'sticky top-0 z-3 border-b border-border-default bg-surface-page';
const ROW =
  'mx-auto flex min-h-15 w-full max-w-[1360px] items-center gap-6 px-10 max-[760px]:grid max-[760px]:min-h-0 max-[760px]:grid-cols-[minmax(0,1fr)_auto] max-[760px]:grid-rows-[56px_auto] max-[760px]:gap-x-3 max-[760px]:gap-y-0 max-[760px]:px-4';
const BRAND =
  '-ml-1 inline-flex shrink-0 items-center gap-2 justify-self-start rounded-xs p-1 text-lockup text-text-primary';
/** A place, and Help: 14.5/20 in the secondary ink, 36 px tall; its own page grey in the primary. */
const PLACE =
  'inline-flex min-h-9 items-center rounded-item px-3 text-nav text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text-primary aria-[current=page]:bg-surface-sunken aria-[current=page]:text-text-primary';
const ACCOUNT =
  'flex min-w-0 items-center gap-2 border-l border-border-default pl-3 max-[760px]:border-l-0 max-[760px]:pl-0';
/** The phone's menu, open under the bar (PhonePages): 48 px rows between hairlines, at 17/24. */
const MENU_ROW = 'flex min-h-12 items-center';
const MENU_LINK = `${MENU_ROW} border-b border-border-default text-menu-link text-text-primary aria-[current=page]:font-semibold`;

/**
 * A teacher's top bar (the lock-only canvas's Main, Reports and PhonePages; LO2), in place of v2's
 * side menu on every signed-in page of theirs but Present: Bali, a link home; Classes and Reports,
 * the page open marked; the live class while one runs (`ridingFor`); then Help, and the account, its
 * initials, its name, gone under 1024 px, and Sign out an icon; with no name, Sign out in words,
 * an icon on a phone (BarStates). Under 760 px the places, Help and the name go behind the menu
 * button, which opens them under the bar with the name and Sign out, closing as a link is followed
 * or on Escape, focus back on the button. Sign out held while it signs out, its words Signing out….
 * A session starts, ends or runs longer only on a class's page, so leaving one, the bar has the
 * account read again (`refresh`, the shell's own, after the next page's reads have begun, so
 * Home's and Classes' count once) and carries the class as the server has it now.
 */
export function TopBar({
  path,
  name,
  classes,
  leaving,
  onSignOut,
  refresh,
}: {
  path: string;
  name: string | null;
  classes: readonly TaughtClass[];
  leaving: boolean;
  onSignOut: () => void;
  refresh: () => Promise<void>;
}) {
  const panel = useId();
  const menuButton = useRef<HTMLButtonElement>(null);
  // Open on the page it was opened on, so a link followed closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === path;
  const [now, setNow] = useState(() => Date.now());
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const ended = useCallback((id: string) => setGone((had) => new Set(had).add(id)), []);

  const was = useRef(path);
  useEffect(() => {
    if (was.current === path) return;
    const left = CLASS_PAGE.test(was.current);
    was.current = path;
    if (left) window.setTimeout(() => void refresh(), 0);
  }, [path, refresh]);

  // This computer's clock, read as the account is and at each bell, when a class's ride ends.
  useEffect(() => setNow(Date.now()), [classes]);
  const bell = nextBell([...classes], now);
  useEffect(() => {
    if (bell === null) return;
    const timer = window.setTimeout(() => setNow(Math.max(Date.now(), bell)), bell - Date.now());
    return () => window.clearTimeout(timer);
  }, [bell]);
  // And the account read again just after the first bell it counts running, past ones too, as Home
  // and Classes read it (they do so themselves): time added after the strip's last read before the
  // bell then brings the class back. Once a bell: an answer still counting it running waits for a
  // later read.
  const readAt = path === '/' || path === '/classes' ? null : nextBell([...classes], 0);
  useEffect(() => {
    if (readAt === null) return;
    const timer = window.setTimeout(() => void refresh(), readAt + AFTER_BELL_MS - Date.now());
    return () => window.clearTimeout(timer);
  }, [readAt, refresh]);

  const riding = ridingFor(classes, path, now, gone);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || !open) return;
    setOpenOn(null);
    menuButton.current?.focus();
  };
  // The bar's own Sign out goes behind the menu while it is open on a phone, Sign out in it.
  const inMenu = open ? 'max-[760px]:hidden' : '';
  const signOut = leaving ? 'Signing out…' : 'Sign out';

  return (
    <header onKeyDown={onKeyDown} className={BAR}>
      <div className={ROW}>
        <Link href="/" aria-label="Bali, your classes" translate="no" className={BRAND}>
          <Mark size={22} />
          Bali
        </Link>
        <nav aria-label="Main" className="flex shrink-0 items-center gap-1 max-[760px]:hidden">
          {PLACES.map((place) => (
            <Link
              key={place.href}
              href={place.href}
              aria-current={isHere(path, place) ? 'page' : undefined}
              className={PLACE}
            >
              {place.label}
            </Link>
          ))}
        </nav>
        {riding === null ? null : (
          <LiveStrip key={riding.session.id} riding={riding} onEnded={ended} onLater={refresh} />
        )}
        <div className="ml-auto flex shrink-0 items-center gap-3 max-[760px]:col-start-2 max-[760px]:row-start-1">
          <Link href={HELP.href} className={`${PLACE} max-[760px]:hidden`}>
            {HELP.label}
          </Link>
          <div className={ACCOUNT}>
            {name ? (
              <>
                <span
                  aria-hidden="true"
                  className="grid size-7 shrink-0 place-items-center rounded-full bg-avatar-bg text-menu-initials text-avatar-fg"
                >
                  {initials(name)}
                </span>
                <span
                  title={name}
                  className="max-w-50 min-w-0 truncate text-data font-normal text-text-secondary max-lg:hidden"
                >
                  {name}
                </span>
              </>
            ) : (
              <button
                type="button"
                aria-disabled={leaving}
                onClick={onSignOut}
                className={`${PLACE} cursor-pointer gap-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-55 max-[760px]:hidden`}
              >
                <LogOut size={16} aria-hidden="true" />
                {signOut}
              </button>
            )}
            <button
              type="button"
              aria-label="Sign out"
              aria-disabled={leaving}
              onClick={onSignOut}
              className={`${ICON_BUTTON} ${name ? '' : 'min-[760px]:hidden'} ${inMenu}`}
            >
              <LogOut size={16} aria-hidden="true" />
            </button>
          </div>
          <button
            ref={menuButton}
            type="button"
            aria-label={open ? 'Close the menu' : 'Menu'}
            aria-expanded={open}
            aria-controls={panel}
            onClick={() => setOpenOn(open ? null : path)}
            className={`${ICON_BUTTON} min-[760px]:hidden`}
          >
            {open ? <X size={16} aria-hidden="true" /> : <Menu size={16} aria-hidden="true" />}
          </button>
        </div>
      </div>
      <nav
        id={panel}
        aria-label="Main"
        hidden={!open}
        className="flex flex-col border-t border-border-default px-4 pb-4 min-[760px]:hidden"
      >
        {[...PLACES, HELP].map((place) => (
          <Link
            key={place.href}
            href={place.href}
            aria-current={isHere(path, place) ? 'page' : undefined}
            onClick={() => setOpenOn(null)}
            className={MENU_LINK}
          >
            {place.label}
          </Link>
        ))}
        <div className={`${MENU_ROW} justify-between gap-3`}>
          {name ? (
            <span className="min-w-0 truncate text-menu-link text-text-secondary">{name}</span>
          ) : null}
          <LockButton variant="secondary" size="sm" aria-disabled={leaving} onClick={onSignOut}>
            {signOut}
          </LockButton>
        </div>
      </nav>
    </header>
  );
}
