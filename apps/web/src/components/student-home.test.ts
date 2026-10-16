import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { MeResponse } from '@bali/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bellTime } from '../lib/session-controls';
import { StudentHome } from './student-home';

/*
 * A student's home (W3, and W4's live card's last row), rendered as it first draws, the boards'
 * sample data in it: StudentHome (Biology, period 3 in class now with Ms. Rivera, 23:04 left to a
 * 9:55 bell, Open the lesson and the phone's chip; Chemistry, period 5 with Mr. Okafor and AP
 * English, period 6 with Ms. Chen under Other classes), StudentHomeEmpty, StudentStates' "The
 * classes didn't load" and StudentChipStates' Checking…, drawn first. The chip's other states are
 * the lesson's read's, after the first draw: `your-phone.test.ts` and `student-web.test.ts`.
 */
vi.mock('next/navigation', () => ({ useRouter: vi.fn() }));
const STARTED = '2026-10-12T14:05:00.000Z';
const BELL = '2026-10-12T14:55:00.000Z';
/** 23:04 before the bell, as StudentHome draws it. */
const NOW = Date.parse(BELL) - (23 * 60 + 4) * 1000;

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

/** The home as it first draws for `account` at NOW, its last read failed or not. */
function home(account: MeResponse, failed = false): string {
  vi.useFakeTimers({ now: NOW });
  return renderToStaticMarkup(
    createElement(StudentHome, { me: account, failed, onRead: () => {} }),
  );
}
afterEach(() => vi.useRealTimers());

/** The visible words of some markup, each run of them on its own. */
const words = (html: string) =>
  html
    .split(/<[^>]+>/)
    .map((s) => s.replace(/&#x27;|&apos;/g, "'").replace(/&amp;/g, '&'))
    .filter((s) => s.trim() !== '');

const LINE = "Your teacher's slides and questions show up here during class.";
const JOIN = 'To join a class, use the Bali app on your iPhone.';

describe('a student’s home with a class in session (StudentHome)', () => {
  const html = home(me(BIOLOGY, CHEMISTRY, ENGLISH));

  it('says the page’s head, the live card, the other classes and how to join, in that order', () => {
    expect(words(html)).toEqual([
      'Your classes',
      LINE,
      'Biology, period 3',
      'Ms. Rivera · in class now',
      '23:04',
      'ends ',
      bellTime(BELL),
      'Open the lesson',
      'Your phone',
      'Checking…',
      'Other classes',
      'Chemistry, period 5',
      'Mr. Okafor',
      'AP English, period 6',
      'Ms. Chen',
      JOIN,
    ]);
  });

  it('draws the class in session on the live card: its ring the session left, its countdown, its bell', () => {
    const card = /<section aria-labelledby="([^"]+)" class="([^"]*)">([^]*?)<\/section>/.exec(html);
    expect(card?.[2]?.split(' ')).toEqual(
      expect.arrayContaining([
        'rounded-live',
        'border',
        'border-live-edge',
        'bg-surface-card',
        'p-5.5',
        'shadow-1',
        'flex',
        'flex-col',
        'gap-4',
      ]),
    );
    const inside = card?.[3] ?? '';
    // Its head a row 14 px apart, as `.lc-head`.
    expect(inside).toMatch(/^<div class="flex items-center gap-3\.5"><svg width="46"/);
    // Named by its heading, the class's name.
    expect(inside).toMatch(
      new RegExp(`<h2 id="${card?.[1]}" class="text-h3[^"]*">Biology, period 3</h2>`),
    );
    // The 46 px ring, r 20.5, stroked 5, its arc the share of the 50 minutes left: 23:04.
    const ring =
      /<svg width="46" height="46" viewBox="0 0 46 46" aria-hidden="true"[^]*?<\/svg>/.exec(
        inside,
      )?.[0];
    expect(ring).toMatch(/r="20.5"/);
    const around = 2 * Math.PI * 20.5;
    const arc = (((23 * 60 + 4) / 3000) * around).toFixed(1);
    expect(ring).toContain(`stroke-dasharray="${arc} ${around.toFixed(1)}"`);
    // The countdown at Home's size on the rounded figures, the bell a time a reader can read.
    expect(inside).toMatch(/<span class="font-num text-home-countdown tabular-nums">23:04<\/span>/);
    expect(inside).toContain(`ends <time dateTime="${BELL}">${bellTime(BELL)}</time>`);
  });

  it('ends on Open the lesson, to the lesson’s page, and the phone’s chip at the right, Checking… until the lesson’s first read (W4)', () => {
    const row =
      /<\/p><\/div><div class="flex flex-wrap items-center gap-2\.5">([^]*?)<\/div><\/section>/.exec(
        html,
      )?.[1] ?? '';
    expect(row).toMatch(
      /^<a class="[^"]*\bh-10\b[^"]*\bbg-action-primary-bg\b[^"]*" href="\/lessons\/bio\/s-bio">Open the lesson<\/a>/,
    );
    expect(row).toContain(
      '<p role="status" class="inline-flex flex-wrap items-center gap-2 ml-auto"><span class="text-caption text-text-tertiary">Your phone</span><span class="text-caption text-text-secondary">Checking…</span></p>',
    );
    // Never a chip from this one-time /v1/me (decision 13): only the lesson's read says it.
    expect(html).not.toMatch(/Focused|as of/);
    // The one control on the card is its way into the lesson.
    expect(html.match(/<a\b|<button\b/g)).toHaveLength(1);
  });

  it('lists the other classes under their label, each with its teacher, in the read’s order', () => {
    expect(html).toMatch(
      /<section aria-labelledby="([^"]+)"><h2 id="\1" class="mb-3 text-section-label text-text-tertiary uppercase">Other classes<\/h2><ul class="flex flex-col gap-2\.5"><li class="[^"]*">/,
    );
    // Each a white row 15/18 px in, the name over the teacher, whose line is the row's 15/22.
    expect(html).toContain(
      '<li class="rounded-md border border-border-default bg-surface-card px-4.5 py-3.75 text-body"><span class="block text-tile-name wrap-anywhere">Chemistry, period 5</span><span class="text-countdown-sub text-text-tertiary wrap-anywhere">Mr. Okafor</span></li>',
    );
  });
});

describe('a student’s home in other states', () => {
  it('lists the classes with no label and no live card when none is in session', () => {
    const html = home(me({ ...BIOLOGY, liveSession: null }, CHEMISTRY));
    expect(words(html)).toEqual([
      'Your classes',
      LINE,
      'Biology, period 3',
      'Ms. Rivera',
      'Chemistry, period 5',
      'Mr. Okafor',
      JOIN,
    ]);
    expect(html).not.toContain('Other classes');
    expect(html).not.toContain('<svg');
  });

  it('shows a class past its bell by this computer’s clock with the rest, though the read said in session', () => {
    vi.useFakeTimers({ now: Date.parse(BELL) });
    const html = renderToStaticMarkup(
      createElement(StudentHome, { me: me(BIOLOGY, CHEMISTRY), failed: false, onRead: () => {} }),
    );
    expect(html).not.toContain('in class now');
    expect(html).not.toContain('Other classes');
  });

  it('puts every class in session on a live card of its own', () => {
    const html = home(me(BIOLOGY, CHEMISTRY, { ...ENGLISH, liveSession: BIOLOGY.liveSession }));
    expect(
      html.match(/<section aria-labelledby="[^"]+" class="[^"]*border-live-edge/g),
    ).toHaveLength(2);
    expect(words(html)).toContain('Ms. Chen · in class now');
    expect(words(html)).toContain('Other classes');
  });

  it('says a class whose teacher has no name as in class now, and a row with its name alone', () => {
    const html = home(
      me(
        { ...BIOLOGY, teacher: { displayName: null } },
        { ...CHEMISTRY, teacher: { displayName: ' ' } },
      ),
    );
    expect(words(html).slice(2, 4)).toEqual(['Biology, period 3', 'In class now']);
    expect(html).toContain(
      '<li class="rounded-md border border-border-default bg-surface-card px-4.5 py-3.75 text-body"><span class="block text-tile-name wrap-anywhere">Chemistry, period 5</span></li>',
    );
  });

  it('with no class yet, says so on the empty card, and gives a teacher the way to the invite page (StudentHomeEmpty)', () => {
    const html = home(me());
    expect(words(html)).toEqual([
      'Your classes',
      LINE,
      "You're not in a class yet",
      'Join one in the Bali app on your iPhone, with the class code from your teacher.',
      'Setting up a teacher account? ',
      'Enter your invite code',
    ]);
    // The ring's track alone, the card 32 px in, as drawn; the link a link in running text.
    expect(html).toMatch(
      /<section aria-labelledby="[^"]+" class="flex max-w-215 flex-col items-start gap-2\.5 rounded-md border border-border-default bg-surface-card p-8 shadow-1"><svg width="46"/,
    );
    expect(html.match(/<circle /g)).toHaveLength(1);
    expect(html).toMatch(
      /<a class="[^"]*\bunderline\b[^"]*" href="\/invite">Enter your invite code<\/a>/,
    );
  });

  it('says a failed read where the classes are, with Try again, whatever the page holds (StudentStates)', () => {
    for (const account of [me(BIOLOGY, CHEMISTRY), me()]) {
      const html = home(account, true);
      expect(html).toMatch(
        /<div class="flex flex-wrap items-center gap-x-4 gap-y-3"><p role="alert" class="text-body">Bali couldn(&#x27;|')t load your classes\.<\/p><button type="button" class="[^"]*\bh-8\.5\b[^"]*">Try again<\/button><\/div>/,
      );
      expect(words(html).slice(0, 4)).toEqual([
        'Your classes',
        LINE,
        "Bali couldn't load your classes.",
        'Try again',
      ]);
    }
    expect(home(me(BIOLOGY))).not.toContain('role="alert"');
  });
});

describe('the home’s wiring (read from its source)', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./student-home.tsx', import.meta.url)),
    'utf8',
  );

  it('reads the account again at the next bell, so the class leaves the live card or keeps its new bell', () => {
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s*if \(bell === null\) return;\s*const timer = window\.setTimeout\(\(\) => \{\s*setNow\(Math\.max\(Date\.now\(\), bell\)\);\s*onRead\(\);\s*\}, bell - Date\.now\(\)\);\s*return \(\) => window\.clearTimeout\(timer\);\s*\}, \[bell, onRead\]\);/,
    );
    // Try again reads it too, never with its click as `load`'s fresh flag (which would forget the page).
    expect(source).toContain('onClick={() => onRead()}');
  });

  it('gives each live card its phone from its lesson’s own read, never a one-time /v1/me (decision 13)', () => {
    // A card per session, so another session of the class starts from Checking… afresh.
    expect(source).toContain('<LiveCard key={live.liveSession.id} live={live} onGone={onRead} />');
    expect(source).toMatch(
      /const followed = followLesson\(api, sessionId, \(state\) => \{\s*setLesson\(state\);\s*if \(!lessonGone\(state\)\) return;\s*followed\.stop\(\);\s*onGone\(\);\s*\}\);\s*return \(\) => followed\.stop\(\);/,
    );
    expect(source).toContain(
      '<YourPhone chip={phoneChip(lesson, new Date(now))} asOf={lesson.asOf} className="ml-auto" />',
    );
    expect(source).not.toMatch(/api\.get\b/);
  });

  it('reads the account again as its tab comes back into view, so a class that started shows with its way in', () => {
    expect(source).toMatch(
      /const back = \(\) => \{\s*if \(document\.visibilityState === 'visible'\) onRead\(\);\s*\};\s*document\.addEventListener\('visibilitychange', back\);\s*return \(\) => document\.removeEventListener\('visibilitychange', back\);/,
    );
  });

  it('gives the home its own read: Home passes the shell’s, never one of its own', () => {
    const page = readFileSync(fileURLToPath(new URL('../app/page.tsx', import.meta.url)), 'utf8');
    expect(page).toContain('<StudentHome me={home.me} failed={error !== null} onRead={load} />');
  });
});
