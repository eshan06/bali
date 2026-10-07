'use client';

import type { SessionReportSummary } from '@bali/shared';
import { ChevronDown, ChevronRight, LockOpen, type LucideIcon, ShieldOff } from 'lucide-react';

import { CARD } from '@/components/card';
import { RecapCard } from '@/components/recap-card';
import { sessionRow } from '@/lib/reports';

/**
 * A session's row (the Recap & reports design): from the list's width where the session and its six
 * figures fit side by side (a 1024 px window included), under the column names, in the canvas's
 * widths; narrower, each figure sits under its own name, three to a row and then two.
 */
export const ROW =
  '@4xl:grid-cols-[minmax(0,1fr)_4.5rem_6.5rem_6rem_5rem_5.5rem_8.5rem] @4xl:gap-x-4';
/** The figures' names, in the columns' order: the column names and each figure's own say these. */
export const COLUMNS = [
  'Joined',
  'Focus time',
  'Average',
  'Silent',
  'Unlocks',
  'Protection off',
] as const;
const [JOINED, FOCUS, AVERAGE, SILENT, UNLOCKS, PROTECTION_OFFS] = COLUMNS;
/** Small grey words, and a figure that is zero, in the captions' ink. */
export const QUIET = 'text-text-tertiary';

/**
 * A session's card in the reports list: its day over its times, which open its recap's timeline
 * under a hairline, then its figures. A session nobody joined says so in the four figures' place,
 * never zeros.
 */
export function Row({
  classId,
  session,
  open,
  onToggle,
}: {
  classId: string;
  session: SessionReportSummary;
  open: boolean;
  onToggle: () => void;
}) {
  const row = sessionRow(session);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li className={CARD}>
      <div className={`grid gap-3 @4xl:items-center ${ROW}`}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? `recap-${session.id}` : undefined}
          onClick={onToggle}
          className="group flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-sm text-left"
        >
          <Chevron size={16} aria-hidden="true" className="shrink-0 text-text-tertiary" />
          <span className="flex min-w-0 flex-col">
            <span className="text-body font-semibold underline-offset-2 group-hover:underline">
              {row.day}
              <span className="sr-only">,</span>
            </span>
            <span className="text-data font-normal text-text-secondary">{row.times}</span>
          </span>
        </button>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 @sm:grid-cols-3 @4xl:col-span-6 @4xl:grid-cols-subgrid @4xl:items-center @4xl:gap-y-0">
          {row.figures ? (
            <>
              <Figure label={JOINED} value={row.figures.joined} />
              <Figure label={FOCUS} value={row.figures.focus} unit zero={!session.focusMinutes} />
              <Figure
                label={AVERAGE}
                value={row.figures.average}
                unit
                zero={!session.averageFocusMinutes}
              />
              <Figure
                label={SILENT}
                value={row.figures.silent}
                unit
                zero={!session.silentMinutes}
              />
            </>
          ) : (
            // No zeros for a session nobody joined, as its recap says (R5).
            <div className="col-span-full text-body text-text-secondary @4xl:col-span-4 @4xl:text-right">
              <dt className="sr-only">{JOINED}</dt>
              <dd>Nobody joined</dd>
            </div>
          )}
          <Figure
            label={UNLOCKS}
            value={row.unlocks}
            zero={!session.unlockCount}
            icon={LockOpen}
            ink="text-state-emergency-fg"
          />
          <Figure
            label={PROTECTION_OFFS}
            value={row.protectionOffs}
            zero={!session.protectionOffCount}
            icon={ShieldOff}
            ink="text-state-revoked-fg"
          />
        </dl>
      </div>
      {open ? (
        <div id={`recap-${session.id}`} className="mt-4 border-t border-border-default pt-4">
          <RecapCard classId={classId} session={session} />
        </div>
      ) : null}
    </li>
  );
}

/**
 * A session's figure in `data`: its name above it on a narrow row, and on a wide one only for a
 * screen reader, the column names above the list saying it for the eye. Minutes carry "min" in
 * `text-secondary`; a zero is quiet; an unlock or protection-off count above zero takes its
 * state's ink and icon, never colour alone.
 */
function Figure({
  label,
  value,
  unit = false,
  zero = false,
  icon: Icon,
  ink,
}: {
  label: string;
  value: string;
  unit?: boolean;
  zero?: boolean;
  icon?: LucideIcon;
  ink?: string;
}) {
  return (
    <div className="@4xl:text-right">
      <dt className="text-label text-text-tertiary uppercase @4xl:sr-only">{label}</dt>
      <dd className="mt-1 text-data @4xl:mt-0">
        {Icon && !zero ? (
          <span className={`inline-flex items-center gap-1 ${ink}`}>
            <Icon size={14} aria-hidden="true" />
            {value}
          </span>
        ) : (
          <span className={zero ? QUIET : ''}>
            {value}
            {unit ? (
              <span className={`font-normal ${zero ? '' : 'text-text-secondary'}`}> min</span>
            ) : null}
          </span>
        )}
      </dd>
    </div>
  );
}
