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
import { Fragment, useEffect, useId, useState } from 'react';

import { reasonWords } from '@/components/unlock-popups';
import type {
  Mark,
  Moment,
  RecapFormat,
  RecapGroups,
  RecapStudent,
  Timeline as View,
} from '@/lib/recap';
import { bellTime } from '@/lib/session-controls';

/**
 * Each moment's words, icon, fill and ink: its state's pair (DESIGN.md §2), never colour alone.
 * The owner's labels (2026-10-06), and the grid's own words for its states.
 */
const MOMENT: Record<Moment, [label: string, Icon: LucideIcon | null, fill: string, ink: string]> =
  {
    in: ['Tapped in', null, 'bg-text-secondary', 'text-text-primary'],
    unlock: ['Unlocked', LockOpen, 'bg-state-emergency-bg', 'text-state-emergency-fg'],
    focus: ['Back in focus', CircleCheck, 'bg-state-focused-bg', 'text-state-focused-fg'],
    off: ['Protection off', ShieldOff, 'bg-state-revoked-bg', 'text-state-revoked-fg'],
    on: ['Protection back on', ShieldCheck, 'bg-state-notjoined-bg', 'text-state-notjoined-fg'],
    silent: ['Silent', WifiOff, 'bg-state-ended-bg', 'text-state-ended-fg'],
    back: ['Checked in again', Wifi, 'bg-state-notjoined-bg', 'text-state-notjoined-fg'],
    left: ['Left', Flag, 'bg-state-ended-bg', 'text-state-ended-fg'],
  };
/** The student panel (PV11b) says each moment in these words too. */
export { MOMENT };

/**
 * A mark's look: a 20 px disc with its icon, edged in the card's colour so the line breaks around
 * it; Tapped in a 12 px dot; Silent edged dashed, as its chip is.
 */
function look(moment: Moment): string {
  const [, , fill, ink] = MOMENT[moment];
  if (moment === 'in') return `size-3 rounded-full border-2 border-surface-card ${fill}`;
  const edge =
    moment === 'silent'
      ? 'border border-dashed border-border-strong'
      : 'border-2 border-surface-card';
  return `grid size-5 place-items-center rounded-full ${edge} ${fill} ${ink}`;
}

/**
 * Where each of a row's marks sits, as CSS `left` (its centre): at its time, or right after the
 * marks before it, packed edge to edge by their widths as `look` draws them, whichever is later;
 * and never past the end less the room the marks after it take. So marks under a minute apart
 * sit side by side, each seen and hovered on its own at any width, nudged no further than they
 * must be; a mark's time is in its label and its card all the same. CSS works it out at the
 * axis's own width, so nothing is measured. Marks only, never a bar.
 * The recap's marks (PV12b) are all one `size`, 18 px.
 * ponytail: a row with more marks than its axis has room for piles its first ones up, overlapping,
 * at its start; and each mark's style names every mark before it, so a row's styles grow with the
 * square of its marks (~30 KB for 50). Drop the terms that can't bind if either ever shows.
 */
export function lefts(marks: readonly Pick<Mark, 'moment' | 'x'>[], size?: number): string[] {
  let edge = 0;
  const packed = marks.map(({ moment, x }) => {
    const width = size ?? (moment === 'in' ? 12 : 20);
    edge += width;
    return { x, centre: edge - width / 2 };
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

function Glyph({ moment, size = 12 }: { moment: Moment; size?: number }) {
  const [, Icon] = MOMENT[moment];
  return Icon ? <Icon size={size} aria-hidden="true" className="shrink-0" /> : null;
}

/** Side by side from where the names' column leaves the axis room; stacked on a phone. */
const ROW = 'grid gap-x-6 gap-y-1 @min-[40rem]:grid-cols-[12.5rem_minmax(0,1fr)]';
/** The card opens toward the axis's middle, so it never runs off a narrow one. */
const FLIP = '-translate-x-[calc(100%_-_36px)]';
const FLIP_NARROW = '@max-[56rem]:-translate-x-[calc(100%_-_36px)]';

/**
 * The session's timeline (the Recap & reports design): a legend of the marks it shows, the axis,
 * and a row per student, each moment a mark at its time. A mark is a button: hovered or focused,
 * it opens a card saying what, who, when and, but in Present, an unlock's reason, which its label
 * says too; the pointer can move onto it. Marks too close to tell apart sit side by side
 * (`lefts`).
 */
export function Timeline({ view, label }: { view: View; label: string }) {
  const id = useId();
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const open = hovered ?? focused;
  // Where each mark whose card opened sits, in percent of its axis: `lefts` may have moved it off
  // its time, and its card opens toward the axis's middle from where the mark is, never past an end.
  const [placedAt, setPlacedAt] = useState<Record<string, number>>({});
  const opening = (key: string, mark: HTMLElement) => {
    const axis = mark.offsetParent?.clientWidth;
    if (!axis) return;
    const at = ((mark.offsetLeft + mark.offsetWidth / 2) / axis) * 100;
    setPlacedAt((p) => ({ ...p, [key]: at }));
  };
  const last = view.ticks.length - 1;
  const hover = (key: string | null) => () => setHovered(key);
  // Escape closes the open card wherever focus is, without moving the pointer (WCAG 1.4.13).
  useEffect(() => {
    if (open === null) return;
    const close = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setHovered(null);
      setFocused(null);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);
  // Who joined, then anyone with a mark there who never did, under words of their own: one who
  // unlocked without joining is never listed as one who joined.
  const groups = (
    [
      ['Who joined', view.rows.slice(0, view.joined)],
      ["Didn't join", view.rows.slice(view.joined)],
    ] as const
  ).filter(([, rows]) => rows.length > 0);
  // Each row's marks, side by side where they would overlap (`lefts`).
  const placed = new Map(view.rows.map((row) => [row.key, lefts(row.marks)]));
  return (
    <section aria-label={label} className="mt-6">
      <ul
        aria-label="What the marks mean"
        className="flex flex-wrap items-center gap-x-5 gap-y-2 text-caption text-text-secondary"
      >
        {view.moments.map((m) => (
          <li key={m} className="inline-flex items-center gap-2">
            <span className={`shrink-0 ${look(m)}`}>
              <Glyph moment={m} />
            </span>
            {MOMENT[m][0]}
          </li>
        ))}
      </ul>
      {view.moments.includes('unlock') ? null : (
        <p className="mt-3 text-body text-text-secondary">No unlocks.</p>
      )}
      <div className={`mt-5 items-end pb-2 ${ROW}`}>
        <span id={`${id}-0`} className="text-caption text-text-tertiary">
          {groups[0]?.[0]}
        </span>
        {/* Narrower, every other time between the ends, then none, so no two labels touch. */}
        <div aria-hidden="true" className="relative h-4.5">
          {view.ticks.map((t, i) => (
            <span
              key={i}
              style={{ left: `${t.x}%` }}
              className={`absolute top-0 text-caption whitespace-nowrap text-text-tertiary ${i === 0 ? '' : i === last ? '-translate-x-full' : `-translate-x-1/2 @max-[28rem]:hidden ${i % 2 ? '@max-[64rem]:hidden' : ''}`}`}
            >
              {t.label}
            </span>
          ))}
        </div>
      </div>
      {groups.map(([heading, rows], g) => (
        <Fragment key={heading}>
          {g > 0 ? (
            <p id={`${id}-${g}`} className="mt-4 pb-2 text-caption text-text-tertiary">
              {heading}
            </p>
          ) : null}
          <ul aria-labelledby={`${id}-${g}`}>
            {rows.map((row) => (
              <li key={row.key} className={`items-center ${ROW}`}>
                <span className="min-w-0 text-body break-words">{row.name}</span>
                <div
                  style={{ backgroundSize: `${view.step}% 100%` }}
                  className="relative h-9 border-r border-border-default bg-[linear-gradient(to_right,var(--bali-border-default)_1px,transparent_1px)]"
                >
                  {/* From the first mark to the end, the same for everyone: never a student's minutes. */}
                  {row.marks.length > 0 ? (
                    <span
                      style={{ left: placed.get(row.key)?.[0] }}
                      className="absolute top-[17px] right-0 h-0.5 rounded-full bg-border-strong"
                    />
                  ) : null}
                  {row.marks.map((m, i) => {
                    const [words, , , ink] = MOMENT[m.moment];
                    const left = placed.get(row.key)?.[i];
                    const at = placedAt[m.key] ?? m.x;
                    return (
                      <Fragment key={m.key}>
                        <button
                          type="button"
                          aria-label={`${row.name}, ${words.toLowerCase()} at ${m.time}${m.reason ? `, ${m.reason}` : ''}`}
                          style={{ left }}
                          onMouseEnter={(e) => {
                            opening(m.key, e.currentTarget);
                            setHovered(m.key);
                          }}
                          onMouseLeave={hover(null)}
                          onFocus={(e) => {
                            opening(m.key, e.currentTarget);
                            setFocused(m.key);
                          }}
                          onBlur={() => setFocused(null)}
                          className={`absolute z-1 cursor-pointer before:absolute before:inset-x-0 before:bottom-full before:h-2.5 ${m.moment === 'in' ? 'top-3 -ml-1.5' : 'top-2 -ml-2.5'} ${look(m.moment)} ${open === m.key ? 'outline-2 outline-offset-2 outline-focus-ring' : ''}`}
                        >
                          <Glyph moment={m.moment} />
                        </button>
                        {open === m.key ? (
                          <div
                            aria-hidden="true"
                            style={{ left }}
                            onMouseEnter={hover(m.key)}
                            onMouseLeave={hover(null)}
                            className={`absolute bottom-[calc(100%_-_4px)] z-2 -ml-4.5 w-max max-w-[min(16rem,calc(50%_+_18px))] rounded-md border border-border-default bg-surface-raised px-4 py-3 text-body break-words shadow-2 @min-[56rem]:max-w-[min(16rem,calc(30%_+_18px))] ${at > 70 ? FLIP : at > 50 ? FLIP_NARROW : ''}`}
                          >
                            <p className={`flex items-center gap-2 font-semibold ${ink}`}>
                              <Glyph moment={m.moment} size={14} />
                              {words}
                            </p>
                            <p className="mt-0.5 text-caption text-text-secondary">
                              {row.name} · {m.time}
                            </p>
                            {m.reason ? <p className="mt-1">{m.reason}</p> : null}
                          </div>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </Fragment>
      ))}
    </section>
  );
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
