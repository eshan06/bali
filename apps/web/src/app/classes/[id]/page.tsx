'use client';

import {
  type ClassDetail,
  type FeedEvent,
  MAX_SESSION_MINUTES,
  type RosterResponse,
  type SessionReportSummary,
  type SessionView,
  type StartSessionResponse,
} from '@bali/shared';
import { ChartBar, Check, Presentation } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { AskPanel, NEW_DRAFT, PickPanel } from '@/components/ask-panel';
import { Button, buttonClass } from '@/components/button';
import { CARD_ALONE } from '@/components/card';
import { DecksPanel } from '@/components/decks-panel';
import { Field } from '@/components/field';
import { JoinCode } from '@/components/join-code';
import { LiveGrid, type StateCounts } from '@/components/live-grid';
import { LiveCounts, LiveHeader } from '@/components/live-header';
import { PresentQuestion } from '@/components/present-question';
import { PresentSlide } from '@/components/present-slide';
import { isOpen, QuestionCard, useLiveQuestion } from '@/components/question-card';
import { endedToday, RecapCard } from '@/components/recap-card';
import { usePresenting } from '@/components/shell';
import { SlideCard } from '@/components/slide-card';
import { getAccessToken } from '@/lib/auth';
import { errText, NOT_A_SESSION_LENGTH, SESSION_ALREADY_RUNNING } from '@/lib/errors';
import type { QuestionDraft } from '@/lib/live-question';
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
 * The length picker, v2's segmented control (ClassBefore): a grey track holding each length as a
 * segment, the radio inside it read by screen readers and clipped away, so the focus ring is drawn
 * on the label for it. The pick is white and raised, in the primary ink, with a check, never colour
 * alone.
 */
const TRACK = 'inline-flex flex-wrap gap-0.5 rounded-sm bg-surface-sunken p-0.75';
const SEGMENT =
  'relative inline-flex cursor-pointer items-center gap-1.5 rounded-item px-4 py-2.25 text-segment text-text-secondary select-none has-checked:bg-surface-card has-checked:text-text-primary has-checked:shadow-1 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus-ring';

/**
 * A label over a part of the page (Roster, Join code): v2's section label, 32 px above its card as
 * ClassBefore draws it, its own 12 px and its section's 20 px gap.
 */
const LABEL = 'mb-3 text-section-label text-text-tertiary uppercase';

/** "28 students", "1 student". */
const students = (count: number) => `${count} ${count === 1 ? 'student' : 'students'}`;

/**
 * A class's page. While no session runs (PV6; ClassBefore, ClassNewCode, ClassStates' lines before
 * a session, CopyStates): its name over "28 students · no session running" with Reports, the length
 * picker and Start, the last session's recap (PV12b; ClassEnded: its line then "28 students · the
 * session ended at 9:55 AM" for one that ended today, and no How it ended, which repeated it), then
 * the roster in three columns beside the join code's card. Until the class is read, a Loading or
 * Error card holds the session's place: a session may be live. While one runs (PV7; ClassLive,
 * ClassStale, ClassStates' lines during a session): the header with the ring, "Live · 25 of 28
 * joined" and the join code, the countdown and the bell, +5, +10 and End; the class counted by state
 * beside Present, then the live grid, and no roster: the grid names every student. In Present
 * (PV9; ClassPresent), the same parts one size up for the projector, the code in a well of its own
 * and +5, +10 and End kept beside Present (the owner, 2026-10-12), so a class of 28 fits one 1080p
 * screen; a question there in the grid's place, totals only (L7, part 2; PresentQuestion,
 * PresentAnswer), closed and put away there too (L7, part 3; PresentQuestionControls,
 * PresentAnswerControls); after the bell there "Class is over" alone (PresentEnded, as PV1
 * approved), the figures left to the recap. Each failure is said where it happened. It sits in the
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
  // The last session the recap found, for the header's line after the bell (PV12b): its end as the
  // server marked it, never this computer's clock.
  const [last, setLast] = useState<SessionReportSummary | null>(null);
  // The class didn't load: said in the session's place, with Try again. Its roster didn't, or a
  // read again of the class failed: said under the header, with Try again.
  const [error, setError] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  // Which send is under way, if any: every control holds while one is, and only a Start's own
  // button says "Starting…" (an End's answer can come after the grid already says it ended).
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
  // The projector view (DESIGN.md §5), toggled in the grid's header and kept for this tab, so a
  // reload or a return from Reports comes back in it; a new tab or window opens without it.
  const [present, setPresent] = useState(false);
  // On the projector, no menu: the shell draws none while Present is on.
  usePresenting(present);
  // The toggle moves as it is pressed (beside the counts, into Present's header), so focus follows;
  // to Start where none is left to follow (Present left with no session to show).
  const toggle = useRef<HTMLButtonElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  const toggled = useRef(false);
  useEffect(() => {
    if (toggled.current) (toggle.current ?? start.current)?.focus();
    toggled.current = false;
  }, [present]);
  // Extend (P10): the last attempt whose answer never came, resent by Try again; and what is said
  // beside the grid: a failure (with Try again), a refusal or an End that failed (its button is
  // the retry), or a note on the session shown.
  const unanswered = useRef<ExtendAttempt | null>(null);
  const [said, setSaid] = useState<{ kind: 'failed' | 'refused' | 'note'; message: string } | null>(
    null,
  );
  // The live question (L7): its card over the grid, and asking one in the side panel, where a
  // student's panel shows: one of the teacher's questions picked (L7b, part 2; LessonAsk), or one
  // written there (LessonWrite), what is written kept until it is asked or cancelled. A new session
  // starts with neither.
  const live = klass !== null && grid !== null && !grid.over;
  const { lesson, onEvent, ask, opening, forgetAsk, snapshot, reread } = useLiveQuestion(
    live ? grid.id : null,
  );
  // What the session shows (M6, part 2b): from the question's read of the session, the stream and
  // this tab's own changes, its card in the question card's place while no question shows, the
  // question first (the conductor's call, 2026-10-16), the slide card back after Done.
  const { slides, onEvent: onSlideEvent } = useSlide(live ? grid.id : null, snapshot, reread);
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

  const readRoster = useCallback(() => {
    api
      .get<RosterResponse>(`/v1/classes/${classId}/roster`)
      .then(setRoster, (e: unknown) => setRosterError(errText(e)));
  }, [api, classId]);

  const load = useCallback(() => {
    setError(null);
    setRosterError(null);
    api.get<ClassDetail>(`/v1/classes/${classId}`).then(
      (c) => {
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
      (e: unknown) => setError(errText(e)),
    );
    readRoster();
  }, [api, classId, readRoster]);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }
    load();
  }, [load, router]);

  // A session over here: the roster read again, so the recap's Didn't join counts who joined the
  // class during it and leaves out who left (PV12b); the card waits for it.
  const over = grid?.over ?? false;
  useEffect(() => {
    if (!over) return;
    setRoster(null);
    setRosterError(null);
    readRoster();
  }, [over, readRoster]);

  // The class's last pick on this computer, and Present as this tab left it, read once the page is
  // in the browser (never at render, where the server has no storage), so before the class's read
  // can show a grid or the recap; a length that isn't a preset reopens Other with it.
  useEffect(() => {
    const remembered = pickFor(rememberedMinutes(classId));
    setPick(remembered.pick);
    setOther(remembered.other);
    setPresent(rememberedPresent(classId));
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

  function startSession(e: React.FormEvent) {
    e.preventDefault();
    if (minutes === null) {
      setLengthSaid(true);
      otherField.current?.focus();
      return;
    }
    void once('start', async () => {
      rememberMinutes(classId, minutes);
      setStartSaid(null);
      try {
        const res = await api.post<StartSessionResponse>(`/v1/classes/${classId}/sessions`, {
          durationMinutes: minutes,
        });
        setGrid({
          id: res.session.id,
          over: false,
          startedAt: res.session.startedAt,
          endsAt: res.session.endsAt,
        });
        // `existing`: a session was running already (another tab's, a phone's), so the length
        // picked here set nothing; said, since the bell shown is that session's.
        setSaid(
          res.outcome === 'existing' ? { kind: 'note', message: SESSION_ALREADY_RUNNING } : null,
        );
      } catch (err) {
        setStartSaid(errText(err));
      }
    });
  }

  function endSession() {
    if (!grid) return;
    const ending = grid.id;
    void once('end', async () => {
      setSaid(null);
      try {
        await api.post(`/v1/sessions/${ending}/end`);
        onEnded(ending);
      } catch (err) {
        // Said beside the controls; End itself sends it again.
        setSaid({ kind: 'refused', message: errText(err) });
      }
    });
  }

  function addTime(attempt: ExtendAttempt) {
    if (!grid) return;
    const session = grid.id;
    void once('extend', async () => {
      setSaid(null);
      const answer = await extendSession(api, session, attempt);
      unanswered.current = keepUnanswered(attempt, answer);
      if (answer.kind === 'extended') onSession({ id: session, classId, endsAt: answer.endsAt });
      else setSaid(answer);
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
      variant="secondary"
      onClick={endSession}
      aria-disabled={busy !== null}
      className={className}
    >
      End session
    </Button>
  );
  // The live grid counted, once its session's grid is read.
  const counts = grid !== null && counted?.session === grid.id ? counted.counts : null;

  // The class's line with no session running: "28 students · no session running".
  const noSession = roster
    ? `${students(roster.students.length)} · no session running`
    : 'No session running';
  // After the bell (ClassEnded), once the recap has found a session that ended today: "28 students ·
  // the session ended at 9:55 AM". Present's stays `noSession` (PV9's, as it is).
  const endedAt = endedToday(last);
  const headLine =
    endedAt === null
      ? noSession
      : roster
        ? `${students(roster.students.length)} · the session ended at ${endedAt}`
        : `The session ended at ${endedAt}`;
  // A read again of the class failed, or its roster didn't load: said under the header.
  const cantLoad = (message: string | null) =>
    message === null ? null : (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <p role="alert" className="text-body">
          Couldn&apos;t load this class. {message}
        </p>
        <Button variant="secondary" size="sm" onClick={load}>
          Try again
        </Button>
      </div>
    );

  // While a session runs (PV7; in Present, PV9): one tree in both views, each part in its place
  // whether Present is on or off, so the grid never restarts or reconnects as it turns on.
  return klass !== null && grid !== null && !grid.over ? (
    <main className={present ? PRESENT_PAGE : 'relative flex flex-col gap-5.5'}>
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
          <p role={said.kind === 'note' ? 'status' : 'alert'} className="text-body">
            {said.message}
          </p>
          {said.kind === 'failed' ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const again = unanswered.current;
                if (again) addTime(again);
              }}
              aria-disabled={busy !== null}
            >
              Try again
            </Button>
          ) : null}
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
        {/* The live question between the counts and the grid (LessonClass), never in Present; the
            slide shown in its place while no question shows (LessonSlide). */}
        {present ? null : lesson.question === null && slides.slide !== null ? (
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
    </main>
  ) : klass !== null && present ? (
    // After the bell in Present (PresentEnded, as PV1 approved): the header, its ring whole, and
    // "Class is over" alone, the figures left to the recap, where the class can't misread them.
    <main className={PRESENT_PAGE}>
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
    </main>
  ) : (
    // No session running (PV6), or the class not read yet: v2's look, its parts 22 px apart.
    <main className={present ? PRESENT_PAGE : 'flex flex-col gap-5.5'}>
      {/* The name over its line, Reports at the end; on a phone the name at the card titles' size and
          Reports on a line of its own. */}
      <header className="flex flex-wrap items-center gap-x-4.5 gap-y-3.5 max-sm:gap-x-3.5">
        <div className="min-w-0 max-sm:flex-1">
          <h1
            className={`text-page-title text-balance wrap-anywhere max-sm:text-h3 ${klass ? '' : 'text-text-tertiary'}`}
          >
            {klass?.name ?? '…'}
          </h1>
          {/* Its line's place held while the class is read, so nothing under it moves. */}
          <p className="mt-0.5 text-meta text-text-secondary">
            {klass === null ? '\u00a0' : headLine}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 max-sm:ml-0 max-sm:basis-full">
          <Link
            href={`/reports?class=${encodeURIComponent(classId)}`}
            className={buttonClass('secondary', '', 'sm')}
          >
            <ChartBar size={16} aria-hidden="true" />
            Reports
          </Link>
        </div>
      </header>

      {/* The class is read and its roster isn't (or a read again failed): said under the header. */}
      {klass ? cantLoad(error ?? rosterError) : null}

      {klass === null ? (
        // Until the class is read, the session's place holds no Start: one may already be live.
        error ? (
          <section className={CARD_ALONE}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <p role="alert" className="text-body">
                Couldn&apos;t load this class. {error}
              </p>
              <Button variant="secondary" size="sm" onClick={load}>
                Try again
              </Button>
            </div>
          </section>
        ) : (
          // As tall as the Start card it holds the place of (118 px), so nothing jumps.
          <section aria-label="Session" className={`flex min-h-29.5 items-center ${CARD_ALONE}`}>
            <p role="status" className="text-body text-text-secondary">
              Loading…
            </p>
          </section>
        )
      ) : (
        <>
          {/* noValidate: the length is checked here and said in Bali's words under the field,
              never by the browser's own bubble over the number input. */}
          <form onSubmit={startSession} noValidate className={CARD_ALONE}>
            <fieldset>
              <legend className="text-body font-medium">Session length</legend>
              {/* The lengths on the left, Start on the right; on a phone Start goes under them. */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5">
                <div className={TRACK}>
                  {[...LENGTH_PRESETS, 'other' as const].map((option) => (
                    <label key={option} className={SEGMENT}>
                      <input
                        type="radio"
                        name="session-length"
                        value={option}
                        checked={pick === option}
                        onChange={() => {
                          setPick(option);
                          setLengthSaid(false);
                        }}
                        className="sr-only"
                      />
                      {pick === option ? <Check size={15} aria-hidden="true" /> : null}
                      {option === 'other' ? 'Other…' : `${option} min`}
                    </label>
                  ))}
                </div>
                {/* One button throughout, so focus stays on it whatever it comes to say. */}
                <Button
                  ref={start}
                  type="submit"
                  aria-disabled={busy !== null}
                  aria-busy={busy === 'start'}
                >
                  {busy === 'start'
                    ? 'Starting…'
                    : minutes === null
                      ? 'Start session'
                      : `Start ${minutes}-minute session`}
                </Button>
              </div>
              {pick === 'other' ? (
                <div className="mt-4 max-w-xs">
                  <Field
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
                    }}
                    readOnly={busy === 'start'}
                    aria-invalid={lengthSaid}
                    aria-describedby={lengthSaid ? `${id}-said` : undefined}
                  />
                </div>
              ) : null}
              {/* Right under the help, as ClassStates says it. */}
              {lengthSaid ? (
                <p id={`${id}-said`} role="alert" className="text-body">
                  {NOT_A_SESSION_LENGTH}
                </p>
              ) : null}
              {/* A Start that failed, said in its card; Start sends it again. */}
              {startSaid ? (
                <p role="alert" className="mt-3.5 text-body">
                  {startSaid}
                </p>
              ) : null}
            </fieldset>
          </form>
          {/* The last session's recap (R4; ClassEnded since PV12b) until a new one starts; only
              once the class is read, so a session already running never shows it. Who didn't join
              is the roster's, whose failure the card says too. Present after the bell is its own
              page, which says only that class is over, so `present` is off here; passed all the
              same, so no reason ever reaches the projector should that change. */}
          <RecapCard
            classId={classId}
            present={present}
            roster={roster?.students ?? null}
            rosterError={rosterError}
            onRetryRoster={load}
            onFound={setLast}
          />
          {/* The roster beside the join code's card; on a narrow page the card goes under it. */}
          <div className="flex flex-wrap items-start gap-5">
            <section
              aria-labelledby={`${id}-roster`}
              className="flex min-w-0 flex-[999_1_520px] flex-col gap-5"
            >
              <h2 id={`${id}-roster`} className={LABEL}>
                {roster ? `Roster · ${students(roster.students.length)}` : 'Roster'}
              </h2>
              {/* Unread, it says so under the header with Try again, never "Loading…" here. */}
              {roster === null ? (
                rosterError ? null : (
                  <p role="status" className="text-body text-text-secondary">
                    Loading…
                  </p>
                )
              ) : roster.students.length === 0 ? (
                <p className="text-body text-text-secondary">No students have joined yet.</p>
              ) : (
                <div className={CARD_ALONE}>
                  {/* ponytail: as v2.css draws it, a word wider than its column runs on into the
                      32 px gap rather than break mid-word (a long surname on a phone); one wider
                      than both (some 13 letters on a phone, 30 on a computer) reaches the next
                      column. break-words if a real roster shows one. */}
                  <ul className="columns-3 gap-x-8">
                    {roster.students.map((s) => (
                      <li key={s.enrollmentId} className="break-inside-avoid py-1.5 text-body">
                        {s.displayName ?? s.studentId.slice(0, 8)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
            <section
              aria-labelledby={`${id}-code`}
              className="flex min-w-0 flex-[1_1_320px] flex-col gap-5"
            >
              <h2 id={`${id}-code`} className={LABEL}>
                Join code
              </h2>
              <div className={CARD_ALONE}>
                <JoinCode classId={classId} code={klass.joinCode} onClass={setKlass} />
              </div>
            </section>
          </div>
        </>
      )}
    </main>
  );
}
