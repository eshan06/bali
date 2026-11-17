'use client';

import {
  type BlockListResponse,
  type ClassDetail,
  type FeedEvent,
  MAX_SESSION_MINUTES,
  type RosterResponse,
  type SessionReportResponse,
  type SessionReportsPage,
  type SessionReportSummary,
  type SessionView,
  type StartSessionResponse,
} from '@bali/shared';
import { Check, CircleAlert, Presentation } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { AskPanel, NEW_DRAFT, PickPanel } from '@/components/ask-panel';
import { Button, LockButton, QUIET } from '@/components/button';
import { WELL } from '@/components/card';
import { useCount, useCountOpened } from '@/components/count';
import { DecksPanel } from '@/components/decks-panel';
import { Input } from '@/components/field';
import { DIALOG, JoinCode } from '@/components/join-code';
import { LiveGrid, type StateCounts } from '@/components/live-grid';
import { LiveCounts, LiveHeader, Ring } from '@/components/live-header';
import { PresentQuestion } from '@/components/present-question';
import { PresentSlide } from '@/components/present-slide';
import { isOpen, QuestionCard, useLiveQuestion } from '@/components/question-card';
import { endedToday, RecapCard } from '@/components/recap-card';
import { usePresenting } from '@/components/shell';
import { SlideCard } from '@/components/slide-card';
import { land, TryAgain } from '@/components/try-again';
import { type ApiClient, SAVE_TIMEOUT_MS } from '@/lib/api-client';
import { getAccessToken } from '@/lib/auth';
import { blockIdOf, type RegisterAnswer, registerBlock } from '@/lib/blocks';
import { daysBefore } from '@/lib/classes';
import {
  errText,
  NOT_A_BLOCK_ID,
  NOT_A_SESSION_LENGTH,
  SESSION_ALREADY_RUNNING,
} from '@/lib/errors';
import { lessonsOn } from '@/lib/lessons';
import { failureOf, type QuestionDraft } from '@/lib/live-question';
import { latestEnded, readEvents, recapGroups } from '@/lib/recap';
import { reportPath } from '@/lib/reports';
import {
  DEFAULT_MINUTES,
  EXTEND_PRESETS,
  type ExtendAttempt,
  extendAttemptFor,
  extendSession,
  keepUnanswered,
  laterBell,
  LENGTH_PRESETS,
  parseMinutes,
  pickFor,
  rememberedMinutes,
  rememberedPresent,
  rememberMinutes,
  rememberPresent,
  saysAlreadyRunning,
  sessionRunning,
} from '@/lib/session-controls';
import { useApi } from '@/lib/use-api';
import { useSlide } from '@/lib/use-slide';

/**
 * The page in Present, the projector's view (ClassPresent, PresentEnded): no menu, the shell
 * drawing none (PV5), the page 36/48/40 in and at least the screen's height, its parts 22 px apart,
 * as v2.css's `.proj` draws it. A 1024 px projector still shows four columns (`PRESENT_COLUMNS`).
 */
const PRESENT_PAGE = 'relative flex min-h-dvh flex-col gap-5.5 px-4 pt-9 pb-10 sm:px-12';

/**
 * The length picker in its well (ClassPage's `.seg`): a stone track holding each length as a
 * segment, 34 px tall, the radio inside it read by screen readers and clipped away, so the focus ring
 * is drawn on the label for it. The pick is white and raised, in the primary ink, with a check, never
 * colour alone; another one greys on hover.
 */
const TRACK = 'inline-flex flex-wrap gap-1 rounded-sm bg-border-default p-1';
const SEGMENT =
  'relative inline-flex h-8.5 cursor-pointer items-center gap-1.5 rounded-item px-3 text-segment whitespace-nowrap text-text-secondary transition-colors select-none [&:not(:has(:checked))]:hover:bg-border-strong has-checked:bg-surface-card has-checked:text-text-primary has-checked:shadow-1 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring';

/** A well before class (ClassPage's `.ready`): 24 px in, 20 on a phone, its parts on one row as they fit. */
const READY = `${WELL} flex flex-wrap items-center justify-between gap-x-8 gap-y-5 p-6 max-[760px]:p-5`;

/** "28 students", "1 student". */
const students = (count: number) => `${count} ${count === 1 ? 'student' : 'students'}`;

/** A form's own button: Start, in its well. */
const submitOf = (form: HTMLFormElement | null) =>
  form?.querySelector<HTMLButtonElement>('[type="submit"]') ?? null;

/**
 * The class's last session, for the line under the well (ClassPage): none yet; one that ended today,
 * the recap card's (v2's ClassEnded, until LO7), which reads it whole; else its day, who joined and
 * how many of them stayed focused the whole time, as the recap counts them.
 */
type Last =
  | { kind: 'finding' }
  | { kind: 'none' }
  | { kind: 'today'; session: SessionReportSummary }
  | { kind: 'line'; session: SessionReportSummary; joined: number; whole: number }
  | { kind: 'error'; message: string };

async function readLast(api: Pick<ApiClient, 'get'>, classId: string): Promise<Last> {
  const reports = `/v1/classes/${encodeURIComponent(classId)}/reports/sessions`;
  try {
    const session = latestEnded(await api.get<SessionReportsPage>(`${reports}?limit=1`));
    if (session === null) return { kind: 'none' };
    if (endedToday(session) !== null) return { kind: 'today', session };
    const [report, events] = await Promise.all([
      api.get<SessionReportResponse>(`${reports}/${encodeURIComponent(session.id)}`),
      readEvents(api, session.id),
    ]);
    const whole = recapGroups(session, report, events, []).wholeTime.length;
    return { kind: 'line', session, joined: report.joined.length, whole };
  } catch (e) {
    return { kind: 'error', message: errText(e) };
  }
}

/** When it ran, by this computer's calendar: "On Friday" for the last six days, else "On Oct 2". */
function onDay(startedAt: string, now = new Date()): string {
  const at = new Date(startedAt);
  const ago = daysBefore(at, now);
  if (ago <= 0) return 'Today';
  if (ago < 7) return `On ${at.toLocaleDateString(undefined, { weekday: 'long' })}`;
  const year = at.getFullYear() === now.getFullYear() ? undefined : 'numeric';
  return `On ${at.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year })}`;
}

/**
 * A text field in the lock-only look (ClassStates' Block code): its label over it in the meta size,
 * the Field's own input 220 px wide, its help under it.
 */
function LockField({
  id,
  label,
  help,
  'aria-describedby': describedBy,
  ...props
}: Omit<ComponentProps<'input'>, 'className'> & {
  id: string;
  label: string;
  help?: string;
  mono?: boolean;
}) {
  const described = [help ? `${id}-help` : null, describedBy].filter(Boolean).join(' ');
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-meta text-text-secondary">
        {label}
      </label>
      <div className="w-55 max-w-full">
        <Input id={id} aria-describedby={described || undefined} {...props} />
      </div>
      {help ? (
        <p id={`${id}-help`} className="text-countdown-sub text-text-tertiary">
          {help}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A line that something didn't load (HomeStates' `.oops`), between hairlines, with Try again; held
 * while `held` says a read of it is on its way.
 */
function Oops({
  children,
  onRetry,
  held = false,
  then,
}: {
  children: ReactNode;
  onRetry: () => unknown;
  held?: boolean;
  then: readonly string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-y border-border-default py-4">
      <TryAgain onRetry={onRetry} held={held} then={then}>
        <p role="alert" className="flex min-w-0 items-center gap-2 text-body">
          <CircleAlert size={18} aria-hidden="true" className="shrink-0" />
          {children}
        </p>
      </TryAgain>
    </div>
  );
}

/**
 * No block yet (ClassStates): students lock in by tapping one, so the start waits for one, and the
 * well asks for its code. The code is checked as the phone reads a tag before it is sent (P3); each
 * refusal is said under the form, and an answer that never came is sent again as it was by Try
 * again, which is safe: one's own tag registers once. Registered, the well becomes Start's.
 */
function RegisterFirst({ onRegistered }: { onRegistered: () => void }) {
  const api = useApi();
  const count = useCount();
  const id = useId();
  const field = useRef<HTMLInputElement>(null);
  // A send under way: a second Enter before the page redraws sends nothing.
  const sending = useRef(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Exclude<RegisterAnswer, { kind: 'registered' }> | null>(null);

  async function register() {
    if (sending.current) return;
    const tagId = blockIdOf(typed);
    if (!tagId) {
      setSaid({ kind: 'refused', message: NOT_A_BLOCK_ID });
      field.current?.focus();
      return;
    }
    sending.current = true;
    setBusy(true);
    setSaid(null);
    const answer = await registerBlock(api, tagId, []);
    sending.current = false;
    setBusy(false);
    if (answer.kind !== 'registered') {
      setSaid(answer);
      if (answer.kind === 'refused') field.current?.focus();
      return;
    }
    count?.('portal_block_registered');
    onRegistered();
  }

  return (
    <section aria-labelledby={`${id}-title`} className={READY}>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 id={`${id}-title`} className="text-section-title">
          Register your block first
        </h2>
        <p className="text-meta text-text-secondary">
          10 letters and digits, written on your block.
        </p>
      </div>
      {/* Register block's own press; Enter in the field presses it too, the submit sending nothing. */}
      <form onSubmit={(e) => e.preventDefault()} className="flex flex-wrap items-end gap-2">
        <LockField
          ref={field}
          id={`${id}-code`}
          label="Block code"
          mono
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            setSaid(null);
          }}
          readOnly={busy}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          translate="no"
          aria-invalid={said?.kind === 'refused'}
          aria-describedby={said ? `${id}-said` : undefined}
        />
        <TryAgain
          type="submit"
          variant="primary"
          size="md"
          onRetry={register}
          held={busy}
          then={[]}
          send={{
            words: 'Register block',
            sending: 'Registering…',
            failed: said?.kind === 'failed',
          }}
        />
      </form>
      {said ? (
        <p id={`${id}-said`} role="alert" className="basis-full text-body break-words">
          {said.message}
        </p>
      ) : null}
    </section>
  );
}

/**
 * A class's page. While no session runs (PV6; ClassBefore, ClassNewCode, ClassStates' lines before
 * a session, CopyStates): its name over "28 students · no session running" with Reports, the length
 * picker and Start, the last session's recap (PV12b; ClassEnded: its line then "28 students · the
 * session ended at 9:55 AM" for one that ended today, and no How it ended, which repeated it), then
 * the roster in three columns beside the join code's card. Until the class is read, a Loading or
 * Error card holds the session's place: a session may be live. While one runs (PV7; ClassLive,
 * ClassStale, ClassStates' lines during a session): the header with the ring, "Live · 25 of 28
 * joined" and the join code, the countdown and the bell, +5, +10 and End session, which asks first in
 * a dialog (GA6; GA1AClassLive, GA1APresent, GA1AStates); the class counted by state
 * beside Present, then the live grid, and no roster: the grid names every student. In Present
 * (PV9; ClassPresent), the same parts one size up for the projector, the code in a well of its own
 * and +5, +10 and End kept beside Present (the owner, 2026-10-12), so a class of 28 fits one 1080p
 * screen; a question there in the grid's place, totals only (L7, part 2; PresentQuestion,
 * PresentAnswer), closed and put away there too (L7, part 3; PresentQuestionControls,
 * PresentAnswerControls); after the bell there "Class is over" alone (PresentEnded, as PV1
 * approved), the figures left to the recap. With lessons off (LO1), no question or slide, on the
 * page or in Present. Each failure is said where it happened. It sits in the
 * shell's frame beside the side menu (PV5), which sets its width and gutters; in Present the shell
 * draws neither, and the page sets its own (`PRESENT_PAGE`).
 */
export default function ClassDetailPage() {
  const api = useApi();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const classId = params.id;
  const id = useId();

  const [klass, setKlass] = useState<ClassDetail | null>(null);
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  // The session the grid shows: running, or over, kept under the recap card until the next Start.
  // Its start and bell come with the Start's answer or the grid's snapshots (a reload), the bell
  // with an extend's too.
  const [grid, setGrid] = useState<{
    id: string;
    over: boolean;
    startedAt: string | null;
    endsAt: string | null;
  } | null>(null);
  // The live grid counted, for the header's line and the counts over the grid (PV7), by session.
  const [counted, setCounted] = useState<{ session: string; counts: StateCounts } | null>(null);
  // The class's last session, for the line under the well, or the recap's card after the bell: read
  // each time the page shows no session (LO4).
  const [last, setLast] = useState<Last>({ kind: 'finding' });
  // Whether the teacher has a block (ClassStates' "No block yet"), read once as the page opens: null
  // until it answers. One that failed counts as yes, so Bali never keeps Start from a teacher whose
  // blocks it couldn't list: a session starts without one, only the students' tap needs it.
  const [hasBlock, setHasBlock] = useState<boolean | null>(null);
  // Add students, open: the join code under the students' heading (ClassStates).
  const [adding, setAdding] = useState(false);
  // The class didn't load: said in the session's place, with Try again. Its roster didn't, or a
  // read again of the class failed: said under the header, with Try again. Each said until its read
  // answers, so Try again holds in its place (ClassRetryStates).
  const [error, setError] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  // A read of each on its way, until its newest one answers: the failure it will answer holds its
  // Try again as Loading…, whichever Try again sent it (ClassRetryStates).
  const [classReading, setClassReading] = useState(false);
  const [rosterReading, setRosterReading] = useState(false);
  // Which send is under way, if any: every control holds while one is; a Start's own button says
  // "Starting…", and an End's, in its confirm, "Ending…".
  const [busy, setBusy] = useState<'start' | 'end' | 'extend' | null>(null);
  // A send under way: a second press before the page redraws sends nothing.
  const sending = useRef(false);
  // The next session's length (P10): a preset, or Other with the minutes typed under it.
  const [pick, setPick] = useState<number | 'other'>(DEFAULT_MINUTES);
  const [other, setOther] = useState('');
  const [lengthSaid, setLengthSaid] = useState(false);
  const otherField = useRef<HTMLInputElement>(null);
  // A Start that failed, said under its button; the button sends it again.
  const [startSaid, setStartSaid] = useState<string | null>(null);
  // The minutes of this page's last Start that got no answer, no session found after it, until a
  // Start is answered or a session shows: it may have landed, so its resend answered `existing`
  // with a session of those minutes is its own (`saysAlreadyRunning`; #432's Left).
  const lostStart = useRef<number | null>(null);
  // The projector view (DESIGN.md §5), toggled in the grid's header and kept for this tab, so a
  // reload or a return from Reports comes back in it; a new tab or window opens without it.
  const [present, setPresent] = useState(false);
  // On the projector, no menu: the shell draws none while Present is on.
  usePresenting(present);
  // A teacher's Start, End, extend and Present, each counted once it has happened (A3b).
  const count = useCount();
  useCountOpened('portal_present_opened', present && klass !== null);
  // The toggle moves as it is pressed (beside the counts, into Present's header), so focus follows;
  // to Start, its well's own button, where none is left to follow (Present left with no session to
  // show).
  const toggle = useRef<HTMLButtonElement>(null);
  const startForm = useRef<HTMLFormElement>(null);
  const toggled = useRef(false);
  useEffect(() => {
    if (toggled.current) (toggle.current ?? submitOf(startForm.current))?.focus();
    toggled.current = false;
  }, [present]);
  // Extend (P10): the last attempt whose answer never came, resent by Try again; and what is said
  // beside the grid: a failure (with Try again), a refusal, or a note on the session shown. An End
  // that failed is said in its confirm instead (`endSaid`, GA6).
  const unanswered = useRef<ExtendAttempt | null>(null);
  const [said, setSaid] = useState<{ kind: 'failed' | 'refused' | 'note'; message: string } | null>(
    null,
  );
  // End session asks first, in a dialog (GA6; GA1's option A, approved 2026-11-01): pressed, it
  // opens the confirm and sends nothing; the confirm's own End session sends the end, and an end
  // that failed is said in it (`endSaid`). `endAsked`: opened and not cancelled, so once the session
  // is over, by this end, the bell or another tab, focus goes to the class's name.
  const endDialog = useRef<HTMLDialogElement>(null);
  const endButton = useRef<HTMLButtonElement>(null);
  const endCancel = useRef<HTMLButtonElement>(null);
  const endAsked = useRef(false);
  const [endSaid, setEndSaid] = useState<string | null>(null);
  // The live question (L7): its card over the grid, and asking one in the side panel, where a
  // student's panel shows: one of the teacher's questions picked (L7b, part 2; LessonAsk), or one
  // written there (LessonWrite), what is written kept until it is asked or cancelled. A new session
  // starts with neither. With lessons off (LO1) neither hook follows the session, so nothing of a
  // lesson is read, its card is gone, and Present always shows the room.
  const lessons = lessonsOn();
  const live = klass !== null && grid !== null && !grid.over;
  const { lesson, onEvent, ask, opening, forgetAsk, snapshot, reread } = useLiveQuestion(
    live && lessons ? grid.id : null,
  );
  // What the session shows (M6, part 2b): from the question's read of the session, the stream and
  // this tab's own changes, its card in the question card's place while no question shows, the
  // question first (the conductor's call, 2026-10-16), the slide card back after Done.
  const { slides, onEvent: onSlideEvent } = useSlide(
    live && lessons ? grid.id : null,
    snapshot,
    reread,
  );
  const onLessonEvent = useCallback(
    (e: FeedEvent) => {
      onEvent(e);
      onSlideEvent(e);
    },
    [onEvent, onSlideEvent],
  );
  // The side panel, one at a time: asking a question (L7-1b), or picking a deck to show (M6, part
  // 2c; LessonDecks).
  const [side, setSide] = useState<'ask' | 'decks' | null>(null);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState<QuestionDraft>(NEW_DRAFT);
  useEffect(() => {
    setSide(null);
    setWriting(false);
    setDraft(NEW_DRAFT);
  }, [grid?.id]);
  // A session shown, by an answer or a read: a Start lost before it is settled, the session its
  // own or another's.
  useEffect(() => {
    lostStart.current = null;
  }, [grid?.id]);
  // Never in Present: asking lists the teacher's questions with their correct answers (the owner,
  // 2026-10-15), and what is written in it; the decks are the teacher's to pick, not the room's.
  const panel = present ? null : side;
  // In Present the question shows in the live grid's place (L7, part 2; PresentQuestion,
  // PresentAnswer), its totals the room's alone, else the slide the session shows (M6, part 2d;
  // PresentSlide): the question first (the conductor's call, 2026-10-16). The grid stays
  // underneath, its stream with it.
  const projected = present && (lesson.question !== null || slides.slide !== null);
  // Back to the button that opened it (Show slides, or Ask a question, on whichever card shows);
  // the question, when one shows (opened meanwhile, from another tab).
  const closePanel = () => {
    setSide(null);
    (
      document.getElementById(`${id}-${side === 'decks' ? 'show' : 'ask'}`) ??
      document.getElementById(`${id}-ask`) ??
      document.getElementById(`${id}-q`)
    )?.focus();
  };
  // Asked: the panel goes, and focus to the question in the card; the decks' panel, opened while the
  // ask was on its way, stays, focus with it (santa's review).
  const sideNow = useRef(side);
  useEffect(() => {
    sideNow.current = side;
  }, [side]);
  const asked = () => {
    if (sideNow.current === 'decks') return;
    setSide(null);
    window.requestAnimationFrame(() => document.getElementById(`${id}-q`)?.focus());
  };
  // Shown: the panel goes, and focus to the slide card's title; to the question, when one shows
  // first.
  const shown = () => {
    setSide(null);
    window.requestAnimationFrame(() =>
      (document.getElementById(`${id}-slides`) ?? document.getElementById(`${id}-q`))?.focus(),
    );
  };

  // Each read's turn, the class's and the roster's: only the newest one's answer is drawn, so a
  // slow read never says its failure over one read since, two Try agains for one failure (under the
  // header and in the recap) included (santa's review).
  const reads = useRef({ klass: 0, roster: 0 });

  const readRoster = useCallback(async () => {
    const mine = ++reads.current.roster;
    setRosterReading(true);
    try {
      const next = await api.get<RosterResponse>(`/v1/classes/${classId}/roster`);
      if (reads.current.roster !== mine) return;
      setRoster(next);
      setRosterError(null);
    } catch (e) {
      if (reads.current.roster === mine) setRosterError(errText(e));
    } finally {
      if (reads.current.roster === mine) setRosterReading(false);
    }
  }, [api, classId]);

  // The class and its roster, read as the page opens and again by Try again.
  const load = useCallback(async () => {
    const mine = ++reads.current.klass;
    setClassReading(true);
    const read = api.get<ClassDetail>(`/v1/classes/${classId}`).then(
      (c) => {
        if (reads.current.klass !== mine) return;
        setClassReading(false);
        setError(null);
        setKlass(c);
        // Recover the live grid across a reload. `grid` is otherwise seeded
        // only by the Start response, so refreshing mid-lesson dropped the grid
        // and offered to start a session that was already running — which reads
        // as the session having ended.
        setGrid(
          (cur) =>
            cur ??
            (c.liveSessionId
              ? { id: c.liveSessionId, over: false, startedAt: null, endsAt: null }
              : null),
        );
      },
      (e: unknown) => {
        if (reads.current.klass !== mine) return;
        setClassReading(false);
        setError(errText(e));
      },
    );
    await Promise.all([read, readRoster()]);
  }, [api, classId, readRoster]);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }
    void load();
  }, [load, router]);

  useEffect(() => {
    if (!getAccessToken()) return;
    let gone = false;
    void api.get<BlockListResponse>('/v1/blocks').then(
      (r) => !gone && setHasBlock(r.blocks.length > 0),
      () => !gone && setHasBlock(true),
    );
    return () => {
      gone = true;
    };
  }, [api]);

  // A session over here: the roster read again, so the recap's Didn't join counts who joined the
  // class during it and leaves out who left (PV12b); the card waits for it.
  const over = grid?.over ?? false;
  useEffect(() => {
    if (!over) return;
    setRoster(null);
    setRosterError(null);
    void readRoster();
  }, [over, readRoster]);

  // Over while End session's confirm was open or its end on its way: the confirm went with the live
  // page, so focus goes to the class's name, after the bell or on Present's (GA1AStates).
  useEffect(() => {
    if (!over || !endAsked.current) return;
    endAsked.current = false;
    land(document, []);
  }, [over]);

  // A session shown on the page before one (a Start's answer, or the read after one got none): the
  // Start's card went with that page, so focus, on Start or the page's body then, goes to the
  // class's name, as End's does (the audit's C2-02; GA4, the conductor's call). Never on a reload,
  // which opens on the live page.
  const before = klass !== null && !live;
  const wasBefore = useRef(false);
  useEffect(() => {
    const at = document.activeElement;
    if (live && wasBefore.current && (at === null || at === document.body)) land(document, []);
    wasBefore.current = before;
  }, [live, before]);

  // The last session, read each time the page comes to show no session: as it opens, and after a
  // bell; forgotten as a Start takes the page, so the next one's never shows the one before it.
  // Only the newest read's answer is drawn.
  const lastReads = useRef(0);
  const readLastSession = useCallback(async () => {
    const mine = ++lastReads.current;
    const next = await readLast(api, classId);
    if (lastReads.current === mine) setLast(next);
  }, [api, classId]);
  useEffect(() => {
    if (!before) return;
    void readLastSession();
    return () => {
      lastReads.current += 1;
      setLast({ kind: 'finding' });
    };
  }, [before, readLastSession]);

  // The class's last pick on this computer, and Present as this tab left it, read once the page is
  // in the browser (never at render, where the server has no storage), so before the class's read
  // can show a grid or the recap; a length that isn't a preset reopens Other with it. Opened from
  // Home's Present (`?present`, Main), Present is on and kept for the tab as its toggle keeps it, and
  // the address forgets it, so a reload or a way back opens as the tab left it.
  useEffect(() => {
    const remembered = pickFor(rememberedMinutes(classId));
    setPick(remembered.pick);
    setOther(remembered.other);
    const fromHome = new URLSearchParams(window.location.search).has('present');
    if (fromHome) {
      rememberPresent(classId, true);
      window.history.replaceState(null, '', `/classes/${classId}`);
    }
    setPresent(fromHome || rememberedPresent(classId));
  }, [classId]);

  // The grid says when the server marks its session over (the bell's sweep, an End from another
  // tab or a phone), and the recap card goes above it. Only that session's end changes anything.
  const onEnded = useCallback((ended: string) => {
    setGrid((cur) => (cur?.id === ended ? { ...cur, over: true } : cur));
  }, []);

  // The bell, from an answer or a snapshot: only later, never back (the window never shrinks); and
  // the start, which never moves, from the first snapshot that carries it.
  const onSession = useCallback((session: SessionView & { startedAt?: string }) => {
    setGrid((cur) => {
      if (cur?.id !== session.id) return cur;
      const endsAt = laterBell(cur.endsAt, session.endsAt);
      const startedAt = cur.startedAt ?? session.startedAt ?? null;
      return endsAt === cur.endsAt && startedAt === cur.startedAt
        ? cur
        : { ...cur, startedAt, endsAt };
    });
  }, []);

  // The live grid's counts as they change, kept with their session so another's never shows.
  const onCounts = useCallback((session: string, counts: StateCounts) => {
    setCounted({ session, counts });
  }, []);

  // A bell that moved settles an extend whose answer never came: the lost one landed, or another
  // tab's did, and either way the truth is on screen. The failure line goes, and the next press
  // is a fresh one, never a resend that would add nothing. A refusal or a note stays said.
  const bell = grid?.endsAt ?? null;
  useEffect(() => {
    unanswered.current = null;
    setSaid((cur) => (cur?.kind === 'failed' ? null : cur));
  }, [bell]);

  const minutes = pick === 'other' ? parseMinutes(other) : pick;

  /** Run `send` unless one is under way, the page busy with `kind` until it settles. */
  async function once(kind: 'start' | 'end' | 'extend', send: () => Promise<void>) {
    if (sending.current) return;
    sending.current = true;
    setBusy(kind);
    try {
      await send();
    } finally {
      sending.current = false;
      setBusy(null);
    }
  }

  /** Start's own press; Enter in the well presses it too, the form's submit sending nothing. */
  function startSession() {
    if (minutes === null) {
      setLengthSaid(true);
      otherField.current?.focus();
      return;
    }
    void once('start', async () => {
      rememberMinutes(classId, minutes);
      setStartSaid(null);
      try {
        // Within a save's limit: the route takes no `eventId`, and a Start sent again while one
        // runs answers that session (`existing`), so a Start cut here that landed is never two.
        const res = await api.post<StartSessionResponse>(
          `/v1/classes/${classId}/sessions`,
          { durationMinutes: minutes },
          SAVE_TIMEOUT_MS,
        );
        count?.('portal_session_started');
        const lost = lostStart.current;
        lostStart.current = null;
        setGrid({
          id: res.session.id,
          over: false,
          startedAt: res.session.startedAt,
          endsAt: res.session.endsAt,
        });
        // `existing`: a session was running already (another tab's, a phone's), so the length
        // picked here set nothing; said, since the bell shown is that session's. Never of this
        // page's own Start that got no answer, sent again: its session, its length used.
        setSaid(
          saysAlreadyRunning(res, minutes, lost)
            ? { kind: 'note', message: SESSION_ALREADY_RUNNING }
            : null,
        );
      } catch (err) {
        // No answer to go by: the Start may have landed, so the class is read again first, and a
        // session running shows as a reload shows it, never a failure over a class in session.
        const noAnswer = failureOf(err).kind === 'failed';
        const running = noAnswer ? await sessionRunning(api, classId) : null;
        if (running === null) {
          // Start sends it again: one with no answer may have landed all the same.
          if (noAnswer) lostStart.current = minutes;
          return setStartSaid(errText(err));
        }
        setSaid(null);
        setGrid((cur) =>
          cur?.id === running ? cur : { id: running, over: false, startedAt: null, endsAt: null },
        );
      }
    });
  }

  /** End session: its confirm opened, Cancel focused, nothing sent. */
  function askEnd() {
    if (sending.current) return;
    setEndSaid(null);
    endAsked.current = true;
    endDialog.current?.showModal();
    // Cancel first: a stray Enter or Space ends nothing.
    endCancel.current?.focus();
  }

  function endSession() {
    if (!grid) return;
    const ending = grid.id;
    void once('end', async () => {
      setEndSaid(null);
      try {
        // Within a save's limit: an End sent again after one landed answers `already_ended`.
        await api.post(`/v1/sessions/${ending}/end`, undefined, SAVE_TIMEOUT_MS);
        count?.('portal_session_ended');
        onEnded(ending);
      } catch (err) {
        // Said in the confirm, opened again if the browser closed it meanwhile (a second Escape);
        // its Try again sends it again.
        setEndSaid(errText(err));
        if (endDialog.current && !endDialog.current.open) endDialog.current.showModal();
      }
    });
  }

  /** Add time; `again`, Try again's resend, keeps its failure said until Bali answers. */
  function addTime(attempt: ExtendAttempt, again = false) {
    if (!grid) return;
    const session = grid.id;
    void once('extend', async () => {
      if (!again) setSaid(null);
      const answer = await extendSession(api, session, attempt);
      unanswered.current = keepUnanswered(attempt, answer);
      if (answer.kind === 'extended') {
        count?.('portal_session_extended');
        setSaid(null);
        onSession({ id: session, classId, endsAt: answer.endsAt });
      } else setSaid(answer);
    });
  }

  // Present, the projector the class can see (DESIGN.md §5): beside the live grid's counts, small
  // and hidden on a phone, which never drives a projector (PV1; `beside`), and in Present's header,
  // after the bell too; none on the page after the bell, as ClassEnded draws it. Pressed, the
  // Button's sunken fill and `text-primary` edge, never colour alone; its icon the same both ways,
  // as ClassPresent draws it. Present's Done sends focus to it (`${id}-present`).
  const presentToggle = (beside = false, className = '') => (
    <Button
      ref={toggle}
      id={`${id}-present`}
      variant="secondary"
      size={beside ? 'sm' : 'md'}
      aria-pressed={present}
      onClick={() => {
        rememberPresent(classId, !present);
        toggled.current = true;
        setPresent(!present);
      }}
      className={beside ? 'ml-auto max-sm:hidden' : className}
    >
      <Presentation size={16} aria-hidden="true" />
      Present
    </Button>
  );

  const extend = EXTEND_PRESETS.map((add) => (
    <Button
      key={add}
      variant="secondary"
      onClick={() => addTime(extendAttemptFor(unanswered.current, add))}
      aria-disabled={busy !== null}
      className="tabular-nums"
    >
      +{add} min
    </Button>
  ));
  const end = (className = '') => (
    <Button
      ref={endButton}
      variant="secondary"
      aria-haspopup="dialog"
      onClick={askEnd}
      aria-disabled={busy !== null}
      className={className}
    >
      End session
    </Button>
  );
  // End session's confirm (GA1AClassLive, GA1APresent, GA1AStates; on a phone GA6EndPhone): v2's
  // dialog, New code's, the same on the class page and in Present, where the room sees it, saying
  // nothing about any student. Cancel first; End session in the primary green, never red. While the
  // end is on its way, Ending…, Cancel and Escape held; a failure said here, Try again in End
  // session's place. Cancel or Escape closes it, focus back on End session.
  const endConfirm = (
    <dialog
      ref={endDialog}
      aria-labelledby={`${id}-end`}
      aria-describedby={`${id}-end-line`}
      onCancel={(e) => {
        // Escape holds while the end is on its way, as Cancel does.
        if (sending.current) e.preventDefault();
      }}
      onClose={() => {
        // Focus back on End session, held while the end is on its way, never the page's body:
        // Chrome closes the dialog on a second Escape all the same. Then its answer says what
        // follows.
        endButton.current?.focus();
        if (sending.current) return;
        endAsked.current = false;
        setEndSaid(null);
      }}
      className={DIALOG}
    >
      <h2 id={`${id}-end`} className="text-dialog-title">
        End session now?
      </h2>
      <p id={`${id}-end-line`} className="-mt-2 text-body text-text-secondary">
        Every student&apos;s apps come back, and you can&apos;t undo this.
      </p>
      {endSaid ? (
        <p role="alert" className="-mt-2 text-body">
          {endSaid}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2.5">
        <Button
          ref={endCancel}
          variant="secondary"
          onClick={() => {
            if (!sending.current) endDialog.current?.close();
          }}
          aria-disabled={busy !== null}
        >
          Cancel
        </Button>
        <TryAgain
          variant="primary"
          size="md"
          onRetry={endSession}
          held={busy !== null}
          then={[]}
          send={{ words: 'End session', sending: 'Ending…', failed: endSaid !== null }}
        />
      </div>
    </dialog>
  );
  // The live grid counted, once its session's grid is read.
  const counts = grid !== null && counted?.session === grid.id ? counted.counts : null;

  // Present's line after the bell, with no session running: "28 students · no session running".
  const noSession = roster
    ? `${students(roster.students.length)} · no session running`
    : 'No session running';
  // After the bell, a session that ended today: when, as ClassEnded's line says it (LO7's to redraw).
  const endedAt = last.kind === 'today' ? endedToday(last.session) : null;
  // A read again of the class failed, or its roster didn't load: said under the header; or the
  // class didn't load, in the session's place. Held while a read of what it says is on its way,
  // the class's or else its roster's, whichever Try again sent it: the class's own answering
  // first, its roster's failure is said here held, and the recap's Try again for it holds too.
  // Read, focus on the class's name (ClassRetryStates).
  const cantLoad = (message: string | null) =>
    message === null ? null : (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <TryAgain onRetry={load} held={error !== null ? classReading : rosterReading} then={[]}>
          <p role="alert" className="text-body">
            Couldn&apos;t load this class. {message}
          </p>
        </TryAgain>
      </div>
    );
  // What is said under the controls: a failed extend with Try again, sending the same one again,
  // held as every control is until Bali answers; then focus on the class's name (ClassRetryStates).
  const saidLine = said && (
    <p role={said.kind === 'note' ? 'status' : 'alert'} className="text-body">
      {said.message}
    </p>
  );

  // While a session runs (PV7; in Present, PV9): one tree in both views, each part in its place
  // whether Present is on or off, so the grid never restarts or reconnects as it turns on.
  return klass !== null && grid !== null && !grid.over ? (
    <div className={present ? PRESENT_PAGE : 'relative flex flex-col gap-5.5'}>
      {/* ClassLive's header, End set apart from adding time, and no New code, which it doesn't
          draw; ClassPresent's in Present, +5, +10 and End kept there beside Present. */}
      <LiveHeader
        name={klass.name}
        joinCode={klass.joinCode}
        counts={counts}
        startedAt={grid.startedAt}
        endsAt={grid.endsAt}
        present={present}
      >
        {extend}
        {end('ml-2')}
        {present ? presentToggle(false, 'ml-2') : null}
      </LiveHeader>

      {/* A roster's failure waits for the page that shows one, after the bell. */}
      {cantLoad(error)}

      {/* Said right under the controls, where they are. */}
      {said ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          {said.kind === 'failed' ? (
            <TryAgain
              onRetry={() => {
                const again = unanswered.current;
                if (again) addTime(again, true);
              }}
              held={busy !== null}
              then={[]}
            >
              {saidLine}
            </TryAgain>
          ) : (
            saidLine
          )}
        </div>
      ) : null}
      {/* The rest of the page, so Present's slide fills what the screen leaves under the header. */}
      <section
        aria-label={projected ? undefined : 'Live grid'}
        className="flex flex-1 flex-col gap-5.5"
      >
        {/* The counts and Present over the grid (ClassLive); in Present the counts alone, and
            none while the question or the slide shows in the grid's place (PresentQuestion,
            PresentSlide). */}
        {projected ? null : (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
            {counts ? <LiveCounts counts={counts} present={present} /> : null}
            {present ? null : presentToggle(true)}
          </div>
        )}
        {/* The live question between the counts and the grid (LessonClass), never in Present, nor
            with lessons off; the slide shown in its place while no question shows (LessonSlide). */}
        {present || !lessons ? null : lesson.question === null && slides.slide !== null ? (
          <SlideCard
            id={id}
            lesson={slides}
            slide={slides.slide}
            asking={panel === 'ask'}
            onAsk={() => setSide('ask')}
          />
        ) : (
          <QuestionCard
            id={id}
            lesson={lesson}
            endsAt={grid.endsAt}
            asking={panel === 'ask'}
            onAsk={() => setSide('ask')}
            showing={panel === 'decks'}
            onShow={() => setSide('decks')}
          />
        )}
        <LiveGrid
          sessionId={grid.id}
          onEnded={onEnded}
          onSession={onSession}
          onCounts={onCounts}
          onEvent={onLessonEvent}
          asking={panel !== null}
          onStudentPanel={() => setSide(null)}
          present={present}
          livePage
          tiles={!projected}
        />
        {/* In Present, the question in the tiles' place, after the grid's own lines; else the
            slide. */}
        {projected && lesson.question !== null ? <PresentQuestion id={id} lesson={lesson} /> : null}
        {projected && lesson.question === null && slides.slide !== null ? (
          <PresentSlide id={id} lesson={slides} slide={slides.slide} />
        ) : null}
      </section>
      {/* End session's confirm, shown only while open, as a modal over the page. */}
      {endConfirm}
      {panel === 'decks' ? (
        <DecksPanel id={`${id}-panel`} lesson={slides} onShown={shown} onClose={closePanel} />
      ) : null}
      {panel === 'ask' && !writing ? (
        <PickPanel
          id={`${id}-panel`}
          openNow={isOpen(lesson)}
          opening={opening}
          onAsk={ask}
          onAsked={asked}
          onWrite={() => setWriting(true)}
          onClose={closePanel}
        />
      ) : null}
      {panel === 'ask' && writing ? (
        <AskPanel
          id={`${id}-panel`}
          draft={draft}
          onDraft={setDraft}
          openNow={isOpen(lesson)}
          opening={opening}
          onAsk={ask}
          onAsked={() => {
            setWriting(false);
            setDraft(NEW_DRAFT);
            asked();
          }}
          onCancel={() => {
            setWriting(false);
            setDraft(NEW_DRAFT);
            forgetAsk();
            closePanel();
          }}
          onClose={closePanel}
        />
      ) : null}
    </div>
  ) : klass !== null && present ? (
    // After the bell in Present (PresentEnded, as PV1 approved): the header, its ring whole, and
    // "Class is over" alone, the figures left to the recap, where the class can't misread them.
    <div className={PRESENT_PAGE}>
      <LiveHeader
        name={klass.name}
        joinCode={klass.joinCode}
        counts={null}
        startedAt={null}
        endsAt={null}
        present
        over={noSession}
      >
        {presentToggle()}
      </LiveHeader>
      {cantLoad(error ?? rosterError)}
      <section
        aria-labelledby={`${id}-over`}
        className="flex flex-1 flex-col items-center justify-center rounded-lg border border-border-default bg-surface-card px-11 py-9 shadow-1"
      >
        <h2 id={`${id}-over`} className="text-present-question">
          Class is over
        </h2>
      </section>
    </div>
  ) : (
    // No session running (PV6), or the class not read yet: the lock-only canvas's ClassPage since
    // LO4 (ClassStates, PhonePages' "A class, before it starts"), its parts 40 px apart, 32 on a phone.
    <div className={present ? PRESENT_PAGE : 'flex flex-col gap-10 max-[760px]:gap-8'}>
      {/* The name over its line, the class's reports at the end; on a phone under them. */}
      <header className="flex flex-wrap items-center gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-1">
          <h1
            className={`text-page-title text-balance wrap-anywhere max-[760px]:text-page-title-phone ${klass ? '' : 'text-text-tertiary'}`}
          >
            {klass?.name ?? '…'}
          </h1>
          {/* Its line's place held while the roster is read, so nothing under it moves. */}
          <p className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-meta text-text-secondary">
            {roster ? <span>{students(roster.students.length)}</span> : null}
            {endedAt ? <span>Ended at {endedAt}</span> : null}
            {roster || endedAt ? null : <>&nbsp;</>}
          </p>
        </div>
        <Link href={`/reports?class=${encodeURIComponent(classId)}`} className={QUIET}>
          This class&apos;s reports
        </Link>
      </header>

      {/* The class is read and its roster isn't (or a read again failed): said under the header. */}
      {klass && (error ?? rosterError) !== null ? (
        <Oops onRetry={load} held={error !== null ? classReading : rosterReading} then={[]}>
          Couldn&apos;t load this class. {error ?? rosterError}
        </Oops>
      ) : null}

      {klass === null && error !== null ? (
        // In the well's place: no Start until the class is read, as one may already be live.
        <Oops onRetry={load} held={classReading} then={[]}>
          Couldn&apos;t load this class. {error}
        </Oops>
      ) : klass === null || hasBlock === null ? (
        // As tall as the well it holds the place of (118 px), so nothing jumps.
        <p
          role="status"
          className={`${WELL} flex min-h-29.5 items-center p-6 text-body text-text-secondary`}
        >
          Loading…
        </p>
      ) : (
        <>
          {hasBlock ? (
            // noValidate: the length is checked here and said in Bali's words under the field,
            // never by the browser's own bubble over the number input.
            <form
              ref={startForm}
              onSubmit={(e) => e.preventDefault()}
              noValidate
              aria-labelledby={`${id}-length`}
              className={READY}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-4">
                <Ring share={0} box={48} stroke={5} />
                <fieldset className="flex min-w-0 flex-col">
                  <legend id={`${id}-length`} className="mb-2 text-meta text-text-secondary">
                    Session length
                  </legend>
                  {/* Held while a Start is on its way, as Start is: dimmed, a pick changing nothing. */}
                  <div className={`${TRACK} ${busy === 'start' ? 'opacity-55' : ''}`}>
                    {[...LENGTH_PRESETS, 'other' as const].map((option) => (
                      <label key={option} className={SEGMENT}>
                        <input
                          type="radio"
                          name="session-length"
                          value={option}
                          checked={pick === option}
                          onChange={() => {
                            if (busy === 'start') return;
                            setPick(option);
                            setLengthSaid(false);
                            setStartSaid(null);
                          }}
                          className="sr-only"
                        />
                        {pick === option ? <Check size={15} aria-hidden="true" /> : null}
                        {option === 'other' ? 'Other…' : `${option} min`}
                      </label>
                    ))}
                  </div>
                  {pick === 'other' ? (
                    <div className="mt-4">
                      <LockField
                        ref={otherField}
                        id={`${id}-minutes`}
                        label="Minutes"
                        help={`A whole number from 1 to ${MAX_SESSION_MINUTES}.`}
                        name="minutes"
                        type="number"
                        inputMode="numeric"
                        autoComplete="off"
                        min={1}
                        max={MAX_SESSION_MINUTES}
                        step={1}
                        value={other}
                        onChange={(e) => {
                          setOther(e.target.value);
                          setLengthSaid(false);
                          setStartSaid(null);
                        }}
                        readOnly={busy === 'start'}
                        aria-invalid={lengthSaid}
                        aria-describedby={lengthSaid ? `${id}-said` : undefined}
                      />
                    </div>
                  ) : null}
                  {/* Right under the help. */}
                  {lengthSaid ? (
                    <p id={`${id}-said`} role="alert" className="mt-2 max-w-110 text-body">
                      {NOT_A_SESSION_LENGTH}
                    </p>
                  ) : null}
                </fieldset>
              </div>
              {/* One button throughout, so focus stays on it whatever it comes to say: Start,
                  Starting… while it is on its way, and Try again once one failed. */}
              <TryAgain
                type="submit"
                variant="primary"
                size="md"
                onRetry={startSession}
                held={busy === 'start'}
                then={[]}
                send={{
                  words: minutes === null ? 'Start session' : `Start ${minutes}-minute session`,
                  sending: 'Starting…',
                  failed: startSaid !== null,
                }}
              />
              {/* A Start that failed, said across the well's foot; Try again sends it again. */}
              {startSaid ? (
                <p
                  role="alert"
                  className="flex basis-full items-center gap-2 border-t border-border-strong pt-4 text-body"
                >
                  <CircleAlert size={18} aria-hidden="true" className="shrink-0" />
                  {startSaid}
                </p>
              ) : null}
            </form>
          ) : (
            <RegisterFirst
              onRegistered={() => {
                setHasBlock(true);
                window.requestAnimationFrame(() => submitOf(startForm.current)?.focus());
              }}
            />
          )}
          {/* The last session (ClassPage's line), or after the bell the day it ended, v2's recap
              card (ClassEnded, PV12b) until LO7 redraws it: who didn't join is the roster's, whose
              failure the card says too. Present after the bell is its own page, which says only
              that class is over, so `present` is off here; passed all the same, so no reason ever
              reaches the projector should that change. */}
          {last.kind === 'today' ? (
            <RecapCard
              classId={classId}
              present={present}
              roster={roster?.students ?? null}
              rosterError={rosterError}
              onRetryRoster={load}
              rosterReading={rosterReading}
            />
          ) : last.kind === 'line' ? (
            <p id={`${id}-last`} className="text-body text-text-secondary">
              {last.joined === 0
                ? `${onDay(last.session.startedAt)}, nobody joined.`
                : `${onDay(last.session.startedAt)}, ${last.whole} of ${last.joined} stayed focused the whole time.`}
              <Link href={reportPath(classId, last.session.id)} className={`ml-3 ${QUIET}`}>
                Open the report
              </Link>
            </p>
          ) : last.kind === 'error' ? (
            <Oops onRetry={readLastSession} then={[`${id}-last`]}>
              Couldn&apos;t load the last session. {last.message}
            </Oops>
          ) : null}
          {/* The students, the join code behind Add students; for a class with none yet, open. */}
          <section aria-labelledby={`${id}-students`} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
              <h2 id={`${id}-students`} className="text-section-title">
                Students
              </h2>
              {roster ? (
                <span className="text-data font-normal text-text-tertiary">
                  {roster.students.length}
                </span>
              ) : null}
              {/* Unread, it waits; a roster that didn't load leaves the code in reach. */}
              {(roster === null ? rosterError !== null : roster.students.length > 0) ? (
                <LockButton
                  variant="secondary"
                  size="sm"
                  aria-expanded={adding}
                  onClick={() => setAdding(!adding)}
                  className="ml-auto"
                >
                  Add students
                </LockButton>
              ) : null}
            </div>
            {adding || roster?.students.length === 0 ? (
              <JoinCode classId={classId} code={klass.joinCode} onClass={setKlass} />
            ) : null}
            {/* Unread, its failure is said under the header with Try again, never here. */}
            {roster === null ? (
              rosterError ? null : (
                <p
                  role="status"
                  className="border-y border-border-default py-3 text-body text-text-secondary"
                >
                  Loading…
                </p>
              )
            ) : roster.students.length === 0 ? (
              <p className="text-body text-text-secondary">No students yet.</p>
            ) : (
              <ul className="columns-[4_168px] gap-x-8 max-[760px]:columns-[2_140px]">
                {roster.students.map((s) => (
                  <li
                    key={s.enrollmentId}
                    className="break-inside-avoid border-b border-border-default py-2 text-body wrap-break-word"
                  >
                    {s.displayName ?? s.studentId.slice(0, 8)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
