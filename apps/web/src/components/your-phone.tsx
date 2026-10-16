'use client';

import type { GridDisplay } from '@/lib/grid-state';
import { bellTime } from '@/lib/session-controls';
import type { PhoneChip } from '@/lib/student-web';

import { CHIP, CHIP_PILL, DOT } from './live-grid';

/**
 * A chip's look and words (StudentPhoneStates): the grid's state's tint, icon and edge, so it never
 * reads greener than the teacher's tile, in the app's words ("Not in", "Screen Time off"); a state
 * this page has no chip for in the grid's Unknown, its words saying what to do (StudentChipStates).
 */
function look(chip: PhoneChip): { display: GridDisplay; label: string } {
  switch (chip.kind) {
    case 'focused':
      return { display: 'focused', label: 'Focused' };
    case 'not_in':
      return { display: 'absent', label: 'Not in' };
    case 'unlocked':
      return { display: 'unlocked', label: 'Unlocked' };
    case 'protection_off':
      return { display: 'protection_off', label: 'Screen Time off' };
    case 'silent':
      return { display: 'silent', label: `Silent · ${chip.minutes} min` };
    case 'unknown':
      return { display: 'unknown', label: CHIP.unknown.label };
  }
}

/**
 * "Your phone" and its chip (`.s-phone`; StudentLesson's head, StudentHome's live card): the
 * student's own phone as the lesson's read says it (`phoneChip`); Checking… before Bali first
 * answers (`chip` null; StudentPhoneStates); and while the page can't reach Bali, the chip kept
 * "as of" the last good read (`asOf`; StudentPhoneStates, StudentChipStates).
 */
export function YourPhone({
  chip,
  asOf,
  className = '',
}: {
  chip: PhoneChip | null;
  asOf: number | null;
  className?: string;
}) {
  const at = chip !== null && asOf !== null ? new Date(asOf).toISOString() : null;
  const shown = chip === null ? null : look(chip);
  const Icon = shown === null ? null : CHIP[shown.display].icons.at(-1);
  return (
    <p role="status" className={`inline-flex flex-wrap items-center gap-2 ${className}`.trim()}>
      <span className="text-caption text-text-tertiary">Your phone</span>
      {shown === null ? (
        <span className="text-caption text-text-secondary">Checking…</span>
      ) : (
        <span className={`${CHIP_PILL} ${CHIP[shown.display].tone}`}>
          {Icon ? <Icon size={13} aria-hidden="true" className="shrink-0" /> : null}
          {shown.label.replaceAll(' · ', DOT)}
        </span>
      )}
      {at === null ? null : (
        <span className="text-caption text-text-tertiary">
          as of <time dateTime={at}>{bellTime(at)}</time>
        </span>
      )}
    </p>
  );
}
