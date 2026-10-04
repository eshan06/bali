import { createHash } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '../src/ids.js';
import { JOIN_CODE_ALPHABET } from '../src/management.js';
import { parseSchoolCommand, type SchoolCommand } from '../src/school-command.js';
import { schools, teacherInvites, users } from '../src/schema.js';
import {
  createSchool,
  formatInviteCode,
  generateInviteCode,
  hashInviteCode,
  INVITE_CODE_LENGTH,
  INVITE_CODE_PATTERN,
  INVITE_LIFETIME_DAYS,
  inviteCodeSymbols,
  mintTeacherInvite,
  recordAgreement,
} from '../src/schools.js';
import { makeTestDb } from '../src/testing.js';
import type { Database } from '../src/types.js';

/*
 * T1a: schools, their data agreements, and the teacher invites the owner mints
 * for them (`npm run school`). Each test makes its own school, so they share
 * one database.
 */

let db: Database;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await makeTestDb());
});

afterAll(async () => {
  await close();
});

const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{25}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Midday, so today is 2026-10-04 in any zone from UTC-11 to UTC+11. */
const NOW = new Date('2026-10-04T12:00:00Z');

/** A school whose data agreement is on record. */
async function signedSchool(name: string) {
  const school = await createSchool(db, { name });
  await recordAgreement(db, { schoolId: school.id, signedOn: '2026-09-30' });
  return school;
}

async function mint(schoolId: string, gen?: () => string) {
  const result = await mintTeacherInvite(db, { schoolId }, gen);
  if (result.outcome !== 'minted') throw new Error(`minted, got ${result.outcome}`);
  return result;
}

async function invitesOf(schoolId: string) {
  return db.select().from(teacherInvites).where(eq(teacherInvites.schoolId, schoolId));
}

/** The whole row as Postgres writes it out: every column, whatever its name. */
async function rowText(inviteId: string): Promise<string> {
  const result = await db.execute(
    sql`select t::text as row from teacher_invites t where t.id = ${inviteId}`,
  );
  // postgres.js answers with the rows, PGlite with an object holding them.
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as {
    row: string;
  }[];
  if (rows.length !== 1 || rows[0] === undefined) throw new Error('expected one invite');
  return rows[0].row;
}

/** A deterministic stand-in for `generateInviteCode`, to force a collision. */
function sequence(...values: string[]): () => string {
  const iter = values[Symbol.iterator]();
  return () => {
    const next = iter.next();
    if (next.done) throw new Error('code sequence exhausted');
    return next.value;
  };
}

/** Async rejection, reading the message off the cause chain as drizzle wraps it. */
async function refusal(promise: Promise<unknown>): Promise<string> {
  const outcome = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  expect(outcome, 'expected a refusal').not.toBeNull();
  const messages: string[] = [];
  for (let err = outcome; err instanceof Error; err = err.cause) messages.push(err.message);
  return messages.join('\n');
}

describe('invite codes', () => {
  it('are 25 symbols of the unambiguous alphabet, never 0/O/1/I/L, fresh each time', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const code = generateInviteCode();
      expect(code).toMatch(CODE);
      expect(code).not.toMatch(/[01OIL]/);
      codes.add(code);
    }
    expect(codes.size).toBe(200);
  });

  it('carry the 112 bits that let a plain SHA-256 keep them (NIST SP 800-63B §5.1.2.2)', () => {
    expect(INVITE_CODE_LENGTH).toBe(25);
    expect(INVITE_CODE_LENGTH * Math.log2(JOIN_CODE_ALPHABET.length)).toBeGreaterThan(112);
  });

  it('are shown in five groups of five, and stored as the SHA-256 of the symbols alone', () => {
    const code = 'ABCDEFGHJKMNPQRSTUVWXYZ23';
    expect(formatInviteCode(code)).toBe('ABCDE-FGHJK-MNPQR-STUVW-XYZ23');
    expect(hashInviteCode(code)).toBe(createHash('sha256').update(code).digest('hex'));
    expect(hashInviteCode(code)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('are read back as typed — case, spaces and any dash set aside — into the symbols minted (T1b)', () => {
    const code = generateInviteCode();
    const shown = formatInviteCode(code);
    for (const typed of [
      shown,
      shown.toLowerCase(),
      shown.replaceAll('-', ' '),
      shown.replaceAll('-', ' - '),
      shown.replaceAll('-', '–'),
      shown.replaceAll('-', '‑'),
      `\t${code}\n`,
    ]) {
      expect(inviteCodeSymbols(typed), typed).toBe(code);
    }
    expect(code).toMatch(INVITE_CODE_PATTERN);
    const short = code.slice(1);
    for (const wrong of [
      short,
      `${code}A`,
      `${short}0`,
      `${short}o`,
      `${short}1`,
      `${short}i`,
      `${short}l`,
    ]) {
      expect(inviteCodeSymbols(wrong), wrong).not.toMatch(INVITE_CODE_PATTERN);
    }
  });
});

describe('mintTeacherInvite', () => {
  it('stores only the hash: the code appears nowhere in the row', async () => {
    const school = await signedSchool('Hash Only High');
    const { code, invite } = await mint(school.id);
    expect(code).toMatch(CODE);
    expect(invite.codeHash).toBe(createHash('sha256').update(code).digest('hex'));

    const row = await rowText(invite.id);
    expect(row).toContain(invite.codeHash);
    for (const shown of [code, formatInviteCode(code), code.toLowerCase()]) {
      expect(row).not.toContain(shown);
    }
  });

  it('expires 14 days after it is minted, by the database clock', async () => {
    const school = await signedSchool('Fortnight High');
    const before = Date.now();
    const { invite } = await mint(school.id);
    expect(INVITE_LIFETIME_DAYS).toBe(14);
    expect(invite.expiresAt.getTime() - invite.createdAt.getTime()).toBe(14 * DAY_MS);
    // PGlite runs in this process; a real Postgres is this machine's too.
    expect(Math.abs(invite.createdAt.getTime() - before)).toBeLessThan(60_000);
    expect(invite.redeemedAt).toBeNull();
    expect(invite.redeemedBy).toBeNull();
    expect(invite.redeemEventId).toBeNull();
  });

  it('refuses a school with no signed data agreement, and stores nothing', async () => {
    const school = await createSchool(db, { name: 'Unsigned High' });
    const result = await mintTeacherInvite(db, { schoolId: school.id });
    expect(result.outcome).toBe('no_agreement');
    expect(await invitesOf(school.id)).toHaveLength(0);
  });

  it('refuses an unknown school, and a removed one', async () => {
    expect((await mintTeacherInvite(db, { schoolId: newUuidV7() })).outcome).toBe('unknown_school');
    // Staged by hand: nothing removes a school yet.
    const removed = await signedSchool('Closed High');
    await db.update(schools).set({ removedAt: new Date() }).where(eq(schools.id, removed.id));
    expect((await mintTeacherInvite(db, { schoolId: removed.id })).outcome).toBe('unknown_school');
    expect(await invitesOf(removed.id)).toHaveLength(0);
  });

  it('mints a different code each time', async () => {
    const school = await signedSchool('Many High');
    const minted = await Promise.all(Array.from({ length: 20 }, () => mint(school.id)));
    expect(new Set(minted.map((m) => m.code)).size).toBe(20);
    expect(new Set(minted.map((m) => m.invite.codeHash)).size).toBe(20);
  });

  it('draws again past a code another invite holds, and never stores one twice', async () => {
    const school = await signedSchool('Collision High');
    const taken = 'ZZZZZZZZZZZZZZZZZZZZZZZZZ';
    const fresh = 'YYYYYYYYYYYYYYYYYYYYYYYYY';
    await mint(school.id, () => taken);
    const second = await mint(school.id, sequence(taken, fresh));
    expect(second.code).toBe(fresh);
    const held = await db
      .select()
      .from(teacherInvites)
      .where(eq(teacherInvites.codeHash, hashInviteCode(taken)));
    expect(held).toHaveLength(1);
  });

  it('refuses cleanly when every draw is taken, storing nothing more', async () => {
    const school = await signedSchool('Exhausted High');
    const taken = 'XXXXXXXXXXXXXXXXXXXXXXXXX';
    await mint(school.id, () => taken);
    expect(await refusal(mintTeacherInvite(db, { schoolId: school.id }, () => taken))).toMatch(
      /could not draw a code no other invite holds/,
    );
    expect(await invitesOf(school.id)).toHaveLength(1);
  });
});

describe('recordAgreement', () => {
  it('records the day as written, and a later one replaces it, saying what it said', async () => {
    const school = await createSchool(db, { name: 'Agreement High' });
    expect(school.agreementSignedAt).toBeNull();
    const first = await recordAgreement(db, { schoolId: school.id, signedOn: '2026-09-30' });
    expect(first?.before).toBeNull();
    expect(first?.school.agreementSignedAt).toBe('2026-09-30');
    const fixed = await recordAgreement(db, { schoolId: school.id, signedOn: '2026-10-01' });
    expect(fixed?.before).toBe('2026-09-30');
    const [row] = await db.select().from(schools).where(eq(schools.id, school.id));
    expect(row?.agreementSignedAt).toBe('2026-10-01');
  });

  it('is undefined for a school not on record', async () => {
    expect(
      await recordAgreement(db, { schoolId: newUuidV7(), signedOn: '2026-10-01' }),
    ).toBeUndefined();
  });
});

describe('the teacher_invites table', () => {
  const values = (schoolId: string, code: string) => ({
    schoolId,
    codeHash: hashInviteCode(code),
    expiresAt: new Date(Date.now() + 14 * DAY_MS),
  });

  it('holds a hash only: a code written to code_hash is refused', async () => {
    const school = await signedSchool('Plaintext High');
    const code = generateInviteCode();
    expect(
      await refusal(
        db.insert(teacherInvites).values({ ...values(school.id, code), codeHash: code }),
      ),
    ).toMatch(/teacher_invites_code_hash_hex/);
  });

  it('holds one invite per code', async () => {
    const school = await signedSchool('Unique High');
    const code = generateInviteCode();
    await db.insert(teacherInvites).values(values(school.id, code));
    expect(await refusal(db.insert(teacherInvites).values(values(school.id, code)))).toMatch(
      /teacher_invites_code_hash_unique/,
    );
  });

  /** Two fresh invites of one school, and an account to redeem them, as T1b will. */
  async function twoInvites(name: string) {
    const school = await signedSchool(name);
    const [account] = await db
      .insert(users)
      .values({ cognitoId: `t1a-${newUuidV7()}`, role: 'student' })
      .returning();
    const [a, b] = await db
      .insert(teacherInvites)
      .values([values(school.id, generateInviteCode()), values(school.id, generateInviteCode())])
      .returning();
    if (!account || !a || !b) throw new Error('not seeded');
    const redeem = (by: string = account.id) => ({
      redeemedAt: new Date(),
      redeemedBy: by,
      redeemEventId: newUuidV7(),
    });
    return { a, b, account, redeem };
  }

  it('keeps a redeem whole, and one eventId redeems one invite', async () => {
    const { a, b, redeem } = await twoInvites('Whole High');
    // Half a redeem: its time without its account and eventId.
    expect(
      await refusal(
        db
          .update(teacherInvites)
          .set({ redeemedAt: new Date() })
          .where(eq(teacherInvites.id, a.id)),
      ),
    ).toMatch(/teacher_invites_redeem_whole/);

    const once = redeem();
    await db.update(teacherInvites).set(once).where(eq(teacherInvites.id, a.id));
    expect(
      await refusal(db.update(teacherInvites).set(once).where(eq(teacherInvites.id, b.id))),
    ).toMatch(/teacher_invites_redeem_event_id_unique/);
  });

  it('is single use: once redeemed, its row never changes again (ready for T1b)', async () => {
    const { a, account, redeem } = await twoInvites('Single Use High');
    const [other] = await db
      .insert(users)
      .values({ cognitoId: `t1a-${newUuidV7()}`, role: 'student' })
      .returning();
    if (!other) throw new Error('no second account');
    const guarded = (by: string) =>
      db
        .update(teacherInvites)
        .set(redeem(by))
        .where(and(eq(teacherInvites.id, a.id), isNull(teacherInvites.redeemedAt)))
        .returning();

    // The redeem T1b makes: one UPDATE guarded by `redeemed_at IS NULL`. It
    // takes the invite once; a second finds nothing to take, and is no error.
    expect(await guarded(account.id)).toHaveLength(1);
    expect(await guarded(other.id)).toHaveLength(0);

    // Unguarded, the database refuses: no second account, no redeem undone.
    const rewrite = (set: Partial<typeof teacherInvites.$inferInsert>) =>
      refusal(db.update(teacherInvites).set(set).where(eq(teacherInvites.id, a.id)));
    expect(await rewrite(redeem(other.id))).toMatch(/single use: invite .* is already redeemed/);
    expect(await rewrite({ redeemedAt: null, redeemedBy: null, redeemEventId: null })).toMatch(
      /single use/,
    );
    const [kept] = await db.select().from(teacherInvites).where(eq(teacherInvites.id, a.id));
    expect(kept?.redeemedBy).toBe(account.id);
  });

  it('keeps a redeemed invite on the record: it is never deleted, while an unredeemed one can go (0014)', async () => {
    const { a, b, redeem } = await twoInvites('Record High');
    await db.update(teacherInvites).set(redeem()).where(eq(teacherInvites.id, a.id));
    const rows = (id: string) => db.select().from(teacherInvites).where(eq(teacherInvites.id, id));

    expect(await refusal(db.delete(teacherInvites).where(eq(teacherInvites.id, a.id)))).toMatch(
      /single use: invite .* is already redeemed/,
    );
    expect(await rows(a.id)).toHaveLength(1);
    await db.delete(teacherInvites).where(eq(teacherInvites.id, b.id));
    expect(await rows(b.id)).toHaveLength(0);
  });
});

describe('npm run school: its arguments', () => {
  const id = newUuidV7();
  const parse = (...argv: string[]) => parseSchoolCommand(argv, NOW);
  const refused = (...argv: string[]) => {
    try {
      parse(...argv);
    } catch (err) {
      return (err as Error).message;
    }
    throw new Error(`expected [${argv.join(' ')}] to be refused`);
  };

  it('no command, or help, asks for the usage', () => {
    expect(parse()).toBeNull();
    expect(parse('help')).toBeNull();
    expect(parse('--help')).toBeNull();
  });

  it('says which command it does not know', () => {
    expect(refused('mint')).toBe('unknown command "mint"');
  });

  it('add: needs a name, one, quoted when it has spaces', () => {
    expect(refused('add')).toBe(`add needs the school's name: add "Lincoln High"`);
    expect(refused('add', '   ')).toBe(`add needs the school's name: add "Lincoln High"`);
    expect(refused('add', 'Lincoln', 'High')).toBe(
      'add takes one name; quote a name with spaces: add "Lincoln High"',
    );
  });

  it("agreement: needs a school's id and a real day, written YYYY-MM-DD, not after today", () => {
    const needs = `agreement needs the school's id and the day its agreement was signed: agreement <school-id> YYYY-MM-DD`;
    expect(refused('agreement')).toBe(needs);
    expect(refused('agreement', id)).toBe(needs);
    expect(refused('agreement', 'lincoln', '2026-10-01')).toBe(
      '"lincoln" is not a school id: add prints one',
    );
    for (const day of ['2026-02-30', '2026-13-01', '10/01/2026', '2026-1-5', 'yesterday']) {
      expect(refused('agreement', id, day)).toBe(`"${day}" is not a day written YYYY-MM-DD`);
    }
    expect(refused('agreement', id, '2026-10-05')).toBe(
      "an agreement can't be signed after today: 2026-10-05 is after 2026-10-04, today on this machine",
    );
    expect(refused('agreement', id, '2026-10-01', 'signed')).toBe('unexpected "signed"');
    expect(parse('agreement', id, '2026-10-04')).toBeTypeOf('function');
  });

  it("invite: needs one school's id", () => {
    expect(refused('invite')).toBe(`invite needs the school's id: invite <school-id>`);
    expect(refused('invite', 'Lincoln High')).toBe(
      '"Lincoln High" is not a school id: add prints one',
    );
    expect(refused('invite', id, 'now')).toBe('unexpected "now"');
  });
});

describe('npm run school: running it', () => {
  /** Run a command, collecting what it prints. */
  async function run(...argv: string[]): Promise<string[]> {
    const command: SchoolCommand | null = parseSchoolCommand(argv, NOW);
    if (!command) throw new Error('expected a command');
    const lines: string[] = [];
    await command({ db, print: (line) => lines.push(line) });
    return lines;
  }

  it('adds a school, records its agreement, and prints an invite once, which only its hash keeps', async () => {
    const added = await run('add', '  Lincoln High  ');
    const schoolId = /its id is (\S+)$/.exec(added[0] ?? '')?.[1];
    if (!schoolId) throw new Error(`no id in ${added.join('\n')}`);
    const [school] = await db.select().from(schools).where(eq(schools.id, schoolId));
    expect(school?.name).toBe('Lincoln High');

    expect(await run('agreement', schoolId, '2026-09-30')).toEqual([
      '"Lincoln High": its data agreement is on record as signed on 2026-09-30',
    ]);
    expect(await run('agreement', schoolId, '2026-10-01')).toEqual([
      '"Lincoln High": its data agreement is on record as signed on 2026-10-01 (it said 2026-09-30)',
    ]);

    const printed = (await run('invite', schoolId)).join('\n');
    const shown = /^ {2}([A-Z2-9]{5}(?:-[A-Z2-9]{5}){4})$/m.exec(printed)?.[1];
    if (!shown) throw new Error(`no code in ${printed}`);
    expect(printed.split(shown)).toHaveLength(2); // printed once
    expect(printed).toMatch(/a teacher invite for "Lincoln High": for one teacher, once, until /);

    const [invite, ...more] = await invitesOf(schoolId);
    expect(more).toHaveLength(0);
    expect(invite?.codeHash).toBe(hashInviteCode(shown.replaceAll('-', '')));
    expect(await rowText(invite?.id ?? '')).not.toContain(shown.replaceAll('-', ''));
  });

  it('refuses an invite for a school with no agreement on record, saying how to record one', async () => {
    const school = await createSchool(db, { name: 'Pending High' });
    expect(await refusal(run('invite', school.id))).toBe(
      `"Pending High" has no data agreement on record, so no invite is minted for it. ` +
        `Once it is signed: npm run school -- agreement ${school.id} YYYY-MM-DD`,
    );
    expect(await invitesOf(school.id)).toHaveLength(0);
  });

  it('says when no school has the id', async () => {
    const unknown = newUuidV7();
    expect(await refusal(run('invite', unknown))).toBe(`no school on record has the id ${unknown}`);
    expect(await refusal(run('agreement', unknown, '2026-10-01'))).toBe(
      `no school on record has the id ${unknown}`,
    );
  });
});
