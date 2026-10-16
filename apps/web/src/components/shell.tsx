'use client';

import type { MeResponse } from '@bali/shared';
import {
  ChartBar,
  CircleQuestionMark,
  House,
  LayoutGrid,
  LogOut,
  type LucideIcon,
  MessageCircleQuestionMark,
  Presentation,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { type ApiClient, POLL_TIMEOUT_MS, UnauthorizedError } from '@/lib/api-client';
import { endSession, getAccessToken } from '@/lib/auth';
import { errText } from '@/lib/errors';
import { type Home, homeFor } from '@/lib/student-web';
import { useApi } from '@/lib/use-api';

import { Button } from './button';
import { CARD_ALONE } from './card';
import { Mark } from './mark';
import { PortalBar } from './portal-bar';

/** The pages read without signing in (sign-in, its callback, Help, the policies), each with a bar. */
export const SIGNED_OUT_PATHS = /^\/(login|auth|support|privacy|terms)(\/|$)/;

/** How the shell frames a page: the side menu or the bar, the page's frame, or nothing yet. */
export interface Frame {
  chrome: 'menu' | 'bar' | null;
  /** The page at v2's width and gutters (`PAGE`). */
  framed: boolean;
  /**
   * The page waits: the account isn't read, so neither its frame nor a page drawn from it shows,
   * and the shell says why in its place (`AccountUnread`).
   */
  hidden: boolean;
}

/** Where the invite page is (Invite): `/` for an account the 13+ check never passed, and `/invite`. */
const INVITE_PATHS = new Set(['/', '/invite']);

/**
 * How a page is framed (the owner's rulings, 2026-10-13). A signed-out page draws its own bar, and
 * a page on the projector (Present) has no menu and no frame of the shell's, as ClassPresent draws
 * it. Otherwise the page waits for the account, so no frame flashes before it is known and no page
 * is drawn from an account that left: Loading… with no menu or bar while it is read, its failure
 * under the bar with Sign out (PV5b, the owner's approval of #352's review); then the side menu for
 * a teacher, and for a student who said 13+ in the app (W3), but on the invite page, which frames
 * itself under the bar (Invite, PV15), as it does for an account the 13+ check never passed, whose
 * every page has the bar.
 */
export function frameFor(
  path: string,
  home: Home | null,
  error: string | null,
  presenting: boolean,
): Frame {
  if (SIGNED_OUT_PATHS.test(path) || presenting)
    return { chrome: null, framed: false, hidden: false };
  if (home === null) return { chrome: error === null ? null : 'bar', framed: false, hidden: true };
  if (home.kind === 'teacher' || (home.kind === 'student' && path !== '/invite'))
    return { chrome: 'menu', framed: true, hidden: false };
  return { chrome: 'bar', framed: !INVITE_PATHS.has(path), hidden: false };
}

/**
 * What the shell does with the account as a page opens: forgets one whose sign-in is gone (a Sign
 * out or an expired session, which both land on /login), so going back never shows it; sends a tab
 * with no sign-in on a signed-in page to /login, a URL with no page among them, where it would
 * otherwise say Loading… for ever (PV5b's review; the owner, 2026-10-14); reads one not read yet on
 * a signed-in page, and one whose last read failed once another page opens (PV5b); or keeps what it
 * has. A failure is never read again on its own page, so never a loop of reads: there its Try again
 * reads it.
 */
export function accountStep(
  path: string,
  signedIn: boolean,
  home: Home | null,
  error: string | null,
  reading: boolean,
  newPage: boolean,
): 'forget' | 'sign in' | 'read' | 'keep' {
  const open = SIGNED_OUT_PATHS.test(path);
  if (!signedIn) {
    if (home !== null || error !== null) return 'forget';
    return open ? 'keep' : 'sign in';
  }
  if (open || reading) return 'keep';
  if (error !== null) return newPage ? 'read' : 'keep';
  return home === null ? 'read' : 'keep';
}

/**
 * One read of the account, as the home reads it (`homeFor`: the 13+ check first, and `/v1/me`,
 * which makes the account, only for one that passed it, so a web sign-in that never set up the app
 * makes no account; PV15), numbered in `reads` as it starts: its answer, its failure in words
 * (`errText`), or null once a newer read has begun, so a read that settles late never says a past
 * failure over fresh data, nor an old answer over a newer word (PV5b). A `401` says nothing: the
 * client has signed this tab out and sent it to /login, the one sign-out.
 */
export async function readAccount(
  api: Pick<ApiClient, 'get'>,
  reads: { current: number },
): Promise<{ home: Home } | { error: string | null } | null> {
  const mine = ++reads.current;
  let said: { home: Home } | { error: string | null };
  try {
    said = { home: await homeFor(api) };
  } catch (e) {
    said = { error: e instanceof UnauthorizedError ? null : errText(e) };
  }
  return mine === reads.current ? said : null;
}

/**
 * A signed-in page the back button brings back whole (the browser's back-forward cache) is
 * reloaded, never shown as it was kept: its account may have signed out, expired, or given way to
 * another sign-in in this tab since.
 */
export const reloadOnRestore = (persisted: boolean, path: string): boolean =>
  persisted && !SIGNED_OUT_PATHS.test(path);

/** Who is signed in, as the shell last read them: one read, for the menu's foot and for Home. */
export interface Me {
  /**
   * Where the account belongs (`homeFor`): a teacher or a student, with `/v1/me`'s answer, or an
   * account the 13+ check never passed, read no further. Null before the first answer, and while a
   * fresh read (a redeem's) is under way.
   */
  home: Home | null;
  /** `/v1/me`'s answer in `home`: null with no answer, and for an account read no further. */
  me: MeResponse | null;
  /**
   * The last read's failure (`errText`), said with Try again: by the shell while no answer is held
   * (`AccountUnread`), by Home over its classes after one; null once a read works.
   */
  error: string | null;
  /** Read it again: after a change, for Try again, or `fresh` after a redeem, forgetting it first. */
  load: (fresh?: boolean) => void;
  /**
   * Read it again unless a read is on its way, keeping what the page shows, its failure too, until
   * the answer: the student home's read every 30 s (W4's follow-up). Settles once that answer has
   * landed, or at once when no read began.
   */
  refresh: () => Promise<void>;
}

const MeContext = createContext<Me>({
  home: null,
  me: null,
  error: null,
  load: () => undefined,
  refresh: () => Promise.resolve(),
});
const PresentingContext = createContext<(on: boolean) => void>(() => undefined);

export const useMe = (): Me => useContext(MeContext);

/** A page on the projector says so while it is (Present): the shell then draws no menu or frame. */
export function usePresenting(on: boolean): void {
  const setPresenting = useContext(PresentingContext);
  useEffect(() => {
    setPresenting(on);
    return () => setPresenting(false);
  }, [on, setPresenting]);
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

interface Item {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** Pages under it at another path: a student's lessons under Your classes (W4). */
  under?: string;
}

/** Whose menu it is: a teacher's, or a student's who said 13+ in the app (W3). */
export type MenuRole = 'teacher' | 'student';

/**
 * The menu's pages, each listed only once it exists, never as a dead or disabled link: a teacher's
 * Classes (PV16) is marked on a class's page too; a student's is Your classes alone (StudentHome),
 * its lessons under it (StudentLesson). Help sits under the gap, in both.
 */
const PAGES: Record<MenuRole, Item[]> = {
  teacher: [
    { href: '/', label: 'Home', Icon: House },
    { href: '/classes', label: 'Classes', Icon: LayoutGrid },
    { href: '/reports', label: 'Reports', Icon: ChartBar },
    { href: '/questions', label: 'Questions', Icon: MessageCircleQuestionMark },
    { href: '/slides', label: 'Slides', Icon: Presentation },
  ],
  student: [{ href: '/', label: 'Your classes', Icon: LayoutGrid, under: '/lessons' }],
};
const HELP: Item = { href: '/support', label: 'Help', Icon: CircleQuestionMark };

/*
 * v2.css's side menu (DESIGN.md §1; every teacher board's): 216 px, white with a hairline on its
 * right, 32/12/14 in, in view as the page scrolls (v2's own was sticky), and scrolling itself on a
 * window too short for it, so its foot is never out of reach. Under 776 px one bar on top
 * (StudentZoom); under 640 px three rows (PV1's phone boards): Bali and the account first, then
 * the links.
 */
const NAV =
  'sticky top-0 flex h-dvh w-54 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border-default bg-surface-card px-3 pt-8 pb-3.5 max-[776px]:static max-[776px]:h-auto max-[776px]:w-auto max-[776px]:flex-row max-[776px]:flex-wrap max-[776px]:items-center max-[776px]:gap-x-1.5 max-[776px]:gap-y-1 max-[776px]:overflow-visible max-[776px]:border-r-0 max-[776px]:border-b max-[776px]:px-4 max-[776px]:py-2.5';
/** The lockup, a link home: its word in the brand's ink, as every board renders it (v2.css's links). */
const BRAND =
  'flex items-center gap-2.25 rounded-item px-2.5 pt-1 pb-4.5 text-lockup text-text-brand max-[776px]:py-1 max-[776px]:pr-3 max-[776px]:pl-1';
/** An item: 14/20 medium in the secondary ink; on its own page grey, semibold, the primary ink. */
const ITEM =
  'flex items-center gap-2.5 rounded-item px-2.5 py-2 text-data text-text-secondary hover:bg-surface-sunken aria-[current=page]:bg-surface-sunken aria-[current=page]:font-semibold aria-[current=page]:text-text-primary';
/** The gap that puts Help and the foot at the bottom; on a phone, the bar's break after Bali. */
const GAP =
  'min-h-6 flex-1 max-[776px]:hidden max-sm:order-2 max-sm:block max-sm:min-h-0 max-sm:basis-full';
const FOOT =
  'mt-2 border-t border-border-default pt-3 max-[776px]:mt-0 max-[776px]:ml-auto max-[776px]:border-t-0 max-[776px]:pt-0 max-sm:order-1';

/** The page beside the menu: left-aligned, 1260 px at most, 30/36/56 in, 22/16/40 on a phone. */
export const SHELL = 'flex max-[776px]:block';
export const PAGE =
  'max-w-[1260px] min-w-0 flex-1 px-9 pt-7.5 pb-14 max-sm:px-4 max-sm:pt-5.5 max-sm:pb-10';

/**
 * The side menu, drawn from what it is given: a teacher's, or a student's (StudentHome). Its foot
 * names the account, its initials beside the name and Sign out an icon; with no name on the
 * account, Sign out in words alone (HomeNoName). A name too long for the foot, such as the sign-in's
 * email that an account with no name of its own shows, stays on one line cut with an ellipsis, whole
 * on hover and to a screen reader; on a phone the foot keeps its place beside Bali, the name cut to
 * fit (MenuNameStates, drawn first).
 */
export function SideMenu({
  role,
  path,
  name,
  leaving,
  onSignOut,
}: {
  role: MenuRole;
  path: string;
  name: string | null;
  leaving: boolean;
  onSignOut: () => void;
}) {
  // Its own page, or one under it (a session's report under Reports, PV14; ReportOpened), or under
  // its other path (a lesson under Your classes, W4; StudentLesson).
  const here = (href: string, under?: string) =>
    path === href ||
    [href !== '/' && href, under].some((root) => root && path.startsWith(`${root}/`));
  const link = ({ href, label, Icon, under }: Item) => (
    <Link
      key={href}
      href={href}
      aria-current={here(href, under) ? 'page' : undefined}
      className={`${ITEM} max-sm:order-3`}
    >
      <Icon size={17} aria-hidden="true" className="shrink-0" />
      {label}
    </Link>
  );
  return (
    <nav aria-label="Main" className={NAV}>
      <Link href="/" translate="no" className={BRAND}>
        <Mark size={20} />
        Bali
      </Link>
      {PAGES[role].map(link)}
      <div className={GAP} />
      {link(HELP)}
      {name ? (
        <div
          className={`flex items-center gap-2.25 pr-1.5 pl-2.5 max-[776px]:p-0 max-sm:min-w-0 max-sm:flex-1 max-sm:basis-0 max-sm:justify-end ${FOOT}`}
        >
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-full bg-avatar-bg text-menu-initials text-avatar-fg"
          >
            {initials(name)}
          </span>
          <span title={name} className="min-w-0 truncate text-menu-name">
            {name}
          </span>
          <button
            type="button"
            aria-label="Sign out"
            aria-disabled={leaving}
            onClick={onSignOut}
            className="ml-auto grid size-9 shrink-0 cursor-pointer place-items-center rounded-item text-text-tertiary hover:bg-surface-sunken hover:text-text-primary aria-disabled:cursor-default aria-disabled:opacity-55 max-sm:ml-0"
          >
            <LogOut size={16} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className={FOOT}>
          <button
            type="button"
            aria-disabled={leaving}
            onClick={onSignOut}
            className={`${ITEM} w-full cursor-pointer aria-disabled:cursor-default aria-disabled:opacity-55`}
          >
            <LogOut size={17} aria-hidden="true" className="shrink-0" />
            {leaving ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </nav>
  );
}

/**
 * The account not read, said in the page's place on every signed-in page, as Home said it
 * (HomeStates' "Loading, before the account answers" and "The account didn't load"): Loading…
 * while it is read, or its failure with Try again, which reads it again. In the page's frame, with
 * no menu: nothing of a teacher's shows before the account reads as one.
 */
export function AccountUnread({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <main className={PAGE}>
      {error ? (
        <div className={`mx-auto max-w-md ${CARD_ALONE}`}>
          <p role="alert">
            <span className="block text-h3">Couldn&apos;t load your account.</span>
            <span className="mt-2 block text-body text-text-secondary">{error}</span>
          </p>
          <Button variant="secondary" onClick={onRetry} className="mt-6">
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

/**
 * The frame of every page (the root layout's), and who is signed in: one read of the account
 * (`readAccount`, the 13+ check before `/v1/me`) as a signed-in page first opens (Home reads it
 * again as it opens), kept as pages change and forgotten once the sign-in is gone; a failed one read
 * again by Try again and on the next page opened; a tab with no sign-in sent to /login. `frameFor`
 * says what to draw. One tree throughout, so the page under it is never remounted as its frame
 * changes (a redeem's turn from the bar to the menu, Present).
 */
export function Shell({ children }: { children: ReactNode }) {
  const api = useApi();
  const router = useRouter();
  const path = usePathname();
  const [home, setHome] = useState<Home | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  // A read under way: the frame asks only when none is.
  const reading = useRef(false);
  // The newest read's number (`readAccount`): only its answer counts.
  const reads = useRef(0);
  // The page the account was last looked at on: a failure is read again on the next one.
  const seen = useRef<string | null>(null);
  // A Sign out under way: a second press sends nothing.
  const [leaving, setLeaving] = useState(false);

  const load = useCallback(
    (fresh = false) => {
      if (fresh) setHome(null);
      setError(null);
      reading.current = true;
      void readAccount(api, reads).then((said) => {
        // A newer read is under way: its answer is the one that counts.
        if (said === null) return;
        reading.current = false;
        if ('home' in said) setHome(said.home);
        else setError(said.error);
      });
    },
    [api],
  );

  // The student home's read every 30 s: never over a read on its way, within a poll's 10 s (#334),
  // and its failure, if one was said, kept until an answer, so it isn't said afresh every 30 s
  // while Bali can't be reached.
  const refresh = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    const limited = { get: <T,>(path: string) => api.get<T>(path, POLL_TIMEOUT_MS) };
    const said = await readAccount(limited, reads);
    // A newer read is under way: its answer is the one that counts.
    if (said === null) return;
    reading.current = false;
    if ('home' in said) {
      setHome(said.home);
      setError(null);
    } else setError(said.error);
  }, [api]);

  // On every page, and again as an answer lands (one landing after a Sign out is forgotten too).
  useEffect(() => {
    const newPage = seen.current !== path;
    seen.current = path;
    const signedIn = getAccessToken() !== null;
    const step = accountStep(path, signedIn, home, error, reading.current, newPage);
    if (step === 'read') load();
    if (step === 'sign in') router.replace('/login');
    if (step === 'forget') {
      setHome(null);
      setError(null);
    }
  }, [path, home, error, load, router]);

  // Back here by the back button with the page kept whole: a signed-in page reloads, so it never
  // shows an account that has since left (`reloadOnRestore`), and its Sign out starts afresh.
  useEffect(() => {
    const back = (e: PageTransitionEvent) => {
      if (reloadOnRestore(e.persisted, window.location.pathname)) window.location.reload();
    };
    window.addEventListener('pageshow', back);
    return () => window.removeEventListener('pageshow', back);
  }, []);

  /**
   * Sign out (S4a): forget the token and end the Cognito session at the hosted UI, which comes back
   * to /login; if the browser can't be sent there, the token is gone all the same and /login says
   * what is left to do.
   */
  function onSignOut() {
    if (leaving) return;
    setLeaving(true);
    if (endSession() === 'local') router.replace('/login');
  }

  const frame = frameFor(path, home, error, presenting);
  const me = home === null || home.kind === 'invite' ? null : home.me;
  const value = useMemo(
    () => ({ home, me, error, load, refresh }),
    [home, me, error, load, refresh],
  );
  return (
    <MeContext value={value}>
      <PresentingContext value={setPresenting}>
        <div className={frame.chrome === 'menu' ? SHELL : undefined}>
          {frame.chrome === 'menu' ? (
            <SideMenu
              role={home?.kind === 'student' ? 'student' : 'teacher'}
              path={path}
              name={me?.user.displayName?.trim() || null}
              leaving={leaving}
              onSignOut={onSignOut}
            />
          ) : frame.chrome === 'bar' ? (
            <PortalBar leaving={leaving} onSignOut={onSignOut} />
          ) : null}
          {frame.hidden ? <AccountUnread error={error} onRetry={() => load()} /> : null}
          <div hidden={frame.hidden} className={frame.framed ? PAGE : undefined}>
            {children}
          </div>
        </div>
      </PresentingContext>
    </MeContext>
  );
}
