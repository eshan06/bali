import type { EventType, FeedEvent } from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CANT_REACH } from '../lib/errors';
import type { Student } from '../lib/grid-state';
import { bellTime } from '../lib/session-controls';
import type { StudentRead } from '../lib/student-panel';
import { StateChip } from './live-grid';
import { CLOCK_OFF, PanelView } from './student-panel';

/*
 * The student panel (PV11b; ClassStudent, PanelStates), rendered: the name, when they tapped in,
 * their state as their tile shows it, this session's moments with their times and each unlock's
 * reason, the last check-in; its loading and its failure with Try again. Never in Present.
 */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

/** 9:mm on the day of the lesson; "now" is 9:32, as PanelStates draws them. */
const at = (minute: number) => new Date(Date.UTC(2026, 9, 14, 14, minute));
const NOW = at(32);
const t = (minute: number) => bellTime(at(minute).toISOString());

function student(over: Partial<Student> = {}): Student {
  return {
    studentId: 'u1-0000-aaaa',
    displayName: 'Ethan Park',
    state: 'focused',
    joinedAt: at(5),
    lastSeenAt: at(31),
    endedAt: null,
    unlock: null,
    clockOff: false,
    ...over,
  };
}

let seq = 0;
/** One of the student's events, the next `seq`. */
function event(type: EventType, minute: number, payload: FeedEvent['payload'] = null): FeedEvent {
  seq += 1;
  return {
    seq,
    eventId: `e${seq}`,
    type,
    userId: 'u1-0000-aaaa',
    occurredAt: at(minute).toISOString(),
    payload,
  };
}
const ready = (...events: FeedEvent[]): StudentRead => ({
  kind: 'ready',
  events: { sessionId: 's1', studentId: 'u1-0000-aaaa', events, cursor: seq },
});

const render = (s: Student, state: StudentRead) =>
  renderToStaticMarkup(
    createElement(PanelView, {
      id: 'g-panel',
      student: s,
      chip: createElement(StateChip, { student: s, now: NOW }),
      read: state,
      now: NOW,
      onClose: () => undefined,
      onRetry: () => undefined,
    }),
  );

/** Markup as read: each tag a space, each run of spaces, no-break ones included, one. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
/** The panel's head, as read: the name, when they tapped in, and the chip. */
const head = (html: string) => text(/^<aside[^>]*><div[^>]*>([^]*?)<button/.exec(html)?.[1] ?? '');
/** Each moment as read: its words, an unlock's reason, and its time. */
const moments = (html: string) =>
  [...html.matchAll(/<li class="relative[^"]*">([^]*?)<\/li>/g)].map((m) => text(m[1] ?? ''));
/** The lines under the moments, as read. */
const notes = (html: string) =>
  [...html.matchAll(/<p class="text-caption text-text-tertiary">([^<]*)<\/p>/g)]
    .map((m) => m[1]?.replaceAll('&#x27;', '’'))
    .filter((line) => !line?.startsWith('Tapped in'));
const PRIVATE = 'Only you see this panel. Present never shows it, or an unlock’s reason.';

describe('the student panel’s states, as PanelStates draws them', () => {
  it('names the student and their state from the grid while the session is read', () => {
    const html = render(student({ state: 'unlocked', unlock: { eventId: 'v', reason: 'nurse' } }), {
      kind: 'loading',
    });
    expect(head(html)).toBe('Ethan Park Unlocked');
    expect(html).toMatch(
      /<h3[^>]*>This session<\/h3><p role="status" class="text-body text-text-secondary">Loading this session…<\/p>/,
    );
    // No tap-in, moment or check-in until they are read.
    expect(notes(html)).toEqual([PRIVATE]);
  });

  it('says a read that failed, with Try again', () => {
    const html = render(student(), { kind: 'error', message: CANT_REACH });
    expect(head(html)).toBe('Ethan Park Focused');
    const [, alert = ''] = /<div role="alert">([^]*?)<\/div>/.exec(html) ?? [];
    expect(text(alert).replaceAll('&#x27;', "'")).toBe(`Couldn't load this session. ${CANT_REACH}`);
    expect(html).toMatch(/<div class="mt-3\.5"><button type="button" class="[^"]*">Try again/);
    expect(notes(html)).toEqual([PRIVATE]);
  });

  it('draws one focused since their tap-in, and when their phone last checked in', () => {
    const html = render(student({ displayName: 'Ana Rodríguez' }), ready(event('tap_in', 6)));
    expect(head(html)).toBe(`Ana Rodríguez Tapped in at ${t(6)} Focused`);
    expect(moments(html)).toEqual([`Tapped in ${t(6)}`]);
    expect(notes(html)).toEqual([`The phone last checked in at ${t(31)}.`, PRIVATE]);
  });

  it('says each unlock with its reason, and none as the recap says it', () => {
    const html = render(
      student({ state: 'protection_off', unlock: { eventId: 'e-u', reason: 'nurse' } }),
      ready(
        event('tap_in', 5),
        { ...event('unlock', 24, { reason: 'nurse' }), eventId: 'e-u' },
        event('protection_off', 27),
        event('refocus', 28),
        event('unlock', 29),
      ),
    );
    expect(moments(html)).toEqual([
      `Tapped in ${t(5)}`,
      `Unlocked Nurse ${t(24)}`,
      `Protection off ${t(27)}`,
      `Back in focus ${t(28)}`,
      `Unlocked No reason given ${t(29)}`,
    ]);
    // The reason in the secondary ink under its words; the time at the right, tertiary.
    expect(html).toMatch(
      /<p class="pt-0\.75 text-data font-normal">Unlocked<small class="block text-tile-line font-normal text-text-secondary">Nurse<\/small><\/p><span class="pt-1 text-tile-line text-text-tertiary">/,
    );
  });

  it('lists no going silent and no coming back, as its Silent board draws it', () => {
    const silent = student({ lastSeenAt: at(27) });
    const html = render(
      silent,
      ready(event('tap_in', 7), event('went_silent', 20), event('came_back', 22)),
    );
    expect(head(html)).toBe(`Ethan Park Tapped in at ${t(7)} Silent · 5 min`);
    expect(moments(html)).toEqual([`Tapped in ${t(7)}`]);
    expect(notes(html)).toEqual([`The phone last checked in at ${t(27)}.`, PRIVATE]);
  });

  it('draws Left, and Left · unlocked with the state’s own icon', () => {
    const left = student({
      state: 'unlocked',
      unlock: { eventId: 'e-o', reason: 'other' },
      endedAt: at(22),
      lastSeenAt: at(22),
    });
    const html = render(
      left,
      ready(
        event('tap_in', 7),
        { ...event('unlock', 20, { reason: 'other' }), eventId: 'e-o' },
        event('enrollment_left', 22),
      ),
    );
    expect(head(html)).toBe(`Ethan Park Tapped in at ${t(7)} Left · unlocked`);
    expect(moments(html)).toEqual([
      `Tapped in ${t(7)}`,
      `Unlocked Other reason ${t(20)}`,
      `Left ${t(22)}`,
    ]);
    // The chip's one icon, the lock (PanelStates), where the tile draws the flag before it.
    const chip = /<span class="inline-flex shrink-0[^"]*">([^]*?)<\/span>/.exec(html)?.[1] ?? '';
    expect(chip.match(/<svg/g)).toHaveLength(1);
    expect(chip).toContain('lucide-lock-open');
  });

  it('says Clock off before the last check-in', () => {
    const html = render(student({ clockOff: true }), ready(event('tap_in', 6)));
    expect(notes(html)).toEqual([
      CLOCK_OFF.replace("'", '’'),
      `The phone last checked in at ${t(31)}.`,
      PRIVATE,
    ]);
  });

  it('says who hasn’t tapped in, with no time and no check-in', () => {
    const html = render(
      student({ displayName: 'Zuri Mensah', state: null, joinedAt: null, lastSeenAt: null }),
      ready(),
    );
    expect(head(html)).toBe('Zuri Mensah Not here');
    expect(html).toContain(
      '<p class="text-body text-text-secondary">Zuri Mensah hasn&#x27;t tapped in this session.</p>',
    );
    expect(notes(html)).toEqual([PRIVATE]);
  });
});

describe('the panel, as ClassStudent draws it', () => {
  const html = render(student(), ready(event('tap_in', 5), event('unlock', 31)));
  const classes = (pattern: RegExp) => pattern.exec(html)?.[1]?.split(' ') ?? [];

  it('is v2.css’s `.panel`: 372 px from the right, white, a hairline, shadow-3, scrolling itself', () => {
    expect(html).toMatch(/^<aside id="g-panel" aria-labelledby="g-panel-name" class="/);
    expect(classes(/^<aside[^>]*class="([^"]*)"/)).toEqual(
      expect.arrayContaining([
        'fixed',
        'inset-y-0',
        'right-0',
        'z-5',
        'w-93',
        'max-w-full',
        'overflow-y-auto',
        'border-l',
        'border-border-default',
        'bg-surface-card',
        'shadow-3',
      ]),
    );
  });

  it('heads it with the name, which takes focus as it opens, and Close', () => {
    expect(html).toMatch(/<h2 id="g-panel-name" tabindex="-1" class="text-h3 wrap-anywhere">/);
    expect(html).toMatch(
      /<button type="button" aria-label="Close" class="[^"]*"><svg[^>]*lucide-x/,
    );
    expect(classes(/<div class="(flex items-start[^"]*)">/)).toEqual(
      expect.arrayContaining(['gap-3', 'border-b', 'pt-5', 'pr-3.5', 'pb-4', 'pl-5']),
    );
  });

  it('marks each moment with a grey 26 px dot, its icon, and a hairline to the next', () => {
    expect(html).toMatch(/<h3 class="mb-3 text-label text-text-tertiary uppercase">This session/);
    const dots = [...html.matchAll(/<span class="relative z-1 grid size-6\.5[^"]*">(<svg[^>]*>)/g)];
    expect(dots.map((d) => /lucide-([\w-]+)/.exec(d[1] ?? '')?.[1])).toEqual([
      'circle-check',
      'lock-open',
    ]);
    expect(html).toContain('bg-surface-sunken text-text-secondary');
    expect(classes(/<li class="(relative[^"]*)">/)).toEqual(
      expect.arrayContaining(['before:bg-border-default', 'last:before:hidden', 'pb-4.5']),
    );
  });

  it('closes on Escape from inside it', () => {
    expect(read('./student-panel.tsx')).toMatch(
      /onKeyDown=\{\(e\) => \{\s*if \(e\.key === 'Escape'\) onClose\(\);\s*\}\}/,
    );
  });
});

describe('the panel on the class page', () => {
  const grid = read('./live-grid.tsx');
  const panel = read('./student-panel.tsx');

  it('reads the student’s events once it opens, the stream’s folded in as they come', () => {
    expect(grid).toMatch(/setStreamed\(\(prev\) => \[\.\.\.prev, e\]\);/);
    expect(panel).toMatch(
      /readStudentEvents\(api, noEvents\(sessionId, studentId\)\)\.then\(\(read\) => \{\s*if \(!cancelled\) setAnswer\(read\);/,
    );
    expect(panel).toMatch(
      /\{ kind: 'ready', events: withEvents\(answer\.events, sessionId, streamed\) \}/,
    );
  });

  it('never opens in Present, closes as it turns on, and opens on the live page alone', () => {
    expect(grid).toMatch(/const selects = livePage && !present;/);
    expect(grid).toMatch(
      /const shown = selects && panel !== null \? students\[panel\.studentId\] : undefined;/,
    );
    expect(grid).toMatch(/\{shown \? \(\s*<StudentPanel\b/);
    expect(grid).toMatch(
      /useEffect\(\(\) => \{\s*if \(present\) setPanel\(null\);\s*\}, \[present\]\);/,
    );
    expect(grid).toMatch(/select=\{\s*selects\s*\?/);
  });

  it('takes focus into it as it opens, and gives it back to the student’s tile as it closes', () => {
    expect(grid).toMatch(
      /useEffect\(\(\) => \{\s*if \(panel !== null\) document\.getElementById\(`\$\{panelId\}-name`\)\?\.focus\(\);\s*\}, \[panel, panelId\]\);/,
    );
    expect(grid).toMatch(
      /onClose=\{\(\) => \{\s*document\.getElementById\(tileId\(shown\.studentId\)\)\?\.focus\(\);\s*setPanel\(null\);/,
    );
  });
});
