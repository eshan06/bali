'use client';

import type { MeResponse, PortalEvent } from '@bali/shared';
import { LogOut } from 'lucide-react';
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

import { countAction } from '@/lib/actions';
import { type ApiClient, UnauthorizedError } from '@/lib/api-client';
import { endSession, getAccessToken, tookSignIn } from '@/lib/auth';
import { errText } from '@/lib/errors';
import { type Home, homeFor } from '@/lib/student-web';
import { useApi } from '@/lib/use-api';

import { ICON_BUTTON } from './button';
import { CARD_ALONE } from './card';
import { CountContext } from './count';
import { Mark } from './mark';
import { initials, PortalBar, TopBar } from './portal-bar';
import { TryAgain } from './try-again';

export { initials };

/** The pages read without signing in (sign-in, its callback, Help, the policies), each with a bar. */
export const SIGNED_OUT_PATHS = /^\/(login|auth|support|privacy|terms)(\/|$)/;

/**
 * How the shell frames a page: the top bar, a teacher's or a student's, or the bar, the page's
 * frame, or nothing yet.
 */
export interface Frame {
  chrome: 'top' | 'bar' | null;
  /** The page in its frame: under the top bar, the bar's (`TOP_PAGE`); else v2's (`PAGE`). */
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
 * under the bar with Sign out (PV5b, the owner's approval of #352's review); then the top bar for a
 * teacher (LO2) and for a student who said 13+ in the app (LO12), but a student's on the invite
 * page, which frames itself under the bar (Invite, PV15), as it does for an account the 13+ check
 * never passed, whose every page has the bar.
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
    return { chrome: 'top', framed: true, hidden: false };
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
 * The shell's reads of the account (`readAccount`), each within its limit (`get`'s), so one always
 * answers. `start` reads it, the newest read's answer handed to `apply`; `reading` says one is on
 * its way until then. `refresh` reads it unless one is on its way, and hands back the read on its
 * way, settling once the newest has answered: a Try again pressed meanwhile holds until then, never
 * let go before any answer (#426's Left).
 */
export function accountReads(
  api: Pick<ApiClient, 'get'>,
  apply: (said: { home: Home } | { error: string | null }) => void,
): { start: () => void; reading: () => boolean; refresh: () => Promise<void> } {
  const reads = { current: 0 };
  let running: Promise<void> | null = null;
  const onItsWay = () => running;
  const start = () => {
    const run = readAccount(api, reads).then((said) => {
      // A newer read is under way: its answer is the one that counts.
      if (said === null) return;
      running = null;
      apply(said);
    });
    running = run;
  };
  return {
    start,
    reading: () => running !== null,
    refresh: async () => {
      if (running === null) start();
      // One begun meanwhile, the page's own, is waited for too.
      for (let run = onItsWay(); run !== null; run = onItsWay()) await run;
    },
  };
}

/**
 * A signed-in page the back button brings back whole (the browser's back-forward cache) is
 * reloaded, never shown as it was kept: its account may have signed out, expired, or given way to
 * another sign-in in this tab since.
 */
export const reloadOnRestore = (persisted: boolean, path: string): boolean =>
  persisted && !SIGNED_OUT_PATHS.test(path);

/** Who is signed in, as the shell last read them: one read, for the top bar and for Home. */
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
   * the answer: the student home's read every 30 s (W4's follow-up), and the account's Try again
   * (`AccountUnread`, PV17a). Settles once the answer of the read it began, or of the one on its
   * way, has landed (`accountReads`).
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

/**
 * v2's page frame (v2.css's `.main`), for a page under the bar and for the account not read:
 * left-aligned, 1260 px at most, 30/36/56 in, 22/16/40 on a phone.
 */
export const PAGE =
  'max-w-[1260px] min-w-0 flex-1 px-9 pt-7.5 pb-14 max-sm:px-4 max-sm:pt-5.5 max-sm:pb-10';

/**
 * The page under the top bar (lock.css's `.wrap.page`; LO2): centred under the bar's row, 1360 px
 * at most, 40 px in at the sides, 32 over and 64 under; under 760 px 16 px in, 24 over and 48 under.
 * A page not yet rebuilt from the lock-only canvas keeps its own look in it, its sides clipped as
 * lock.css clips the page's, so a layer v2 drew for its own wider gutters (the unlock pop-ups', 36 px
 * out) never scrolls the page sideways.
 */
export const TOP_PAGE =
  'mx-auto w-full max-w-[1360px] overflow-x-clip px-10 pt-8 pb-16 max-[760px]:px-4 max-[760px]:pt-6 max-[760px]:pb-12';

/*
 * lock.css's top bar for a student (StudentWebStates, drawn first; LO12), as the teacher's draws it
 * (`TopBar`): on the page's colour with its hairline, in view as the page scrolls; its row 1360 px
 * wide at most, 40 px in, 56 px tall and 16 px in under 760 px, one row there, as no class rides in
 * it and no menu opens. Its places 14.5/20 in the secondary ink, 36 px tall, the page open grey in
 * the primary ink.
 */
const BAR = 'sticky top-0 z-3 border-b border-border-default bg-surface-page';
const ROW =
  'mx-auto flex min-h-15 w-full max-w-[1360px] items-center gap-6 px-10 max-[760px]:min-h-14 max-[760px]:gap-3 max-[760px]:px-4';
const BRAND =
  '-ml-1 inline-flex shrink-0 items-center gap-2 rounded-xs p-1 text-lockup text-text-primary';
const PLACE =
  'inline-flex min-h-9 items-center rounded-item px-3 text-nav text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text-primary aria-[current=page]:bg-surface-sunken aria-[current=page]:text-text-primary';

/** Your classes' pages: a student's home, and a lesson's under it (StudentLesson, lessons on). */
const isYours = (path: string): boolean => path === '/' || path.startsWith('/lessons/');

/**
 * A student's top bar (StudentWeb's frame, StudentWebStates, drawn first; LO12), in place of v2's
 * side menu on every signed-in page of theirs but the invite page: Bali, a link home; Your classes,
 * marked on it and on a lesson's page under it; then Help, and the account, its initials, its name
 * (whole on hover, gone under 1024 px) and Sign out an icon; with no name, Sign out in words, an icon
 * on a phone (BarStates' rule). No class rides in it and no menu opens: under 760 px Your classes
 * goes, Bali leading home, and Help and the account keep their places. Sign out held while it signs
 * out, its words Signing out….
 */
export function StudentBar({
  path,
  name,
  leaving,
  onSignOut,
}: {
  path: string;
  name: string | null;
  leaving: boolean;
  onSignOut: () => void;
}) {
  return (
    <header className={BAR}>
      <div className={ROW}>
        <Link href="/" aria-label="Bali, your classes" translate="no" className={BRAND}>
          <Mark size={22} />
          Bali
        </Link>
        <nav aria-label="Main" className="flex shrink-0 items-center max-[760px]:hidden">
          <Link href="/" aria-current={isYours(path) ? 'page' : undefined} className={PLACE}>
            Your classes
          </Link>
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <Link href="/support" className={PLACE}>
            Help
          </Link>
          <div className="flex min-w-0 items-center gap-2 border-l border-border-default pl-3">
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
                {leaving ? 'Signing out…' : 'Sign out'}
              </button>
            )}
            <button
              type="button"
              aria-label="Sign out"
              aria-disabled={leaving}
              onClick={onSignOut}
              className={`${ICON_BUTTON} ${name ? '' : 'min-[760px]:hidden'}`}
            >
              <LogOut size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * The account not read, said in the page's place on every signed-in page, as Home says it
 * (HomeStates' "Loading, before the account answers" and "The account didn't load"): Loading…
 * while it is read, or its failure, headed as the page, with Try again. Try again reads it again
 * keeping the card, its button held as Loading… until Bali answers, so focus stays on it, and a
 * failure is said again however it is worded (PV17a; HomeInterimStates, drawn first); read, focus
 * lands on the page's own heading (`TryAgain`). Said in the page's one `<main>` (`PagePlace`), in
 * the page's frame with no menu: nothing of a teacher's shows before the account reads as one.
 */
export function AccountUnread({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => Promise<void>;
}) {
  return error ? (
    <div className={`mx-auto max-w-md ${CARD_ALONE}`}>
      <TryAgain size="md" onRetry={onRetry} then={[]} className="mt-3.5">
        <div role="alert">
          <h1 className="text-body font-semibold">Couldn&apos;t load your account.</h1>
          <p className="text-body text-text-secondary">{error}</p>
        </div>
      </TryAgain>
    </div>
  ) : (
    <p role="status" className="mx-auto max-w-md text-center text-body text-text-secondary">
      Loading…
    </p>
  );
}

/**
 * The page's place, and its one `<main>` in every state (the owner's follow-up of 2026-10-16): on
 * a signed-in page the shell's own, holding the account not read (`AccountUnread`) with the page
 * waiting hidden after it (PV5b), else the page, in the top bar's frame under it (a teacher's since
 * LO2, a student's since LO12), v2's under the bar, or alone in Present. A page draws its parts in
 * it, never a `<main>` of its own, so none waits hidden
 * beside the shell's. One element throughout, so the page is never remounted as its frame changes.
 * A page read without signing in draws its own bar and its own `<main>`: going there from a
 * signed-in page, or back, opens another page, mounted afresh either way.
 */
export function PagePlace({
  signedOut,
  frame,
  error,
  onRetry,
  children,
}: {
  signedOut: boolean;
  frame: Frame;
  error: string | null;
  onRetry: () => Promise<void>;
  children: ReactNode;
}) {
  if (signedOut) return <div>{children}</div>;
  return (
    <main
      className={
        frame.chrome === 'top' ? TOP_PAGE : frame.framed || frame.hidden ? PAGE : undefined
      }
    >
      {frame.hidden ? <AccountUnread error={error} onRetry={onRetry} /> : null}
      <div hidden={frame.hidden}>{children}</div>
    </main>
  );
}

/**
 * The frame of every page (the root layout's), and who is signed in: one read of the account
 * (`readAccount`, the 13+ check before `/v1/me`) as a signed-in page first opens (Home reads it
 * again as it opens), kept as pages change and forgotten once the sign-in is gone; a failed one read
 * again by Try again and on the next page opened; a tab with no sign-in sent to /login. `frameFor`
 * says what to draw, and the page's one `<main>` is the shell's (`PagePlace`). One tree throughout,
 * so the page under it is never remounted as its frame changes (a redeem's turn from the bar to the
 * top bar, Present).
 */
export function Shell({ children }: { children: ReactNode }) {
  const api = useApi();
  const router = useRouter();
  const path = usePathname();
  const [home, setHome] = useState<Home | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presenting, setPresenting] = useState(false);
  // The account's reads, each within a read's 10 s (#334), kept for the tab's life with its one
  // client: the frame asks only when none is on its way, and only the newest one's answer counts.
  const [reads] = useState(() =>
    accountReads(api, (said) => {
      if ('home' in said) {
        setHome(said.home);
        setError(null);
      } else setError(said.error);
    }),
  );
  // The page the account was last looked at on: a failure is read again on the next one.
  const seen = useRef<string | null>(null);
  // A Sign out under way: a second press sends nothing.
  const [leaving, setLeaving] = useState(false);

  const load = useCallback(
    (fresh = false) => {
      if (fresh) setHome(null);
      setError(null);
      reads.start();
    },
    [reads],
  );

  // The student home's read every 30 s, and the account's Try again (PV17a): never a second read
  // beside one on its way, which it waits for instead, and its failure, if one was said, kept until
  // an answer, so it isn't said afresh every 30 s while Bali can't be reached, and Try again keeps
  // its card, held until the answer.
  const { refresh } = reads;

  // On every page, and again as an answer lands (one landing after a Sign out is forgotten too).
  useEffect(() => {
    const newPage = seen.current !== path;
    seen.current = path;
    const signedIn = getAccessToken() !== null;
    const step = accountStep(path, signedIn, home, error, reads.reading(), newPage);
    if (step === 'read') load();
    if (step === 'sign in') router.replace('/login');
    if (step === 'forget') {
      setHome(null);
      setError(null);
    }
  }, [path, home, error, load, reads, router]);

  // A teacher's actions, counted for PostHog through Bali's API (A3b): only while the account
  // reads as a teacher's. A sign-in counts once, as its account first does.
  const teacher = home?.kind === 'teacher';
  const count = useMemo(
    () => (teacher ? (event: PortalEvent) => countAction(api, event) : null),
    [api, teacher],
  );
  useEffect(() => {
    if (count !== null && tookSignIn()) count('portal_signed_in');
  }, [count]);

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
  // The account's name, as the top bar names it: none for an account with no name.
  const name = me?.user.displayName?.trim() || null;
  return (
    <MeContext value={value}>
      <CountContext value={count}>
        <PresentingContext value={setPresenting}>
          <div>
            {frame.chrome === 'top' && home?.kind === 'teacher' ? (
              <TopBar
                path={path}
                name={name}
                classes={home.me.classes}
                leaving={leaving}
                onSignOut={onSignOut}
                refresh={refresh}
              />
            ) : frame.chrome === 'top' ? (
              <StudentBar path={path} name={name} leaving={leaving} onSignOut={onSignOut} />
            ) : frame.chrome === 'bar' ? (
              <PortalBar leaving={leaving} onSignOut={onSignOut} />
            ) : null}
            <PagePlace
              signedOut={SIGNED_OUT_PATHS.test(path)}
              frame={frame}
              error={error}
              onRetry={refresh}
            >
              {children}
            </PagePlace>
          </div>
        </PresentingContext>
      </CountContext>
    </MeContext>
  );
}
