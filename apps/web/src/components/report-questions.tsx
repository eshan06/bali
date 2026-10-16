'use client';

import type { SessionReportQuestion } from '@bali/shared';
import { useId } from 'react';

import { Button } from '@/components/button';
import { CARD_ALONE } from '@/components/card';
import {
  ANSWERED_COLUMN,
  answeredLine,
  Options,
  OPTIONS_COLUMN,
  RESULTS,
} from '@/components/question-card';
import type { SessionQuestions } from '@/lib/reports';
import { bellTime } from '@/lib/session-controls';

/** v2.css's `.said`: a line and its Try again beside it, under it on a narrow card. */
const SAID = 'flex flex-wrap items-center gap-x-4 gap-y-3';

/**
 * A session's Questions card on its report page (L7c): ReportOpened's Questions, LessonStates' lines
 * for it, and its intermediate states as ReportQuestionsStates draws them (drawn on the canvas
 * first). Each question the session asked, in the order asked, with its totals as the server counts
 * them, through the class page's card's own options and bars. The guard is the server's: a question
 * whose `counts` is null (under 3 answers) says so and shows no breakdown. Only totals: never who
 * answered, or what. None asked: no card. Its read is its own, loading and failing under its title,
 * the report above it standing either way.
 */
export function ReportQuestions({
  questions,
  onRetry,
}: {
  questions: SessionQuestions;
  onRetry: () => void;
}) {
  const id = useId();
  if (questions.kind === 'ready' && questions.questions.length === 0) return null;
  return (
    <section
      aria-labelledby={id}
      aria-busy={questions.kind === 'loading'}
      className={`flex flex-col gap-5.5 ${CARD_ALONE}`}
    >
      {/* v2.css's `.lesson-title`: the card's title, how many it asked under it. */}
      <div className="flex flex-col gap-0.75">
        <h2 id={id} className="text-section-label text-text-tertiary uppercase">
          Questions
        </h2>
        {questions.kind === 'ready' ? (
          <p className="text-body text-text-secondary">
            {questions.questions.length} asked in this session
          </p>
        ) : null}
      </div>
      {questions.kind === 'loading' ? (
        <p role="status" className="text-body text-text-secondary">
          Loading…
        </p>
      ) : questions.kind === 'error' ? (
        <div className={SAID}>
          <p role="alert" className="text-body">
            Bali couldn&apos;t load this session&apos;s questions.
          </p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : (
        questions.questions.map((question, i) => (
          <Asked key={question.id} question={question} first={i === 0} />
        ))
      )}
    </section>
  );
}

/**
 * One question asked (v2.css's `.results`): when it was asked and, when it has a correct answer,
 * whether students were shown it; its words; the guard's line while the server gives no breakdown;
 * its options; and "N of M answered". The ones after the first under a hairline.
 */
function Asked({ question, first }: { question: SessionReportQuestion; first: boolean }) {
  const asked = bellTime(question.openedAt);
  return (
    <div className={first ? RESULTS : `${RESULTS} border-t border-border-default pt-5`}>
      <div className={OPTIONS_COLUMN}>
        <p className="text-caption text-text-tertiary">
          {question.correctOption === null
            ? asked
            : `${asked} · ${question.revealed ? 'Answer shown' : 'Answer not shown'}`}
        </p>
        <h3 className="mt-1 text-h3 text-pretty wrap-break-word">{question.prompt}</h3>
        {/* Under the question as the board renders it: `.app p`'s margin 0 outranks `.guard`'s. */}
        {question.counts === null ? (
          <p className="text-body text-text-secondary">Too few answers to show a breakdown.</p>
        ) : null}
        <Options
          question={question}
          counts={question.counts}
          answered={question.answered}
          shown={!question.open && question.revealed}
        />
      </div>
      <div className={ANSWERED_COLUMN}>{answeredLine(question.answered, question.eligible)}</div>
    </div>
  );
}
