import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/*
 * The portal's page and component tests drive the page (the owner, 2026-10-22; CLAUDE.md, Working
 * rules): rendered in jsdom and used with Testing Library, as `components/try-again.test.tsx` is.
 * The ones written before read their component's source text and match it with regexes, which
 * pins the code's shape, not what a user gets. Each UI step converts the ones it touches, so the
 * list below only shrinks: a test under app/ or components/ that reads a file's text fails here
 * unless it is listed, and a listed one that no longer does fails until its entry goes.
 */
const SRC = import.meta.dirname;

/** A file's text read: `readFile` or `readFileSync` named at all, its import too, or `?raw`. */
const READS = /\breadFile(?:Sync)?\b|\?raw['"]/;

/** The test files under app/ and components/ that read a file's text, as paths from src/. */
function reading(): string[] {
  const tests = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return tests(path);
      // Every name Vitest runs by default: .test. or .spec., ts or js, x or not, c or m.
      return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
    });
  return ['app', 'components']
    .flatMap((dir) => tests(join(SRC, dir)))
    .filter((file) => READS.test(readFileSync(file, 'utf8')))
    .map((file) => relative(SRC, file).split(sep).join('/'))
    .sort();
}

describe('the portal’s page and component tests drive the page', () => {
  it('adds none that reads source text, and lists none that stopped', () => {
    expect(reading()).toEqual([...STILL_READING, ...GUARDS].sort());
  });
});

/**
 * The page and component tests that still read source text, as they stood when the owner decided
 * the portal's tests drive the page (2026-10-22). A UI step converts the ones it touches and takes
 * their entries off; none is ever added. One whose reads come to guard only other files moves to
 * `GUARDS`, saying why.
 */
const STILL_READING = [
  'app/class-page.test.ts',
  'app/home.test.ts',
  'app/icons.test.ts',
  'app/present.test.ts',
  'app/rendering.test.ts',
  'app/support/support.test.ts',
  'app/tokens.test.ts',
  'components/ask-panel.test.ts',
  'components/classes.test.ts',
  'components/decks-panel.test.ts',
  'components/entry-page.test.ts',
  'components/home.test.ts',
  'components/invite-code.test.ts',
  'components/join-code.test.ts',
  'components/live-grid.test.ts',
  'components/present-question.test.ts',
  'components/present-slide.test.ts',
  'components/question-card.test.ts',
  'components/recap-card.test.ts',
  'components/report-questions.test.ts',
  'components/reports-list.test.ts',
  'components/saved-questions.test.ts',
  'components/session-report.test.ts',
  'components/shell.test.ts',
  'components/slide-card.test.ts',
  'components/slides.test.ts',
  'components/student-home.test.ts',
  'components/student-lesson.test.ts',
  'components/student-panel.test.ts',
  'components/student-slide.test.ts',
  'components/unlock-popups.test.ts',
];

/**
 * Tests whose reads guard other files, never their own component's shape: try-again's scan, which
 * fails on a Try again drawn by hand anywhere in the portal.
 */
const GUARDS = ['components/try-again.test.tsx'];
