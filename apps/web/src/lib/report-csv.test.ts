import type { SessionReportSummary } from '@bali/shared';
import { describe, expect, it } from 'vitest';

import { CSV_COLUMNS, csvName, sessionsCsv } from './report-csv';

/*
 * Reports' Download CSV (LO8; ReportsMoments, drawn first): the sessions listed, a row each, with
 * the table's figures and when each ran, in a file a spreadsheet opens as written. Never a student's
 * name or row: it is written from the sessions' totals alone, the only thing it is given.
 */

const NY = { timeZone: 'America/New_York' };

/** A lesson from 9:05 to 9:55 in New York, over at its bell. */
function lesson(id: string, day: string, over: Partial<SessionReportSummary> = {}) {
  return {
    id,
    startedAt: `${day}T13:05:00.000Z`,
    endsAt: `${day}T13:55:00.000Z`,
    endedAt: `${day}T13:55:00.000Z`,
    ended: true,
    joinedCount: 26,
    focusMinutes: 1222,
    averageFocusMinutes: 47,
    silentMinutes: 3,
    unlockCount: 2,
    protectionOffCount: 1,
    ...over,
  } satisfies SessionReportSummary;
}
const MON = lesson('a', '2026-10-12');
// Nobody joined; ended a minute in.
const THU = lesson('b', '2026-10-01', {
  endsAt: '2026-10-01T13:06:00.000Z',
  endedAt: '2026-10-01T13:06:00.000Z',
  joinedCount: 0,
  focusMinutes: 0,
  averageFocusMinutes: null,
  silentMinutes: 0,
  unlockCount: 0,
  protectionOffCount: 0,
});

/** The file's text without its byte-order mark, which it must start with. */
function body(text: string): string {
  expect(text.charCodeAt(0)).toBe(0xfeff);
  return text.slice(1);
}

describe('the sessions listed, as a CSV file', () => {
  it('is its header, then a row per session, newest first, each line ended CRLF', () => {
    const text = sessionsCsv(
      'Biology, period 3',
      { sessions: [MON, THU], wholeTime: { a: 22 } },
      NY,
    );
    expect(body(text)).toBe(
      [
        'Class,Date,Start,End,Joined,Focused the whole time,Average time focused (min),Length (min),Emergency unlocks,Protection off',
        '"Biology, period 3",2026-10-12,09:05,09:55,26,22,47,50,2,1',
        // Nobody joined: none stayed, and no average.
        '"Biology, period 3",2026-10-01,09:05,09:06,0,0,,1,0,0',
        '',
      ].join('\r\n'),
    );
    expect(CSV_COLUMNS).toHaveLength(10);
  });

  it('says when each ran by the viewer’s clock, the date as spreadsheets read it, the time on 24 hours', () => {
    // 11:30 PM in New York is the next day by UTC: the day is New York's.
    const late = lesson('c', '2026-10-13', {
      startedAt: '2026-10-13T03:30:00.000Z',
      endsAt: '2026-10-13T04:20:00.000Z',
      endedAt: '2026-10-13T04:20:00.000Z',
    });
    const text = sessionsCsv('Night class', { sessions: [late], wholeTime: { c: 1 } }, NY);
    expect(body(text).split('\r\n')[1]).toBe('"Night class",2026-10-12,23:30,00:20,26,1,47,50,2,1');
  });

  it('counts a session to its bell until it is marked over', () => {
    const open = { ...MON, endedAt: null, endsAt: '2026-10-12T14:05:00.000Z' };
    const text = sessionsCsv('Biology', { sessions: [open], wholeTime: { a: 3 } }, NY);
    expect(body(text).split('\r\n')[1]).toBe('"Biology",2026-10-12,09:05,10:05,26,3,47,60,2,1');
  });

  it('never makes up a count it wasn’t given: blank, never a zero, for a session someone joined', () => {
    const text = sessionsCsv('Biology', { sessions: [MON], wholeTime: {} }, NY);
    expect(body(text).split('\r\n')[1]).toBe('"Biology",2026-10-12,09:05,09:55,26,,47,50,2,1');
  });

  it('always quotes the class’s name, its quotes doubled (RFC 4180), and nothing else needing none', () => {
    const row = (name: string) =>
      body(sessionsCsv(name, { sessions: [THU], wholeTime: {} }, NY)).split('\r\n')[1];
    expect(row('Bio "A", room 2')).toBe('"Bio ""A"", room 2",2026-10-01,09:05,09:06,0,0,,1,0,0');
    expect(row('Line\nbreak')?.startsWith('"Line\nbreak",')).toBe(true);
    expect(row('Plain')).toBe('"Plain",2026-10-01,09:05,09:06,0,0,,1,0,0');
    // The header is words this file writes: quoted only where a field needs it, none here.
    expect(body(sessionsCsv('Plain', { sessions: [], wholeTime: {} }, NY))).toBe(
      `${CSV_COLUMNS.join(',')}\r\n`,
    );
  });

  it('keeps a name a spreadsheet would run as a formula as text (CSV injection)', () => {
    const first = (name: string) =>
      body(sessionsCsv(name, { sessions: [THU], wholeTime: {} }, NY))
        .split('\r\n')[1]
        ?.split(',2026-10-01')[0];
    expect(first('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(first('+1')).toBe(`"'+1"`);
    expect(first('-1')).toBe(`"'-1"`);
    expect(first('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(first('\tTab')).toBe(`"'\tTab"`);
    // Anywhere but first, the same characters are only text.
    expect(first('Bio 1+1')).toBe('"Bio 1+1"');
    // A spreadsheet splitting on semicolons keeps it one cell, so no part of it starts a formula
    // (santa's review).
    expect(first('x;=1+1;')).toBe('"x;=1+1;"');
  });

  it('is named for its class', () => {
    expect(csvName('Biology, period 3')).toBe('Biology, period 3 sessions.csv');
  });
});
