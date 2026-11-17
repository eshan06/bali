// @vitest-environment jsdom
import type { MeResponse, Presentation } from '@bali/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '@/lib/api-client';
import { bellTime } from '@/lib/session-controls';
import { ACCOUNT_EVERY_MS } from '@/lib/student-web';

import { LEDGER_LIVE } from './card';
import { StudentHome } from './student-home';

/*
 * A student's home (LO12; the lock-only canvas's StudentWeb, its other moments on StudentWebStates,
 * drawn first), as a student meets it (the owner's decision of 2026-10-22: the portal's tests drive
 * the page), StudentWeb's sample data in it: Biology, period 3 in class now with Ms. Rivera, 23:04
 * left of its 50 minutes, and Chemistry, period 5 with Mr. Okafor. Bali's answers come from a
 * stand-in `fetch` under the portal's own client: each class's read of its session, held until a
 * test gives one. Converted from `student-home.test.ts`'s read of the home's source and its markup
 * (LO12), with LO1's tests of the lessons switch.
 */
const bali = vi.hoisted(() => ({
  /** Every path the page asked Bali for. */
  asked: [] as string[],
  /** How a path answers; a path with none is held, as a read on its way. */
  answers: new Map<string, () => Promise<Response>>(),
  client: null as ReturnType<typeof import('@/lib/api-client').createApiClient> | null,
}));
vi.mock('@/lib/use-api', () => ({ useApi: () => bali.client, useSignOut: () => () => undefined }));
vi.mock('@/lib/monitoring', () => ({ captureApiFailure: vi.fn() }));

const STARTED = '2026-10-12T14:05:00.000Z';
const BELL = '2026-10-12T14:55:00.000Z';
/** 23:04 before the bell, as StudentWeb's ring draws it. */
const NOW = Date.parse(BELL) - (23 * 60 + 4) * 1000;
/** Biology's read of its session. */
const READ = '/v1/sessions/s-bio/presentation';

type Class = MeResponse['classes'][number];
const klass = (id: string, name: string, teacher: string | null, live = false): Class => ({
  id,
  name,
  teacher: { displayName: teacher },
  enrollmentId: `e-${id}`,
  liveSession: live ? { id: `s-${id}`, startedAt: STARTED, endsAt: BELL } : null,
});
const BIOLOGY = klass('bio', 'Biology, period 3', 'Ms. Rivera', true);
const CHEMISTRY = klass('chem', 'Chemistry, period 5', 'Mr. Okafor');
const ENGLISH = klass('eng', 'AP English, period 6', 'Ms. Chen');

const me = (...classes: Class[]): MeResponse => ({
  user: { id: 'u1', role: 'student', displayName: 'Ana Rodríguez' },
  classes,
  session: null,
  armed: false,
});

/** A class's read answered: its session runs, or not, and the student's phone in it. */
const says =
  (phone: Presentation['phone'], running = true) =>
  (): Promise<Response> => {
    const body: Presentation = { running, question: null, slide: null, phone };
    return Promise.resolve(Response.json(body, { headers: { etag: `"${JSON.stringify(body)}"` } }));
  };
/** A read with no answer: no connection. */
const offline = () => Promise.reject(new TypeError('Failed to fetch'));

afterEach(() => {
  // Focus off first, so no Try again unmounted here hands focus on in the next test's page.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  bali.asked.length = 0;
  bali.answers.clear();
});

/**
 * The home as it opens at NOW, in the shell's one `<main>`, on this page's own clock unless `clock`
 * is false, its reads the test's: `failed`, the account's last read failed; `onRead` and
 * `onRefresh`, the shell's.
 */
function open(
  account: MeResponse,
  over: Partial<Parameters<typeof StudentHome>[0]> = {},
  clock = true,
) {
  if (clock) vi.useFakeTimers({ now: NOW });
  bali.client = createApiClient({
    baseUrl: 'http://api',
    getToken: () => 'token',
    fetchImpl: (url) => {
      const path = (url as string).replace('http://api', '');
      bali.asked.push(path);
      return bali.answers.get(path)?.() ?? new Promise<Response>(() => undefined);
    },
  });
  const props: Parameters<typeof StudentHome>[0] = {
    me: account,
    failed: false,
    onRead: vi.fn(),
    onRefresh: vi.fn(() => Promise.resolve()),
    ...over,
  };
  const view = render(
    <main>
      <StudentHome {...props} />
    </main>,
  );
  return { props, view };
}

/** This page's clock moved on by `ms`, each answer it brings drawn. */
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

/** Each class's row: its cells' words. */
const rows = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    );
/** A class's row, by its name. */
const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement;
/** What the live row's phone says, each of its parts. */
const phone = (name = 'Biology, period 3') =>
  Array.from(within(rowOf(name)).getByRole('status').children, (part) => part.textContent);
/** The line saying Bali can't be reached, if the page says it. */
const unreached = () => screen.queryByText(/^Can.t reach Bali right now/);

describe('a student’s home (StudentWeb)', () => {
  it('heads the page Your classes over a ledger: each class in session first, in the live green, then the rest, each part in the account’s order, each with its teacher', () => {
    open(me(CHEMISTRY, BIOLOGY, ENGLISH));
    expect(screen.getByRole('heading', { level: 1, name: 'Your classes' })).toBeTruthy();
    expect(screen.getAllByRole('columnheader').map((head) => head.textContent)).toEqual([
      'Class',
      'Teacher',
      'Now',
    ]);
    expect(rows()).toEqual([
      ['Biology, period 3', 'Ms. Rivera', 'In class nowYour phoneChecking…'],
      ['Chemistry, period 5', 'Mr. Okafor', ''],
      ['AP English, period 6', 'Ms. Chen', ''],
    ]);
    expect(rowOf('Biology, period 3').className).toBe(LEDGER_LIVE);
    expect(rowOf('Chemistry, period 5').className).toBe('');
    // How to join, under the classes; nothing to press anywhere on the page.
    expect(screen.getByText('To join a class, use the Bali app on your iPhone.')).toBeTruthy();
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('draws In class now with the ring of the session left, 23:04 of its 50 minutes, and no countdown or bell', () => {
    open(me(BIOLOGY));
    const live = within(rowOf('Biology, period 3')).getByText('In class now');
    const arc = live.querySelectorAll('svg circle')[1];
    const around = 2 * Math.PI * (8 - 2.5 / 2);
    const share = (23 * 60 + 4) / (50 * 60);
    expect(arc?.getAttribute('stroke-dasharray')).toBe(
      `${(share * around).toFixed(1)} ${around.toFixed(1)}`,
    );
    expect(screen.queryByText('23:04')).toBeNull();
    expect(screen.queryByText(bellTime(BELL))).toBeNull();
  });

  it('gives the student’s phone from the class’s own read: Checking… until it answers, then its chip, never from the account', async () => {
    let give!: (answer: Response) => void;
    bali.answers.set(READ, () => new Promise<Response>((resolve) => (give = resolve)));
    open(me(BIOLOGY, CHEMISTRY));
    await tick(0);
    expect(bali.asked).toEqual([READ]);
    expect(phone()).toEqual(['Your phone', 'Checking…']);
    await act(async () => give(await says({ state: 'focused', lastSeenAt: null })()));
    await tick(0);
    expect(phone()).toEqual(['Your phone', 'Focused']);
    // Read again every 2 s, as the lesson page reads it.
    bali.answers.set(READ, says({ state: 'unlocked', lastSeenAt: null }));
    await tick(2_000);
    expect(phone()).toEqual(['Your phone', 'Unlocked']);
    expect(bali.asked).toEqual([READ, READ]);
  });

  it('says Bali can’t be reached under the classes while a class’s reads fail before one answers, and no more once one answers (StudentChipUnreached)', async () => {
    bali.answers.set(READ, offline);
    open(me(BIOLOGY, CHEMISTRY));
    await tick(0);
    const line = unreached();
    expect(line?.textContent).toBe(
      "Can't reach Bali right now, so this page may be behind. It keeps trying.",
    );
    // Checking… stays in the chip's place; the line under the classes, over how to join.
    expect(phone()).toEqual(['Your phone', 'Checking…']);
    const table = screen.getByRole('table');
    const join = screen.getByText('To join a class, use the Bali app on your iPhone.');
    expect(table.compareDocumentPosition(line as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect((line as Node).compareDocumentPosition(join) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // The reads go on every 2 s: one answers, and the line goes.
    bali.answers.set(READ, says({ state: 'focused', lastSeenAt: null }));
    await tick(2_000);
    expect(unreached()).toBeNull();
    expect(phone()).toEqual(['Your phone', 'Focused']);
  });

  it('keeps the chip as of its last answer while a later read fails, and says nothing more', async () => {
    bali.answers.set(READ, says({ state: 'focused', lastSeenAt: null }));
    open(me(BIOLOGY));
    await tick(0);
    bali.answers.set(READ, offline);
    await tick(2_000);
    expect(phone()).toEqual([
      'Your phone',
      'Focused',
      `as of ${bellTime(new Date(NOW).toISOString())}`,
    ]);
    expect(unreached()).toBeNull();
  });

  it('reads the account again once a class’s read says its session is over, and reads that class no more', async () => {
    bali.answers.set(READ, says(null, false));
    const { props } = open(me(BIOLOGY));
    await tick(0);
    expect(props.onRead).toHaveBeenCalledTimes(1);
    await tick(10_000);
    expect(bali.asked).toEqual([READ]);
  });

  it('at the bell by this computer’s clock, takes the class out of the live green and reads the account again', async () => {
    const { props } = open(me(BIOLOGY, CHEMISTRY));
    await tick(23 * 60_000 + 3_000);
    expect(props.onRead).not.toHaveBeenCalled();
    expect(screen.getByText('In class now')).toBeTruthy();
    await tick(1_000);
    expect(props.onRead).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('In class now')).toBeNull();
    expect(rows()).toEqual([
      ['Biology, period 3', 'Ms. Rivera', ''],
      ['Chemistry, period 5', 'Mr. Okafor', ''],
    ]);
  });

  it('gives every class in session a live row of its own, each read on its own; a teacher with no name leaves the cell empty', async () => {
    const live = { id: 's-eng', startedAt: STARTED, endsAt: BELL };
    open(
      me(
        BIOLOGY,
        CHEMISTRY,
        { ...ENGLISH, teacher: { displayName: ' ' }, liveSession: live },
        { ...klass('art', 'Art', null) },
      ),
    );
    await tick(0);
    expect(rows()).toEqual([
      ['Biology, period 3', 'Ms. Rivera', 'In class nowYour phoneChecking…'],
      ['AP English, period 6', '', 'In class nowYour phoneChecking…'],
      ['Chemistry, period 5', 'Mr. Okafor', ''],
      ['Art', '', ''],
    ]);
    expect(rowOf('AP English, period 6').className).toBe(LEDGER_LIVE);
    expect(bali.asked).toEqual([READ, '/v1/sessions/s-eng/presentation']);
  });

  it('with no class yet, says StudentWeb’s line, and gives a teacher the way to the invite page', () => {
    open(me());
    expect(screen.getByRole('heading', { level: 1, name: 'Your classes' })).toBeTruthy();
    expect(
      screen.getByText(
        'Join one in the Bali app on your iPhone, with the class code from your teacher.',
      ),
    ).toBeTruthy();
    const invite = screen.getByRole('link', { name: 'Enter your invite code' });
    expect(invite.getAttribute('href')).toBe('/invite');
    expect(invite.parentElement?.textContent).toBe(
      'Setting up a teacher account? Enter your invite code',
    );
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('To join a class, use the Bali app on your iPhone.')).toBeNull();
  });
});

describe('the account’s reads (the shell’s, handed to the home)', () => {
  it('says a later read that failed under the title, over what was read before, Try again held until it answers, focus then on the title (StudentWebStates)', async () => {
    let answer!: () => void;
    const onRefresh = vi.fn(() => new Promise<void>((done) => (answer = done)));
    const { props, view } = open(me(CHEMISTRY), { failed: true, onRefresh }, false);
    const title = screen.getByRole('heading', { level: 1, name: 'Your classes' });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe("Bali couldn't load your classes.");
    expect(title.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(
      alert.compareDocumentPosition(screen.getByRole('table')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(rows()).toEqual([['Chemistry, period 5', 'Mr. Okafor', '']]);

    const again = screen.getByRole('button', { name: 'Try again' });
    again.focus();
    fireEvent.click(again);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(again.textContent).toBe('Loading…');
    expect(again.getAttribute('aria-disabled')).toBe('true');
    // A second press while it reads sends nothing.
    fireEvent.click(again);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // It answers, the failure gone: focus on the page's title, never left on the body.
    act(() => answer());
    await act(() => Promise.resolve());
    view.rerender(
      <main>
        <StudentHome {...props} failed={false} />
      </main>,
    );
    await act(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(title);
  });

  it('reads the account again as its tab comes back into view', () => {
    const { props } = open(me(CHEMISTRY));
    act(() => {
      fireEvent(document, new Event('visibilitychange'));
    });
    expect(props.onRead).toHaveBeenCalledTimes(1);
  });

  it('reads it again every 30 s while no class is in session, never while one is: the bell and the classes’ own reads take over (the owner, 2026-10-16)', async () => {
    const idle = open(me(CHEMISTRY));
    await tick(ACCOUNT_EVERY_MS);
    expect(idle.props.onRefresh).toHaveBeenCalledTimes(1);
    cleanup();
    const live = open(me(BIOLOGY, CHEMISTRY));
    await tick(ACCOUNT_EVERY_MS * 2);
    expect(live.props.onRefresh).not.toHaveBeenCalled();
  });
});

describe('no lesson piece, whichever way the lessons switch is set (LO12; ARCHITECTURE, Web portal, decision 8)', () => {
  it.each(['on', 'off'])(
    'lessons %s: no way into a lesson and no line about one, the phone’s read going on',
    async (said) => {
      vi.stubEnv('NEXT_PUBLIC_LESSONS', said);
      open(me(BIOLOGY, CHEMISTRY));
      await tick(0);
      expect(screen.queryAllByRole('link')).toEqual([]);
      expect(document.querySelector('a[href^="/lessons/"]')).toBeNull();
      expect(screen.queryByText(/slides|questions|lesson/i)).toBeNull();
      expect(bali.asked).toEqual([READ]);
    },
  );
});
