'use client';

import {
  CircleCheck,
  Flag,
  LockOpen,
  type LucideIcon,
  ShieldCheck,
  ShieldOff,
  Wifi,
  WifiOff,
} from 'lucide-react';

import { reasonWords } from '@/components/unlock-popups';
import type { Moment, RecapFormat, RecapGroups, RecapStudent } from '@/lib/recap';
import { bellTime } from '@/lib/session-controls';

/**
 * Each moment's words and icon, its state's (DESIGN.md §2): the owner's labels (2026-10-06), and
 * the grid's own words for its states. The recap's marks and words, and the student panel's moments
 * (PV11b), all say them so.
 */
export const MOMENT: Record<Moment, [label: string, Icon: LucideIcon | null]> = {
  in: ['Tapped in', null],
  unlock: ['Unlocked', LockOpen],
  focus: ['Back in focus', CircleCheck],
  off: ['Protection off', ShieldOff],
  on: ['Protection back on', ShieldCheck],
  silent: ['Silent', WifiOff],
  back: ['Checked in again', Wifi],
  left: ['Left', Flag],
};

/**
 * Where each of a row's marks sits, as CSS `left` (its centre): at its time, or right after the
 * marks before it, packed edge to edge, each `size` px wide, whichever is later; and never past
 * the end less the room the marks after it take. So marks under a minute apart sit side by side,
 * each seen on its own at any width, nudged no further than they must be; a mark's time is in the
 * row's words all the same. CSS works it out at the axis's own width, so nothing is measured.
 * Marks only, never a bar. The recap's marks (PV12b) are 18 px.
 * ponytail: a row with more marks than its axis has room for piles its first ones up, overlapping,
 * at its start; and each mark's style names every mark before it, so a row's styles grow with the
 * square of its marks (~30 KB for 50). Drop the terms that can't bind if either ever shows.
 */
export function lefts(marks: readonly { x: number }[], size: number): string[] {
  let edge = 0;
  const packed = marks.map(({ x }) => {
    edge += size;
    return { x, centre: edge - size / 2 };
  });
  const end = packed.at(-1)?.centre ?? 0;
  return packed.map(({ x, centre }, i) => {
    if (packed.length === 1) return `${x}%`;
    const after = packed.slice(0, i).map((p) => `calc(${p.x}% + ${centre - p.centre}px)`);
    const at = after.length > 0 ? `max(${x}%, ${after.join(', ')})` : `${x}%`;
    const room = end - centre;
    return `min(${at}, ${room > 0 ? `max(0%, calc(100% - ${room}px))` : '100%'})`;
  });
}

/**
 * A mark's ring (v2.css's `.mk`): an unlock's orange, a protection off's red, Silent's dashed,
 * every other stone, each in its state's ink.
 */
const RING: Partial<Record<Moment, string>> = {
  unlock: 'border-unlock-edge text-state-emergency-fg',
  off: 'border-mark-off text-state-revoked-fg',
  silent: 'border-dashed border-mark text-text-secondary',
};

/**
 * A student's moments in words, as ClassEnded says them: "Unlocked at 9:18 AM, Bathroom. Back in
 * focus at 9:24 AM." Each but their first tap-in, where their line starts; an unlock's reason (the
 * tile's words, none in lowercase) after its time, but in Present, which the class can see (#265).
 */
export function saidOf(student: RecapStudent, present = false, format: RecapFormat = {}): string {
  const first = student.moments.find((m) => m.moment === 'in');
  return student.moments
    .filter((m) => m !== first)
    .map((m) => {
      const why = m.reason === null ? 'no reason given' : reasonWords(m.reason);
      const reason = m.moment === 'unlock' && !present ? `, ${why}` : '';
      return `${MOMENT[m.moment][0]} at ${bellTime(m.at.toISOString(), format)}${reason}.`;
    })
    .join(' ');
}

/**
 * Where a tick between the axis's ends hides, by the axis's own width, so no two labels touch: one
 * beside an end needs about 80 px from it (the end's label carries AM or PM), any other about 40.
 * Ticks are `step` % of the axis apart, a sixth at least (`recapGroups`).
 */
function tickHides(step: number, besideEnd: boolean): string {
  if (step >= 20) return besideEnd ? '@max-[25rem]/axis:hidden' : '@max-[13rem]/axis:hidden';
  return besideEnd ? '@max-[30rem]/axis:hidden' : '@max-[15rem]/axis:hidden';
}

/** A row (v2.css's `.xrows`): the name, the line, the words, side by side; on a phone, stacked. */
const XROW =
  'grid grid-cols-1 items-center gap-x-4.5 gap-y-1.5 @min-[40rem]:grid-cols-[170px_minmax(0,1fr)_minmax(0,1.15fr)]';

/**
 * A student's line (v2.css's `.mline`), for the eye only, the words saying all it draws: a thin
 * stone line from each tap-in, and each other moment a mark on it, side by side where they would
 * overlap (`lefts`), its icon at v2.css's 2.25 by a class, which outranks the 1.75 rule.
 */
function Line({ student }: { student: RecapStudent }) {
  const marks = student.moments.filter((m) => m.moment !== 'in');
  const placed = lefts(marks, 18);
  return (
    <span aria-hidden="true" className="relative block h-5.5">
      {student.spans.map((span, i) => (
        <span
          key={i}
          style={{ left: `${span.from}%`, width: `${span.to - span.from}%` }}
          className="absolute top-2.5 h-0.5 rounded-full bg-border-strong"
        />
      ))}
      {marks.map((m, i) => {
        const Icon = MOMENT[m.moment][1];
        return (
          <span
            key={m.key}
            style={{ left: placed[i] }}
            className={`absolute top-0.5 -ml-2.25 grid size-4.5 place-items-center rounded-full border-[1.5px] bg-surface-card ${RING[m.moment] ?? 'border-mark text-text-secondary'}`}
          >
            {Icon ? <Icon size={10} aria-hidden="true" className="stroke-[2.25]" /> : null}
          </span>
        );
      })}
    </span>
  );
}

/** Students under the axis, a row each between hairlines. */
function Rows({ students, groups, present }: { students: readonly RecapStudent[] } & Lists) {
  const last = groups.ticks.length - 1;
  return (
    <ul>
      <li aria-hidden="true" className={`${XROW} pb-1.5`}>
        <span className="@max-[40rem]:hidden" />
        <span className="@container/axis relative h-4">
          {groups.ticks.map((t, i) => (
            <span
              key={i}
              style={{ left: `${t.x}%` }}
              className={`absolute top-0 text-axis whitespace-nowrap text-text-tertiary ${i === 0 ? '' : i === last ? '-translate-x-full' : `-translate-x-1/2 ${tickHides(groups.step, i === 1 || i === last - 1)}`}`}
            >
              {t.label}
            </span>
          ))}
        </span>
        <span className="@max-[40rem]:hidden" />
      </li>
      {students.map((s) => (
        <li key={s.key} className={`${XROW} border-t border-border-default py-3 last:border-b`}>
          <span className="text-tile-name wrap-anywhere">{s.name}</span>
          <Line student={s} />
          <span className="text-data font-normal text-text-secondary">{saidOf(s, present)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Names alone, each in a grey pill (v2.css's `.namelist`). */
const names = (students: readonly RecapStudent[]) => (
  <ul className="flex flex-wrap gap-x-2 gap-y-1.5">
    {students.map((s) => (
      <li
        key={s.key}
        className="rounded-full bg-surface-sunken px-2.5 py-0.75 text-meta wrap-anywhere"
      >
        {s.name}
      </li>
    ))}
  </ul>
);

/** A group's label (v2.css's `.wlabel`). */
const GROUP = 'text-section-label text-text-tertiary uppercase';

interface Lists {
  groups: RecapGroups;
  present: boolean;
}

/**
 * The recap's three groups (PV12b; ClassEnded, from PV12a's `recapGroups`), each only when it has
 * someone. Someone who never joined but has an unlock or protection off here (rare; no board draws
 * it) gets a row under the names, so the moment is never hidden. No reason in Present (#265),
 * though the recap is never there since PV9.
 */
export function RecapLists({ groups, present }: Lists) {
  const { partTime, wholeTime, notJoined } = groups;
  const marked = notJoined.filter((s) => s.moments.length > 0);
  const named = notJoined.filter((s) => s.moments.length === 0);
  return (
    <>
      {partTime.length > 0 ? (
        <div>
          <h3 className={`mb-1.5 ${GROUP}`}>Focused part of the time · {partTime.length}</h3>
          <Rows students={partTime} groups={groups} present={present} />
        </div>
      ) : null}
      {wholeTime.length > 0 ? (
        <div>
          <h3 className={`mb-1 ${GROUP}`}>Focused the whole time · {wholeTime.length}</h3>
          <p className="mb-2.5 text-caption text-text-tertiary">
            From their own tap-in to the end of the session, they never unlocked, turned protection
            off, went silent or left. A late tap-in still counts.
          </p>
          {names(wholeTime)}
        </div>
      ) : null}
      {notJoined.length > 0 ? (
        <div>
          <h3 className={`mb-2.5 ${GROUP}`}>Didn&apos;t join · {notJoined.length}</h3>
          {named.length > 0 ? names(named) : null}
          {marked.length > 0 ? (
            <div className={named.length > 0 ? 'mt-4.5' : ''}>
              <Rows students={marked} groups={groups} present={present} />
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
