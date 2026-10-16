'use client';

import type { StudentQuestion } from '@bali/shared';
import { Check, CircleCheck, EyeOff, type LucideIcon, Nfc, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';

import { getAccessToken } from '@/lib/auth';
import { bellTime } from '@/lib/session-controls';
import {
  type Bell,
  enterFullscreen,
  followLesson,
  fullEnds,
  keptBell,
  leaveFullscreen,
  type Lesson,
  type LessonState,
  lessonView,
  type LessonView,
  phoneChip,
  type PhoneChip,
  picker,
  type Picks,
  type Said,
  saidNow,
  type Sending,
  type StudentClass,
} from '@/lib/student-web';
import { useApi } from '@/lib/use-api';
import { type DeckState, useShownDeck } from '@/lib/use-slide';

import { Button, buttonClass } from './button';
import { CARD_ALONE } from './card';
import { Countdown, Ring, shareLeft, useClock } from './live-header';
import { letterClass, letterOf } from './question-card';
import { useMe } from './shell';
import { SlideFull, StudentSlide } from './student-slide';
import { CantReach, NOTICE, YourPhone } from './your-phone';

/** The line under every question (StudentLesson), the board's own words. */
export const PRIVACY = "Your teacher sees the class's totals, never which answer is yours.";

const EMPTY: LessonState = { presentation: null, problem: null, asOf: null };

/**
 * A student's lesson (W4; StudentLesson, StudentNotIn, StudentClosed, StudentWaiting, StudentEnded,
 * StudentPhoneStates, StudentStates, and StudentNoSlide, StudentCardStates and StudentChipStates,
 * drawn first): the class `classId`'s session `sessionId`, followed once the account lists it as the
 * class's (`followLesson`, W2), its question answered here, the slide its teacher shows (W5) and the
 * student's own phone beside its name. The account is the shell's one read, read again as the page
 * opens and at the bell, so minutes the teacher added move it; a class the account doesn't list
 * isn't the student's. The slide's deck is loaded only while the lesson shows it (`useShownDeck`),
 * and closed once the teacher stops, shows another, or the class is over.
 */
export function StudentLessonPage({ classId, sessionId }: { classId: string; sessionId: string }) {
  const api = useApi();
  const router = useRouter();
  const { home, me, error, load } = useMe();
  // The account as the page opened: only a read since says the class isn't the student's.
  const [opened] = useState(me);
  const asked = useRef(false);
  const [lesson, setLesson] = useState<LessonState>(EMPTY);
  const [attempt, setAttempt] = useState(0);
  const following = useRef<Lesson | null>(null);
  const [picks, setPicks] = useState<Picks>({ sending: null, said: null });
  const [pick] = useState(() => picker(setPicks));

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace('/login');
      return;
    }
    asked.current = true;
    load();
  }, [load, router]);

  // A lesson is a student's: a teacher, or an account never through the 13+ check, goes home.
  useEffect(() => {
    if (home !== null && home.kind !== 'student') router.replace('/');
  }, [home, router]);

  const klass = me?.classes.find((c) => c.id === classId);
  // The session's start and bell, kept once a read lists it: a read after its end lists none.
  const [bell, setBell] = useState(() => keptBell(null, klass, sessionId));
  const kept = keptBell(bell, klass, sessionId);
  if (kept !== bell) setBell(kept);
  const endsAt = bell?.endsAt ?? null;
  // Never once the account no longer lists the class: its reads would only be refused.
  const follows = endsAt !== null && klass !== undefined;

  useEffect(() => {
    if (!follows) return;
    const followed = followLesson(api, sessionId, setLesson);
    following.current = followed;
    return () => {
      followed.stop();
      following.current = null;
    };
  }, [api, sessionId, follows, attempt]);

  // The account again at the bell, once: minutes the teacher added bring a later one.
  useEffect(() => {
    if (endsAt === null) return;
    const timer = window.setTimeout(() => load(), Math.max(0, Date.parse(endsAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [endsAt, load]);

  const account = me !== opened ? 'fresh' : asked.current && error !== null ? 'failed' : 'stale';
  const view = lessonView(klass, account, bell, lesson);
  const shown = view.kind === 'live' ? view.presentation.slide : null;
  const { deck, reload } = useShownDeck(api, shown);

  if (home === null || home.kind !== 'student') return null;
  return (
    <StudentLesson
      view={view}
      deck={deck}
      onReloadDeck={reload}
      sending={picks.sending}
      said={picks.said}
      onPick={(questionId, option) => void pick(following.current, questionId, option)}
      onRetry={() => {
        setLesson(EMPTY);
        setAttempt((n) => n + 1);
        load();
      }}
    />
  );
}

/** A line said in the lesson's place, beside what to do (StudentStates' `.said`). */
const SAID = 'flex flex-wrap items-center gap-x-4 gap-y-3';

/** Full screen (W5): open, with the question it opened beside; or why it last closed, for focus. */
interface Full {
  open: { questionId: string | null } | null;
  back: 'left' | 'question' | 'gone' | null;
}

/**
 * The lesson page as its state draws it (W4): Loading… and the lesson that didn't load, with Try
 * again (StudentStates); not in this class (StudentCardStates); class over (StudentEnded, its line
 * without a time when the page can't say when, StudentCardStates); and the class's head, the
 * student's own phone at its end, over the phone's line when it isn't focused (StudentPhoneStates),
 * then "Can't reach Bali" while reads fail (StudentChipStates), then the question card and the slide
 * its teacher shows (StudentLesson; W5), the card alone (StudentNoSlide), the slide alone
 * (StudentSlideAlone), or "Nothing shared yet" (StudentWaiting). The slide's Full screen
 * (StudentSlideFull) closes by itself once a question is asked, the slides stop or the class is
 * over (PV1), focus then on the question, or on the class's name; left by the student, on Full
 * screen.
 */
export function StudentLesson({
  view,
  deck,
  onReloadDeck,
  sending,
  said,
  onPick,
  onRetry,
}: {
  view: LessonView;
  /** The slide's deck, as `useShownDeck` holds it: loading, open, or why not. */
  deck: DeckState;
  onReloadDeck: () => void;
  sending: Sending;
  said: Said;
  onPick: (questionId: string, option: number) => void;
  onRetry: () => void;
}) {
  const over = useId();
  const id = useId();
  const [full, setFull] = useState<Full>({ open: null, back: null });
  const ends = full.open === null ? null : fullEnds(full.open, view);
  if (ends !== null) setFull({ open: null, back: ends });
  const leave = useCallback(
    () => setFull((cur) => (cur.open === null ? cur : { open: null, back: 'left' })),
    [],
  );
  // Closed: the page out of full screen, and focus where the student is now; with no class's name
  // on the page (the lesson refused, or no longer theirs), on what it offers to do (santa's review).
  useEffect(() => {
    if (full.open !== null || full.back === null) return;
    leaveFullscreen();
    const to = { left: 'full', question: 'question', gone: 'class' }[full.back];
    const target =
      document.getElementById(`${id}-${to}`) ??
      document.querySelector<HTMLElement>('main :is(button, a)');
    target?.focus();
  }, [full, id]);
  // The page gone, full screen goes with it.
  useEffect(() => () => leaveFullscreen(), []);

  if (view.kind === 'loading') {
    return (
      <main>
        <p role="status" className="text-body text-text-secondary">
          Loading…
        </p>
      </main>
    );
  }
  if (view.kind === 'failed') {
    return (
      <main className={SAID}>
        <p role="alert" className="text-body">
          Bali couldn&apos;t load this lesson.
        </p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </main>
    );
  }
  if (view.kind === 'not_in_class') {
    return (
      <main className={SAID}>
        <p role="alert" className="text-body">
          This lesson is for a class you&apos;re not in.
        </p>
        <Link href="/" className={buttonClass('secondary', '', 'sm')}>
          Your classes
        </Link>
      </main>
    );
  }
  if (view.kind === 'over') {
    const at = view.at === null ? null : new Date(view.at).toISOString();
    return (
      <main className="flex flex-col gap-5.5">
        <LessonHead klass={view.klass} bell={null} headingId={`${id}-class`} />
        <section
          aria-labelledby={over}
          className={`flex max-w-160 flex-col items-start gap-3 ${CARD_ALONE}`}
        >
          <h2 id={over} className="text-h3">
            Class is over
          </h2>
          <p className="text-body text-text-secondary">
            {at === null ? (
              'This class has ended.'
            ) : (
              <>
                This class ended at <time dateTime={at}>{bellTime(at)}</time>.
              </>
            )}{' '}
            Slides and questions from it aren&apos;t available after class.
          </p>
          <Link href="/" className={buttonClass('secondary')}>
            Your classes
          </Link>
        </section>
      </main>
    );
  }
  const { klass, bell, presentation, behind } = view;
  const q = presentation.question;
  const { slide } = presentation;
  // A pick that said it didn't send but a read since shows held is in (`saidNow`).
  const card = q ? (
    <QuestionCard
      headingId={`${id}-question`}
      question={q}
      sending={sending?.questionId === q.id ? sending.option : null}
      said={saidNow(said, q)}
      onPick={(option) => onPick(q.id, option)}
    />
  ) : null;
  return (
    <main className="flex flex-col gap-5.5">
      <LessonHead klass={klass} bell={bell} phone={view} headingId={`${id}-class`} />
      <PhoneLine chip={phoneChip(view)} endsAt={bell.endsAt} />
      {behind ? <CantReach /> : null}
      {slide ? (
        // The card first in the page's order at every width, so the keyboard and a screen reader
        // reach the question first: beside the slide from 1024 px (StudentLesson), over it under
        // that (StudentZoom). The slide alone keeps the width it has beside a card
        // (StudentSlideAlone).
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_25rem]">
          {card ? <div className="lg:col-start-2 lg:row-start-1">{card}</div> : null}
          <StudentSlide
            slide={slide}
            deck={deck}
            onReload={onReloadDeck}
            fullId={`${id}-full`}
            onFull={() => {
              // On the press itself: a browser lets a page go full screen only then.
              enterFullscreen();
              setFull({ open: { questionId: q?.id ?? null }, back: null });
            }}
          />
        </div>
      ) : card ? (
        // At its own width at the start of the page (StudentNoSlide); a column of its own under
        // 1024 px, as StudentZoom draws it.
        <div className="lg:max-w-100">{card}</div>
      ) : (
        <p className="text-body text-text-secondary">
          Nothing shared yet. Slides and questions from your teacher show up here.
        </p>
      )}
      {full.open && slide ? (
        <SlideFull
          slide={slide}
          deck={deck}
          behind={behind}
          onReload={onReloadDeck}
          onLeave={leave}
        />
      ) : null}
    </main>
  );
}

/**
 * The class's head (StudentLesson): the ring, the share of the session left, the class over "with
 * Ms. Rivera", the time left to the server's bell on this computer's clock with the bell under it,
 * and at its end the student's own phone as the lesson's last read says it (`phone`), on a line of
 * its own on a phone, as ClassLive's controls go; once the class is over (StudentEnded), the class
 * and its teacher alone.
 */
function LessonHead({
  klass,
  bell,
  phone,
  headingId,
}: {
  klass: StudentClass;
  bell: Bell | null;
  phone?: Pick<LessonState, 'presentation' | 'asOf'>;
  /** The class's name: focus comes here once full screen closes with its slide gone (W5). */
  headingId: string;
}) {
  const now = useClock(bell?.endsAt ?? null);
  const teacher = klass.teacher.displayName?.trim();
  return (
    <header className="flex flex-wrap items-center gap-x-4.5 gap-y-3.5 max-sm:gap-x-3.5">
      {bell ? (
        <Ring share={shareLeft(bell.startedAt, bell.endsAt, now)} box={44} stroke={5} />
      ) : null}
      <div className="min-w-0 max-sm:flex-1">
        <h1
          id={headingId}
          tabIndex={-1}
          className="text-page-title text-balance wrap-anywhere max-sm:text-h3"
        >
          {klass.name}
        </h1>
        {teacher ? (
          <p className="mt-0.5 text-meta text-text-secondary wrap-anywhere">with {teacher}</p>
        ) : null}
      </div>
      {bell ? <Countdown endsAt={bell.endsAt} now={now} /> : null}
      {phone ? (
        <div className="ml-auto flex flex-wrap items-center gap-2 max-sm:ml-0 max-sm:basis-full">
          <YourPhone chip={phoneChip(phone, new Date(now))} asOf={phone.asOf} />
        </div>
      ) : null}
    </header>
  );
}

/** What the phone's line says (StudentPhoneStates), beside its icon, for a phone not focused. */
function lineFor(chip: PhoneChip, endsAt: string): { Icon: LucideIcon; words: ReactNode } | null {
  const at = (iso: string) => <time dateTime={iso}>{bellTime(iso)}</time>;
  switch (chip.kind) {
    case 'not_in':
      return {
        Icon: Nfc,
        words: "You're not tapped in yet. Tap your teacher's block with your phone.",
      };
    case 'unlocked':
      return {
        Icon: Smartphone,
        words: (
          <>
            Everything on your phone is open until you lock your apps again in the Bali app, or
            until the bell at {at(endsAt)}. Your teacher can see you unlocked.
          </>
        ),
      };
    case 'protection_off':
      return {
        Icon: Smartphone,
        words:
          "Screen Time is off for Bali, so no app on your phone is paused and your teacher sees that it's off. Open the Bali app on your phone to turn it back on.",
      };
    case 'silent':
      return {
        Icon: Smartphone,
        words: (
          <>
            Bali hasn&apos;t heard from your phone since {at(chip.since)}, and your teacher sees
            that. Open the Bali app on your phone so it can check in.
          </>
        ),
      };
    default:
      return null;
  }
}

/**
 * The line under the head for a phone not focused (StudentPhoneStates; StudentNotIn's `.s-remind`):
 * what it means and what to do on the phone, the Unlocked one's bell the account's (`/v1/me`'s
 * `liveSession.endsAt`); none for Focused, nor for a state this page has no chip for, whose chip
 * says what to do (StudentChipStates).
 */
function PhoneLine({ chip, endsAt }: { chip: PhoneChip | null; endsAt: string }) {
  const line = chip === null ? null : lineFor(chip, endsAt);
  if (line === null) return null;
  const { Icon, words } = line;
  return (
    <div className={`flex items-start gap-3 ${NOTICE}`}>
      <Icon size={20} aria-hidden="true" className="mt-px shrink-0" />
      <p>{words}</p>
    </div>
  );
}

/**
 * An open question's answer (v2.css's `.s-opt`): white, a strong edge, 17/26; picked
 * (`aria-pressed`), the brand's fill, semibold and white, its letter white with the brand's ink, a
 * check at its end.
 */
const OPTION =
  'group flex min-h-13 w-full cursor-pointer items-center gap-3 rounded-sm border border-border-strong bg-surface-card px-4 py-3 text-left text-body-lg text-text-primary hover:bg-surface-sunken aria-pressed:border-action-primary-bg aria-pressed:bg-action-primary-bg aria-pressed:font-semibold aria-pressed:text-action-primary-fg aria-pressed:hover:bg-action-primary-bg';
/** A closed question's answer (`.s-done`); the student's own (`.mine`); the correct one (`.right`). */
const DONE = 'border border-border-default bg-surface-card px-4 py-3 text-text-secondary';
const MINE = 'border border-border-strong bg-surface-sunken px-4 py-3 text-text-primary';
const RIGHT = 'border-2 border-bar-right bg-option-right px-3.75 py-2.75 text-text-primary';
/** A closed answer's mark under its words (`.s-mark`). */
const MARK = 'inline-flex items-center gap-1 text-section-label uppercase';

/** The card's line under the answers (StudentLesson, StudentNotIn, StudentClosed; StudentCardStates). */
function caption(q: StudentQuestion, open: boolean, sending: boolean): string {
  if (!open) {
    return q.correctOption === null
      ? 'Your teacher closed this question.'
      : 'Your teacher closed it and showed the answer.';
  }
  if (sending) return 'Sending your answer…';
  return q.answer
    ? 'Your answer is in. You can change it until the question closes.'
    : 'Pick an answer. You can change it until the question closes.';
}

/**
 * The question card (StudentLesson, StudentNotIn, StudentClosed; StudentCardStates' states, drawn
 * first), the phone's card in v2's look (decision 13): a tap on an answer sends it and another
 * changes it until the close, no Submit; closed, the correct answer marked once shown, never red,
 * and the student's own as Your answer; never a count, nor anyone else's answer. `sending`: the
 * answer on its way; `said`: what the last one's request said, the line's place taken by it.
 * `headingId`: its question's, where focus comes once a question asked closes full screen (W5).
 */
function QuestionCard({
  headingId: id,
  question: q,
  sending,
  said,
  onPick,
}: {
  headingId: string;
  question: StudentQuestion;
  sending: number | null;
  said: 'too_late' | 'failed' | null;
  onPick: (option: number) => void;
}) {
  // Closed once a read says so, or once Bali said this question closed before the answer reached
  // it: too late is said on the closed card (StudentCardStates), the read saying so due within 2 s.
  const open = q.open && said !== 'too_late';
  const picked = sending ?? q.answer?.option ?? null;
  // A send that failed is no news once the question has closed: there's no picking it again.
  const alert =
    said === 'too_late'
      ? "This question closed before your answer reached Bali, so it wasn't counted."
      : said === 'failed' && open
        ? "Bali couldn't send your answer. Check your connection and pick it again."
        : null;
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3.5 rounded-live border border-border-default bg-surface-card p-5.5 shadow-1"
    >
      <div>
        <p
          className={`text-section-label uppercase ${open ? 'text-text-brand' : 'text-text-tertiary'}`}
        >
          {open ? 'Question' : 'Question · closed'}
        </p>
        <h2 id={id} tabIndex={-1} className="mt-2 text-h3 text-pretty wrap-break-word">
          {q.prompt}
        </h2>
      </div>
      <div className="flex flex-col gap-2">
        {q.options.map((option, i) => {
          if (open) {
            return (
              <button
                key={i}
                type="button"
                aria-pressed={picked === i}
                // The answer Bali holds sends nothing again, but while one is on its way (a send
                // that hangs never says it didn't send) or after one didn't send (Bali may have
                // taken it, its answer lost, and the line says to pick it again).
                onClick={() => {
                  if (picked !== i || sending !== null || said === 'failed') onPick(i);
                }}
                className={OPTION}
              >
                <span
                  aria-hidden="true"
                  className={`${letterClass(false)} group-aria-pressed:bg-surface-card group-aria-pressed:text-text-brand`}
                >
                  {letterOf(i)}
                </span>
                <span className="min-w-0 flex-1 wrap-break-word">{option}</span>
                {picked === i ? <Check size={20} aria-hidden="true" className="shrink-0" /> : null}
              </button>
            );
          }
          const right = q.correctOption === i;
          const mine = q.answer?.option === i;
          return (
            <div
              key={i}
              className={`flex min-h-13 items-center gap-3 rounded-sm text-body-lg ${right ? RIGHT : mine ? MINE : DONE}`}
            >
              <span aria-hidden="true" className={letterClass(right)}>
                {letterOf(i)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={`wrap-break-word${right ? ' font-semibold' : ''}`}>{option}</span>
                {right || mine ? (
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    {right ? (
                      <span className={`${MARK} text-text-brand`}>
                        <CircleCheck size={14} aria-hidden="true" />
                        Correct answer
                      </span>
                    ) : null}
                    {mine ? (
                      <span className={`${MARK} text-state-notjoined-fg`}>Your answer</span>
                    ) : null}
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
      {alert ? (
        <p role="alert" className="text-body">
          {alert}
        </p>
      ) : (
        <p aria-live="polite" className="text-caption text-text-tertiary">
          {caption(q, open, sending !== null)}
        </p>
      )}
      <p className="flex items-start gap-2 border-t border-border-default pt-3 text-caption text-text-tertiary">
        <EyeOff size={16} aria-hidden="true" className="mt-px shrink-0" />
        {PRIVACY}
      </p>
    </section>
  );
}
