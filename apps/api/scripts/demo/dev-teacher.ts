import { newUuidV7 } from '@bali/db';
import {
  type BlockDetail,
  type ClassDetail,
  type EndSessionResponse,
  type ExtendSessionResponse,
  MAX_SESSION_MINUTES,
  type MeResponse,
  type SessionSnapshot,
  type StartSessionResponse,
} from '@bali/shared';
import { parseArgs } from 'node:util';

// The portal's own grid rules, so a line here says what its chip would (rule 2).
import {
  fromSnapshot,
  gridDisplay,
  type GridDisplay,
  type Student,
  unlockNote,
} from '../../../web/src/lib/grid-state.js';
import { detailOf } from './cognito.js';
import { type Call, createCall } from './http.js';
import {
  createRemoteWorld,
  type DemoActorSpec,
  provisioningSql,
  resolveRemoteConfig,
} from './world.js';

/*
 * The teacher's side of an iPhone device check against Railway dev, from the
 * terminal (Phase 3 · T1): a class to join, a block to tap, a session to start
 * and each student's state as it changes. The portal cannot do this on dev yet
 * (docs/DECISIONS.md, 2026-09-25).
 *
 * It is the exit demo's remote mode, reused: the same variables (README,
 * "Running it against a deployed API"), the same Cognito sign-in and teacher
 * check, the same HTTP caller. Only the teacher's own requests — no database,
 * no sweep key — and nothing it prints is a credential: the password stays in
 * the sign-in, the token in the requests.
 */

const TEACHER: DemoActorSpec = { key: 'teacher', displayName: 'Teacher', role: 'teacher' };
const DEFAULT_CLASS = 'Device check';
const DEFAULT_TAG = 'DEVICE-CHECK-1';
const DEFAULT_POLL_MS = 2_000;

export const USAGE = `usage: npm run dev:teacher -- <command> [--class <name>]

  class [name]       make the class (default "${DEFAULT_CLASS}"), or reuse yours of that name; prints its join code
  block [tag]        register a block tag to you (default ${DEFAULT_TAG}); a re-run returns the same block
  start [minutes]    start a session in the class (default 20 minutes)
  watch              print each student's state as it changes, until the session ends (Ctrl-C stops)
  extend [minutes]   add time to the running session (default 10 minutes)
  end                end the running session

--class names the class for start, watch, extend and end (default "${DEFAULT_CLASS}").
It signs in as DEMO_USER_TEACHER against DEMO_API_URL, with the exit demo's variables
(README, "Running it against a deployed API").`;

export interface DevTeacherIO {
  env: NodeJS.ProcessEnv;
  print: (line: string) => void;
  /** Tests only: a stand-in for Cognito. */
  cognitoFetch?: typeof fetch;
  /** How often `watch` reads the session. */
  pollMs?: number;
}

interface Teacher {
  call: Call;
  token: string;
  userId: string;
  className: string;
  print: (line: string) => void;
  pollMs: number;
}

type Run = (t: Teacher) => Promise<void>;

export async function runDevTeacher(argv: readonly string[], io: DevTeacherIO): Promise<void> {
  let parsed: { run: Run | null; className: string };
  try {
    parsed = parseCommandLine(argv);
  } catch (err) {
    io.print(USAGE);
    throw err;
  }
  const { run, className } = parsed;
  if (!run) {
    io.print(USAGE);
    return;
  }

  // Signed in as the demo's remote mode signs in — its variables, its Cognito
  // call, and its check that this account really is a teacher.
  const world = createRemoteWorld(resolveRemoteConfig(io.env, [TEACHER]), {
    cognitoFetch: io.cognitoFetch,
  });
  const teacher = (await world.provision([TEACHER])).get(TEACHER.key);
  if (!teacher) throw new Error('the teacher did not sign in');
  await run({
    call: createCall(world.base),
    token: teacher.token,
    userId: teacher.userId,
    className,
    print: io.print,
    pollMs: io.pollMs ?? DEFAULT_POLL_MS,
  });
}

/** The command and its argument, checked before anything signs in; no run is the usage. */
function parseCommandLine(argv: readonly string[]): { run: Run | null; className: string } {
  const { positionals, values } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: { class: { type: 'string' } },
  });
  const [command, arg, ...extra] = positionals;
  if (extra.length > 0) throw new Error(`unexpected "${extra.join(' ')}"`);
  // `class [name]` names the class too; the server stores a name trimmed.
  const className = (
    (command === 'class' ? arg : undefined) ??
    values.class ??
    DEFAULT_CLASS
  ).trim();
  const none = (run: Run): Run => {
    if (arg !== undefined) throw new Error(`${command} takes no argument; --class names the class`);
    return run;
  };
  switch (command) {
    case undefined:
    case 'help':
      return { run: null, className };
    case 'class':
      return { run: classCommand, className };
    case 'block':
      return { run: (t) => blockCommand(t, arg ?? DEFAULT_TAG), className };
    case 'start': {
      const n = minutes(arg, 20);
      return { run: (t) => startCommand(t, n), className };
    }
    case 'watch':
      return { run: none(watchCommand), className };
    case 'extend': {
      const n = minutes(arg, 10);
      return { run: (t) => extendCommand(t, n), className };
    }
    case 'end':
      return { run: none(endCommand), className };
    default:
      throw new Error(`unknown command "${command}"`);
  }
}

function minutes(arg: string | undefined, fallback: number): number {
  const n = arg === undefined ? fallback : Number(arg);
  if (!Number.isInteger(n) || n < 1 || n > MAX_SESSION_MINUTES) {
    throw new Error(
      `minutes must be a whole number from 1 to ${MAX_SESSION_MINUTES}, not "${arg}"`,
    );
  }
  return n;
}

/** A time in this machine's own zone. */
const local = (at: string | Date): string => new Date(at).toLocaleTimeString();

/** The teacher's live class of that name, or null. */
async function findClass(t: Teacher): Promise<ClassDetail | null> {
  const me = await t.call<MeResponse>('GET', '/v1/me', { token: t.token });
  const named = me.classes.filter((c) => c.name === t.className);
  if (named.length > 1) {
    throw new Error(
      `you have ${named.length} classes named "${t.className}" — use another with --class`,
    );
  }
  const found = named[0];
  return found ? t.call<ClassDetail>('GET', `/v1/classes/${found.id}`, { token: t.token }) : null;
}

async function requireClass(t: Teacher): Promise<ClassDetail> {
  const klass = await findClass(t);
  if (!klass) {
    throw new Error(
      `you have no class named "${t.className}" — make it first: npm run dev:teacher -- class`,
    );
  }
  return klass;
}

async function requireRunning(t: Teacher): Promise<{ klass: ClassDetail; sessionId: string }> {
  const klass = await requireClass(t);
  if (!klass.liveSessionId) {
    throw new Error(
      `no session is running in "${klass.name}" — start one: npm run dev:teacher -- start`,
    );
  }
  return { klass, sessionId: klass.liveSessionId };
}

async function classCommand(t: Teacher): Promise<void> {
  const found = await findClass(t);
  const klass =
    found ??
    (await t
      .call<ClassDetail>('POST', '/v1/classes', { token: t.token, body: { name: t.className } })
      .catch((err: unknown) => {
        // classes.school_id is NOT NULL and no code path assigns it (the demo's case).
        if (err instanceof Error && err.message.includes('not assigned to a school')) {
          throw new Error(
            `the teacher has no school, so no class can be made. Assign one out of band:\n` +
              provisioningSql(t.userId, 'school'),
            { cause: err },
          );
        }
        throw err;
      }));
  t.print(
    `class "${klass.name}" (${found ? 'yours already' : 'made'}): join code ${klass.joinCode}`,
  );
  if (klass.liveSessionId) t.print(`a session is running in it: ${klass.liveSessionId}`);
}

async function blockCommand(t: Teacher, tagId: string): Promise<void> {
  // Registering one's own tag again returns that block: the call is its own retry.
  const block = await t.call<BlockDetail>('POST', '/v1/blocks', {
    token: t.token,
    body: { tagId },
  });
  t.print(`block ${block.tagId} is yours — type it into the phone's Tap field`);
}

async function startCommand(t: Teacher, durationMinutes: number): Promise<void> {
  const klass = await requireClass(t);
  const started = await t.call<StartSessionResponse>('POST', `/v1/classes/${klass.id}/sessions`, {
    token: t.token,
    body: { durationMinutes },
  });
  const { id, endsAt } = started.session;
  t.print(
    started.outcome === 'created'
      ? `session ${id} started in "${klass.name}"; it ends at ${local(endsAt)}`
      : `a session was already running in "${klass.name}": ${id}, until ${local(endsAt)} (extend adds time)`,
  );
  if (started.armedConverted > 0) {
    t.print(`${started.armedConverted} tap(s) made before the start joined it`);
  }
}

async function extendCommand(t: Teacher, durationMinutes: number): Promise<void> {
  const { sessionId } = await requireRunning(t);
  const extended = await t.call<ExtendSessionResponse>('POST', `/v1/sessions/${sessionId}/extend`, {
    token: t.token,
    body: { durationMinutes, eventId: newUuidV7() },
  });
  t.print(`session ${sessionId} now ends at ${local(extended.session.endsAt)}`);
}

async function endCommand(t: Teacher): Promise<void> {
  const klass = await requireClass(t);
  if (!klass.liveSessionId) {
    t.print(`no session is running in "${klass.name}" — nothing to end`);
    return;
  }
  const ended = await t.call<EndSessionResponse>(
    'POST',
    `/v1/sessions/${klass.liveSessionId}/end`,
    { token: t.token },
  );
  t.print(
    `session ${klass.liveSessionId} ${ended.outcome === 'ended' ? 'ended' : 'had already ended'}; ` +
      `${ended.endedParticipations} participation(s) closed`,
  );
}

/** The portal's chip labels (apps/web/src/components/live-grid.tsx), as text. */
const LABEL: Record<GridDisplay, string> = {
  focused: 'focused',
  unlocked: 'unlocked',
  protection_off: 'protection off',
  silent: 'silent',
  ended: 'left',
  left_unprotected: 'left · unlocked',
  left_protection_off: 'left · protection off',
  absent: 'waiting — not tapped in',
  unknown: 'a state this checkout does not know — pull and re-run',
};

/** A student's chip as the grid shows it now, the unlock's note, and when they were last seen. */
function describe(s: Student, now: Date): string {
  const shown = gridDisplay(s, now);
  const parts = [LABEL[shown], unlockNote(s, shown)];
  if (s.lastSeenAt) parts.push(`last seen ${local(s.lastSeenAt)}`);
  return parts.filter(Boolean).join(' · ');
}

/**
 * The snapshot the portal boots from, read every few seconds, printing a
 * student's line whenever it changes — a check-in moves "last seen", so each
 * one shows. Polling, not the stream: nothing held open, and every read is the
 * whole truth. A failed read is said once and tried again; the session's end
 * ends the watch, and so does a sign-in that expired.
 */
async function watchCommand(t: Teacher): Promise<void> {
  const { klass, sessionId } = await requireRunning(t);
  t.print(`watching "${klass.name}", session ${sessionId} (Ctrl-C stops)`);
  const say = (line: string): void => t.print(`${local(new Date())}  ${line}`);
  const shown = new Map<string, { name: string; line: string }>();
  let endsAt: string | null = null;
  let failing: string | null = null;

  /** The snapshot, or null when the read failed — said once, however often it fails. */
  const read = async (): Promise<SessionSnapshot | null> => {
    try {
      const snap = await t.call<SessionSnapshot>('GET', `/v1/sessions/${sessionId}`, {
        token: t.token,
      });
      if (failing !== null) say('reading the session again');
      failing = null;
      return snap;
    } catch (err) {
      const why = detailOf(err);
      if (why.includes('→ 401 ')) {
        throw new Error("the teacher's sign-in has expired; run watch again", { cause: err });
      }
      if (why !== failing) say(`could not read the session (${why}); trying again`);
      failing = why;
      return null;
    }
  };

  /** Print what changed since the last read; true once the session is over. */
  const show = (snap: SessionSnapshot): boolean => {
    const firstRead = endsAt === null;
    if (snap.session.endsAt !== endsAt) {
      endsAt = snap.session.endsAt;
      say(`the session ends at ${local(endsAt)}`);
    }
    const students = fromSnapshot(snap);
    if (firstRead && Object.keys(students).length === 0) say('no students in the class yet');
    const now = new Date();
    for (const s of Object.values(students)) {
      const name = s.displayName ?? s.studentId.slice(0, 8);
      const line = describe(s, now);
      if (shown.get(s.studentId)?.line !== line) say(`${name}: ${line}`);
      shown.set(s.studentId, { name, line });
    }
    for (const [id, { name }] of shown) {
      if (id in students) continue;
      say(`${name}: no longer in the class`);
      shown.delete(id);
    }
    if (snap.ended) say('the session is over');
    return snap.ended;
  };

  for (;;) {
    const snap = await read();
    if (snap && show(snap)) return;
    await sleep(t.pollMs);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
