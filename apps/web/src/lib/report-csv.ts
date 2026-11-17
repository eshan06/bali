import type { RecapFormat } from './recap';
import { minutesLong, type SessionList } from './reports';

/*
 * Reports' Download CSV (LO8; the canvas's ReportsMoments, drawn first): the sessions listed, newest
 * first, a row each with the table's figures and when it ran. The session totals alone, never a
 * student's name or row.
 */

/** Its columns, in order. */
export const CSV_COLUMNS = [
  'Class',
  'Date',
  'Start',
  'End',
  'Joined',
  'Focused the whole time',
  'Average time focused (min)',
  'Length (min)',
  'Emergency unlocks',
  'Protection off',
] as const;

/** The byte-order mark, so a spreadsheet opens the file as UTF-8: a class's name may be any text. */
const BOM = String.fromCharCode(0xfeff);

/**
 * A field as a spreadsheet reads it back: quoted when it holds a comma, a quote or a line break, its
 * quotes doubled (RFC 4180); and text a spreadsheet would run as a formula, its first character one
 * of = + - @, a tab or a return, kept as text by a quote before it (OWASP's CSV injection). Only a
 * class's name is text a person typed; every figure is a count, never negative.
 */
function field(value: string | number): string {
  const text = /^[=+\-@\t\r]/.test(String(value)) ? `'${value}` : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * The sessions listed as a CSV file's text: its header, then a row each, its day and times by the
 * viewer's clock unless `timeZone` says otherwise, as spreadsheets read them everywhere ("2026-10-12",
 * "09:05"), its average and its length in whole minutes, and no average for a session nobody joined;
 * each line ended CRLF (RFC 4180).
 */
export function sessionsCsv(
  className: string,
  list: Pick<SessionList, 'sessions' | 'wholeTime'>,
  { timeZone }: Pick<RecapFormat, 'timeZone'> = {},
): string {
  const day = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  });
  const clock = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  });
  const rows = list.sessions.map((s) => {
    const start = Date.parse(s.startedAt);
    const end = Date.parse(s.endedAt ?? s.endsAt);
    return [
      className,
      day.format(start),
      clock.format(start),
      clock.format(end),
      s.joinedCount,
      // Nobody joined: none stayed. Someone did: the count read before the session was listed.
      s.joinedCount === 0 ? 0 : (list.wholeTime[s.id] ?? ''),
      s.averageFocusMinutes ?? '',
      minutesLong(s),
      s.unlockCount,
      s.protectionOffCount,
    ];
  });
  const lines = [CSV_COLUMNS, ...rows].map((row) => row.map(field).join(','));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

/** The file's name, for its class: "Biology, period 3 sessions.csv". */
export const csvName = (className: string): string => `${className} sessions.csv`;

/**
 * Save `text` as a file named `name`, as the browser saves a link it downloads: a link to it,
 * clicked. Its address is let go a moment later, once the browser has taken the file.
 */
export function saveFile(name: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
