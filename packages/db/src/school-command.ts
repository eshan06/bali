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
import type { Database } from './types.js';

/*
 * The owner's school commands, `npm run school -- <command>`
 * (apps/api/scripts/school.ts): add a school, record its data agreement, mint a
 * teacher invite, list the schools, export one student's record, against DATABASE_URL as `npm run migrate`
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
  print(JSON.stringify(record, null, 2));
}
