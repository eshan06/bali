import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type {
  EventType,
  FeedEvent,
  ReportStudent,
  RosterStudent,
  SessionReportQuestion,
  SessionReportResponse,
  UnlockReason,
} from '@bali/shared';
import { sessionReport } from '@bali/shared';
import { createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { sessionWhen, type SessionWindow } from '../lib/recap';
import type { SessionPage, SessionQuestions } from '../lib/reports';
import { SessionReport, SessionReportPage } from './session-report';

/*
 * A session's report on its own page (PV14), as ReportOpened draws it, ReportStates' two lines for
 * it, and the intermediate states drawn first on the canvas (ReportPageStates, ReportPhone):
 * rendered in each, the way back to Reports, the session's day over its times, its recap card
 * ("This session"), its Unlocks table and its Questions card (L7c, report-questions.test.ts
 * draws it in each state); the route's ids and the page's reads from their sources.
 */
const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('not found');
  }),
);
vi.mock('next/navigation', () => ({ notFound }));
const { default: Route } = await import('../app/reports/[classId]/[sessionId]/page');
const source = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

/** 9:05 to 9:55 on ReportOpened's day, Mon, Oct 12. */
const AT = (minute: number) => new Date(Date.UTC(2026, 9, 12, 14) + minute * 60_000).toISOString();
const WINDOW: SessionWindow = { startedAt: AT(5), endsAt: AT(55), endedAt: AT(55) };

let seq = 0;
function event(
  type: EventType,
  userId: string | null,
  minute: number,
  payload: Record<string, unknown> | null = null,
): FeedEvent {
  seq += 1;
  return { seq, eventId: `e${seq}`, type, userId, occurredAt: AT(minute), payload };
}

/** R2's report on the session, as its route answers it, each named by their id. */
function reportOf(events: readonly FeedEvent[]): SessionReportResponse {
  const r = sessionReport(
    { startedAt: new Date(WINDOW.startedAt), endsAt: new Date(WINDOW.endsAt), endedAt: null },
    events.map((e) => ({ ...e, occurredAt: new Date(e.occurredAt) })),
    new Date(AT(70)),
  );
  const named = (id: string): ReportStudent => ({ id, displayName: id });
  return {
    ended: true,
    ...WINDOW,
    joined: r.joined.map(named),
    focusMinutes: Math.round(r.focusMinutes),
    averageFocusMinutes: r.averageFocusMinutes === null ? null : Math.round(r.averageFocusMinutes),
    silentMinutes: Math.round(r.silentMinutes),
    unlocks: r.unlocks.map(({ eventId, studentId, occurredAt, reason, recordedAs }) => ({
      eventId,
      student: named(studentId),
      occurredAt: occurredAt.toISOString(),
      reason,
      recordedAs,
    })),
    protectionOffs: r.protectionOffs.map(({ eventId, studentId, occurredAt, recordedAs }) => ({
      eventId,
      student: named(studentId),
      occurredAt: occurredAt.toISOString(),
      recordedAs,
    })),
  };
}

const enrolled = (id: string): RosterStudent => ({
  enrollmentId: `n-${id}`,
  studentId: id,
  displayName: id,
  joinedAt: AT(0),
});
const ROSTER = ['Ana Rodríguez', 'Jaylen Brooks', 'Diego Ramírez', 'Zuri Mensah'].map(enrolled);

/** ReportOpened's moments, a few of them: Jaylen's bathroom break, Diego's unlock with no reason. */
function board(): FeedEvent[] {
  return [
    event('session_started', null, 5),
    event('tap_in', 'Ana Rodríguez', 5),
    event('tap_in', 'Jaylen Brooks', 6),
    event('tap_in', 'Diego Ramírez', 6),
    event('unlock', 'Jaylen Brooks', 18, { reason: 'bathroom' }),
    event('refocus', 'Jaylen Brooks', 24),
    event('unlock', 'Diego Ramírez', 31),
    event('session_expired', null, 55),
  ];
}
const ready = (events: FeedEvent[], report = reportOf(events)): SessionPage => ({
  kind: 'ready',
  session: WINDOW,
  report,
  events,
  roster: ROSTER,
});

/** A question it asked, ReportOpened's first: its answer shown, its breakdown in. */
const ASKED: SessionReportQuestion = {
  id: '0199e3a1-0000-7000-8000-000000000001',
  prompt: 'Which value of x solves x² − 5x + 6 = 0?',
  options: ['x = 1', 'x = 2', 'x = 4', 'x = 6'],
  correctOption: 1,
  revealed: true,
  open: false,
  openedAt: AT(18),
  answered: 21,
  eligible: 28,
  counts: [3, 14, 1, 3],
};
/** It asked none: no Questions card. */
const NONE_ASKED: SessionQuestions = { kind: 'ready', questions: [] };

/** Every space read as one, as Intl's narrow no-break space before AM and PM. */
const plain = (s: string) => s.replace(/\s/g, ' ').replace(/&#x27;/g, "'");
const render = (
  page: SessionPage,
  className: string | null = 'Biology, period 3',
  questions: SessionQuestions = NONE_ASKED,
) =>
  plain(
    renderToStaticMarkup(
      createElement(SessionReport, {
        classId: 'c1',
        className,
        page,
        questions,
        onRetry: () => undefined,
        onRetryQuestions: () => undefined,
      }),
    ),
  );
/** The text of the page, its tags dropped. */
const text = (html: string) => html.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
const clock = (minute: number) =>
  plain(
    new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(
      new Date(AT(minute)),
    ),
  );
const { day, times } = sessionWhen(WINDOW);
/** The Unlocks table's rows: each cell's words. */
const unlockRows = (html: string) =>
  [...(/<tbody[^>]*>([^]*)<\/tbody>/.exec(html)?.[1] ?? '').matchAll(/<tr>([^]*?)<\/tr>/g)].map(
    ([, row = '']) => text(row),
  );

describe('the way back (ReportOpened)', () => {
  it('leads to Reports with the class picked, its name after Reports, beside its arrow', () => {
    const html = render({ kind: 'loading' });
    const back = /<a class="([^"]*)" href="([^"]*)">([^]*?)<\/a>/.exec(html);
    expect(back?.[2]).toBe('/reports?class=c1');
    // v2's `back`: 14/20 semibold in the brand's ink, 6 px from its 16 px arrow, held to its words.
    expect(back?.[1]?.split(' ')).toEqual(
      expect.arrayContaining([
        'self-start',
        'wrap-anywhere',
        'inline-flex',
        'gap-1.5',
        'text-data',
        'font-semibold',
        'text-text-brand',
        'hover:underline',
      ]),
    );
    expect(back?.[3]).toMatch(
      /^<svg[^>]*\bwidth="16"[^>]*\blucide-arrow-left\b[^>]*>[^]*<\/svg>Reports · Biology, period 3$/,
    );
  });

  it('says Reports alone for a class the account doesn’t list (ReportPageStates)', () => {
    expect(text(render({ kind: 'error', message: 'not your class' }, null))).toMatch(
      /^\|Reports\|Couldn't load this session\.\|not your class\|Try again\|$/,
    );
  });
});

describe('a session’s page in each state', () => {
  it('says it is loading under the way back, and nothing else (ReportStates, ReportPageStates)', () => {
    const html = render({ kind: 'loading' });
    expect(text(html)).toBe('|Reports · Biology, period 3|Loading this session…|');
    expect(html).toMatch(
      /<\/a><p role="status" class="text-body text-text-secondary">Loading this session…<\/p><\/main>$/,
    );
  });

  it('says why it couldn’t load in a card, Try again reading it again (ReportStates)', () => {
    const html = render({ kind: 'error', message: "Couldn't reach Bali." });
    expect(html).toMatch(
      /<div class="[^"]*\bshadow-1\b[^"]*"><p role="alert" class="text-body"><span class="block font-semibold">Couldn't load this session\.<\/span><span class="text-text-secondary">Couldn't reach Bali\.<\/span><\/p><button type="button" class="[^"]*\bmt-3\.5\b[^"]*">Try again<\/button><\/div>/,
    );
    expect(html).not.toMatch(/<h1|Loading/);
  });

  it('heads the session with its day over its times, then its card and its unlocks (ReportOpened)', () => {
    const html = render(ready(board()));
    expect(html).toMatch(
      /^<main class="flex flex-col gap-5\.5"><a [^>]*>[^]*?<\/a><header><h1 class="text-page-title">([^<]*)<\/h1><p class="mt-0\.5 text-meta text-text-secondary">([^<]*)<\/p><\/header><section aria-labelledby="([^"]+)" class="@container flex flex-col gap-4\.5 [^"]*\bshadow-1\b[^"]*"><h2 id="\3" class="text-section-label text-text-tertiary uppercase">This session<\/h2>/,
    );
    expect(text(html)).toContain(`|${plain(day)}|${plain(times)}|This session|Joined|3|`);
    // The class page's recap whole: the figures, the note on silence, then the groups.
    expect(text(html)).toContain('|Focused part of the time · 2|');
    expect(text(html)).toContain('|Focused the whole time · 1|');
    expect(text(html)).toContain("|Didn't join · 1|Zuri Mensah|");
    // No "Last session", no Open its report: this is its report.
    expect(html).not.toMatch(/Last session|Open its report/);
  });

  it('lists every unlock, oldest first: who, when and the reason, none in the tertiary ink', () => {
    const html = render(ready(board()));
    expect(html).toMatch(
      /<h2 id="([^"]+)" class="mb-3 [^"]*">Unlocks · 2<\/h2><div class="overflow-x-auto [^"]*"><table aria-labelledby="\1"/,
    );
    expect(text(/<thead>[^]*<\/thead>/.exec(html)?.[0] ?? '')).toBe('|Student|When|Reason|');
    expect(unlockRows(html)).toEqual([
      `|Jaylen Brooks|${clock(18)}|Bathroom|`,
      `|Diego Ramírez|${clock(31)}|No reason given|`,
    ]);
    // The student as the row's header, bold as the board's `<b>`; the time right, on one line.
    expect(html).toMatch(
      /<tr><th scope="row" class="[^"]*\bfont-bold\b[^"]*">Jaylen Brooks<\/th><td class="[^"]*\btext-right whitespace-nowrap\b[^"]*">/,
    );
    expect(html).toMatch(/<td class="[^"]*\btext-text-tertiary\b[^"]*">No reason given<\/td>/);
  });

  it('says each reason as the tile does, one this tab doesn’t know as none', () => {
    const report = reportOf(board());
    const reasons = (['nurse', 'other', 'counselor'] as UnlockReason[]).map((reason) => {
      const one = { ...report, unlocks: [{ ...report.unlocks[0], reason }] };
      return unlockRows(render(ready(board(), one)))[0]?.split('|')[3];
    });
    expect(reasons).toEqual(['Nurse', 'Other reason', 'No reason given']);
  });

  it('has no Unlocks table when there were none, the card saying so (ReportPageStates)', () => {
    const events = [event('tap_in', 'Ana Rodríguez', 5)];
    const html = render(ready(events));
    expect(text(html)).toContain('|No unlocks.|');
    expect(html).not.toMatch(/Unlocks ·|<table/);
  });

  it('says nobody joined, with no Unlocks table but for an unlock from someone who never joined', () => {
    const nobody = render(ready([]));
    expect(text(nobody)).toBe(
      `|Reports · Biology, period 3|${plain(day)}|${plain(times)}|This session|Nobody joined this session.|`,
    );
    // A tap a later one of hers went ahead of (A14), and the unlock sent under it: listed.
    const events = [
      event('tap_in', 'Zuri Mensah', 8, { recorded_as: 'superseded' }),
      event('unlock', 'Zuri Mensah', 9, { reason: 'nurse', recorded_as: 'no_live_participation' }),
    ];
    const html = render(ready(events));
    expect(text(html)).toContain('|Nobody joined this session.|');
    expect(unlockRows(html)).toEqual([`|Zuri Mensah|${clock(9)}|Nurse|`]);
  });
});

describe('its Questions card (L7c; ReportOpened, ReportQuestionsStates)', () => {
  const sections = (html: string) =>
    [...html.matchAll(/<h2 [^>]*>([^<]*)<\/h2>/g)].map(([, words]) => words);

  it('comes last, after the Unlocks table, or after the card when there were no unlocks', () => {
    const asked: SessionQuestions = { kind: 'ready', questions: [ASKED] };
    const html = render(ready(board()), 'Biology, period 3', asked);
    expect(sections(html)).toEqual(['This session', 'Unlocks · 2', 'Questions']);
    expect(text(html)).toContain(`|Questions|1 asked in this session|${clock(18)} · Answer shown|`);
    expect(html).toMatch(/<\/section><\/main>$/);
    const calm = render(ready([event('tap_in', 'Ana Rodríguez', 5)]), 'Biology, period 3', asked);
    expect(sections(calm)).toEqual(['This session', 'Questions']);
  });

  it('none asked: the page ends at its Unlocks table, or at its card', () => {
    expect(sections(render(ready(board())))).toEqual(['This session', 'Unlocks · 2']);
    expect(render(ready(board()))).toMatch(/<\/table><\/div><\/section><\/main>$/);
    expect(sections(render(ready([event('tap_in', 'Ana Rodríguez', 5)])))).toEqual([
      'This session',
    ]);
  });

  it('says its own loading and failure under its title, the report above it kept', () => {
    const loading = render(ready(board()), 'Biology, period 3', { kind: 'loading' });
    expect(text(loading)).toMatch(/\|Unlocks · 2\|[^]*\|Questions\|Loading…\|$/);
    const failed = render(ready(board()), 'Biology, period 3', { kind: 'error' });
    expect(text(failed)).toContain(`|${plain(day)}|${plain(times)}|This session|`);
    expect(text(failed)).toMatch(
      /\|Questions\|Bali couldn't load this session's questions\.\|Try again\|$/,
    );
    expect(failed).not.toContain("Couldn't load this session.");
  });

  it('shows nothing of it while the page itself loads or didn’t load', () => {
    const asked: SessionQuestions = { kind: 'ready', questions: [ASKED] };
    expect(render({ kind: 'loading' }, 'Biology, period 3', asked)).not.toContain('Questions');
    const failed = render({ kind: 'error', message: "Couldn't reach Bali." }, null, {
      kind: 'error',
    });
    expect(text(failed)).toBe(
      "|Reports|Couldn't load this session.|Couldn't reach Bali.|Try again|",
    );
  });
});

describe('its URL and its reads (from their sources)', () => {
  const ID = '0199e3a1-0000-7000-8000-00000000000a';
  const CLASS = '0199e3a1-0000-7000-8000-00000000000c';

  it('is a page for a class and a session each an id the API mints, else none', async () => {
    const page = await Route({ params: Promise.resolve({ classId: CLASS, sessionId: ID }) });
    expect(isValidElement(page) && page.type).toBe(SessionReportPage);
    expect(isValidElement(page) && page.props).toEqual({ classId: CLASS, sessionId: ID });
    for (const [classId, sessionId] of [
      ['..', ID],
      [CLASS, '..'],
      ['c1', ID],
      [CLASS, `${ID}/..`],
    ]) {
      notFound.mockClear();
      await expect(Route({ params: Promise.resolve({ classId, sessionId }) })).rejects.toThrow(
        'not found',
      );
      expect(notFound).toHaveBeenCalledOnce();
    }
  });

  it('reads the session as it opens and again by Try again, its class named from the shell', () => {
    const component = source('./session-report.tsx');
    expect(component).toMatch(
      /void readSessionPage\(api, classId, sessionId\)\.then\(\(next\) => \{\s*if \(live\) setPage\(next\);\s*\}\);/,
    );
    expect(component).toMatch(/\}, \[api, classId, sessionId, attempt, router\]\);/);
    expect(component).toMatch(
      /onRetry=\{\(\) => \{\s*setPage\(\{ kind: 'loading' \}\);\s*setQuestions\(\{ kind: 'loading' \}\);\s*setAttempt\(\(n\) => n \+ 1\);\s*\}\}/,
    );
    // The account the shell read once: no read of the class's own for its name.
    expect(component).toMatch(
      /className=\{me\?\.classes\.find\(\(c\) => c\.id === classId\)\?\.name \?\? null\}/,
    );
    expect(component).not.toMatch(/api\.get/);
  });

  it('reads its questions at once with the page, again by the page’s Try again and by the card’s own', () => {
    const component = source('./session-report.tsx');
    // Signed in only (the page's read sends anyone else to sign in), and nothing from a read the
    // page or the card has asked again since.
    expect(component).toMatch(
      /useEffect\(\(\) => \{\s*if \(!getAccessToken\(\)\) return;\s*let live = true;\s*void readSessionQuestions\(api, classId, sessionId\)\.then\(\(next\) => \{\s*if \(live\) setQuestions\(next\);\s*\}\);\s*return \(\) => \{\s*live = false;\s*\};\s*\}, \[api, classId, sessionId, attempt, asked\]\);/,
    );
    expect(component).toMatch(
      /onRetryQuestions=\{\(\) => \{\s*setQuestions\(\{ kind: 'loading' \}\);\s*setAsked\(\(n\) => n \+ 1\);\s*\}\}/,
    );
    // Drawn once the page is read, after the report's own parts.
    expect(component).toMatch(
      /<Report page=\{page\} \/>\s*<ReportQuestions questions=\{questions\} onRetry=\{onRetryQuestions\} \/>/,
    );
  });
});
