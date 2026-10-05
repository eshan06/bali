import { validate as isUuid } from 'uuid';

import {
  createSchool,
  formatInviteCode,
  INVITE_LIFETIME_DAYS,
  listSchools,
  mintTeacherInvite,
  recordAgreement,
  schoolsNamed,
} from './schools.js';
import { exportStudentRecord } from './student-record.js';
import { type DisposalCounts, disposeSchool } from './transitions.js';
import type { Database } from './types.js';

/*
 * The owner's school commands, `npm run school -- <command>`
 * (apps/api/scripts/school.ts): add a school, record its data agreement, mint a
 * teacher invite, list the schools, export one student's record, dispose of a
 * school's data, against DATABASE_URL as `npm run migrate`
 * is. Every argument is checked before anything connects, and each refusal says
 * what was wrong and how to say it.
 */

export const SCHOOL_USAGE = `usage: npm run school -- <command>

  add <name>                    add a school; prints its id
  agreement <school-id> <day>   record the school's data agreement as signed on <day>, YYYY-MM-DD
  invite <school-id>            mint a teacher invite for the school: one code, for one teacher,
                                good for ${INVITE_LIFETIME_DAYS} days, and shown this once only
  list                          every school: its id, its agreement's day, and how many of its
                                invites are open (not redeemed, not expired); never a code
  export-student <id>           one student's whole record, as JSON on standard output, for a
                                parent's inspection request; <id> is their account's id or
                                their Cognito subject (sub). It reads, and writes nothing
  dispose <school-id>           what disposing of the school's data, on its written request,
                                would take; it writes nothing
  dispose <school-id> --confirm "<name>"
                                dispose of it: its teachers and students de-identified, its
                                classes, blocks and open invites removed, logged by counts and
                                never a name. Refused while a lesson of it runs

It runs against DATABASE_URL, as npm run migrate does.`;

export interface SchoolCommandIO {
  db: Database;
  print: (line: string) => void;
}

/** A command whose arguments are checked, ready to run. */
export type SchoolCommand = (io: SchoolCommandIO) => Promise<void>;

/**
 * The command `argv` names, its arguments checked; null asks for the usage. A
 * bad argument throws, saying why. `now` is the clock today is read from for an
 * agreement's day: this machine's (tests pass one).
 */
export function parseSchoolCommand(
  argv: readonly string[],
  now: Date = new Date(),
): SchoolCommand | null {
  const [command, ...args] = argv;
  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      return null;
    case 'add': {
      if (args.length > 1) {
        throw new Error(`add takes one name; quote a name with spaces: add "${args.join(' ')}"`);
      }
      const name = args[0]?.trim();
      if (!name) throw new Error(`add needs the school's name: add "Lincoln High"`);
      return (io) => add(io, name);
    }
    case 'agreement': {
      const [schoolId, day, ...extra] = args;
      if (schoolId === undefined || day === undefined) {
        throw new Error(
          `agreement needs the school's id and the day its agreement was signed: ` +
            `agreement <school-id> YYYY-MM-DD`,
        );
      }
      nothingMore(extra);
      checkSchoolId(schoolId);
      checkDay(day, now);
      return (io) => agreement(io, schoolId, day);
    }
    case 'invite': {
      const [schoolId, ...extra] = args;
      if (schoolId === undefined) {
        throw new Error(`invite needs the school's id: invite <school-id>`);
      }
      nothingMore(extra);
      checkSchoolId(schoolId);
      return (io) => invite(io, schoolId);
    }
    case 'list':
      nothingMore(args);
      return list;
    case 'export-student': {
      const [who, ...extra] = args;
      if (!who?.trim()) {
        throw new Error(
          `export-student needs the account's id or Cognito subject: export-student <id>`,
        );
      }
      nothingMore(extra);
      return (io) => exportStudent(io, who.trim());
    }
    case 'dispose': {
      const [schoolId, flag, name, ...extra] = args;
      if (schoolId === undefined) {
        throw new Error(`dispose needs the school's id: dispose <school-id>`);
      }
      checkSchoolId(schoolId);
      if (flag === undefined) return (io) => dispose(io, schoolId);
      if (flag !== '--confirm' || !name?.trim()) {
        throw new Error(
          `dispose is confirmed with the school's name: dispose <school-id> --confirm "<name>"`,
        );
      }
      nothingMore(extra);
      return (io) => dispose(io, schoolId, name);
    }
    default:
      throw new Error(`unknown command "${command}"`);
  }
}

function nothingMore(extra: readonly string[]): void {
  if (extra.length > 0) throw new Error(`unexpected "${extra.join(' ')}"`);
}

function checkSchoolId(schoolId: string): void {
  if (!isUuid(schoolId)) throw new Error(`"${schoolId}" is not a school id: add prints one`);
}

/**
 * A real day of the calendar, written YYYY-MM-DD, and not after today in this
 * machine's zone (`TZ`: the school's on the API's service, DEPLOY.md).
 */
function checkDay(day: string, now: Date): void {
  const at = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00Z`) : null;
  // A day past its month's end parses as one of the next month's, so it reads back changed.
  if (!at || Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== day) {
    throw new Error(`"${day}" is not a day written YYYY-MM-DD`);
  }
  const two = (n: number) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
  if (day > today) {
    throw new Error(
      `an agreement can't be signed after today: ${day} is after ${today}, today on this machine`,
    );
  }
}

const noSchool = (schoolId: string) => `no school on record has the id ${schoolId}`;

async function add({ db, print }: SchoolCommandIO, name: string): Promise<void> {
  // Said, not refused: two schools may share a name, and a second run of one
  // add — its answer lost — would otherwise go unseen (T1a's review).
  for (const same of await schoolsNamed(db, name)) {
    print(
      `a school named "${same.name}" is on record already, its id ${same.id}: if you meant it, use that id`,
    );
  }
  const school = await createSchool(db, { name });
  print(`added "${school.name}"; its id is ${school.id}`);
  print(`once its data agreement is signed: npm run school -- agreement ${school.id} YYYY-MM-DD`);
}

async function agreement(
  { db, print }: SchoolCommandIO,
  schoolId: string,
  day: string,
): Promise<void> {
  const recorded = await recordAgreement(db, { schoolId, signedOn: day });
  if (!recorded) throw new Error(noSchool(schoolId));
  const { school, before } = recorded;
  const replaced = before !== null && before !== day ? ` (it said ${before})` : '';
  print(`"${school.name}": its data agreement is on record as signed on ${day}${replaced}`);
}

async function invite({ db, print }: SchoolCommandIO, schoolId: string): Promise<void> {
  const minted = await mintTeacherInvite(db, { schoolId });
  if (minted.outcome === 'unknown_school') throw new Error(noSchool(schoolId));
  if (minted.outcome === 'no_agreement') {
    throw new Error(
      `"${minted.school.name}" has no data agreement on record, so no invite is minted for it. ` +
        `Once it is signed: npm run school -- agreement ${schoolId} YYYY-MM-DD`,
    );
  }
  const until = minted.invite.expiresAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'long',
  });
  print(`a teacher invite for "${minted.school.name}": for one teacher, once, until ${until}`);
  print('');
  print(`  ${formatInviteCode(minted.code)}`);
  print('');
  print('This is the only time it is shown: only its hash is stored. Lost, mint another.');
}

/** One school a line, the name last so a long one never pushes the columns out. */
async function list({ db, print }: SchoolCommandIO): Promise<void> {
  const all = await listSchools(db);
  if (all.length === 0) {
    print('no school is on record yet: npm run school -- add "<name>"');
    return;
  }
  const row = (id: string, day: string, open: string, name: string) =>
    `${id.padEnd(36)}  ${day.padEnd(10)}  ${open.padEnd(12)}  ${name}`;
  print(row('id', 'agreement', 'open invites', 'name'));
  for (const school of all) {
    print(
      row(school.id, school.agreementSignedAt ?? 'none', String(school.openInvites), school.name),
    );
  }
}

/** The record as one JSON document, and nothing else on standard output, so it redirects whole. */
async function exportStudent({ db, print }: SchoolCommandIO, who: string): Promise<void> {
  const record = await exportStudentRecord(db, who);
  if (!record) throw new Error(`no account on record has the id or Cognito subject ${who}`);
  // A teacher's classes and blocks are the school's, never in the export: one
  // would print as a record that only looks whole.
  if (record.account.role !== 'student') {
    throw new Error(`${who} is a ${record.account.role}'s account, not a student's`);
  }
  print(JSON.stringify(record, null, 2));
}

const tally = (c: DisposalCounts) =>
  `teachers ${c.teachers}, students ${c.students}, classes ${c.classes}, ` +
  `sessions ${c.sessions}, blocks ${c.blocks}, open invites ${c.openInvites}, ` +
  `pre-bell taps ${c.armedTaps}`;

/**
 * Without a name, what the disposal would take; with the school's own, the
 * disposal, logged by the school's id and counts alone (C6a).
 */
async function dispose(
  { db, print }: SchoolCommandIO,
  schoolId: string,
  confirmName?: string,
): Promise<void> {
  const at = new Date();
  const result = await disposeSchool(db, { schoolId, at, confirmName });
  switch (result.outcome) {
    case 'unknown_school':
      throw new Error(noSchool(schoolId));
    case 'already_disposed':
      print(
        `school ${schoolId} was disposed of already, on ${result.disposedAt.toISOString()}: nothing more to do`,
      );
      return;
    case 'name_mismatch':
      throw new Error(
        `school ${schoolId} is named "${result.school.name}"; nothing was written. ` +
          `To confirm: dispose ${schoolId} --confirm "${result.school.name}"`,
      );
    case 'in_session':
      throw new Error(
        `"${result.school.name}" has ${result.sessions} lesson(s) running; nothing was written. ` +
          'Run it again after the bell.',
      );
    case 'shared_accounts':
      throw new Error(
        `${result.userIds.length} account(s) of "${result.school.name}" have records at another ` +
          `school too, so disposing of them here would take that school's records as well; ` +
          `nothing was written. This command can't split an account between schools: ` +
          result.userIds.join(', '),
      );
    case 'preview':
      print(
        `disposing of "${result.school.name}" (${schoolId}) would take: ${tally(result.counts)}`,
      );
      print(
        'Its teachers and students would be de-identified, its classes, blocks and open invites ' +
          'removed; its lessons stay, naming no one. Nothing was written.',
      );
      print(
        "First check no parent's inspection request is open for one of its students " +
          '(docs/RUNBOOKS.md, runbook 1, step 10).',
      );
      print(`To go ahead: npm run school -- dispose ${schoolId} --confirm "${result.school.name}"`);
      return;
    case 'disposed':
      print(`disposed of school ${schoolId} on ${at.toISOString()}: ${tally(result.counts)}`);
      return;
  }
}
